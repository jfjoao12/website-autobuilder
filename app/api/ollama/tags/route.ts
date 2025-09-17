// /app/api/ollama/tags/route.ts
import { NextResponse } from "next/server";

const OLLAMA_HOST = process.env.OLLAMA_HOST?.replace(/\/+$/, "") || "http://127.0.0.1:11434";

export async function GET() {
    try {
        const r = await fetch(`${OLLAMA_HOST}/api/tags`, { cache: "no-store" });
        if (!r.ok) return NextResponse.json([], { status: r.status });

        const data = (await r.json()) as { models?: { name?: string | null }[] };
        const names = Array.isArray(data?.models)
            ? data.models
                  .map((model) => model?.name)
                  .filter((name): name is string => Boolean(name && name.trim().length > 0))
            : [];
        return NextResponse.json(names);
    } catch {
        // Fallback to a couple of known tags if Ollama is down
        return NextResponse.json(["qwen3:8b", "qwen2.5:7b-instruct"], { status: 200 });
    }
}
