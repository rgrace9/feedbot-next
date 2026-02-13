import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { MODELS as models } from "../constants/models.js";
import { PROMPT_VARIATIONS } from "../constants/promptData.js";
import { FeedBotProcessor } from "./classes/FeedBotProcessor.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI arguments
function parseArgs(): { limit?: number } {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");

  if (limitIndex !== -1 && args[limitIndex + 1]) {
    const limit = parseInt(args[limitIndex + 1]!, 10);
    if (!isNaN(limit)) {
      return { limit };
    }
  }

  return {};
}

// Main entry point
(async () => {
  const { limit } = parseArgs();

  // Validate environment variables
  if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
    console.error(
      "Error: AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT environment variables are required",
    );
    process.exit(1);
  }

  // Configure the processor
  const processor = new FeedBotProcessor({
    csvPath: path.join(__dirname, "../data/evaluation_dataset.csv"),
    outputDir: path.join(__dirname, "../feedbotOutput"),
    models,
    promptVariations: PROMPT_VARIATIONS,
    modelConfig: {
      apiKey: process.env.AZURE_OPENAI_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: "2025-03-01-preview",
    },
    limit,
  });

  // Run the processor
  await processor.run();
})();
