export interface UsageMetadata {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUSD?: number;
  responseId?: string; // OpenRouter generation ID for batch cost lookup
}

export interface ProviderResult {
  content: string;
  usage?: UsageMetadata;
}

export interface ChatMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

export interface ProcessOptions {
  maxTokens?: number;
}

export interface LlmProviderClient {
  process(
    model: string,
    messages: ChatMessage[],
    temperature?: number,
    options?: ProcessOptions,
  ): Promise<ProviderResult>;
}
