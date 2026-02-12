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

    console.log(`Endpoint: ${normalizedEndpoint}`);
    console.log(`API Key (first 20 chars): ${apiKey.substring(0, 20)}...`);
    console.log(`API Key length: ${apiKey.length}`);

    // Detect if this is APIM gateway or direct Azure OpenAI resource
    const isAPIM = normalizedEndpoint.includes("azure-api.net");
    console.log(
      `\nDetected endpoint type: ${isAPIM ? "APIM Gateway" : "Direct Azure OpenAI Resource"}\n`,
    );

    // Try multiple API versions and paths
    const pathVariations = isAPIM
      ? ["/openai/models", "/models", "/deployments", "/v1/models"]
      : ["/openai/models", "/v1/models"];

    const apiVersions = [
      "2024-10-21",
      "2024-08-01-preview",
      "2023-12-01-preview",
    ];
    let success = false;
    let lastError: string = "";

    for (const apiVersion of apiVersions) {
      for (const pathVar of pathVariations) {
        const modelListUrl = `${normalizedEndpoint}${pathVar}?api-version=${apiVersion}`;

        console.log(`Trying: ${pathVar} with API version ${apiVersion}`);
        console.log(`URL: ${modelListUrl}`);

        const response = await fetch(modelListUrl, {
          method: "GET",
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
          },
        });

        console.log(`Response status: ${response.status}`);

        if (response.ok) {
          const data: ModelsListResponse = await response.json();
          console.log(
            `✓ Success with path: ${pathVar}, API version: ${apiVersion}`,
          );
          processModels(data);
          success = true;
          break;
        } else {
          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText}`;
          console.log(`✗ Failed\n`);
        }
      }
      if (success) break;
    }

    if (!success) {
      console.error("\n❌ All paths and API versions failed");
      console.error(`Last error: ${lastError}`);
      console.error("\n⚠️  Your endpoint appears to be an APIM Gateway.");
      console.error(
        "This endpoint may not support the /openai/models API directly.",
      );
      console.error("\n📝 To fix this, do one of the following:\n");
      console.error(
        "1. Use your direct Azure OpenAI resource endpoint instead:",
      );
      console.error("   - Go to Azure Portal > Your Azure OpenAI Resource");
      console.error("   - Copy the 'Endpoint' value from the Overview tab");
      console.error(
        "   - It should look like: https://my-resource.openai.azure.com/\n",
      );
      console.error("2. Or, ask your APIM administrator for the correct route");
      console.error(
        "   - The APIM may expose the models endpoint at a custom path\n",
      );
      console.error("Your current APIM endpoint is:");
      console.error(`   ${normalizedEndpoint}\n`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Error fetching Azure OpenAI models:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the function
listAzureOpenAIModels();
