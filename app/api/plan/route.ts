import { NextResponse } from "next/server";
import { callOllamaTwo } from "../../lib/ollama";

/**
 * Body: { topic: string, pageCount: number }
 * Returns: { plan: { site_title: string, pages: { id: string, title: string, purpose?: string }[] } }
 */
export async function POST(req: Request) {
  try {
    const { topic, pageCount } = await req.json();

    const system =
      "You output ONLY valid minified JSON for a simple website plan.";
    const prompt = `Create a concise website plan.
Return JSON with keys: site_title (string), pages (array of {id,title,purpose}).
Rules: exactly ${pageCount} pages; ids must be url-safe slugs; keep titles short.
Topic: ${topic}.`;

    const { json, error, raw } = await callOllamaTwo(
      "qwen3:3b-instruct",
      prompt,
      true,
      system
    );
    if (error) return NextResponse.json({ error, raw }, { status: 400 });

    return NextResponse.json({ plan: json });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
