type ThinkingExtraction = { cleaned: string; thoughts: string[]; };

const stripThinking = (input: string): ThinkingExtraction => {
    const thoughts: string[] = [];
    let working = input ?? "";

    // Pull hidden reasoning (<think>, HTML comments, “Thought:”) into a side-channel array
    const collect = (_match: string, thought: string) => {
        const trimmed = thought.trim();
        if (trimmed) thoughts.push(trimmed);
        return "";
    };

    // Capture thinking; remove from visible
    working = working.replace(/<think>[\s\S]*?<\/think>/gi, (m) => collect(m, m.replace(/<\/?think>/gi, "")));
    working = working.replace(/<!--\s*think[\s\S]*?-->/gi, (m) => collect(m, m.replace(/<!-+\s*think:?\s*/i, "").replace(/-+>/, "")));
    working = working.replace(/(?:^|\n)\s*(Thought|Thinking|Reasoning)\s*:(.*)(?=\n|$)/gi, (m, label, rest) => collect(m, `${label}: ${rest}`));

    // Remove fences but keep inner content
    const fence = /```(?:json|html)?\s*([\s\S]*?)```/gi;
    if (fence.test(working)) working = working.replace(fence, (_, inner) => `${inner}\n`);

    return { cleaned: working.trim(), thoughts };
};

const extractJsonObject = (input: string): string => {
    const { cleaned } = stripThinking(input);
    const trimmed = cleaned.trim();
    const noTicks = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { JSON.parse(noTicks); return noTicks; } catch { }
    const first = noTicks.indexOf("{");
    const last = noTicks.lastIndexOf("}");
    // If the model wraps JSON in chatter, grab the outermost braces and try again
    if (first !== -1 && last !== -1 && last > first) {
        const candidate = noTicks.slice(first, last + 1);
        try { JSON.parse(candidate); return candidate; } catch { }
    }
    return noTicks;
};
export { stripThinking, extractJsonObject};