import { Ollama } from "ollama";

type JsonOnly = Record<string, unknown>;

const DEFAULT_HOST = "http://127.0.0.1:11434";

export async function callOllama(
  modelName: string,
  userPrompt: string,
  expectJson: boolean = false,
  host: string = DEFAULT_HOST
) {
  const client = new Ollama({ host });

  if (!expectJson) {
    // --- Text streaming path ---
    console.log(`🔌 Streaming from ${modelName}...`);
    const stream = await client.generate({
      model: modelName,
      prompt: userPrompt,
      stream: true,
    });

    for await (const chunk of stream) {
      // chunk.response is a string segment
      process.stdout.write(chunk.response);
    }
    console.log("\n✅ Done.");
    return;
  }

  // --- JSON path (non-streamed for reliable parsing) ---
  const jsonSystemPrompt =
    "You are to output ONLY valid minified JSON. No prose, no code fences, no comments.";

  console.log(`🧱 Requesting JSON from ${modelName}...`);
  const result = await client.generate({
    model: modelName,
    system: jsonSystemPrompt,
    prompt: userPrompt,
    // Tells Ollama to format the output as JSON (when supported by the model/template)
    format: "json",
    stream: false,
  });

  const raw = (result?.response ?? "").trim();
  try {
    const parsed: JsonOnly = JSON.parse(raw);
    console.log("✅ Parsed JSON:");
    console.dir(parsed, { depth: null });
    return parsed;
  } catch (err) {
    console.error("❌ Could not parse JSON. Raw output below:");
    console.error(raw);
    throw err;
  }
}

// Example usage:
// callOllama(
//   "qwen3:0.6b",
//   `Create a plan for a website page that will have the name of the page, functionalities (with detailed features), colors, etc.`,
//   false
// ).catch(console.error);
