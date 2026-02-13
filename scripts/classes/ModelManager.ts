import OpenAI from "openai";
import type { EvaluationRow } from "./PromptGenerator.js";
import { PromptGenerator } from "./PromptGenerator.js";

export interface ModelConfig {
  apiKey: string;
  endpoint: string;
  apiVersion: string;
}

export interface ProcessingResult {
  hint: string;
  timestamp: string;
  error?: string;
}

/**
 * Manages OpenAI model interactions and API calls
 */
export class ModelManager {
  private config: ModelConfig;
  private promptGenerator: PromptGenerator;

  constructor(config: ModelConfig, promptGenerator: PromptGenerator) {
    this.config = config;
    this.promptGenerator = promptGenerator;
  }

  /**
   * Create an OpenAI client for a specific model deployment
   */
  private createClient(model: string): OpenAI {
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: `${this.config.endpoint}/openai/deployments/${model}`,
      defaultQuery: { "api-version": this.config.apiVersion },
      defaultHeaders: { "api-key": this.config.apiKey },
    });
  }

  /**
   * Check if a model supports temperature parameter
   */
  private supportsTemperature(model: string): boolean {
    // GPT-5 models and O1 models don't support temperature
    return !model.startsWith("gpt-5") && !model.startsWith("o1");
  }

  /**
   * Process a single row with a specific model and prompt variation
   */
  async processRow(
    row: EvaluationRow,
    model: string,
    promptVariation: string,
  ): Promise<ProcessingResult> {
    const client = this.createClient(model);
    const prompt = this.promptGenerator.generate(row, promptVariation);

    // Build API parameters based on model capabilities
    const apiParams: any = {
      model,
      messages: [{ role: "user", content: prompt }],
    };

    // Only add temperature for models that support it
    if (this.supportsTemperature(model)) {
      apiParams.temperature = 0.2;
    }

    try {
      const resp = await client.chat.completions.create(apiParams);
      const hint = resp?.choices[0]?.message.content || "";

      return {
        hint,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`API call failed: ${errorMessage}`);
    }
  }
}
