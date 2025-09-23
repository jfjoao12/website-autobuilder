import { Ollama } from "ollama";

type JsonOnly = Record<string, unknown>;

export const DEFAULT_HOST = "http://127.0.0.1:11434";

export async function callOllama(
  modelName: string,
  userPrompt: string,
  expectJson = false,
  host: string = DEFAULT_HOST
) {
  const client = new Ollama({ host });

  if (!expectJson) {
    const stream = await client.generate({
      model: modelName,
      prompt: userPrompt,
      stream: true,
    });

    let aggregated = "";
    for await (const chunk of stream) {
      aggregated += chunk?.response ?? "";
    }
    return aggregated.trim();
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
    return JSON.parse(raw) as JsonOnly;
  } catch {
    throw new Error("Failed to parse JSON from Ollama response");
  }
}

export async function streamOllamaText(
  modelName: string,
  userPrompt: string,
  host: string = DEFAULT_HOST
) {
  const client = new Ollama({ host });
  return client.generate({
    model: modelName,
    prompt: userPrompt,
    stream: true,
  });
}
