import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OLLAMA_HOST = process.env.OLLAMA_HOST?.replace(/\/+$/, "") || "http://127.0.0.1:11434";

type RawTag = { name?: string; model?: string };

export async function GET() {
    try {
        const response = await fetch(`${OLLAMA_HOST}/api/tags`, { cache: "no-store" });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return NextResponse.json(
                { error: text || "Failed to fetch models from Ollama" },
                { status: response.status },
            );
        }

        const payload = (await response.json()) as { models?: RawTag[]; items?: RawTag[] };
        const source = Array.isArray(payload.models) ? payload.models : Array.isArray(payload.items) ? payload.items : [];

        const models = source
            .map((entry) => ({
                name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : undefined,
                model: typeof entry.model === "string" && entry.model.trim().length > 0 ? entry.model.trim() : undefined,
            }))
            .filter((entry) => entry.name || entry.model);

        return NextResponse.json({ models });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to contact Ollama";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
