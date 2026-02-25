#!/usr/bin/env tsx
/**
 * View and manage the OpenRouter cost ledger
 * Usage:
 *   npm run ledger:view     - Display the cost ledger report
 *   npm run ledger:csv      - Export cost ledger as CSV
 *   npm run ledger:reset    - Reset the cost ledger (for testing)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { OpenRouterCostLedger } from "./classes/OpenRouterCostLedger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const command = process.argv[2] || "view";
  const ledger = new OpenRouterCostLedger();

  switch (command) {
    case "view":
      ledger.printReport();
      break;

    case "csv": {
      const csv = ledger.getAsCSV();
      const outputPath = path.join(
        __dirname,
        "../feedbotOutput/openrouter_cost_ledger.csv",
      );
      fs.writeFileSync(outputPath, csv, "utf-8");
      console.log(`✅ Cost ledger exported to ${outputPath}`);
      break;
    }

    case "reset": {
      const confirm = process.argv[3];
      if (confirm !== "--confirm") {
        console.log("⚠️  This will reset the cost ledger!");
        console.log("Run with --confirm flag to proceed:");
        console.log("  npm run ledger:reset -- --confirm");
        process.exit(1);
      }
      ledger.reset();
      break;
    }

    case "json": {
      const data = ledger.getLedger();
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log("Valid commands: view, csv, reset, json");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
