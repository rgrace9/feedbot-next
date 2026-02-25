#!/usr/bin/env tsx
/**
 * Backfill the cost ledger from existing OpenRouter progress files
 * This reads all existing progress files and populates the cost ledger
 * with historical cost data.
 *
 * Usage: npm run ledger:backfill
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { OPENROUTER_MODELS } from "../constants/models.js";
import { OpenRouterCostLedger } from "./classes/OpenRouterCostLedger.js";

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
      };
    };
  };
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function discoverOpenRouterProgressFiles(outputDir: string): ProgressFile[] {
  const results: ProgressFile[] = [];

  function scanDirectory(dir: string): void {
    if (!existsSync(dir)) return;

    const files = readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
      const fullPath = path.join(dir, file.name);

      // Skip if it's a directory (unless it looks like a date folder)
      if (file.isDirectory()) {
        // Recursively scan subdirectories
        scanDirectory(fullPath);
        continue;
      }

      const match = file.name.match(/^feedbot_progress_m-(.+)_p-(.+)\.json$/);
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

      // Only include OpenRouter models
      if (!OPENROUTER_MODELS.includes(model)) {
        continue;
      }

      results.push({ model, prompt, filename: fullPath });
    }
  }

  scanDirectory(outputDir);
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
    console.warn(`Failed to read ${filePath}`);
    return null;
  }
}

async function main(): Promise<void> {
  const feedbotOutputDir = path.join(__dirname, "../feedbotOutput");
  const costLedger = new OpenRouterCostLedger();

  console.log("🔍 Discovering OpenRouter progress files...\n");

  const progressFiles = discoverOpenRouterProgressFiles(feedbotOutputDir);

  if (progressFiles.length === 0) {
    console.log("❌ No OpenRouter progress files found.");
    process.exit(1);
  }

  console.log(`Found ${progressFiles.length} OpenRouter progress files\n`);

  let entriesAdded = 0;
  let entriesSkipped = 0;

  for (const progressFile of progressFiles) {
    const stateFile = loadStateFile(progressFile.filename);
    if (!stateFile) {
      console.warn(`⚠️  Could not load: ${progressFile.filename}`);
      continue;
    }

    const processed = stateFile.processed || {};

    for (const [fingerprint, data] of Object.entries(processed)) {
      const usage = data.usage;

      // Skip if missing cost data
      if (
        !usage ||
        usage.promptTokens === undefined ||
        usage.completionTokens === undefined ||
        usage.totalTokens === undefined ||
        usage.costUSD === undefined
      ) {
        entriesSkipped++;
        continue;
      }

      // Log to ledger
      costLedger.logRequest(
        progressFile.model,
        usage.promptTokens,
        usage.completionTokens,
        usage.totalTokens,
        usage.costUSD,
      );

      entriesAdded++;
    }
  }

  console.log(`✅ Backfill complete!`);
  console.log(`   Entries added: ${entriesAdded}`);
  console.log(`   Entries skipped (incomplete data): ${entriesSkipped}\n`);

  // Print the updated report
  costLedger.printReport();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
