import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { DATASET } from "../constants/spreadsheets";
import {
  normalizeEvaluationRow,
  type EvaluationRow,
  type RawEvaluationRow,
} from "./classes/PromptGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Discover actual progress files instead of using hardcoded constants
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function discoverProgressFiles(): Array<{
  model: string;
  prompt: string;
  filename: string;
}> {
  const feedbotOutputDir = path.join(__dirname, "../feedbotOutput");
  const files = readdirSync(feedbotOutputDir);

  const progressFiles: Array<{
    model: string;
    prompt: string;
    filename: string;
  }> = [];

  files.forEach((filename) => {
    const encodedMatch = filename.match(
      /^feedbot_progress_m-(.+)_p-(.+)\.json$/,
    );
    if (encodedMatch) {
      const [, encodedModel, encodedPrompt] = encodedMatch;
      if (!encodedModel || !encodedPrompt) {
        return;
      }
      progressFiles.push({
        model: safeDecode(encodedModel),
        prompt: safeDecode(encodedPrompt),
        filename,
      });
      return;
    }

    // Backward compatibility for old filename format
    const legacyMatch = filename.match(/^feedbot_progress_(.+)_(.+)\.json$/);
    if (legacyMatch) {
      const [, model, prompt] = legacyMatch;
      if (!model || !prompt) {
        return;
      }
      progressFiles.push({ model, prompt, filename });
    }
  });

  return progressFiles;
}

interface StateFile {
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
}

interface AggregatedResult {
  fingerprint: string;
  name: string;
  score: string;
  max_score: string;
  is_active: string;
  title: string;
  profile_id: string;
  original_error_output: string;
  [key: string]: string; // For model+prompt combination columns
}

// Load JSON file safely
function loadStateFile(filePath: string): StateFile | null {
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Error reading ${filePath}:`, error);
      return null;
    }
  }
  return null;
}

function buildMarkdownReport(
  resultArray: AggregatedResult[],
  progressFiles: Array<{ model: string; prompt: string; filename: string }>,
): string {
  const lines: string[] = [];
  lines.push("# Error Output and Model Response");

  let resultIndex = 1;

  for (const { model, prompt } of progressFiles) {
    const columnName = `${model}_${prompt}`;

    for (const row of resultArray) {
      const modelOutput = row[columnName];
      if (!modelOutput || modelOutput.trim() === "") {
        continue;
      }

      lines.push("");
      lines.push(`## Result ${resultIndex++}`);
      lines.push("");
      lines.push("### Original Error Output");
      lines.push("````text");
      lines.push(row.original_error_output);
      lines.push("````");
      lines.push("");
      lines.push("### Model Output Message");
      lines.push("````text");
      lines.push(modelOutput);
      lines.push("````");
    }
  }

  return lines.join("\n");
}

