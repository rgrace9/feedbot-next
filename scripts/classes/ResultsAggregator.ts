/**
 * Statistics for a single model+prompt combination
 */
export interface CombinationStats {
  processed: number;
  skipped: number;
  failed: number;
}

/**
 * Aggregates and reports processing statistics
 */
export class ResultsAggregator {
  private stats: Map<string, CombinationStats>;

  constructor() {
    this.stats = new Map();
  }

  /**
   * Initialize stats for a model+prompt combination
   */
  initializeCombination(model: string, promptVariation: string): void {
    const key = this.getKey(model, promptVariation);
    this.stats.set(key, { processed: 0, skipped: 0, failed: 0 });
  }

  /**
   * Increment processed count for a combination
   */
  incrementProcessed(model: string, promptVariation: string): void {
    this.incrementStat(model, promptVariation, "processed");
  }

  /**
   * Increment skipped count for a combination
   */
  incrementSkipped(model: string, promptVariation: string): void {
    this.incrementStat(model, promptVariation, "skipped");
  }

  /**
   * Increment failed count for a combination
   */
  incrementFailed(model: string, promptVariation: string): void {
    this.incrementStat(model, promptVariation, "failed");
  }

  /**
   * Get stats for a specific combination
   */
  getStats(model: string, promptVariation: string): CombinationStats {
    const key = this.getKey(model, promptVariation);
    return this.stats.get(key) || { processed: 0, skipped: 0, failed: 0 };
  }

  /**
   * Generate a summary report of all statistics
   */
  generateSummary(models: string[], promptVariations: string[]): string {
    const lines: string[] = ["\n=== SUMMARY ==="];

    for (const model of models) {
      for (const promptVariation of promptVariations) {
        const stat = this.getStats(model, promptVariation);
        lines.push(
          `${model} + ${promptVariation}: ${stat.processed} processed, ${stat.skipped} skipped, ${stat.failed} failed`,
        );
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate a unique key for a model+prompt combination
   */
  private getKey(model: string, promptVariation: string): string {
    return `${model}_${promptVariation}`;
  }

  /**
   * Increment a specific stat type
   */
  private incrementStat(
    model: string,
    promptVariation: string,
    statType: keyof CombinationStats,
  ): void {
    const key = this.getKey(model, promptVariation);
    const stats = this.stats.get(key);
    if (stats) {
      stats[statType]++;
    }
  }
}
