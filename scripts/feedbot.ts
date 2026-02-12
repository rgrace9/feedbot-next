import { parse } from "csv-parse/sync";
import * as dotenv from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import OpenAI from "openai";
import * as path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const model = "gpt-4o-mini";

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY!,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${model}`,
  defaultQuery: { "api-version": "2025-03-01-preview" },
  defaultHeaders: { "api-key": process.env.AZURE_OPENAI_KEY! },
});

// CSV row interface matching evaluation_dataset.csv
interface EvaluationRow {
  category: string;
  test_name: string;
  error_type: string;
  count: string;
  fingerprint: string;
  canonical_key: string;
  clean_error_text: string;
}

// State file structure
interface StateFile {
  processed: {
    [fingerprint: string]: {
      hint: string;
      timestamp: string;
    };
  };
}

// File paths
const CSV_PATH = path.join(__dirname, "../data/evaluation_dataset.csv");
const STATE_PATH = path.join(
  __dirname,
  "../feedbotOutput/feedbot_progress.json",
);

// Parse CLI arguments
function parseArgs(): { limit?: number } {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");

  if (limitIndex !== -1 && args[limitIndex + 1]) {
    const limit = parseInt(args[limitIndex + 1]!, 10);
    if (!isNaN(limit)) {
      return { limit };
    }
  }

  return {};
}

// Load existing state
function loadState(): StateFile {
  if (existsSync(STATE_PATH)) {
    const content = readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(content);
  }
  return { processed: {} };
}

// Save state
function saveState(state: StateFile): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

// Generate prompt for a row
function generatePrompt(row: EvaluationRow): string {
  return `You are Feedbot, a TA for a Java/Gradle assignment.
Given this grading log, write a student-facing hint.

Category: ${row.category}
Test Name: ${row.test_name}

Rules:
- Focus on the most important error.
- Explain it in 1–2 sentences.
- Give 3–5 concrete steps to debug locally.
- Do NOT give the full solution.

LOG:
${row.clean_error_text}
`;
}

// Main processing function
(async () => {
  const { limit } = parseArgs();

  // Load CSV
  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const rows: EvaluationRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  // Load state
  const state = loadState();

  // Apply limit if specified
  const rowsToProcess = limit ? rows.slice(0, limit) : rows;
  const total = rowsToProcess.length;

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Starting feedbot processing: ${total} rows to process`);
  if (limit) {
    console.log(`(Limited to first ${limit} rows)`);
  }
  console.log("---\n");

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    const index = i + 1;

    // Skip if row is undefined
    if (!row) {
      continue;
    }

    // Skip DEPENDENCY_NOT_MET errors
    if (row.error_type === "DEPENDENCY_NOT_MET") {
      console.log(
        `[${index}/${total}] Skipping DEPENDENCY_NOT_MET: ${row.category}`,
      );
      skipped++;
      continue;
    }

    // Skip if already processed
    if (state.processed[row.fingerprint]) {
      console.log(`[${index}/${total}] Already processed: ${row.category}`);
      skipped++;
      continue;
    }

    // Process row
    try {
      const prompt = generatePrompt(row);
      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      });

      const hint = resp?.choices[0]?.message.content || "";

      // Save to state immediately
      state.processed[row.fingerprint] = {
        hint,
        timestamp: new Date().toISOString(),
      };
      saveState(state);

      // Print to console
      console.log(`[${index}/${total}] ${row.category}`);
      console.log(`Hint: ${hint}`);
      console.log("---\n");

      processed++;
    } catch (error) {
      console.error(`[${index}/${total}] ERROR processing ${row.category}`);
      console.error(`  Fingerprint: ${row.fingerprint}`);
      console.error(`  Error:`, error instanceof Error ? error.message : error);
      console.log("---\n");
      failed++;
    }
  }

  // Print final summary
  console.log("\n=== SUMMARY ===");
  console.log(`Total rows: ${total}`);
  console.log(`Processed: ${processed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`State saved to: ${STATE_PATH}`);
})();
