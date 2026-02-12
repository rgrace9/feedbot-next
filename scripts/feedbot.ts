import { parse } from "csv-parse/sync";
import * as dotenv from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import OpenAI from "openai";
import * as path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const models = ["gpt-4o", "gpt-4o-mini", "gpt-5-mini"];
const promptVariations = ["detailed", "concise", "encouraging"];

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

// Generate state file path for a specific model+prompt combination
function getStatePath(model: string, promptVariation: string): string {
  return path.join(
    __dirname,
    `../feedbotOutput/feedbot_progress_${model}_${promptVariation}.json`,
  );
}

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
function loadState(statePath: string): StateFile {
  if (existsSync(statePath)) {
    const content = readFileSync(statePath, "utf-8");
    return JSON.parse(content);
  }
  return { processed: {} };
}

// Save state
function saveState(state: StateFile, statePath: string): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

// Generate prompt for a row
function generatePrompt(row: EvaluationRow, promptVariation: string): string {
  let basePrompt = `You are FeedBot, an automated feedback assistant for a programming course. Your goal is to help students understand why their submission failed and how to make progress, without giving them the solution. 
Follow this process: 
1. Carefully analyze the error output produced by the grading system. 
1. Identify the type of problem (e.g., build configuration issue, language version mismatch, test failure, runtime error). 
1. Infer what misunderstanding or mistake the student likely made. 
1. Write a short, clear hint that explains the issue at a high level and suggests a next step the student can take. 
Guidelines: 
* Do NOT provide code or a complete fix. 
* Do NOT mention internal tooling, graders, or infrastructure. 
* Use clear, student-friendly language. 
* Focus on what to check or review, not what to copy.`;

  // Add variation-specific modifications
  switch (promptVariation) {
    case "detailed":
      basePrompt += `
* Provide comprehensive analysis with multiple debugging steps.
* Include background context about why this type of error occurs.`;
      break;
    case "concise":
      basePrompt += `
* Keep response under 100 words.
* Focus only on the most critical issue.`;
      break;
    case "encouraging":
      basePrompt += `
* Use supportive, motivational language.
* Remind the student that debugging is a normal part of learning.`;
      break;
  }

  basePrompt += `
This is the assignment the student is working on: https://neu-pdi.github.io/cs3100-public-resources/assignments/cyb1-recipes

Category: ${row.category}
Test Name: ${row.test_name}
LOG:
${row.clean_error_text}`;

  return basePrompt;
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

  // Track stats per model+prompt combination
  const stats: {
    [key: string]: { processed: number; skipped: number; failed: number };
  } = {};

  console.log(
    `Starting feedbot processing: ${models.length} models × ${promptVariations.length} prompt variations`,
  );
  console.log(`Total combinations: ${models.length * promptVariations.length}`);
  if (limit) {
    console.log(`(Limited to first ${limit} rows per combination)`);
  }
  console.log("---\n");

  // Loop through each model
  for (const model of models) {
    // Loop through each prompt variation
    for (const promptVariation of promptVariations) {
      const combinationKey = `${model}_${promptVariation}`;
      stats[combinationKey] = { processed: 0, skipped: 0, failed: 0 };

      // Get state path for this combination
      const statePath = getStatePath(model, promptVariation);

      // Initialize OpenAI client for this model
      const client = new OpenAI({
        apiKey: process.env.AZURE_OPENAI_KEY!,
        baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${model}`,
        defaultQuery: { "api-version": "2025-03-01-preview" },
        defaultHeaders: { "api-key": process.env.AZURE_OPENAI_KEY! },
      });

      // Load state for this combination
      const state = loadState(statePath);

      // Apply limit if specified
      const rowsToProcess = limit ? rows.slice(0, limit) : rows;
      const total = rowsToProcess.length;

      console.log(
        `\n[${model}] [${promptVariation}] Starting combination: ${total} rows to process`,
      );
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
            `[${model}] [${promptVariation}] [${index}/${total}] Skipping DEPENDENCY_NOT_MET: ${row.category}`,
          );
          stats[combinationKey].skipped++;
          continue;
        }

        // Skip if already processed
        if (state.processed[row.fingerprint]) {
          console.log(
            `[${model}] [${promptVariation}] [${index}/${total}] Already processed: ${row.category}`,
          );
          stats[combinationKey].skipped++;
          continue;
        }

        // Process row
        try {
          const prompt = generatePrompt(row, promptVariation);

          // Create API call parameters based on model capabilities
          const apiParams: any = {
            model,
            messages: [{ role: "user", content: prompt }],
          };

          // Only add temperature for models that support it
          if (!model.startsWith("gpt-5")) {
            apiParams.temperature = 0.2;
          }
          // GPT-5 and O1 models use default temperature (1) only

          const resp = await client.chat.completions.create(apiParams);

          const hint = resp?.choices[0]?.message.content || "";

          // Save to state immediately
          state.processed[row.fingerprint] = {
            hint,
            timestamp: new Date().toISOString(),
          };
          saveState(state, statePath);

          // Print to console
          console.log(
            `[${model}] [${promptVariation}] [${index}/${total}] Processing: ${row.category}`,
          );
          console.log(`[${model}] [${promptVariation}] Hint: ${hint}`);
          console.log("---\n");

          stats[combinationKey].processed++;
        } catch (error) {
          console.error(
            `[${model}] [${promptVariation}] [${index}/${total}] ERROR processing ${row.category}`,
          );
          console.error(`  Fingerprint: ${row.fingerprint}`);
          console.error(
            `  Error:`,
            error instanceof Error ? error.message : error,
          );
          console.log("---\n");
          stats[combinationKey].failed++;
        }
      }

      console.log(
        `[${model}] [${promptVariation}] Combination complete. State saved to: ${statePath}\n`,
      );
    }
  }

  // Print final summary
  console.log("\n=== SUMMARY ===");
  for (const model of models) {
    for (const promptVariation of promptVariations) {
      const key = `${model}_${promptVariation}`;
      const stat = stats[key];
      console.log(
        `${model} + ${promptVariation}: ${stat.processed} processed, ${stat.skipped} skipped, ${stat.failed} failed`,
      );
    }
  }
})();
