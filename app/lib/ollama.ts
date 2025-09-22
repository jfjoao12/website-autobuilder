"use server";

import { Ollama } from "ollama";

export type JsonOnly = Record<string, unknown>;

const DEFAULT_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

export async function callOllamaTwo(
  modelName: string,
  userPrompt: string,
  expectJson: boolean = false,
  systemPrompt?: string
) {
  const client = new Ollama({ host: DEFAULT_HOST });

  if (!expectJson) {
    const stream = await client.generate({
      model: modelName,
      prompt: userPrompt,
      stream: true,
      system: systemPrompt,
    });

    let buffer = "";
    for await (const chunk of stream) {
      buffer += chunk.response ?? "";
    }
    return { text: buffer };
  }

  const jsonSystem =
    systemPrompt ??
    "You are to output ONLY valid minified JSON. No prose, no code fences, no comments.";

  const res = await client.generate({
    model: modelName,
    system: jsonSystem,
    prompt: userPrompt,
    format: "json",
    stream: false,
  });

  const raw = (res?.response ?? "").trim();
  try {
    const parsed: JsonOnly = JSON.parse(raw);
    return { json: parsed };
  } catch (e) {
    return { error: "Failed to parse JSON from model", raw };
  }
}
