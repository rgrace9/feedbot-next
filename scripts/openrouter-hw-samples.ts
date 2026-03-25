import { randomBytes } from "crypto";
import { parse } from "csv-parse/sync";
import * as dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { OPENROUTER_MODELS } from "../constants/models.js";
import {
  BASE_PROMPT,
  CHAIN_OF_THOUGHT_PROMPT,
} from "../constants/promptData.js";
import { DATASET } from "../constants/spreadsheets.js";
import { OpenRouterModelClient } from "./classes/providers/OpenRouterModelClient.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function formatRunFolder(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const suffix = randomBytes(3).toString("hex"); // 6-char run id
  return `${mm}${dd}${yyyy}-${suffix}`;
}

type HwSampleRow = {
  name: string;
  output: string;
};

type CliArgs = {
  datasetPath: string;
  model: string;
  concurrency: number;
  limit?: number;
  outputDir: string;
  trackCosts: boolean;
  dumpPrompt: boolean;
  dumpIndex?: number;
};

function toText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf("--model");
  const concIdx = args.indexOf("--concurrency");
  const limitIdx = args.indexOf("--limit");
  const outIdx = args.indexOf("--out-dir");
  const trackCosts = args.includes("--track-costs");
  const dumpPrompt = args.includes("--dump-prompt");
  const dumpIndexIdx = args.indexOf("--dump-index");

  const datasetPath = path.join(__dirname, DATASET);
  const model =
    modelIdx !== -1 && args[modelIdx + 1]
      ? args[modelIdx + 1]!
      : OPENROUTER_MODELS[0]!;

  let concurrency = 8;
  if (concIdx !== -1 && args[concIdx + 1]) {
    const parsed = parseInt(args[concIdx + 1]!, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      concurrency = parsed;
    }
  }

  let limit: number | undefined;
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    const parsed = parseInt(args[limitIdx + 1]!, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = parsed;
    }
  }

  const outputDir =
    outIdx !== -1 && args[outIdx + 1]
      ? path.resolve(args[outIdx + 1]!)
      : path.join(__dirname, "../feedbotOutput");

  let dumpIndex: number | undefined;
  if (dumpIndexIdx !== -1 && args[dumpIndexIdx + 1]) {
    const parsed = parseInt(args[dumpIndexIdx + 1]!, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      dumpIndex = parsed;
    }
  }

  return {
    datasetPath,
    model,
    concurrency,
    ...(limit !== undefined ? { limit } : {}),
    outputDir,
    trackCosts,
    dumpPrompt,
    ...(dumpIndex !== undefined ? { dumpIndex } : {}),
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

function fencedTextBlock(body: string): string {
  const fenceLen = Math.max(3, longestBacktickRun(body) + 1);
  const fence = "`".repeat(fenceLen);
  return `${fence}text\n${body}\n${fence}`;
}

function buildUserTail(unitName: string, errorOutput: string): string {
  return `}\n\nError output / failing test output:\n\n${errorOutput}\n\nUnit name: ${unitName}`;
}

function buildMarkdown(
  results: Array<{
    rowIndex: number;
    unitName: string;
    errorOutput: string;
    response: string;
  }>,
): string {
  return results
    .map((r, i) => {
      const parts: string[] = [];
      if (i > 0) {
        parts.push("---", "");
      }
      parts.push(`### Result ${i + 1}`, "");
      parts.push(
        "#### Original Error Output",
        "",
        fencedTextBlock(r.errorOutput),
        "",
      );
      parts.push("#### Model Output Message", "", fencedTextBlock(r.response));
      return parts.join("\n");
    })
    .join("\n");
}

(async () => {
  const args = parseArgs();

  if (!process.env.OPEN_ROUTER_KEY) {
    console.error("OPEN_ROUTER_KEY is required.");
    process.exit(1);
  }

  const datasetBase = path.basename(args.datasetPath);
  if (!/^hw\d+_samples\.csv$/i.test(datasetBase)) {
    console.error(
      `This script only supports hwX_samples.csv. Got: ${datasetBase}`,
    );
    process.exit(1);
  }

  const csvContent = readFileSync(args.datasetPath, "utf-8");
  const rawRows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, unknown>>;

  if (rawRows.length === 0) {
    console.error("Dataset CSV has no rows.");
    process.exit(1);
  }

  // Supports the known hwX_samples.csv schemas:
  // - id,score,max_score,name,output,part,grader_result_id
  // - id,score,max_score,name,output,part
  // - name,score,max_score,output,is_active,title,profile_id
  const first = rawRows[0]!;
  for (const required of ["name", "output"]) {
    if (!(required in first)) {
      console.error(`Dataset missing required column: ${required}`);
      process.exit(1);
    }
  }

  const rows: HwSampleRow[] = rawRows.map((r) => ({
    name: toText(r.name).trim(),
    output: toText(r.output),
  }));

  const toProcess = args.limit ? rows.slice(0, args.limit) : rows;
  mkdirSync(args.outputDir, { recursive: true });
  const runOutputDir = path.join(args.outputDir, formatRunFolder(new Date()));
  mkdirSync(runOutputDir, { recursive: true });

  const jsonlPath = path.join(args.outputDir, "openrouter_hw_samples.jsonl");
  const jsonPath = path.join(args.outputDir, "openrouter_hw_samples.json");
  const mdPath = path.join(args.outputDir, "openrouter_hw_samples.md");
  const promptDebugPath = path.join(
    args.outputDir,
    "openrouter_hw_samples_prompt_debug.txt",
  );

  const runJsonlPath = path.join(runOutputDir, "openrouter_hw_samples.jsonl");
  const runJsonPath = path.join(runOutputDir, "openrouter_hw_samples.json");
  const runMdPath = path.join(runOutputDir, "openrouter_hw_samples.md");
  const runPromptDebugPath = path.join(
    runOutputDir,
    "openrouter_hw_samples_prompt_debug.txt",
  );

  const client = new OpenRouterModelClient({
    apiKey: process.env.OPEN_ROUTER_KEY,
    ...(args.trackCosts ? { fetchCosts: true } : {}),
  });

  console.log(`Dataset: ${args.datasetPath}`);
  console.log(`Rows: ${toProcess.length} (of ${rows.length})`);
  console.log(`Model: ${args.model}`);
  console.log(`Concurrency: ${args.concurrency}`);
  console.log(`JSONL: ${jsonlPath}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`MD: ${mdPath}`);
  console.log(`Run folder: ${runOutputDir}`);
  if (args.dumpPrompt) {
    console.log(
      `Prompt debug: ${promptDebugPath}${args.dumpIndex !== undefined ? ` (rowIndex=${args.dumpIndex})` : ""}`,
    );
  }
  console.log("---\n");

  const systemPrompt = `${BASE_PROMPT}\n${CHAIN_OF_THOUGHT_PROMPT}`.trim();

  const results = await runWithConcurrency(
    toProcess,
    args.concurrency,
    async (row, rowIndex) => {
      const unitName = row.name;
      const errorOutput = row.output ?? "";
      const userTail = buildUserTail(unitName, errorOutput);
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userTail },
      ];

      if (
        args.dumpPrompt &&
        (args.dumpIndex === undefined || args.dumpIndex === rowIndex)
      ) {
        const debugText = [
          `=== rowIndex: ${rowIndex} ===`,
          "",
          "=== system ===",
          systemPrompt,
          "",
          "=== user ===",
          userTail,
          "",
        ].join("\n");
        writeFileSync(promptDebugPath, debugText, "utf-8");
        writeFileSync(runPromptDebugPath, debugText, "utf-8");
      }
      try {
        const res = await client.process(args.model, messages, 0.2);
        return {
          kind: "ok" as const,
          rowIndex,
          unitName,
          errorOutput,
          response: res.content ?? "",
          usage: res.usage,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          kind: "error" as const,
          rowIndex,
          unitName,
          errorOutput,
          message: msg,
        };
      }
    },
  );

  const ordered = results.slice().sort((a, b) => a.rowIndex - b.rowIndex);
  writeFileSync(
    jsonlPath,
    ordered.map((r) => JSON.stringify(r)).join("\n") +
      (ordered.length ? "\n" : ""),
    "utf-8",
  );
  writeFileSync(jsonPath, JSON.stringify(ordered, null, 2) + "\n", "utf-8");
  writeFileSync(
    runJsonlPath,
    ordered.map((r) => JSON.stringify(r)).join("\n") +
      (ordered.length ? "\n" : ""),
    "utf-8",
  );
  writeFileSync(runJsonPath, JSON.stringify(ordered, null, 2) + "\n", "utf-8");

  const okForMarkdown = ordered
    .filter((r) => r.kind === "ok")
    .map((r) => ({
      rowIndex: r.rowIndex,
      unitName: r.unitName,
      errorOutput: r.errorOutput,
      response: (r as { response: string }).response,
    }));

  writeFileSync(mdPath, buildMarkdown(okForMarkdown), "utf-8");
  writeFileSync(runMdPath, buildMarkdown(okForMarkdown), "utf-8");

  console.log(
    `Done. ok=${ordered.filter((r) => r.kind === "ok").length} error=${ordered.filter((r) => r.kind === "error").length}`,
  );
})();
