import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { ModelManager, type ModelConfig } from "./ModelManager.js";
import type { EvaluationRow } from "./PromptGenerator.js";
import { PromptGenerator } from "./PromptGenerator.js";
import { ResultsAggregator } from "./ResultsAggregator.js";

/**
 * State file structure for tracking processed items
 */
interface StateFile {
  processed: {
    [fingerprint: string]: {
      hint: string;
      timestamp: string;
    };
  };
}

/**
 * Configuration for FeedBot processor
 */
export interface FeedBotConfig {
  csvPath: string;
  outputDir: string;
  models: string[];
  promptVariations: string[];
  modelConfig: ModelConfig;
  limit?: number;
}

/**
 * Main processor for FeedBot - orchestrates the entire processing workflow
 */
export class FeedBotProcessor {
  private config: FeedBotConfig;
  private promptGenerator: PromptGenerator;
  private modelManager: ModelManager;
  private resultsAggregator: ResultsAggregator;

  constructor(config: FeedBotConfig) {
    this.config = config;
    this.promptGenerator = new PromptGenerator();
    this.modelManager = new ModelManager(
      config.modelConfig,
      this.promptGenerator,
    );
    this.resultsAggregator = new ResultsAggregator();
  }

  /**
   * Load CSV data
   */
  private loadCSV(): EvaluationRow[] {
    const csvContent = readFileSync(this.config.csvPath, "utf-8");
    return parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
  }

  /**
   * Generate state file path for a specific model+prompt combination
   */
  private getStatePath(model: string, promptVariation: string): string {
    return path.join(
      this.config.outputDir,
      `feedbot_progress_${model}_${promptVariation}.json`,
    );
  }

  /**
   * Load state from file
   */
  private loadState(statePath: string): StateFile {
    if (existsSync(statePath)) {
      const content = readFileSync(statePath, "utf-8");
      return JSON.parse(content);
    }
    return { processed: {} };
  }

  /**
   * Save state to file
   */
  private saveState(state: StateFile, statePath: string): void {
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  /**
   * Check if a row has already been processed
   */
  private isAlreadyProcessed(row: EvaluationRow, state: StateFile): boolean {
    return !!state.processed[row.fingerprint];
  }

  /**
   * Log a message with model and prompt variation context
   */
  private log(
    model: string,
    promptVariation: string,
    message: string,
    index?: number,
    total?: number,
  ): void {
    const prefix =
      index !== undefined && total !== undefined
        ? `[${model}] [${promptVariation}] [${index}/${total}]`
        : `[${model}] [${promptVariation}]`;
    console.log(`${prefix} ${message}`);
  }

  /**
   * Process a single row
   */
  private async processSingleRow(
    row: EvaluationRow,
    model: string,
    promptVariation: string,
    state: StateFile,
    statePath: string,
    index: number,
    total: number,
  ): Promise<void> {
    // Skip if row is undefined
    if (!row) {
      return;
    }

    // Skip DEPENDENCY_NOT_MET errors
    if (this.promptGenerator.shouldSkipRow(row)) {
      this.log(
        model,
        promptVariation,
        `Skipping DEPENDENCY_NOT_MET: ${row.category}`,
        index,
        total,
      );
      this.resultsAggregator.incrementSkipped(model, promptVariation);
      return;
    }

    // Skip if already processed
    if (this.isAlreadyProcessed(row, state)) {
      this.log(
        model,
        promptVariation,
        `Already processed: ${row.category}`,
        index,
        total,
      );
      this.resultsAggregator.incrementSkipped(model, promptVariation);
      return;
    }

    // Process the row
    try {
      const result = await this.modelManager.processRow(
        row,
        model,
        promptVariation,
      );

      // Save to state immediately
      state.processed[row.fingerprint] = {
        hint: result.hint,
        timestamp: result.timestamp,
      };
      this.saveState(state, statePath);

      // Log success
      this.log(
        model,
        promptVariation,
        `Processing: ${row.category}`,
        index,
        total,
      );
      this.log(model, promptVariation, `Hint: ${result.hint}`);
      console.log("---\n");

      this.resultsAggregator.incrementProcessed(model, promptVariation);
    } catch (error) {
      console.error(
        `[${model}] [${promptVariation}] [${index}/${total}] ERROR processing ${row.category}`,
      );
      console.error(`  Fingerprint: ${row.fingerprint}`);
      console.error(`  Error:`, error instanceof Error ? error.message : error);
      console.log("---\n");

      this.resultsAggregator.incrementFailed(model, promptVariation);
    }
  }

  /**
   * Process all rows for a specific model+prompt combination
   */
  private async processCombination(
    rows: EvaluationRow[],
    model: string,
    promptVariation: string,
  ): Promise<void> {
    // Initialize stats for this combination
    this.resultsAggregator.initializeCombination(model, promptVariation);

    // Get state path and load state
    const statePath = this.getStatePath(model, promptVariation);
    const state = this.loadState(statePath);

    // Apply limit if specified
    const rowsToProcess = this.config.limit
      ? rows.slice(0, this.config.limit)
      : rows;
    const total = rowsToProcess.length;

    this.log(
      model,
      promptVariation,
      `Starting combination: ${total} rows to process`,
    );
    console.log("---\n");

    // Process each row
    for (let i = 0; i < rowsToProcess.length; i++) {
      const row = rowsToProcess[i];
      await this.processSingleRow(
        row,
        model,
        promptVariation,
        state,
        statePath,
        i + 1,
        total,
      );
    }

    this.log(
      model,
      promptVariation,
      `Combination complete. State saved to: ${statePath}\n`,
    );
  }

  /**
   * Run the complete processing workflow
   */
  async run(): Promise<void> {
    console.log(
      `Starting feedbot processing: ${this.config.models.length} models × ${this.config.promptVariations.length} prompt variations`,
    );
    console.log(
      `Total combinations: ${this.config.models.length * this.config.promptVariations.length}`,
    );
    if (this.config.limit) {
      console.log(
        `(Limited to first ${this.config.limit} rows per combination)`,
      );
    }
    console.log("---\n");

    // Load CSV data
    const rows = this.loadCSV();

    // Process each model+prompt combination
    for (const model of this.config.models) {
      for (const promptVariation of this.config.promptVariations) {
        await this.processCombination(rows, model, promptVariation);
      }
    }

    // Print final summary
    const summary = this.resultsAggregator.generateSummary(
      this.config.models,
      this.config.promptVariations,
    );
    console.log(summary);
  }
}
