export type LlmProvider = "azure" | "openrouter";

export const AZURE_MODELS = [
  // "gpt-4o",
  // "gpt-4o-mini",
  "gpt-5-mini",
];

// Cost-focused starter set for comparison on OpenRouter
export const OPENROUTER_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-5-mini",
  "deepseek/deepseek-chat-v3",
  "qwen/qwen3-32b",
  // "google/gemini-2.0-flash-001", // GOING AWAY MARCH 31, 2026
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
];

export const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  azure: AZURE_MODELS,
  openrouter: OPENROUTER_MODELS,
};

// Backward compatible default
export const MODELS = AZURE_MODELS;
