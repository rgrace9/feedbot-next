import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { OPENROUTER_MODELS } from "../constants/models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ProgressFile = {
  model: string;
  prompt: string;
  filename: string;
};

type EvaluationRow = {
  category: string;
  test_name: string;
  error_type: string;
  count: string;
  fingerprint: string;
  canonical_key: string;
  clean_error_text: string;
};

type StateFile = {
  processed: {
    [fingerprint: string]: {
      hint: string;
      timestamp: string;
      usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        costUSD?: number;
      };
    };
  };
};

type OpenRouterResultRow = {
  model: string;
  prompt: string;
  fingerprint: string;
  category: string;
  test_name: string;
  error_type: string;
  clean_error_text: string;
  timestamp: string;
  hint: string;
  prompt_tokens: string;
  completion_tokens: string;
  total_tokens: string;
  cost_usd: string;
  state_file: string;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function discoverOpenRouterProgressFiles(outputDir: string): ProgressFile[] {
  const files = readdirSync(outputDir);
  const openRouterModelSet = new Set(OPENROUTER_MODELS);
  const results: ProgressFile[] = [];

  for (const filename of files) {
    const match = filename.match(/^feedbot_progress_m-(.+)_p-(.+)\.json$/);
    if (!match) {
      continue;
    }

    const encodedModel = match[1];
    const encodedPrompt = match[2];
    if (!encodedModel || !encodedPrompt) {
      continue;
    }

    const model = safeDecode(encodedModel);
    const prompt = safeDecode(encodedPrompt);

    if (!openRouterModelSet.has(model)) {
      continue;
    }

    results.push({ model, prompt, filename });
  }

  return results;
}

function loadStateFile(filePath: string): StateFile | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as StateFile;
  } catch (error) {
    console.warn(`Failed to read ${filePath}:`, error);
    return null;
  }
}

function formatMaybeNumber(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function formatMaybeCost(value: number | undefined): string {
  return value === undefined ? "" : value.toFixed(6);
}

function escapeInlineMarkdown(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function buildMarkdown(rows: OpenRouterResultRow[]): string {
  const lines: string[] = [];
  lines.push("# OpenRouter FeedBot Aggregated Results");
  lines.push("");
  lines.push(`Total requests: ${rows.length}`);
  lines.push("");

  const byModel: Record<
    string,
    {
      count: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cost: number;
    }
  > = {};

  for (const row of rows) {
    if (!byModel[row.model]) {
      byModel[row.model] = {
        count: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
      };
    }
    byModel[row.model]!.count += 1;
    byModel[row.model]!.promptTokens += Number.parseInt(
      row.prompt_tokens || "0",
      10,
    );
    byModel[row.model]!.completionTokens += Number.parseInt(
      row.completion_tokens || "0",
      10,
    );
    byModel[row.model]!.totalTokens += Number.parseInt(
      row.total_tokens || "0",
      10,
    );
    byModel[row.model]!.cost += Number.parseFloat(row.cost_usd || "0");
  }

  lines.push("## Model Summary");
  lines.push(
    "| Model | Requests | Tokens: Prompt | Tokens: Completion | Tokens: Total | Total Cost (USD) | Avg Cost / Request |",
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|");

  for (const [model, summary] of Object.entries(byModel)) {
    const avgCost = summary.count > 0 ? summary.cost / summary.count : 0;
    lines.push(
      `| ${model} | ${summary.count} | ${summary.promptTokens} | ${summary.completionTokens} | ${summary.totalTokens} | ${summary.cost.toFixed(6)} | ${avgCost.toFixed(6)} |`,
    );
  }

  lines.push("");
  lines.push("## Requests");
  lines.push(
    "| Model | Prompt | Fingerprint | Timestamp | Total Tokens | Cost (USD) | Hint |",
  );
  lines.push("|---|---|---|---|---:|---:|---|");

  for (const row of rows) {
    lines.push(
      `| ${escapeInlineMarkdown(row.model)} | ${escapeInlineMarkdown(row.prompt)} | ${escapeInlineMarkdown(row.fingerprint)} | ${escapeInlineMarkdown(row.timestamp)} | ${row.total_tokens || ""} | ${row.cost_usd || ""} | ${escapeInlineMarkdown(row.hint)} |`,
    );
  }

  return lines.join("\n");
}

(async () => {
  const outputDir = path.join(__dirname, "../feedbotOutput");
  const csvPath = path.join(outputDir, "openrouter_aggregated_results.csv");
  const markdownPath = path.join(outputDir, "openrouter_aggregated_results.md");
  const datasetPath = path.join(__dirname, "../data/evaluation_dataset.csv");

  console.log("Aggregating OpenRouter progress files...");

  const progressFiles = discoverOpenRouterProgressFiles(outputDir);
  if (progressFiles.length === 0) {
    console.error("No OpenRouter progress files found in feedbotOutput.");
    return;
  }

  const datasetContent = readFileSync(datasetPath, "utf-8");
  const datasetRows: EvaluationRow[] = parse(datasetContent, {
    columns: true,
    skip_empty_lines: true,
  });

  const metadataByFingerprint: Record<string, EvaluationRow> = {};
  for (const row of datasetRows) {
    metadataByFingerprint[row.fingerprint] = row;
  }

  const aggregatedRows: OpenRouterResultRow[] = [];

  for (const progressFile of progressFiles) {
    const statePath = path.join(outputDir, progressFile.filename);
    const state = loadStateFile(statePath);

    if (!state) {
      continue;
    }

    for (const [fingerprint, result] of Object.entries(state.processed)) {
      const metadata = metadataByFingerprint[fingerprint];

      aggregatedRows.push({
        model: progressFile.model,
        prompt: progressFile.prompt,
        fingerprint,
        category: metadata?.category ?? "",
        test_name: metadata?.test_name ?? "",
        error_type: metadata?.error_type ?? "",
        clean_error_text: metadata?.clean_error_text ?? "",
        timestamp: result.timestamp,
        hint: result.hint,
        prompt_tokens: formatMaybeNumber(result.usage?.promptTokens),
        completion_tokens: formatMaybeNumber(result.usage?.completionTokens),
        total_tokens: formatMaybeNumber(result.usage?.totalTokens),
        cost_usd: formatMaybeCost(result.usage?.costUSD),
        state_file: progressFile.filename,
      });
    }
  }

  aggregatedRows.sort((a, b) => {
    if (a.model !== b.model) {
      return a.model.localeCompare(b.model);
    }
    return a.timestamp.localeCompare(b.timestamp);
  });

  const csvHeaders: Array<keyof OpenRouterResultRow> = [
    "model",
    "prompt",
    "fingerprint",
    "category",
    "test_name",
    "error_type",
    "clean_error_text",
    "timestamp",
    "hint",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cost_usd",
    "state_file",
  ];

  const csvData = stringify(aggregatedRows, {
    header: true,
    columns: csvHeaders,
  });

  writeFileSync(csvPath, csvData, "utf-8");
  writeFileSync(markdownPath, buildMarkdown(aggregatedRows), "utf-8");

  console.log(`OpenRouter CSV written: ${csvPath}`);
  console.log(`OpenRouter Markdown written: ${markdownPath}`);
  console.log(`Rows aggregated: ${aggregatedRows.length}`);
})();
