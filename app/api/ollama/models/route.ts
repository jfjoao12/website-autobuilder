import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
    try {
        const res = await fetch("http://127.0.0.1:11434/api/tags", {
            method: "GET",
        });
        if (!res.ok) {
            const text = await res.text();
            return new Response(JSON.stringify({ error: text }), { status: 500 });
        }
        const data = await res.json();
        // Ollama returns: { models: [{ name, modified_at, size, digest }, ...] }
        const names = (data.models ?? []).map((m: any) => m.name);
        return new Response(JSON.stringify({ models: names }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message ?? "Unknown error" }), { status: 500 });
    }
}
