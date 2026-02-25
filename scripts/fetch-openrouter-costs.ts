import { parse as parseCsv } from "csv-parse/sync";
import * as dotenv from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

dotenv.config();

type SourceRow = {
  model: string;
  responseId: string;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
};

type CostLookupResult = {
  responseId: string;
  model: string;
  promptTokens: number | undefined;
  outputTokens: number | undefined;
  totalCostUSD: number | undefined;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(): { inputPath: string; outputPath: string } {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");

  const defaultInputPath = path.join(
    __dirname,
    "../feedbotOutput/openrouter_aggregated_results.csv",
  );
  const defaultOutputPath = path.join(
    __dirname,
    "../feedbotOutput/openrouter_response_costs.json",
  );

  const inputPath =
    inputIndex !== -1 && args[inputIndex + 1]
      ? path.resolve(args[inputIndex + 1]!)
      : defaultInputPath;

  const outputPath =
    outputIndex !== -1 && args[outputIndex + 1]
      ? path.resolve(args[outputIndex + 1]!)
      : defaultOutputPath;

  return { inputPath, outputPath };
}

function toMaybeNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseAggregateCsv(inputPath: string): SourceRow[] {
  const content = readFileSync(inputPath, "utf-8");
  const rows = parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>;

  return rows
    .map((row) => ({
      model: row.model ?? "",
      responseId: row.response_id ?? "",
      promptTokens: toMaybeNumber(row.prompt_tokens),
      completionTokens: toMaybeNumber(row.completion_tokens),
    }))
    .filter((row) => row.responseId.length > 0 && row.model.length > 0);
}

function parseMarkdownTableLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return [];
  }
  return trimmed
    .split("|")
    .slice(1, -1)
    .map((value) => value.trim());
}

function parseAggregateMarkdown(inputPath: string): SourceRow[] {
  const content = readFileSync(inputPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const results: SourceRow[] = [];

  const headerLineIndex = lines.findIndex((line) =>
    line.includes("| Model | Prompt | Response ID |"),
  );

  if (headerLineIndex === -1) {
    return results;
  }

  for (let i = headerLineIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim().startsWith("|")) {
      if (results.length > 0) {
        break;
      }
      continue;
    }

    const cells = parseMarkdownTableLine(line);
    if (cells.length < 7) {
      continue;
    }

    const model = cells[0] ?? "";
    const responseId = cells[2] ?? "";
    const promptTokens = toMaybeNumber(cells[5]);
    const completionTokens = toMaybeNumber(cells[6]);

    if (model && responseId) {
      results.push({
        model,
        responseId,
        promptTokens,
        completionTokens,
      });
    }
  }

  return results;
}

function loadSourceRows(inputPath: string): SourceRow[] {
  if (inputPath.endsWith(".csv")) {
    return parseAggregateCsv(inputPath);
  }

  if (inputPath.endsWith(".md")) {
    return parseAggregateMarkdown(inputPath);
  }

  throw new Error("Input must be a .csv or .md file");
}

function dedupeRows(rows: SourceRow[]): SourceRow[] {
  const byResponseId = new Map<string, SourceRow>();

  for (const row of rows) {
    if (!byResponseId.has(row.responseId)) {
      byResponseId.set(row.responseId, row);
    }
  }

  return Array.from(byResponseId.values());
}

function parseGenerationCost(data: unknown): number | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const payload = data as {
    data?: {
      total_cost?: number | string;
    };
  };

  return toMaybeNumber(payload.data?.total_cost);
}

async function fetchCostForResponse(
  apiKey: string,
  responseId: string,
): Promise<number | undefined> {
  const response = await fetch(
    `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(responseId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    return undefined;
  }

  const data = await response.json();
  return parseGenerationCost(data);
}

async function main(): Promise<void> {
  const apiKey = process.env.OPEN_ROUTER_KEY;
  if (!apiKey) {
    throw new Error("OPEN_ROUTER_KEY environment variable is required");
  }

  const { inputPath, outputPath } = parseArgs();
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const sourceRows = dedupeRows(loadSourceRows(inputPath));
  if (sourceRows.length === 0) {
    throw new Error("No response IDs found in input file");
  }

  const results: CostLookupResult[] = [];

  console.log(`Found ${sourceRows.length} unique response IDs`);

  for (const [index, row] of sourceRows.entries()) {
    const total = sourceRows.length;
    const cost = await fetchCostForResponse(apiKey, row.responseId);

    results.push({
      responseId: row.responseId,
      model: row.model,
      promptTokens: row.promptTokens,
      outputTokens: row.completionTokens,
      totalCostUSD: cost,
    });

    if ((index + 1) % 20 === 0 || index + 1 === total) {
      console.log(`Processed ${index + 1}/${total}`);
    }
  }

  writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");

  console.log(`\nJSON output written: ${outputPath}`);
  console.log(`Entries: ${results.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
