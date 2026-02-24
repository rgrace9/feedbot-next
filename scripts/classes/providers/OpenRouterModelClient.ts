import { OpenRouter } from "@openrouter/sdk";
import type {
  ChatMessage,
  LlmProviderClient,
  ProviderResult,
} from "./providerTypes.js";

export interface OpenRouterClientConfig {
  apiKey: string;
}

export class OpenRouterModelClient implements LlmProviderClient {
  private client: OpenRouter;
  private apiKey: string;

  constructor(config: OpenRouterClientConfig) {
    this.apiKey = config.apiKey;
    this.client = new OpenRouter({ apiKey: config.apiKey });
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

    const responseCost = (response as { cost?: unknown }).cost;
    if (result.usage && typeof responseCost === "number") {
      result.usage.costUSD = responseCost;
    }

    if (result.usage && result.usage.costUSD === undefined && response.id) {
      await this.sleep(30000);
      const fetchedCost = await this.fetchGenerationCostWithRetry(response.id);
      if (fetchedCost !== undefined) {
        result.usage.costUSD = fetchedCost;
      }
    }

    return result;
  }
}
