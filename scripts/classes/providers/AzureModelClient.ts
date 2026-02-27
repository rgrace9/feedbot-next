import OpenAI from "openai";
import type {
  ChatMessage,
  LlmProviderClient,
  ProcessOptions,
  ProviderResult,
} from "./providerTypes.js";

export interface AzureClientConfig {
  apiKey: string;
  endpoint: string;
  apiVersion: string;
}

export class AzureModelClient implements LlmProviderClient {
  private client: OpenAI;

  constructor(config: AzureClientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.endpoint}/openai/deployments`,
      defaultQuery: { "api-version": config.apiVersion },
      defaultHeaders: { "api-key": config.apiKey },
    });
  }

  async process(
    model: string,
    messages: ChatMessage[],
    temperature?: number,
    _options?: ProcessOptions,
  ): Promise<ProviderResult> {
    const payload: any = { model, messages };
    if (temperature !== undefined) payload.temperature = temperature;

    const resp = await this.client.chat.completions.create(payload);
    const content = resp.choices[0]?.message.content || "";

    const result: ProviderResult = { content };
    if (resp.usage) {
      result.usage = {
        promptTokens: resp.usage.prompt_tokens,
        completionTokens: resp.usage.completion_tokens,
        totalTokens: resp.usage.total_tokens,
      };
    }

    return result;
  }
}
