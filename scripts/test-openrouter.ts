import { OpenRouter } from "@openrouter/sdk";
import * as dotenv from "dotenv";

dotenv.config();

(async () => {
  const apiKey = process.env.OPEN_ROUTER_KEY;
  if (!apiKey) {
    console.error("Error: OPEN_ROUTER_KEY environment variable is required");
    process.exit(1);
  }

  console.log("🧪 Testing OpenRouter Integration...\n");

  const openRouter = new OpenRouter({ apiKey });

  try {
    console.log("📤 Sending test request to OpenRouter...");

    const response = await openRouter.chat.send({
      chatGenerationParams: {
        model: "openai/gpt-4o-mini",
        stream: false,
        messages: [
          {
            role: "user",
            content: "Say 'OpenRouter works' and nothing else.",
          },
        ],
      },
    });
    console.log("response id", response.id);
    console.log("usage", response.usage);
    console.log("\n✅ Response received successfully!\n");
    console.log("📝 Content:", response.choices[0]?.message.content);
    console.log("\n📊 Token Usage:");
    console.log(`  Prompt tokens:     ${response.usage?.promptTokens ?? 0}`);
    console.log(
      `  Completion tokens: ${response.usage?.completionTokens ?? 0}`,
    );
    console.log(`  Total tokens:      ${response.usage?.totalTokens ?? 0}`);

    // Check for cost info in response
    if ((response as any).cost) {
      console.log(`  Cost (USD):        $${(response as any).cost.toFixed(6)}`);
    }

    console.log("\n🎉 OpenRouter integration is working!");

    async function fetchGenerationWithRetry(
      id: string,
      retries = 3,
      delayMs = 2000,
    ) {
      for (let i = 0; i < retries; i++) {
        await new Promise((r) => setTimeout(r, delayMs));
        const res = await fetch(
          `https://openrouter.ai/api/v1/generation?id=${id}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );
        const data = await res.json();
        if (data?.data?.total_cost !== undefined) return data.data;
        console.log(`  Retrying... (${i + 1}/${retries})`);
      }
      return null;
    }

    await new Promise((r) => setTimeout(r, 30000));
    const generation = await fetchGenerationWithRetry(response.id);
    if (generation) {
      console.log(`  Cost (USD): $${generation.total_cost.toFixed(6)}`);
    }
  } catch (error) {
    console.error("\n❌ Error calling OpenRouter:");
    if (error instanceof Error) {
      console.error(`  ${error.message}`);
      if ((error as any).status) {
        console.error(`  Status: ${(error as any).status}`);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
})();
