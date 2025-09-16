// /app/api/ollama/route.ts
import { NextRequest, NextResponse } from "next/server";

const OLLAMA_HOST = process.env.OLLAMA_HOST?.replace(/\/+$/, "") || "http://127.0.0.1:11434";

export async function POST(req: NextRequest) {
    try {
        const { model, prompt, prePrompt, json } = await req.json();

        if (!model || !prompt) {
            return new NextResponse("Missing model or prompt", { status: 400 });
        }

        // Build a succinct prompt (optionally JSON-first)
        const finalPrompt =
            (prePrompt ? prePrompt + "\n\n" : "") +
            (json
                ? "Return ONLY valid JSON as the final output without extra commentary.\n\n"
                : "") +
            prompt;

        // Call Ollama generate
        const r = await fetch(`${OLLAMA_HOST}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // stream=false to keep it super simple; you can upgrade to stream later
            body: JSON.stringify({ model, prompt: finalPrompt, stream: false }),
        });

        if (!r.ok) {
            const t = await r.text().catch(() => "");
            return new NextResponse(t || "Ollama error", { status: r.status });
        }

        const data = await r.json();
        // data = { response, model, done, ... }
        return new NextResponse(data?.response ?? "", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
    } catch (err: any) {
        return new NextResponse(err?.message || "Server error", { status: 500 });
    }
}
