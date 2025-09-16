// /lib/ollama.ts
export type CallAiOptions = {
    prePrompt?: string;
    json?: boolean;
};

export async function callAi(
    model: string,
    prompt: string,
    options: CallAiOptions = {}
): Promise<string> {
    const res = await fetch("/api/ollama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, ...options }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `AI error (${res.status})`);
    }
    // Return raw text; caller decides how to parse.
    return res.text();
}
