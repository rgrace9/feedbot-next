import * as dotenv from "dotenv";

dotenv.config();

interface ModelDeployment {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  permission: string[];
  root: string;
  parent: string | null;
}

interface ModelsListResponse {
  object: string;
  data: ModelDeployment[];
}

function processModels(data: ModelsListResponse): void {
  if (!data.data || data.data.length === 0) {
    console.log("No models found in your Azure OpenAI account.");
    return;
  }

  console.log(`\nFound ${data.data.length} available models:\n`);

  // Sort by model name for easier reading
  const sortedModels = data.data.sort((a, b) => a.id.localeCompare(b.id));

  console.log("=== Available Models ===\n");
  sortedModels.forEach((model, index) => {
    console.log(`${index + 1}. ${model.id}`);
    console.log(`   Object: ${model.object}`);
    console.log(`   Owner: ${model.owned_by}`);
    if (model.parent) {
      console.log(`   Parent: ${model.parent}`);
    }
    console.log();
  });

  // Extract just the model names for easy copy-paste
  console.log("=== Model Names Only ===\n");
  console.log("const models = [");
  sortedModels.forEach((model) => {
    console.log(`  "${model.id}",`);
  });
  console.log("];");
}

async function listAzureOpenAIModels(): Promise<void> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;

  if (!endpoint || !apiKey) {
    console.error(
      "Error: AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY environment variables are required",
    );
    process.exit(1);
  }

  try {
    console.log("Fetching available Azure OpenAI models...\n");

    // Normalize endpoint (remove trailing slash if present)
    const normalizedEndpoint = endpoint.endsWith("/")
      ? endpoint.slice(0, -1)
      : endpoint;

    // Construct the models list URL
    const modelListUrl = `${normalizedEndpoint}/openai/models?api-version=2024-10-21`;

    console.log(`Endpoint: ${normalizedEndpoint}`);
    console.log(`Fetching from: ${modelListUrl}\n`);

    const response = await fetch(modelListUrl, {
      method: "GET",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`\n❌ Failed to fetch models (HTTP ${response.status})`);
      console.error(`Error: ${errorText}`);
      process.exit(1);
    }

    const data: ModelsListResponse = await response.json();
    processModels(data);
  } catch (error) {
    console.error("\n❌ Error fetching Azure OpenAI models:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the function
listAzureOpenAIModels();