// Main aggregation function
(async () => {
  const CSV_PATH = path.join(__dirname, DATASET);
  const OUTPUT_PATH = path.join(
    __dirname,
    "../feedbotOutput/aggregated_results.csv",
  );
  const MARKDOWN_PATH = path.join(
    __dirname,
    "../feedbotOutput/aggregated_results.md",
  );

  console.log("Starting results aggregation...");

  // Discover actual progress files
  const progressFiles = discoverProgressFiles();
  console.log(
    `Found ${progressFiles.length} progress files:`,
    progressFiles.map((f) => f.filename),
  );

  if (progressFiles.length === 0) {
    console.error("No progress files found! Check feedbotOutput directory.");
    return;
  }

  // Load original CSV to get error metadata
  console.log("Loading evaluation dataset...");
  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const originalRows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as RawEvaluationRow[];

  const normalizedRows: EvaluationRow[] = originalRows.map((row) =>
    normalizeEvaluationRow(row),
  );

  // Create lookup map for error metadata
  const errorMetadata: { [fingerprint: string]: EvaluationRow } = {};
  normalizedRows.forEach((row) => {
    errorMetadata[row.fingerprint] = row;
  });

  // Load all JSON files and aggregate results
  console.log("Loading progress files...");
  const aggregatedResults: { [fingerprint: string]: AggregatedResult } = {};

  for (const { model, prompt, filename } of progressFiles) {
    const filePath = path.join(__dirname, "../feedbotOutput", filename);
    const columnName = `${model}_${prompt}`;

    console.log(`Processing: ${columnName}`);

    const stateFile = loadStateFile(filePath);
    if (!stateFile) {
      console.warn(`Skipping ${filename} - file not found or invalid`);
      continue;
    }

    // Process each result in this file
    Object.entries(stateFile.processed).forEach(([fingerprint, result]) => {
      // Initialize result object if this is the first time we see this fingerprint
      if (!aggregatedResults[fingerprint]) {
        const metadata = errorMetadata[fingerprint];
        if (!metadata) {
          console.warn(`No metadata found for fingerprint: ${fingerprint}`);
          return;
        }

        aggregatedResults[fingerprint] = {
          fingerprint,
          name: metadata.name,
          score: metadata.score,
          max_score: metadata.max_score,
          is_active: String(metadata.is_active),
          title: metadata.title,
          profile_id: metadata.profile_id,
          original_error_output: metadata.output,
        };

        // Initialize all model+prompt columns as empty
        for (const { model: m, prompt: p } of progressFiles) {
          aggregatedResults[fingerprint][`${m}_${p}`] = "";
          aggregatedResults[fingerprint][`${m}_${p}_tokens`] = "";
          aggregatedResults[fingerprint][`${m}_${p}_cost_usd`] = "";
        }
      }

      // Add the hint for this model+prompt combination
      aggregatedResults[fingerprint][columnName] = result.hint;

      // Add usage metrics if available
      if (result.usage) {
        const tokensInfo = result.usage.totalTokens
          ? `${result.usage.totalTokens}`
          : "";
        const costInfo = result.usage.costUSD
          ? `${result.usage.costUSD.toFixed(6)}`
          : "";

        aggregatedResults[fingerprint][`${columnName}_tokens`] = tokensInfo;
        aggregatedResults[fingerprint][`${columnName}_cost_usd`] = costInfo;
      }
    });
  }

  // Convert to array and sort by title, then prompt name
  const resultArray = Object.values(aggregatedResults);
  resultArray.sort((a, b) => {
    if (a.title !== b.title) {
      return a.title.localeCompare(b.title);
    }
    return a.name.localeCompare(b.name);
  });

  // Generate CSV
  console.log("Generating CSV...");
  const csvHeaders = [
    "fingerprint",
    "name",
    "score",
    "max_score",
    "is_active",
    "title",
    "profile_id",
    "original_error_output",
  ];

  // Add hint, token, and cost columns for each model+prompt combination
  for (const { model, prompt } of progressFiles) {
    csvHeaders.push(`${model}_${prompt}`);
    csvHeaders.push(`${model}_${prompt}_tokens`);
    csvHeaders.push(`${model}_${prompt}_cost_usd`);
  }

  const csvData = stringify(resultArray, {
    header: true,
    columns: csvHeaders,
  });

  // Write CSV file
  writeFileSync(OUTPUT_PATH, csvData, "utf-8");

  // Write Markdown file
  const markdownReport = buildMarkdownReport(resultArray, progressFiles);
  writeFileSync(MARKDOWN_PATH, markdownReport, "utf-8");

  // Print summary
  console.log("\n=== AGGREGATION SUMMARY ===");
  console.log(`Unique errors processed: ${resultArray.length}`);
  console.log(`Model+prompt combinations: ${progressFiles.length}`);
  console.log(`Output file: ${OUTPUT_PATH}`);
  console.log(`Markdown file: ${MARKDOWN_PATH}`);

  // Count coverage per combination
  console.log("\nCoverage by model+prompt combination:");
  for (const { model, prompt } of progressFiles) {
    const columnName = `${model}_${prompt}`;
    const count = resultArray.filter(
      (row) => row[columnName] && row[columnName].trim() !== "",
    ).length;

    // Calculate total tokens and costs
    let totalTokens = 0;
    let totalCost = 0;
    for (const row of resultArray) {
      const tokens = row[`${columnName}_tokens`];
      const cost = row[`${columnName}_cost_usd`];
      if (tokens) totalTokens += parseInt(tokens as string, 10);
      if (cost) totalCost += parseFloat(cost as string);
    }

    let summary = `  ${columnName}: ${count}/${resultArray.length} errors processed`;
    if (totalTokens > 0 || totalCost > 0) {
      const usage = [
        totalTokens > 0 && `${totalTokens} tokens`,
        totalCost > 0 && `$${totalCost.toFixed(6)}`,
      ]
        .filter(Boolean)
        .join(" | ");
      summary += ` (${usage})`;
    }
    console.log(summary);
  }

  console.log(
    `\n✅ Aggregation complete! Check: ${OUTPUT_PATH} and ${MARKDOWN_PATH}`,
  );
})();
