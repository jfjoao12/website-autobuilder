// /lib/ollama.ts
export type CallAiOptions = {
    prePrompt?: string;
    json?: boolean;
    enforceCode?: boolean;
    stream?: boolean;
    options?: Record<string, unknown>;
    onChunk?: (chunk: string) => void;
};

export async function callAi(
    model: string,
    prompt: string,
    options: CallAiOptions = {}
): Promise<string> {
    const { stream = false, onChunk, ...rest } = options;
    const res = await fetch("/api/ollama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, ...rest, stream }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `AI error (${res.status})`);
    }

    if (!stream) {
        return res.text();
    }

    const reader = res.body?.getReader();
    if (!reader) {
        throw new Error("Streaming not supported by response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let aggregate = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;
            try {
                const parsed = JSON.parse(line);
                const delta = typeof parsed.response === "string" ? parsed.response : "";
                if (delta) {
                    aggregate += delta;
                    onChunk?.(delta);
                }
                if (parsed.done) {
                    // Drain any trailing buffer after done and break out.
                    buffer = "";
                }
            } catch {
                // If parsing fails, assume plain text chunk.
                aggregate += line;
                onChunk?.(line);
            }
        }
    }

    if (buffer.trim()) {
        const tail = buffer.trim();
        try {
            const parsed = JSON.parse(tail);
            const delta = typeof parsed.response === "string" ? parsed.response : "";
            if (delta) {
                aggregate += delta;
                onChunk?.(delta);
            }
        } catch {
            aggregate += tail;
            onChunk?.(tail);
        }
    }

    return aggregate;
}
