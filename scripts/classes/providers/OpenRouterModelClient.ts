import { OpenRouter } from "@openrouter/sdk";
import { OpenRouterCostLedger } from "../OpenRouterCostLedger.js";
import type {
  ChatMessage,
  LlmProviderClient,
  ProviderResult,
} from "./providerTypes.js";

export interface OpenRouterClientConfig {
  apiKey: string;
  fetchCosts?: boolean; // Whether to fetch costs immediately (defaults to env var or false)
}

export class OpenRouterModelClient implements LlmProviderClient {
  private client: OpenRouter;
  private apiKey: string;
  private costLedger: OpenRouterCostLedger;
  private fetchCosts: boolean;

  constructor(config: OpenRouterClientConfig) {
    this.apiKey = config.apiKey;
    this.client = new OpenRouter({ apiKey: config.apiKey });
    this.costLedger = new OpenRouterCostLedger();
    // Default to false unless explicitly set or env var is true
    this.fetchCosts =
      config.fetchCosts ??
      process.env.FETCH_OPENROUTER_COSTS?.toLowerCase() === "true";
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchGenerationCostWithRetry(
    generationId: string,
    retries: number = 3,
    delayMs: number = 2000,
  ): Promise<number | undefined> {
    for (let attempt = 0; attempt < retries; attempt++) {
      await this.sleep(delayMs);
      try {
        const response = await fetch(
          `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
          {
            headers: { Authorization: `Bearer ${this.apiKey}` },
          },
        );

        if (!response.ok) {
          continue;
        }

        const data = (await response.json()) as {
          data?: { total_cost?: number | string };
        };

        const rawCost = data?.data?.total_cost;
        if (rawCost !== undefined && rawCost !== null) {
          const parsed =
            typeof rawCost === "number" ? rawCost : Number.parseFloat(rawCost);
          if (!Number.isNaN(parsed)) {
            return parsed;
          }
        }
      } catch {
        // best effort
      }
    }

    return undefined;
  }

  private extractContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const first = content[0];
      if (first && typeof first === "object" && "text" in first) {
        const text = (first as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
    }

    return "";
  }

  async process(
    model: string,
    messages: ChatMessage[],
    temperature?: number,
  ): Promise<ProviderResult> {
    const response = await this.client.chat.send({
      chatGenerationParams: {
        model,
        messages,
        stream: false,
        ...(temperature !== undefined ? { temperature } : {}),
      },
    });

    const result: ProviderResult = {
      content: this.extractContent(response.choices[0]?.message?.content),
    };

    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
      };
    }

    // Always capture response ID for batch cost lookup later
    if (response.id) {
      result.usage = result.usage ?? {};
      result.usage.responseId = response.id;
    }

    const responseCost = (response as { cost?: unknown }).cost;
    if (result.usage && typeof responseCost === "number") {
      result.usage.costUSD = responseCost;
    }

    // Only fetch cost immediately if fetchCosts is enabled
    if (
      this.fetchCosts &&
      result.usage &&
      result.usage.costUSD === undefined &&
      response.id
    ) {
      await this.sleep(30000);
      const fetchedCost = await this.fetchGenerationCostWithRetry(response.id);
      if (fetchedCost !== undefined) {
        result.usage.costUSD = fetchedCost;
      }
    }

    // Log to persistent cost ledger if usage and cost are available
    if (
      result.usage &&
      result.usage.promptTokens !== undefined &&
      result.usage.completionTokens !== undefined &&
      result.usage.totalTokens !== undefined &&
      result.usage.costUSD !== undefined
    ) {
      this.costLedger.logRequest(
        model,
        result.usage.promptTokens,
        result.usage.completionTokens,
        result.usage.totalTokens,
        result.usage.costUSD,
      );
    }

    return result;
  }
}
