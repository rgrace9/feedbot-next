// Row-ordered sample runner: no fingerprints / progress JSON. CSV `output` feeds the prompt.
// Concurrent LLM calls (default: 8 for openrouter, 1 for azure). Override: --concurrency N
import { parse } from "csv-parse/sync";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import { MODELS_BY_PROVIDER, type LlmProvider } from "../constants/models.js";
import { PROMPT_VARIATIONS } from "../constants/promptData.js";
import {
  ModelManager,
  type ModelConfig,
  type UsageMetadata,
} from "./classes/ModelManager.js";
import {
  normalizeEvaluationRow,
  PromptGenerator,
  REQUIRED_DATASET_COLUMNS,
  type EvaluationRow,
  type RawEvaluationRow,
} from "./classes/PromptGenerator.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type CliArgs = {
  csvPath: string;
  model: string;
  promptVariation: string;
  limit?: number;
  outputPath: string;
  forceAll: boolean;
  trackCosts: boolean;
  concurrency: number;
};

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const csvIdx = args.indexOf("--csv");
  const modelIdx = args.indexOf("--model");
  const promptIdx = args.indexOf("--prompt");
  const limitIdx = args.indexOf("--limit");
  const outIdx = args.indexOf("--output");
  const concIdx = args.indexOf("--concurrency");

  const defaultCsv = path.join(__dirname, "../data/hw4_sample_10.csv");

  const csvPath =
    csvIdx !== -1 && args[csvIdx + 1]
      ? path.resolve(args[csvIdx + 1]!)
      : defaultCsv;

  const provider = (process.env.LLM_PROVIDER ?? "azure").toLowerCase() as
    | LlmProvider
    | string;
  const models =
    provider === "openrouter" || provider === "azure"
      ? MODELS_BY_PROVIDER[provider]
      : MODELS_BY_PROVIDER.azure;

  const model =
    modelIdx !== -1 && args[modelIdx + 1]
      ? args[modelIdx + 1]!
      : models[0]!;

  const promptVariation =
    promptIdx !== -1 && args[promptIdx + 1]
      ? args[promptIdx + 1]!
      : PROMPT_VARIATIONS[0] ?? "chain-of-thought";

  let limit: number | undefined;
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    const n = parseInt(args[limitIdx + 1]!, 10);
    if (!Number.isNaN(n) && n > 0) {
      limit = n;
    }
  }

  const outputPath =
    outIdx !== -1 && args[outIdx + 1]
      ? path.resolve(args[outIdx + 1]!)
      : path.join(__dirname, "../feedbotOutput/sample_line_results.jsonl");

  const forceAll = args.includes("--force-all");
  const trackCosts = args.includes("--track-costs");

  let concurrency: number;
  if (concIdx !== -1 && args[concIdx + 1]) {
    const n = parseInt(args[concIdx + 1]!, 10);
    concurrency =
      !Number.isNaN(n) && n > 0 ? n : defaultConcurrencyForProvider(provider);
  } else {
    concurrency = defaultConcurrencyForProvider(provider);
  }

  return {
    csvPath,
    model,
    promptVariation,
    ...(limit !== undefined ? { limit } : {}),
    outputPath,
    forceAll,
    trackCosts,
    concurrency,
  };
}

function defaultConcurrencyForProvider(
  provider: LlmProvider | string,
): number {
  return provider === "openrouter" ? 8 : 1;
}

function resolveProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? "azure").toLowerCase();
  if (provider === "azure" || provider === "openrouter") {
    return provider;
  }
  console.error(
    `Invalid LLM_PROVIDER "${provider}". Use "azure" or "openrouter".`,
  );
  process.exit(1);
}

