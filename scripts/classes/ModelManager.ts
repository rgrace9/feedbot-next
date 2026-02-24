import type { EvaluationRow } from "./PromptGenerator.js";
import { PromptGenerator } from "./PromptGenerator.js";
import { AzureModelClient } from "./providers/AzureModelClient.js";
import { OpenRouterModelClient } from "./providers/OpenRouterModelClient.js";
import type {
  LlmProviderClient,
  UsageMetadata,
} from "./providers/providerTypes.js";

export interface ModelConfig {
  provider: "azure" | "openrouter";
  apiKey: string;
  endpoint?: string;
  apiVersion?: string;
}

export type { UsageMetadata } from "./providers/providerTypes.js";

export interface ProcessingResult {
  hint: string;
  timestamp: string;
  error?: string;
  usage?: UsageMetadata;
}

/**
 * Manages LLM API calls for Azure OpenAI and OpenRouter
 */
export class ModelManager {
  private config: ModelConfig;
  private promptGenerator: PromptGenerator;
  private providerClient: LlmProviderClient;

  constructor(config: ModelConfig, promptGenerator: PromptGenerator) {
    this.config = config;
    this.promptGenerator = promptGenerator;

    if (config.provider === "azure") {
      this.validateAzureConfig();
      this.providerClient = new AzureModelClient({
        apiKey: config.apiKey,
        endpoint: config.endpoint!,
        apiVersion: config.apiVersion!,
      });
    } else {
      this.providerClient = new OpenRouterModelClient({
        apiKey: config.apiKey,
      });
    }
  }

  private validateAzureConfig(): void {
    if (!this.config.endpoint || !this.config.apiVersion) {
      throw new Error("Azure requires endpoint and apiVersion in ModelConfig");
    }
  }

  private supportsTemperature(model: string): boolean {
    const normalizedModel = model.split("/").pop() ?? model;
    return (
      !normalizedModel.startsWith("gpt-5") && !normalizedModel.startsWith("o1")
    );
  }

  async processRow(
    row: EvaluationRow,
    model: string,
    promptVariation: string,
  ): Promise<ProcessingResult> {
    const prompt = this.promptGenerator.generate(row, promptVariation);
    const messages = [{ role: "user" as const, content: prompt }];
    const temperature = this.supportsTemperature(model) ? 0.2 : undefined;

    try {
      const result = await this.providerClient.process(
        model,
        messages,
        temperature,
      );

      const processingResult: ProcessingResult = {
        hint: result.content,
        timestamp: new Date().toISOString(),
      };

      if (result.usage) {
        processingResult.usage = result.usage;
      }

      return processingResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`API call failed: ${msg}`);
    }
  }
}
