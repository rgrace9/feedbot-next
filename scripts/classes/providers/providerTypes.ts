export interface UsageMetadata {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUSD?: number;
}

export interface ProviderResult {
  content: string;
  usage?: UsageMetadata;
}

export interface ChatMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

export interface LlmProviderClient {
  process(
    model: string,
    messages: ChatMessage[],
    temperature?: number,
  ): Promise<ProviderResult>;
}
