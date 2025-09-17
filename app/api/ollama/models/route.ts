type OllamaTagResponse = {
    models?: { name?: string | null }[];
};

export async function GET() {
    try {
        const res = await fetch("http://127.0.0.1:11434/api/tags", {
            method: "GET",
        });
        if (!res.ok) {
            const text = await res.text();
            return new Response(JSON.stringify({ error: text }), { status: 500 });
        }
        const data: OllamaTagResponse = await res.json();
        // Ollama returns: { models: [{ name, modified_at, size, digest }, ...] }
        const names = (data.models ?? [])
            .map((model) => model?.name)
            .filter((name): name is string => Boolean(name && name.trim().length > 0));
        return new Response(JSON.stringify({ models: names }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
}