function validateEnv(provider: LlmProvider): ModelConfig {
  if (provider === "azure") {
    if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
      console.error(
        "AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT are required for Azure.",
      );
      process.exit(1);
    }
    return {
      provider,
      apiKey: process.env.AZURE_OPENAI_KEY!,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      apiVersion: "2025-03-01-preview",
    };
  }
  if (!process.env.OPEN_ROUTER_KEY) {
    console.error("OPEN_ROUTER_KEY is required for OpenRouter.");
    process.exit(1);
  }
  return {
    provider,
    apiKey: process.env.OPEN_ROUTER_KEY!,
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

type JsonlRecord =
  | {
      kind: "skipped";
      rowIndex: number;
      name: string;
      skipReason: string;
    }
  | {
      kind: "ok";
      rowIndex: number;
      name: string;
      score: string;
      max_score: string;
      title: string;
      output: string;
      hint: string;
      timestamp: string;
      usage?: UsageMetadata;
    }
  | {
      kind: "error";
      rowIndex: number;
      name: string;
      message: string;
    };

(async () => {
  const args = parseArgs();
  const provider = resolveProvider();
  const modelConfig = validateEnv(provider);
  if (provider === "openrouter") {
    modelConfig.fetchCosts = args.trackCosts;
  }

  const csvContent = readFileSync(args.csvPath, "utf-8");
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as RawEvaluationRow[];

  if (rows.length === 0) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const firstRow = rows[0] as Record<string, unknown>;
  const missing = REQUIRED_DATASET_COLUMNS.filter((c) => !(c in firstRow));
  if (missing.length > 0) {
    console.error(
      `CSV is missing required columns: ${missing.join(", ")}. Need: ${REQUIRED_DATASET_COLUMNS.join(", ")}`,
    );
    process.exit(1);
  }

  const evaluationRows = rows.map((r) => normalizeEvaluationRow(r));
  const toProcess = args.limit
    ? evaluationRows.slice(0, args.limit)
    : evaluationRows;

  const outDir = path.dirname(args.outputPath);
  mkdirSync(outDir, { recursive: true });

  const promptGenerator = new PromptGenerator();
  const modelManager = new ModelManager(modelConfig, promptGenerator);

  console.log(`CSV: ${args.csvPath}`);
  console.log(`Rows: ${toProcess.length} (of ${evaluationRows.length} in file)`);
  console.log(`Model: ${args.model}`);
  console.log(`Prompt: ${args.promptVariation}`);
  console.log(`Concurrency: ${args.concurrency}`);
  console.log(`Output: ${args.outputPath}`);
  console.log("---\n");

  const skipped: JsonlRecord[] = [];
  const apiRows: { row: EvaluationRow; rowIndex: number }[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i]!;
    const rowIndex = i;
    const skipReason = args.forceAll
      ? null
      : promptGenerator.getSkipReason(row);

    if (skipReason) {
      skipped.push({
        kind: "skipped",
        rowIndex,
        name: row.name,
        skipReason,
      });
      console.log(
        `[${rowIndex + 1}/${toProcess.length}] SKIP (${skipReason}): ${row.name}`,
      );
    } else {
      apiRows.push({ row, rowIndex });
    }
  }

  const apiResults = await runWithConcurrency(
    apiRows,
    args.concurrency,
    async ({ row, rowIndex }, _i) => {
      try {
        const result = await modelManager.processRow(
          row,
          args.model,
          args.promptVariation,
        );
        const record: JsonlRecord = {
          kind: "ok",
          rowIndex,
          name: row.name,
          score: row.score,
          max_score: row.max_score,
          title: row.title,
          output: row.output,
          hint: result.hint,
          timestamp: result.timestamp,
          usage: result.usage,
        };
        const label =
          row.name.length > 60 ? `${row.name.slice(0, 60)}…` : row.name;
        console.log(`[${rowIndex + 1}/${toProcess.length}] OK: ${label}`);
        return record;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[${rowIndex + 1}/${toProcess.length}] ERROR: ${msg}`);
        return {
          kind: "error" as const,
          rowIndex,
          name: row.name,
          message: msg,
        };
      }
    },
  );

  const allLines = [...skipped, ...apiResults].sort(
    (a, b) => a.rowIndex - b.rowIndex,
  );
  writeFileSync(
    args.outputPath,
    allLines.map((r) => JSON.stringify(r)).join("\n") + (allLines.length ? "\n" : ""),
    "utf-8",
  );

  console.log(`\nDone. Wrote ${allLines.length} lines to ${args.outputPath}`);
})();
