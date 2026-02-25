import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CostLedgerEntry {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD: number;
}

export interface CostLedgerSummary {
  model: string;
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUSD: number;
}

export interface CostLedgerData {
  createdAt: string;
  lastUpdatedAt: string;
  entries: CostLedgerEntry[];
  summary: Record<string, CostLedgerSummary>;
}

/**
 * Manages persistent cost tracking for OpenRouter requests.
 * Stores all costs in feedbotOutput/openrouter_cost_ledger.json
 */
export class OpenRouterCostLedger {
  private ledgerPath: string;

  constructor() {
    const feedbotOutputDir = path.join(__dirname, "../../feedbotOutput");
    this.ledgerPath = path.join(
      feedbotOutputDir,
      "openrouter_cost_ledger.json",
    );
  }

  /**
   * Load the cost ledger from disk, or initialize if it doesn't exist
   */
  private load(): CostLedgerData {
    if (existsSync(this.ledgerPath)) {
      try {
        const content = readFileSync(this.ledgerPath, "utf-8");
        return JSON.parse(content) as CostLedgerData;
      } catch (error) {
        console.warn(
          "Failed to load cost ledger, starting fresh:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    return {
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      entries: [],
      summary: {},
    };
  }

  /**
   * Save the cost ledger to disk
   */
  private save(data: CostLedgerData): void {
    writeFileSync(this.ledgerPath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Rebuild the summary statistics from entries
   */
  private rebuildSummary(
    entries: CostLedgerEntry[],
  ): Record<string, CostLedgerSummary> {
    const summary: Record<string, CostLedgerSummary> = {};

    for (const entry of entries) {
      if (!summary[entry.model]) {
        summary[entry.model] = {
          model: entry.model,
          requestCount: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          totalCostUSD: 0,
        };
      }

      summary[entry.model]!.requestCount += 1;
      summary[entry.model]!.totalPromptTokens += entry.promptTokens;
      summary[entry.model]!.totalCompletionTokens += entry.completionTokens;
      summary[entry.model]!.totalTokens += entry.totalTokens;
      summary[entry.model]!.totalCostUSD += entry.costUSD;
    }

    return summary;
  }

  /**
   * Add a cost entry for a single OpenRouter request
   */
  logRequest(
    model: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    costUSD: number,
  ): void {
    const data = this.load();

    const entry: CostLedgerEntry = {
      timestamp: new Date().toISOString(),
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUSD,
    };

    data.entries.push(entry);
    data.lastUpdatedAt = new Date().toISOString();
    data.summary = this.rebuildSummary(data.entries);

    this.save(data);
  }

  /**
   * Get the full ledger data
   */
  getLedger(): CostLedgerData {
    return this.load();
  }

  /**
   * Get summary statistics by model
   */
  getSummary(): Record<string, CostLedgerSummary> {
    return this.load().summary;
  }

  /**
   * Get total cost across all requests
   */
  getTotalCost(): number {
    const ledger = this.load();
    return ledger.entries.reduce((sum, entry) => sum + entry.costUSD, 0);
  }

  /**
   * Print a formatted report to console
   */
  printReport(): void {
    const data = this.load();

    console.log("\n📊 OpenRouter Cost Ledger Report");
    console.log("================================");
    console.log(`Created: ${data.createdAt}`);
    console.log(`Last Updated: ${data.lastUpdatedAt}`);
    console.log(`Total Requests: ${data.entries.length}`);
    console.log(
      `Total Cost: $${data.entries.reduce((sum, e) => sum + e.costUSD, 0).toFixed(6)}`,
    );
    console.log("\n📈 Summary by Model:");

    const sortedModels = Object.values(data.summary).sort(
      (a, b) => b.totalCostUSD - a.totalCostUSD,
    );

    for (const modelSummary of sortedModels) {
      console.log(`\n  ${modelSummary.model}`);
      console.log(`    Requests: ${modelSummary.requestCount}`);
      console.log(
        `    Tokens: ${modelSummary.totalTokens} (prompt: ${modelSummary.totalPromptTokens}, completion: ${modelSummary.totalCompletionTokens})`,
      );
      console.log(`    Cost: $${modelSummary.totalCostUSD.toFixed(6)}`);
    }

    console.log("\n");
  }

  /**
   * Export the ledger to CSV format
   */
  getAsCSV(): string {
    const data = this.load();
    const headers = [
      "Timestamp",
      "Model",
      "Prompt Tokens",
      "Completion Tokens",
      "Total Tokens",
      "Cost USD",
    ];
    const rows = data.entries.map((entry) => [
      entry.timestamp,
      entry.model,
      entry.promptTokens.toString(),
      entry.completionTokens.toString(),
      entry.totalTokens.toString(),
      entry.costUSD.toFixed(6),
    ]);

    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join(
      "\n",
    );

    return csv;
  }

  /**
   * Reset the ledger (for testing)
   */
  reset(): void {
    const data: CostLedgerData = {
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      entries: [],
      summary: {},
    };
    this.save(data);
    console.log("✅ Cost ledger reset.");
  }
}
