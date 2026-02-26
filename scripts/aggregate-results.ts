import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { DATASET } from "../constants/spreadsheets";

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

// Interfaces
interface EvaluationRow {
  category: string;
  test_name: string;
  error_type: string;
  count: string;
  fingerprint: string;
  canonical_key: string;
  clean_error_text: string;
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
  category: string;
  test_name: string;
  error_type: string;
  clean_error_text: string;
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

function escapeInlineMarkdown(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function normalizeMultiline(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function buildMarkdownReport(
  resultArray: AggregatedResult[],
  totalRows: number,
  progressFiles: Array<{ model: string; prompt: string; filename: string }>,
): string {
  const lines: string[] = [];
  lines.push("# FeedBot Hint Generation Analysis");
  lines.push("");
  lines.push(`📊 **Dataset**: ${totalRows} unique errors`);
  lines.push(
    `🤖 **Models**: ${progressFiles.length} model+prompt combinations`,
  );
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("| Model + Prompt | Processed | Coverage |");
  lines.push("|---|---|---|");
  for (const { model, prompt } of progressFiles) {
    const columnName = `${model}_${prompt}`;
    const count = resultArray.filter(
      (row) => row[columnName] && row[columnName].trim() !== "",
    ).length;
    const percentage = ((count / totalRows) * 100).toFixed(1);
    lines.push(
      `| ${model} + ${prompt} | ${count}/${totalRows} | ${percentage}% |`,
    );
  }
  lines.push("");

  // Group by error for comparison
  lines.push("## Error Analysis & Model Comparison");
  lines.push(
    "*Organized by error type for easy comparison across models/prompts*",
  );
  lines.push("");

  // Group errors by category for better organization
  const errorsByCategory: { [category: string]: AggregatedResult[] } = {};
  resultArray.forEach((row) => {
    const key = row.error_type;
    if (!errorsByCategory[key]) {
      errorsByCategory[key] = [];
    }
    const bucket = errorsByCategory[key];
    if (bucket) {
      bucket.push(row);
    }
  });

  for (const [errorType, errors] of Object.entries(errorsByCategory)) {
    lines.push(
      `### ${errorType
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (l) => l.toUpperCase())}`,
    );
    lines.push("");

    for (const error of errors) {
      lines.push(`#### ${error.category}`);
      lines.push(`**Error Context**: \`${error.clean_error_text}\``);
      lines.push(`**Fingerprint**: \`${error.fingerprint}\``);
      lines.push("");

      // Show all model responses for this error
      const hasResponses = progressFiles.some(({ model, prompt }) => {
        const columnName = `${model}_${prompt}`;
        return error[columnName] && error[columnName].trim() !== "";
      });

      if (!hasResponses) {
        lines.push("*No responses generated for this error.*");
        lines.push("");
        continue;
      }

      for (const { model, prompt } of progressFiles) {
        const columnName = `${model}_${prompt}`;
        const hint = error[columnName];
        const tokens = error[`${columnName}_tokens`];
        const cost = error[`${columnName}_cost_usd`];

        if (hint && hint.trim() !== "") {
          lines.push(`**${model} + ${prompt}:**`);
          if (tokens || cost) {
            const usage = [
              tokens && `Tokens: ${tokens}`,
              cost && `Cost: $${cost}`,
            ]
              .filter(Boolean)
              .join(" | ");
            lines.push(`*${usage}*`);
          }
          lines.push("```");
          lines.push(normalizeMultiline(hint));
          lines.push("```");
          lines.push("");
        }
      }
      lines.push("---");
      lines.push("");
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
  const originalRows: EvaluationRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  // Create lookup map for error metadata
  const errorMetadata: { [fingerprint: string]: EvaluationRow } = {};
  originalRows.forEach((row) => {
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
          category: metadata.category,
          test_name: metadata.test_name,
          error_type: metadata.error_type,
          clean_error_text: metadata.clean_error_text,
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

  // Convert to array and sort by category, then test_name
  const resultArray = Object.values(aggregatedResults);
  resultArray.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.test_name.localeCompare(b.test_name);
  });

  // Generate CSV
  console.log("Generating CSV...");
  const csvHeaders = [
    "fingerprint",
    "category",
    "test_name",
    "error_type",
    "clean_error_text",
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
  const markdownReport = buildMarkdownReport(
    resultArray,
    resultArray.length,
    progressFiles,
  );
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
