import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { MODELS_BY_PROVIDER, type LlmProvider } from "../constants/models.js";
import { PROMPT_VARIATIONS } from "../constants/promptData.js";
import { FeedBotProcessor } from "./classes/FeedBotProcessor.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI arguments
function parseArgs(): { limit?: number; trackCosts: boolean } {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const trackCosts = args.includes("--track-costs");

  if (limitIndex !== -1 && args[limitIndex + 1]) {
    const limit = parseInt(args[limitIndex + 1]!, 10);
    if (!isNaN(limit)) {
      return { limit, trackCosts };
    }
  }

  return { trackCosts };
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
  const { limit, trackCosts } = parseArgs();
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
  const delays =
    provider === "openrouter"
      ? { delayMs: 0, delayBetweenCombinationsMs: 0 }
      : { delayMs: 2000, delayBetweenCombinationsMs: 5000 };

  // Configure the processor
  const processor = new FeedBotProcessor({
    csvPath: path.join(__dirname, "../data/evaluation_dataset.csv"),
    outputDir: path.join(__dirname, "../feedbotOutput"),
    models,
    promptVariations: PROMPT_VARIATIONS,
    modelConfig,
    ...delays,
    ...(limit !== undefined ? { limit } : {}),
  });

  // Run the processor
  await processor.run();
})();
