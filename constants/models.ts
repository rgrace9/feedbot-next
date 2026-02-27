export type LlmProvider = "azure" | "openrouter";

export const AZURE_MODELS = [
  // "gpt-4o",
  // "gpt-4o-mini",
  "gpt-5-mini",
];

// Cost-focused starter set for comparison on OpenRouter
export const OPENROUTER_MODELS = [
  "openai/gpt-4o-mini",
  "deepseek/deepseek-chat-v3",
  // "qwen/qwen3.5-flash-02-23",
  "anthropic/claude-3-haiku",
  "google/gemini-2.5-flash-lite",
];

export const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  azure: AZURE_MODELS,
  openrouter: OPENROUTER_MODELS,
};

// Backward compatible default
export const MODELS = AZURE_MODELS;
