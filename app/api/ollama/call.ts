import { Ollama } from "ollama";

type JsonOnly = Record<string, unknown>;

export const DEFAULT_HOST = "http://127.0.0.1:11434";

export async function callOllama(
  modelName: string,
  userPrompt: string,
  expectJson: boolean = false,
  host: string = DEFAULT_HOST
) {
  const client = new Ollama({ host });

  if (!expectJson) {
    const result = await client.generate({
      model: modelName,
      prompt: userPrompt,
      stream: false,
    });

    return (result?.response ?? "").trim();
  }

  const jsonSystemPrompt =
    "You are to output ONLY valid minified JSON. No prose, no code fences, no comments.";

  const result = await client.generate({
    model: modelName,
    system: jsonSystemPrompt,
    prompt: userPrompt,
    format: "json",
    stream: false,
  });

  const raw = (result?.response ?? "").trim();
  try {
    const parsed: JsonOnly = JSON.parse(raw);
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
