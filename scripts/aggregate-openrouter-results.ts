import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { OPENROUTER_MODELS } from "../constants/models.js";
import { DATASET } from "../constants/spreadsheets.js";
import {
  normalizeEvaluationRow,
  type EvaluationRow,
  type RawEvaluationRow,
} from "./classes/PromptGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ProgressFile = {
  model: string;
  prompt: string;
  filename: string;
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
        responseId?: string;
      };
    };
  };
};

type OpenRouterResultRow = {
  model: string;
  prompt: string;
  fingerprint: string;
  name: string;
  score: string;
  max_score: string;
  is_active: string;
  title: string;
  profile_id: string;
  id: string;
  part: string;
  grader_result_id: string;
  original_error_output: string;
  timestamp: string;
  hint: string;
  prompt_tokens: string;
  completion_tokens: string;
  total_tokens: string;
  cost_usd: string;
  response_id: string;
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

/** Longest contiguous run of backticks (for safe CommonMark fenced blocks). */
function longestBacktickRun(s: string): number {
  let max = 0;
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "`") {
      run++;
      max = Math.max(max, run);
    } else {
      run = 0;
    }
  }
  return max;
}

/** Renders body as literal text so `---`, `###`, etc. do not affect surrounding markdown. */
function fencedTextBlock(body: string): string {
  const fenceLen = Math.max(3, longestBacktickRun(body) + 1);
  const fence = "`".repeat(fenceLen);
  return `${fence}text\n${body}\n${fence}`;
}

function buildMarkdown(rows: OpenRouterResultRow[]): string {
  const sections: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const chunk: string[] = [];
    if (i > 0) {
      chunk.push("---");
      chunk.push("");
    }
    chunk.push("### Error");
    chunk.push("");
    chunk.push(fencedTextBlock(row.original_error_output));
    chunk.push("");
    chunk.push("### LLM Response");
    chunk.push("");
    chunk.push(fencedTextBlock(row.hint));
    sections.push(chunk.join("\n"));
  }

  return sections.join("\n");
}

(async () => {
  const outputDir = path.join(__dirname, "../feedbotOutput");
  const csvPath = path.join(outputDir, "openrouter_aggregated_results.csv");
  const markdownPath = path.join(outputDir, "openrouter_aggregated_results.md");
  const datasetPath = path.join(__dirname, DATASET);

  console.log("Aggregating OpenRouter progress files...");

  const progressFiles = discoverOpenRouterProgressFiles(outputDir);
  if (progressFiles.length === 0) {
    console.error("No OpenRouter progress files found in feedbotOutput.");
    return;
  }

  const datasetContent = readFileSync(datasetPath, "utf-8");
  const datasetRows = parse(datasetContent, {
    columns: true,
    skip_empty_lines: true,
  }) as RawEvaluationRow[];

  const normalizedDatasetRows: EvaluationRow[] = datasetRows.map((row) =>
    normalizeEvaluationRow(row),
  );

  const metadataByFingerprint: Record<string, EvaluationRow> = {};
  for (const row of normalizedDatasetRows) {
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
      const row = metadataByFingerprint[fingerprint];

      aggregatedRows.push({
        model: progressFile.model,
        prompt: progressFile.prompt,
        fingerprint,
        name: row?.name ?? "",
        score: row?.score ?? "",
        max_score: row?.max_score ?? "",
        is_active: row ? String(row.is_active) : "",
        title: row?.title ?? "",
        profile_id: row?.profile_id ?? "",
        id: row?.id ?? "",
        part: row?.part ?? "",
        grader_result_id: row?.grader_result_id ?? "",
        original_error_output: row?.output ?? "",
        timestamp: result.timestamp,
        hint: result.hint,
        prompt_tokens: formatMaybeNumber(result.usage?.promptTokens),
        completion_tokens: formatMaybeNumber(result.usage?.completionTokens),
        total_tokens: formatMaybeNumber(result.usage?.totalTokens),
        cost_usd: formatMaybeCost(result.usage?.costUSD),
        response_id: result.usage?.responseId ?? "",
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
    "name",
    "score",
    "max_score",
    "is_active",
    "title",
    "profile_id",
    "id",
    "part",
    "grader_result_id",
    "original_error_output",
    "timestamp",
    "hint",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cost_usd",
    "response_id",
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
