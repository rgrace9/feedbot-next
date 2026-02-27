import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { MODELS_BY_PROVIDER, type LlmProvider } from "../constants/models.js";
import { PROMPT_VARIATIONS } from "../constants/promptData.js";
import { DATASET } from "../constants/spreadsheets.js";
import { FeedBotProcessor } from "./classes/FeedBotProcessor.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI arguments
function parseArgs(): {
  limit?: number;
  trackCosts: boolean;
  concurrency?: number;
} {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const concurrencyIndex = args.indexOf("--concurrency");
  const trackCosts = args.includes("--track-costs");

  let limit: number | undefined;
  let concurrency: number | undefined;

  if (limitIndex !== -1 && args[limitIndex + 1]) {
    const parsedLimit = parseInt(args[limitIndex + 1]!, 10);
    if (!isNaN(parsedLimit)) {
      limit = parsedLimit;
    }
  }

  if (concurrencyIndex !== -1 && args[concurrencyIndex + 1]) {
    const parsedConcurrency = parseInt(args[concurrencyIndex + 1]!, 10);
    if (!isNaN(parsedConcurrency) && parsedConcurrency > 0) {
      concurrency = parsedConcurrency;
    }
  }

  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    trackCosts,
  };
}

function resolveProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? "azure").toLowerCase();
  if (provider === "azure" || provider === "openrouter") {
    return provider;
  }

  console.error(
    `Error: Invalid LLM_PROVIDER \"${provider}\". Use \"azure\" or \"openrouter\".`,
  );
  process.exit(1);
}

// Main entry point
(async () => {
  const { limit, trackCosts, concurrency } = parseArgs();
  const provider = resolveProvider();

  // Validate environment variables
  if (provider === "azure") {
    if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
      console.error(
        "Error: AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT environment variables are required",
      );
      process.exit(1);
    }
  } else {
    if (!process.env.OPEN_ROUTER_KEY) {
      console.error(
        "Error: OPEN_ROUTER_KEY environment variable is required for OpenRouter",
      );
      process.exit(1);
    }
  }

  const models = MODELS_BY_PROVIDER[provider];
  const modelConfig =
    provider === "azure"
      ? {
          provider,
          apiKey: process.env.AZURE_OPENAI_KEY!,
          endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
          apiVersion: "2025-03-01-preview",
        }
      : {
          provider,
          apiKey: process.env.OPEN_ROUTER_KEY!,
          fetchCosts: trackCosts,
        };

  // Set delays based on provider
  // OpenRouter: no delays needed (generous rate limits)
  // Azure: 2s between requests, 5s between combinations (strict rate limits)
  const defaults =
    provider === "openrouter"
      ? { delayMs: 0, delayBetweenCombinationsMs: 0, concurrency: 8 }
      : { delayMs: 2000, delayBetweenCombinationsMs: 5000, concurrency: 1 };

  // Configure the processor
  const processor = new FeedBotProcessor({
    csvPath: path.join(__dirname, DATASET),
    outputDir: path.join(__dirname, "../feedbotOutput"),
    models,
    promptVariations: PROMPT_VARIATIONS,
    modelConfig,
    ...defaults,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });

  // Run the processor
  await processor.run();
})();
