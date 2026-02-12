import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Models and prompt variations (matching your feedbot.ts)
const models = ["gpt-4o", "gpt-4o-mini", "gpt-5-mini"];
const promptVariations = ["detailed", "concise", "encouraging"];

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

// Generate state file path (matching your feedbot.ts)
function getStatePath(model: string, promptVariation: string): string {
  return path.join(
    __dirname,
    `../feedbotOutput/feedbot_progress_${model}_${promptVariation}.json`,
  );
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

// Main aggregation function
(async () => {
  const CSV_PATH = path.join(__dirname, "../data/evaluation_dataset.csv");
  const OUTPUT_PATH = path.join(
    __dirname,
    "../feedbotOutput/aggregated_results.csv",
  );

  console.log("Starting results aggregation...");

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

  for (const model of models) {
    for (const promptVariation of promptVariations) {
      const filePath = getStatePath(model, promptVariation);
      const columnName = `${model}_${promptVariation}`;

      console.log(`Processing: ${columnName}`);

      const stateFile = loadStateFile(filePath);
      if (!stateFile) {
        console.warn(`Skipping ${filePath} - file not found or invalid`);
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
            clean_error_text:
              metadata.clean_error_text.substring(0, 200) + "...", // Truncate for CSV readability
          };

          // Initialize all model+prompt columns as empty
          for (const m of models) {
            for (const p of promptVariations) {
              aggregatedResults[fingerprint][`${m}_${p}`] = "";
            }
          }
        }

        // Add the hint for this model+prompt combination
        aggregatedResults[fingerprint][columnName] = result.hint;
      });
    }
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
    ...models.flatMap((model) =>
      promptVariations.map((prompt) => `${model}_${prompt}`),
    ),
  ];

  const csvData = stringify(resultArray, {
    header: true,
    columns: csvHeaders,
  });

  // Write CSV file
  writeFileSync(OUTPUT_PATH, csvData, "utf-8");

  // Print summary
  console.log("\n=== AGGREGATION SUMMARY ===");
  console.log(`Unique errors processed: ${resultArray.length}`);
  console.log(
    `Model+prompt combinations: ${models.length * promptVariations.length}`,
  );
  console.log(`Output file: ${OUTPUT_PATH}`);

  // Count coverage per combination
  console.log("\nCoverage by model+prompt combination:");
  for (const model of models) {
    for (const promptVariation of promptVariations) {
      const columnName = `${model}_${promptVariation}`;
      const count = resultArray.filter(
        (row) => row[columnName] && row[columnName].trim() !== "",
      ).length;
      console.log(
        `  ${columnName}: ${count}/${resultArray.length} errors processed`,
      );
    }
  }

  console.log(`\n✅ Aggregation complete! Check: ${OUTPUT_PATH}`);
})();
