// /app/api/ollama/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const OLLAMA_HOST = process.env.OLLAMA_HOST?.replace(/\/+$/, "") || "http://127.0.0.1:11434";

export async function POST(req: NextRequest) {
    try {
        const { model, prompt, prePrompt, json, stream } = await req.json();

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
            body: JSON.stringify({ model, prompt: finalPrompt, stream: Boolean(stream) }),
        });

        if (!r.ok) {
            const t = await r.text().catch(() => "");
            return new NextResponse(t || "Ollama error", { status: r.status });
        }

        if (stream) {
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            const upstream = r.body;
            if (!upstream) {
                return new NextResponse("", {
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                });
            }

            const downstream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    const reader = upstream.getReader();
                    let buffer = "";
                    try {
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            let newlineIndex: number;
                            while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                                const line = buffer.slice(0, newlineIndex).trim();
                                buffer = buffer.slice(newlineIndex + 1);
                                if (line) {
                                    controller.enqueue(encoder.encode(`${line}\n`));
                                }
                            }
                        }
                        const tail = buffer.trim();
                        if (tail) {
                            controller.enqueue(encoder.encode(`${tail}\n`));
                        }
                    } finally {
                        controller.close();
                    }
                },
            });

            return new NextResponse(downstream, {
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Cache-Control": "no-cache",
                },
            });
        }

        const data = await r.json();
        // data = { response, model, done, ... }
        return new NextResponse(data?.response ?? "", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Server error";
        return new NextResponse(message, { status: 500 });
    }
}
