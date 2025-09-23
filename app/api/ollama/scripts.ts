import {
  callOllama,
  DEFAULT_HOST,
  streamOllamaText,
} from "./call";

const PAGE_MARKER = "### Page";

type CodePromptOptions = {
  allPlans?: string[];
  pageIndex?: number;
};

type LayoutFragments = {
  header: string;
  footer: string;
};

export async function generatePlan(
  input: string,
  model: string,
  pageCount: number = 1
): Promise<string[]> {
  const raw = await callOllama(
    model,
    `Create a comprehensive multi-page website plan based on the following description. Generate ${pageCount} distinct page plans in a single response. Each plan MUST begin with the exact heading "### Page <number>: <Title>" followed by detailed bullet points that cover layout, hero concept, sections, interactions, tone, and visual direction. Keep language concise and scannable.\n\nDescription: ${input}`,
    false
  );

  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [];
  }

  const segments = raw
    .split(new RegExp(`(?=${PAGE_MARKER})`, "g"))
    .map((segment) => segment.trim())
    .filter((segment) => segment.startsWith(PAGE_MARKER));

  const normalizedCount = Number.isFinite(pageCount)
    ? Math.max(1, Math.floor(pageCount))
    : 1;

  return segments.slice(0, normalizedCount);
}

export async function generateCode(
  plan: string,
  model: string,
  options: CodePromptOptions = {}
) {
  return callOllama(model, buildCodePrompt(plan, options), false);
}

export async function streamCode(
  plan: string,
  model: string,
  options: CodePromptOptions = {}
) {
  return streamOllamaText(model, buildCodePrompt(plan, options));
}

export async function generateLayoutFragments(
  plans: string[],
  model: string
): Promise<LayoutFragments> {
  const response = await callOllama(
    model,
    buildLayoutPrompt(plans),
    true
  );

  const header = typeof response?.header === "string" ? response.header.trim() : "";
  const footer = typeof response?.footer === "string" ? response.footer.trim() : "";

  if (!header || !footer) {
    throw new Error("Layout generation failed");
  }

  return { header, footer };
}

export async function regeneratePlanForPage(
  plans: string[],
  pageIndex: number,
  model: string
): Promise<string> {
  const total = plans.length;
  const target = plans[pageIndex];

  const planSummaries = plans
    .map((plan, idx) => {
      const firstLine = plan.split(/\r?\n/).find((line) => line.trim());
      return `Page ${idx + 1}: ${firstLine ?? plan.slice(0, 80)}`;
    })
    .join("\n");

  const prompt = [
    `You are revising Page ${pageIndex + 1} of a ${total}-page website plan.`,
    "Refresh this page plan to improve clarity, flow, and alignment with the other pages.",
    "Keep the existing structure if possible, but make it more compelling and specific.",
    "Return only the page plan starting with the exact heading \"### Page <number>: <Title>\" and keep concise bullet points.",
    "Current plans for context:",
    planSummaries,
    "Current detailed plan to refine:",
    target,
  ].join("\n\n");

  const raw = await callOllama(model, prompt, false);

  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("Plan regeneration failed");
  }

  const trimmed = raw.trim();
  if (!trimmed.startsWith(PAGE_MARKER)) {
    return `${PAGE_MARKER} ${pageIndex + 1}: Updated\n${trimmed}`;
  }

  return trimmed;
}

export async function listModels(host: string = DEFAULT_HOST) {
  const base = host.endsWith("/") ? host.slice(0, -1) : host;
  const response = await fetch(`${base}/api/tags`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models (${response.status})`);
  }

  const payload = (await response.json()) as {
    models?: Array<{ name?: string }>;
  };

  const names = Array.isArray(payload.models)
    ? payload.models
        .map((modelEntry) => modelEntry?.name?.trim())
        .filter((name): name is string => Boolean(name))
    : [];

  return names;
}

function buildCodePrompt(plan: string, options: CodePromptOptions) {
  const { allPlans = [], pageIndex } = options;
  const pageNumber = typeof pageIndex === "number" ? pageIndex + 1 : "?";

  const summaries = allPlans
    .map((entry, idx) => {
      const firstLine = entry.split(/\r?\n/).find((line) => line.trim());
      return `Page ${idx + 1}: ${firstLine ?? entry.slice(0, 60)}`;
    })
    .join("\n");

  return [
    `You are designing Page ${pageNumber} of a cohesive multi-page website.`,
    "Follow the provided plan exactly, keep the styling consistent with the rest of the site, and favour modern, clean aesthetics.",
    "Return a single self-contained HTML document with embedded CSS and JavaScript.",
    "Do NOT include a global <header> or <footer>; those will be added later.",
    "Re-use typography, spacing, and color cues that match the other pages.",
    summaries ? `Other page summaries for context:\n${summaries}` : "",
    "Plan for the current page:",
    plan,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildLayoutPrompt(plans: string[]) {
  const planBlock = plans
    .map((plan, index) => `Page ${index + 1}:\n${plan}`)
    .join("\n\n");

  return [
    "You are an expert front-end designer creating a unified site experience.",
    "Design a shared site header and footer that align with the style cues of the following page plans.",
    "Return JSON with two string fields: header and footer. The header/footer should be HTML fragments with inline CSS and no <html>, <head>, or <body> wrappers.",
    "Focus on consistency in typography, spacing, and call-to-action styling.",
    "Plans:\n" + planBlock,
  ].join("\n\n");
}
