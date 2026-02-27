import { OpenRouter } from "@openrouter/sdk";
import { OpenRouterCostLedger } from "../OpenRouterCostLedger.js";
import type {
  ChatMessage,
  LlmProviderClient,
  ProcessOptions,
  ProviderResult,
} from "./providerTypes.js";

export interface OpenRouterClientConfig {
  apiKey: string;
  fetchCosts?: boolean; // Whether to fetch costs immediately (defaults to env var or false)
  maxTokens?: number;
}

type FeedBotPayload = {
  status: "OK" | "RETRY";
  strategy: string;
  focus: string;
  spec_quote: string;
  analysis: string;
  hint: string;
};

const DEFAULT_OPENROUTER_MAX_TOKENS = 1024;

export class OpenRouterModelClient implements LlmProviderClient {
  private client: OpenRouter;
  private apiKey: string;
  private costLedger: OpenRouterCostLedger;
  private fetchCosts: boolean;
  private maxTokens: number;

  constructor(config: OpenRouterClientConfig) {
    this.apiKey = config.apiKey;
    this.client = new OpenRouter({ apiKey: config.apiKey });
    this.costLedger = new OpenRouterCostLedger();
    // Default to false unless explicitly set or env var is true
    this.fetchCosts =
      config.fetchCosts ??
      process.env.FETCH_OPENROUTER_COSTS?.toLowerCase() === "true";
    this.maxTokens =
      config.maxTokens ??
      this.parsePositiveInteger(process.env.OPENROUTER_MAX_TOKENS) ??
      DEFAULT_OPENROUTER_MAX_TOKENS;
  }

  private parsePositiveInteger(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
      const textParts: string[] = [];

      for (const part of content) {
        if (typeof part === "string") {
          textParts.push(part);
          continue;
        }

        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text;
          if (typeof text === "string" && text.trim().length > 0) {
            textParts.push(text);
          }
        }
      }

      return textParts.join("\n").trim();
    }

    return "";
  }

  private tryParseJsonObject(candidate: string): object | undefined {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as object;
      }
    } catch {
      // fall through
    }

    return undefined;
  }

  private extractFirstJsonObjectSubstring(text: string): string | undefined {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        if (depth === 0) {
          start = i;
        }
        depth++;
      } else if (char === "}" && depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          return text.slice(start, i + 1);
        }
      }
    }

    return undefined;
  }

  private ensureJsonObjectContent(content: string): string {
    const normalized = content.trim();
    const direct = this.tryParseJsonObject(normalized);
    if (direct) {
      return JSON.stringify(direct);
    }

    const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      const fromFence = this.tryParseJsonObject(fencedMatch[1].trim());
      if (fromFence) {
        return JSON.stringify(fromFence);
      }
    }

    const extracted = this.extractFirstJsonObjectSubstring(normalized);
    if (extracted) {
      const fromExtracted = this.tryParseJsonObject(extracted);
      if (fromExtracted) {
        return JSON.stringify(fromExtracted);
      }
    }

    const preview = normalized.slice(0, 300).replace(/\s+/g, " ");
    throw new Error(
      `OpenRouter response was not valid JSON object content. Preview: ${preview}`,
    );
  }

  private async repairToJsonObject(
    originalModel: string,
    rawText: string,
  ): Promise<string | undefined> {
    if (!rawText.trim()) {
      return undefined;
    }

    const repairModel =
      process.env.OPENROUTER_JSON_REPAIR_MODEL?.trim() || originalModel;

    const repairResponse = await this.client.chat.send({
      chatGenerationParams: {
        model: repairModel,
        stream: false,
        temperature: 0,
        responseFormat: { type: "json_object" },
        maxTokens: this.maxTokens,
        messages: [
          {
            role: "system",
            content:
              "Convert the user text into a valid JSON object. Return only JSON. No markdown.",
          },
          {
            role: "user",
            content: rawText,
          },
        ],
      },
    });

    const repaired = this.extractContent(
      repairResponse.choices[0]?.message?.content,
    );

    const direct = this.tryParseJsonObject(repaired.trim());
    if (direct && this.isValidFeedBotPayload(direct)) {
      return JSON.stringify(direct);
    }

    const extracted = this.extractFirstJsonObjectSubstring(repaired);
    if (extracted) {
      const parsed = this.tryParseJsonObject(extracted);
      if (parsed && this.isValidFeedBotPayload(parsed)) {
        return JSON.stringify(parsed);
      }
    }

    return undefined;
  }

  private isValidFeedBotPayload(value: object): value is FeedBotPayload {
    const candidate = value as Record<string, unknown>;
    const status = candidate.status;

    if (status !== "OK" && status !== "RETRY") {
      return false;
    }

    if (typeof candidate.strategy !== "string") {
      return false;
    }
    if (typeof candidate.focus !== "string") {
      return false;
    }
    if (typeof candidate.spec_quote !== "string") {
      return false;
    }
    if (typeof candidate.analysis !== "string") {
      return false;
    }
    if (typeof candidate.hint !== "string") {
      return false;
    }

    return true;
  }

  private async normalizeJsonWithFallbacks(
    model: string,
    content: string,
  ): Promise<string | undefined> {
    const normalized = content.trim();
    if (!normalized) {
      return undefined;
    }

    // 1) direct parse
    const direct = this.tryParseJsonObject(normalized);
    if (direct && this.isValidFeedBotPayload(direct)) {
      return JSON.stringify(direct);
    }

    // 2) extract first {...}
    const extracted = this.extractFirstJsonObjectSubstring(normalized);
    if (extracted) {
      const parsed = this.tryParseJsonObject(extracted);
      if (parsed && this.isValidFeedBotPayload(parsed)) {
        return JSON.stringify(parsed);
      }
    }

    // 3) repair pass
    return this.repairToJsonObject(model, normalized);
  }

  async process(
    model: string,
    messages: ChatMessage[],
    temperature?: number,
    options?: ProcessOptions,
  ): Promise<ProviderResult> {
    // one retry max
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.client.chat.send({
        chatGenerationParams: {
          model,
          messages,
          stream: false,
          responseFormat: { type: "json_object" },
          maxTokens: options?.maxTokens ?? this.maxTokens,
          ...(temperature !== undefined ? { temperature } : {}),
        },
      });

      const raw = this.extractContent(response.choices[0]?.message?.content);
      const content = await this.normalizeJsonWithFallbacks(model, raw);

      if (content) {
        const result: ProviderResult = { content };

        if (response.usage) {
          result.usage = {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          };
        }

        if (response.id) {
          result.usage = result.usage ?? {};
          result.usage.responseId = response.id;
        }

        const responseCost = (response as { cost?: unknown }).cost;
        if (result.usage && typeof responseCost === "number") {
          result.usage.costUSD = responseCost;
        }

        return result;
      }
    }

    // retry exhausted -> mark RETRY so harness can drop
    return {
      content: JSON.stringify({ status: "RETRY" }),
    };
  }
}
