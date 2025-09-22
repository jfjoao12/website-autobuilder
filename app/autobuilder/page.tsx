// /app/autobuilder/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { callAi } from "../lib/ollama";
import type { CallAiOptions } from "../lib/ollama";
import { slugify } from "../lib/slug";

type Plan = {
    site_title?: string;
    pages: {
        id: string;
        title: string;
        purpose?: string
    }[];
};

type PagePlan = {
    id: string;
    title: string;
    outline: string[];
    components?: string[];
    copy_points?: string[];
    interactions?: string[];
    seo?: { title?: string; description?: string; keywords?: string[] };
};

type DesignTokens = {
    palette?: Record<string, string>;
    spacing?: Record<string, string>;
    radii?: Record<string, string>;
    shadows?: Record<string, string>;
    font_stack?: { heading?: string; body?: string; mono?: string;[key: string]: string | undefined };
    [key: string]: unknown;
};

type SeoMetaPage = {
    page_id: string;
    open_graph: string[];
    twitter: string[];
    extra?: string[];
};

type SeoArtifacts = {
    sitemap: string;
    robots: string;
    pages: SeoMetaPage[];
};

type BuiltPage = {
    id: string;
    title: string;
    html: string;
    valid: boolean;
    issues: string[];
    thinking: string[];
};

type SharedLayout = {
    header: string;
    footer: string;
    siteTitle?: string;
    thinking: string[];
};

type LiveStreamPhase = "plan" | "layout" | "page";
type LiveStreamState = {
    phase: LiveStreamPhase;
    label: string;
    raw: string;
    cleaned: string;
    thoughts: string[];
    history: { id: string; text: string; timestamp: number }[];
};

type WizardVariant = "idea" | "plan" | "progress" | "preview";
type WizardHeroState = {
    title: string;
    subtitle: string;
    accent: string;
    label: string;
    variant: WizardVariant;
};

const DEFAULT_PREPROMPT = [
    "You are **Website Builder AI — Vanilla Web Deluxe**.",
    "Your job: design and ship **beautiful, cohesive, production-grade websites** using **only HTML5, CSS3, and vanilla JavaScript (ES6+)**.",
    "**No frameworks, no build tools, no external assets/CDNs.** Deliver self-contained files only.",
    "",
    "## Principles (in order)",
    "Aesthetic polish → Correctness → Clarity → Maintainability → Performance → Accessibility → Security.",
    "",
    "## Layout & Design Charter",
    "- **Comprehensive visual system**: define CSS custom properties in :root (colors, spacing, radii, shadows, typography scale).",
    "- **Responsive grid**: use modern **Flexbox/Grid**; max content width ~1200–1280px with fluid padding; sensible section rhythm (e.g., 64–96px).",
    "- **Typography**: system UI stack; use 'clamp()' for fluid headings; consistent line-height and vertical rhythm.",
    "- **Color & contrast**: dark-friendly by default; minimum 4.5:1 contrast for body text; obvious focus outlines.",
    "- **Components**: cohesive header (sticky), nav with active state, hero, cards, buttons, forms, sections, and a real footer (contact/CTA).",
    "- **Micro-interactions**: small CSS transitions only (opacity/transform). Respect 'prefers-reduced-motion'.",
    "- **Naming**: simple/BEM-like classes (e.g., .btn, .btn--primary, .card, .section).",
    "",
    "## Technology constraints",
    "- Only **inline <style>** and optional **inline <script>** per page.",
    "- Use **semantic HTML** and landmarks (<header>, <nav>, <main>, <section>, <footer>).",
    "- **No** external <script src=\"http…\">, <link rel=\"stylesheet\">, frameworks, or imports.",
    "- Prefer **inline SVG** over bitmap images; if images are unavoidable, keep small (<=200KB) and include alt text.",
    "",
    "## Quality gates (must pass)",
    "- HTML includes <!doctype html>, <html lang=\"en\">, <head> with <meta charset=\"utf-8\"> and a usable <title>.",
    "- **No console errors**, no broken internal links, no layout overlap on common widths (360px, 768px, 1024px, 1280px).",
    "- Keyboard navigation works; all interactive elements are focusable; forms have associated <label>.",
    "- Consistent spacing scale; consistent radii/shadows; no 'ugly defaults' (unstyled anchors, misaligned grids, etc.).",
    "",
    "## Workflow (always)",
    "1) **PLAN** → return **only valid JSON**:",
    "   {",
    "     \"pages\":[{\"id\":\"kebab\",\"title\":\"…\",\"purpose\":\"…\"}],",
    "     \"routes\":[], \"components\":[], \"data\":{}, \"apis\":[], \"deps\":[],",
    "     \"acceptance\":[], \"risks\":[],",
    "     \"targets\":{\"a11y\":{\"minContrast\":4.5,\"requireMain\":true},\"perf\":{\"maxImgKB\":200},\"seo\":{\"titleLen\":[30,60]}}",
    "   }",
    "2) **BUILD** → for each page, output a **single self-contained HTML document**:",
    "   - Reuse shared header/footer if provided.",
    "   - Include a tidy **<style>** block with tokens (CSS variables) and a small **<script>** only if needed.",
    "   - Use a responsive grid, clear section hierarchy, and polished component styling.",
    "3) **VALIDATE & FIX** → mentally compile: resolve missing imports (should be none), nav mismatches, a11y issues, and any layout glitches. If issues exist, output **only the corrected full HTML** and a 3–6 bullet summary of what changed.",
    "",
    "## Creativity policy",
    "- You **may** introduce tasteful enhancements (hero composition, gradient accents, subtle glass/blur, decorative SVG patterns, empty-state illustrations) if they improve clarity and aesthetics—still pure CSS/JS/HTML.",
    "- Avoid heavy animations; keep interactions delightful but restrained.",
    "",
    "## Security & performance",
    "- Sanitize any dynamic text before inserting into the DOM.",
    "- Avoid layout thrash; prefer CSS for styling over JS; throttle/debounce any scroll/resize handlers.",
    "",
    "## Output discipline",
    "- Be decisive; pick sensible defaults when unspecified and state them briefly.",
    "- Output only what’s requested (JSON or full HTML documents). No markdown fences unless explicitly asked.",
    "- **Thinking policy**: Do not output <think>…</think> unless explicitly allowed; if allowed, keep it short and bulleted.",
].join("\n");

const DEFAULT_USER_PROMPT = `Build a website for a repair shop that sells cases and does phone repairs.
Tone: professional, friendly.
Target pages: suggest a realistic set for this business.`;

const STEPS = [
    { title: "Framing the chrome", subtitle: "Generating unified header & footer", accent: "from-indigo-500 via-sky-500 to-emerald-400" },
    { title: "Blueprinting the experience", subtitle: "Drafting a tailored site map", accent: "from-blue-500 via-sky-400 to-cyan-400" },
    { title: "Crafting every pixel", subtitle: "Authoring page-level HTML", accent: "from-purple-500 via-fuchsia-400 to-rose-400" },
    { title: "Shaping the delivery", subtitle: "Organising outputs and checks", accent: "from-amber-500 via-orange-400 to-rose-400" },
    { title: "Proofing the build", subtitle: "Running validation passes", accent: "from-emerald-500 via-teal-400 to-sky-400" },
];

const PANEL_CLASS = "rounded-2xl border border-slate-800/70 bg-slate-900/60 backdrop-blur";

/** Validation toggles */
type RuleFlags = {
    html: boolean;
    head: boolean;
    body: boolean;
    title: boolean;
    noExternalScript: boolean;
};

type ThinkingExtraction = { cleaned: string; thoughts: string[]; };

const stripThinkingArtifacts = (input: string): ThinkingExtraction => {
    const thoughts: string[] = [];
    let working = input ?? "";

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
    const { cleaned } = stripThinkingArtifacts(input);
    const trimmed = cleaned.trim();
    const noTicks = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { JSON.parse(noTicks); return noTicks; } catch { }
    const first = noTicks.indexOf("{");
    const last = noTicks.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
        const candidate = noTicks.slice(first, last + 1);
        try { JSON.parse(candidate); return candidate; } catch { }
    }
    return noTicks;
};

// ---------- New prompts for per-page plan & fix ----------
const buildPagePlanPrompt = (
    siteTitle: string,
    page: { id: string; title: string; purpose?: string },
    allPages: { id: string; title: string }[],
    brandContext: string,
) => `
You are planning a single web page for the site "${siteTitle}".

Return ONLY JSON with shape:
{
  "id": string, "title": string,
  "outline": string[],
  "components": string[],
  "copy_points": string[],
  "interactions": string[],
  "seo": { "title": string, "description": string, "keywords": string[] }
}

Guidance:
- The page must serve this purpose: ${page.purpose || "N/A"}.
- Navigation should include these pages: ${allPages.map(p => `${p.title} (${p.id}.html)`).join(", ")}.
- Keep it minimal, accessible, and dark-friendly.
- No lorem ipsum; specify realistic copy bullets (short).

Brand/voice context:
${brandContext}
`;

const buildDesignTokensPrompt = (siteTitle: string | undefined, userPrompt?: string) => `
You are defining concise design tokens for the site "${siteTitle || "Generated Site"}".

Return ONLY JSON with this exact top-level shape:
{
  "palette": { "background": string, "surface": string, "primary": string, "secondary": string, "accent": string, "text": string, "muted": string },
  "spacing": { "xs": string, "sm": string, "md": string, "lg": string, "xl": string },
  "radii": { "sm": string, "md": string, "lg": string },
  "shadows": { "soft": string, "strong": string },
  "font_stack": { "heading": string, "body": string, "mono": string }
}

Guidelines:
- Use CSS-friendly token values (px / rem for spacing, rgba/hex for colors).
- Keep palette dark-friendly with sufficient contrast between background, surface, and text.
- Derive tone and vocabulary from this brief:
${userPrompt || DEFAULT_USER_PROMPT}
`;

const buildFixPrompt = (siteTitle: string, pageTitle: string, issues: string[], html: string) => `
You produced a self-contained HTML document for "${pageTitle}" on the site "${siteTitle}", but it failed validation.

Issues:
${issues.map(i => `- ${i}`).join("\n")}

Return ONLY a fully corrected, self-contained HTML document. Keep styles minimal and dark-friendly. No external assets.
Do not output JSON, Markdown fences, or commentary — deliver the full <!doctype html> payload only.
Here is your previous attempt (for reference):
---
${html}
---
`;

const buildA11yFixPrompt = (siteTitle: string, pageTitle: string, issues: string[], html: string) => `
You delivered an HTML page for "${pageTitle}" on the site "${siteTitle}", but it failed the accessibility audit.

Accessibility issues to address:
${issues.map((issue) => `- ${issue}`).join("\n")}

Return ONLY the updated HTML document with minimal edits that resolve the issues. Keep the existing structure, styles, and copy; modify only the necessary attributes/elements. Do not introduce new frameworks or external assets.
Never return JSON, Markdown, or bullet summaries — respond with the exact HTML document.
Here is the current HTML:
---
${html}
---
`;

const buildLinkFixPrompt = (
    siteTitle: string,
    pageTitle: string,
    brokenLinks: { href: string; text?: string | null }[],
    html: string,
    knownPages: { id: string; title: string }[],
) => `
You produced the page "${pageTitle}" for the site "${siteTitle}", but some internal navigation links point to non-existent files.

Existing pages (id → file → title):
${knownPages.map(({ id, title }) => `- ${id} → ${id}.html → ${title}`).join("\n")}

Invalid links to correct:
${brokenLinks.map((link) => `- href="${link.href}"${link.text ? ` (text: ${link.text})` : ""}`).join("\n")}

Return ONLY the revised HTML document. Adjust only the href values necessary so each link resolves to one of the valid pages above. Do not change other content or structure.
Respond with raw HTML only; do not include JSON or explanations.
Here is the current HTML:
---
${html}
---
`;

const buildSeoPackPrompt = (
    siteTitle: string | undefined,
    pages: { id: string; title: string; purpose?: string }[],
    baseUrl: string,
) => `
You are generating final SEO helpers for the site "${siteTitle || "Generated Site"}".

Return ONLY JSON shaped exactly as:
{
  "sitemap": string,
  "robots": string,
  "pages": [
    {
      "page_id": string,
      "open_graph": string[],
      "twitter": string[],
      "extra"?: string[]
    }
  ]
}

Requirements:
- sitemap must be valid XML referencing ${baseUrl}<page>.html for the ids below.
- robots should allow all agents except explicitly disallowed sections if needed; include sitemap URL on its last line.
- For each page, provide Open Graph meta tags (title, description, type, url, image placeholder) and Twitter card tags (card type, title, description, image).
- Include a concise meta description tag (name="description") in the "extra" array when helpful.
- Use the provided page intents as guidance:
${pages.map((p) => `- ${p.title} (${p.id}.html) -> ${p.purpose || "General page"}`).join("\n")}
`;

// ---------- Existing builder prompts ----------
const buildPlanPrompt = (count: number, preferredTitle?: string, userPrompt?: string) => `
You will propose a small website plan as compact JSON only.

Rules:
- Return ONLY a valid JSON object.
- The JSON must be: { "site_title": string, "pages": [{ "id": string, "title": string, "purpose": string }] }
- "id" must be kebab-case, unique.
- Suggest exactly ${count} pages that make sense for the user's request.
${preferredTitle ? `- Use "${preferredTitle}" as the site title unless there is a compelling reason to improve it.\n` : ""}

User goal/context:
${userPrompt || DEFAULT_USER_PROMPT}
`;

const buildSharedLayoutPrompt = (
    pageEstimate: number,
    userPrompt?: string,
    tokens?: DesignTokens | null
) => {
    // ✅ Default tokens that match DesignTokens exactly
    const tk: DesignTokens = tokens ?? {
        palette: {
            background: "#0b1220",
            surface: "#0f172a",
            primary: "#38bdf8",
            secondary: "#a78bfa",
            accent: "#22d3ee",
            text: "#e6edf6",
            muted: "#94a3b8",
        },
        spacing: { xs: "6px", sm: "10px", md: "14px", lg: "18px", xl: "24px" },
        radii: { sm: "8px", md: "14px", lg: "22px" },
        shadows: {
            soft: "0 1px 2px rgba(0,0,0,.25)",
            strong: "0 10px 30px rgba(2,6,23,.35)",
        },
        font_stack: {
            heading:
                'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            body:
                'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        },
    };

    // Safely pull fields (fallbacks included)
    const p = tk.palette ?? {};
    const s = tk.spacing ?? {};
    const r = tk.radii ?? {};
    const sh = tk.shadows ?? {};
    const f = tk.font_stack ?? {};

    const tokensHint = `
Design tokens (use as CSS variables or hard values):
- Colors: background ${p.background ?? "#0b1220"}, surface ${p.surface ?? "#0f172a"}, text ${p.text ?? "#e6edf6"}, primary ${p.primary ?? "#38bdf8"}, secondary ${p.secondary ?? "#a78bfa"}, accent ${p.accent ?? p.primary ?? "#38bdf8"}, muted ${p.muted ?? "#94a3b8"}
- Font: heading "${f.heading ?? "system-ui"}"; body "${f.body ?? "system-ui"}"; mono "${f.mono ?? "ui-monospace"}"
- Radii: sm ${r.sm ?? "8px"}, md ${r.md ?? "14px"}, lg ${r.lg ?? "22px"}
- Spacing scale: xs ${s.xs ?? "6px"}, sm ${s.sm ?? "10px"}, md ${s.md ?? "14px"}, lg ${s.lg ?? "18px"}, xl ${s.xl ?? "24px"}
- Shadows: soft "${sh.soft ?? "0 1px 2px rgba(0,0,0,.25)"}"; strong "${sh.strong ?? "0 10px 30px rgba(2,6,23,.35)"}"
`.trim();

    return `
Design a **polished, responsive, sticky header and a cohesive footer** for a vanilla HTML/CSS/JS site.
Return **ONLY JSON** shaped exactly as:
{ "site_title": string, "header": string, "footer": string }

### Hard requirements
- The **header snippet** must contain:
  - <header class="site-header" data-shared>
    - a container with the site title element <a class="brand">…</a>
    - <nav data-shared-nav> with EXACTLY ${pageEstimate} link placeholders:
      <a data-nav-slot="n" href="#page-n" data-active="false">Label n</a>
  - a **<style>** block scoped to .site-header and related classes (no global resets)
  - The header is **sticky**: position: sticky; top: 0; z-index: 50; backdrop blur; subtle border-bottom & shadow
  - Active link styling must target BOTH [aria-current="page"] and [data-active="true"] (accent color, underline/indicator)
  - Focus states with :focus-visible are clearly visible and meet contrast
  - Responsive layout:
    - max content width ~1200–1280px with fluid side padding
    - nav wraps to a horizontal scroll or collapses gracefully on small screens (no frameworks)
- The **footer snippet** must contain:
  - <footer class="site-footer" data-shared>
    - contact/CTA line, small print, and a “back to top” anchor
  - a **<style>** block scoped to .site-footer
- **No** <!doctype>, <html>, or <body> tags (snippets only).
- **No** external assets (no <link> or external <script>).

### Visual & interaction guidance
- Dark-friendly design using the tokens below; ensure 4.5:1 contrast for body text.
- Use CSS vars at the top of the header/footer styles (define if missing), e.g.:
  :root { --bg:${p.background ?? "#0b1220"}; --surface:${p.surface ?? "#0f172a"}; --fg:${p.text ?? "#e6edf6"}; --primary:${p.primary ?? "#38bdf8"}; --muted:${p.muted ?? "#94a3b8"}; --accent:${p.accent ?? p.primary ?? "#38bdf8"}; --radius:${r.md ?? "14px"}; --font-heading:${(f.heading ?? "system-ui").replace(/"/g, '\\"')}; --font-body:${(f.body ?? "system-ui").replace(/"/g, '\\"')}; }
- Spacing uses a consistent scale; rounded corners with ${r.md ?? "14px"}; subtle hover/focus transitions (opacity/transform only); respect prefers-reduced-motion.

${tokensHint}

### Output rules
- Keep CSS tidy and scoped (.site-header, .site-footer).
- Include just enough HTML structure to drop into pages.
- Do not include markdown fences, comments, or explanations—**JSON only** as specified.

User goal/context:
${userPrompt || ""}
`.trim();
};

const buildPagePrompt = (
    siteTitle: string,
    page: { id: string; title: string; purpose?: string },
    pagePlan: PagePlan | null,
    layout: SharedLayout | null,
    allPages: { id: string; title: string }[],
    tokens: DesignTokens | null,
) => {
    const layoutGuidance = layout
        ? `- Reuse the shared header/footer provided below without changing their structure.
- Replace every <a data-nav-slot> so it links to the exact page list (href="<id>.html").
- For the current page "${page.id}", set aria-current="page" AND data-active="true" on its nav link.`
        : `- Include a simple <header> with "${siteTitle}" and a nav placeholder.`;

    const sharedChromeSnippet = layout
        ? `Shared header snippet:
${layout.header}

Shared footer snippet:
${layout.footer}
`
        : "";

    const navList = allPages.map((p) => `- ${p.title} (${p.id}.html)`).join("\n");

    const planning = pagePlan ? `
Per-page plan to implement:
- Outline: ${pagePlan.outline.join(" · ")}
- Components: ${(pagePlan.components || []).join(", ")}
- Copy: ${(pagePlan.copy_points || []).join(" | ")}
- Interactions: ${(pagePlan.interactions || []).join(", ")}
- SEO: ${pagePlan.seo?.title || ""} — ${pagePlan.seo?.description || ""}
` : "";

    const tokensSummary = tokens
        ? (() => {
            const lines: string[] = [];
            if (tokens.palette) {
                const palettePairs = Object.entries(tokens.palette).map(([key, value]) => `${key}: ${value}`).join(", ");
                if (palettePairs) lines.push(`Palette → ${palettePairs}`);
            }
            if (tokens.spacing) {
                const spacingPairs = Object.entries(tokens.spacing).map(([key, value]) => `${key}: ${value}`).join(", ");
                if (spacingPairs) lines.push(`Spacing scale → ${spacingPairs}`);
            }
            if (tokens.radii) {
                const radiiPairs = Object.entries(tokens.radii).map(([key, value]) => `${key}: ${value}`).join(", ");
                if (radiiPairs) lines.push(`Radii → ${radiiPairs}`);
            }
            if (tokens.shadows) {
                const shadowPairs = Object.entries(tokens.shadows).map(([key, value]) => `${key}: ${value}`).join(", ");
                if (shadowPairs) lines.push(`Shadows → ${shadowPairs}`);
            }
            if (tokens.font_stack) {
                const fontPairs = Object.entries(tokens.font_stack).map(([key, value]) => `${key}: ${value}`).join(", ");
                if (fontPairs) lines.push(`Fonts → ${fontPairs}`);
            }
            return lines.length
                ? `
Design tokens (apply consistently):
${lines.map((line) => `- ${line}`).join("\n")}
`
                : "";
        })()
        : "";

    return `
Generate a single, self-contained HTML5 document for the page below.

Constraints:
- <!doctype html>, <html lang="en">, <head> with <meta charset="utf-8"> and a <title>.
- Inline <style> with a minimal, modern, dark-friendly palette.
- Optional <script> allowed for small interactions only (no external imports).
- The page must be fully functional if saved as a standalone .html file.
- Output raw HTML only — no JSON, Markdown, or commentary.
${layoutGuidance}- Use the page "purpose" to drive content. Avoid lorem ipsum.
${planning}
${tokensSummary}
Site navigation targets:
${navList}

${sharedChromeSnippet}

Return ONLY the final HTML document. Do not wrap in Markdown or JSON.

Page:
{
  "id": "${page.id}",
  "title": "${page.title}",
  "purpose": ${JSON.stringify(page.purpose || "")}
}
`;
};

export default function AutoBuilder() {
    const [models, setModels] = useState<string[]>([]);
    const [model, setModel] = useState<string>("");

    const [prePrompt, setPrePrompt] = useState(DEFAULT_PREPROMPT);
    const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);
    const [pageCount, setPageCount] = useState<number>(3);

    // NEW: settings
    const [maxFixes, setMaxFixes] = useState<number>(2);
    const [useCustomCtx, setUseCustomCtx] = useState<boolean>(false);
    const [ctxLen, setCtxLen] = useState<number>(8192);

    const [ruleFlags, setRuleFlags] = useState<RuleFlags>({
        html: true,
        head: true,
        body: true,
        title: true,
        noExternalScript: true,
    });

    // Workflow log
    const [status, setStatus] = useState<string>("");
    const [statusLines, setStatusLines] = useState<string[]>([]);

    const [plan, setPlan] = useState<Plan | null>(null);
    const [sharedLayout, setSharedLayout] = useState<SharedLayout | null>(null);
    const [designTokens, setDesignTokens] = useState<DesignTokens | null>(null);
    const [seoArtifacts, setSeoArtifacts] = useState<SeoArtifacts | null>(null);
    const [pages, setPages] = useState<BuiltPage[]>([]);
    const [exportHref, setExportHref] = useState<string | null>(null);

    const [stepIndex, setStepIndex] = useState<number>(-1);
    const [wizardStep, setWizardStep] = useState<number>(0);
    const [promptError, setPromptError] = useState<string | null>(null);

    // Live stream inside hero
    const [liveStream, setLiveStream] = useState<LiveStreamState | null>(null);
    const [activeInsight, setActiveInsight] = useState<"live" | "thoughts" | "log">("live");

    const heroConfig = useMemo<WizardHeroState>(() => {
        switch (wizardStep) {
            case 0:
                return {
                    title: "What is your website about?",
                    subtitle: "Describe the project and choose how many pages you need.",
                    accent: "from-sky-500 via-indigo-500 to-purple-500",
                    label: "Step 1 of 4",
                    variant: "idea",
                };
            case 1:
                return {
                    title: "Review the generated plan",
                    subtitle: "Confirm the outline before we continue building.",
                    accent: "from-blue-500 via-sky-400 to-cyan-400",
                    label: "Step 2 of 4",
                    variant: "plan",
                };
            case 2:
                return {
                    title: "Generating your site",
                    subtitle: "We’re crafting layout, pages, and checks. Watch the progress below.",
                    accent: "from-purple-500 via-fuchsia-400 to-rose-400",
                    label: "Step 3 of 4",
                    variant: "progress",
                };
            case 3:
            default:
                return {
                    title: "Preview and export",
                    subtitle: "Open the generated experience or download the bundle.",
                    accent: "from-emerald-500 via-teal-400 to-sky-400",
                    label: "Step 4 of 4",
                    variant: "preview",
                };
        }
    }, [wizardStep]);

    const heroProgress = useMemo(() => {
        if (stepIndex < 0) return 0;
        if (stepIndex >= STEPS.length) return 1;
        return Math.min((stepIndex + 1) / STEPS.length, 1);
    }, [stepIndex]);

    const showPreviewCTA = useMemo(() => pages.length > 0 && stepIndex >= STEPS.length, [pages.length, stepIndex]);
    const generationInFlight = stepIndex >= 0 && stepIndex < STEPS.length;
    const generationComplete = showPreviewCTA;

    const nextDisabled = useMemo(() => {
        switch (wizardStep) {
            case 0:
                return generationInFlight || userPrompt.trim().length === 0;
            case 1:
                return !(plan?.pages?.length);
            case 2:
                return !generationComplete;
            default:
                return false;
        }
    }, [generationComplete, generationInFlight, plan?.pages?.length, userPrompt, wizardStep]);

    const nextLabel = useMemo(() => {
        if (wizardStep === 0) return "Start build";
        if (wizardStep === 3) return "Start over";
        return "Next";
    }, [wizardStep]);

    const insightItems = useMemo(
        () => [
            { id: "live" as const, label: "Live response", count: liveStream?.cleaned ? 1 : 0 },
            { id: "thoughts" as const, label: "AI thinking", count: liveStream?.history.length ?? 0 },
            { id: "log" as const, label: "Workflow log", count: Math.min(statusLines.length, 99) },
        ],
        [liveStream?.cleaned, liveStream?.history.length, statusLines.length],
    );

    const insightContent = useMemo(() => {
        if (activeInsight === "live") {
            if (!liveStream) {
                return <p className="text-sm text-neutral-400">AI output will appear here once the build starts.</p>;
            }
            return (
                <div className="space-y-3">
                    <p className="text-[0.65rem] uppercase tracking-[0.3em] text-neutral-400">{liveStream.label}</p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-100">
                        {liveStream.cleaned || "Waiting for model output…"}
                    </p>
                </div>
            );
        }

        if (activeInsight === "thoughts") {
            const history = liveStream?.history ?? [];
            if (history.length === 0) {
                return <p className="text-sm text-neutral-400">No captured thinking yet.</p>;
            }
            return (
                <ul className="space-y-2 text-sm text-neutral-200">
                    {history.slice(-12).map((entry) => (
                        <li key={entry.id} className="rounded-lg border border-slate-800/70 bg-slate-950/80 p-2">
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                            <p className="mt-1 whitespace-pre-wrap leading-relaxed text-neutral-100">{entry.text}</p>
                        </li>
                    ))}
                </ul>
            );
        }

        const logText = status.trim();
        if (!logText) {
            return <p className="text-sm text-neutral-400">No workflow log yet.</p>;
        }
        return (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
                {logText}
            </pre>
        );
    }, [activeInsight, liveStream, status]);

    useEffect(() => {
        (async () => {
            try {
                const r = await fetch("/api/ollama/tags");
                const names: string[] = await r.json();
                setModels(names);
                setModel((prev) => prev || names[0] || "qwen3:8b");
            } catch {
                setModels(["error"]);
                setModel((prev) => prev || "qwen3:8b");
            }
        })();
    }, []);

    const log = (line: string) => {
        setStatus((s) => s + (s ? "\n" : "") + line);
        const lines = line.split("\n").map((l) => l.trim()).filter(Boolean);
        setStatusLines((prev) => [...prev, ...lines]);
    };

    const resetAll = () => {
        setPlan(null);
        setSharedLayout(null);
        setDesignTokens(null);
        setSeoArtifacts(null);
        setPages([]);
        setExportHref(null);
        setStatus("");
        setStatusLines([]);
        setStepIndex(-1);
        setLiveStream(null);
        setWizardStep(0);
        setPromptError(null);
        setActiveInsight("live");
    };

    // Live stream helpers
    const beginLiveStream = useCallback((phase: LiveStreamPhase, label: string) => {
        setLiveStream({ phase, label, raw: "", cleaned: "", thoughts: [], history: [] });
    }, []);

    const appendLiveStream = useCallback((phase: LiveStreamPhase, label: string, chunk: string) => {
        setLiveStream((prev) => {
            const raw = (prev && prev.phase === phase ? prev.raw : "") + chunk;
            const { cleaned, thoughts } = stripThinkingArtifacts(raw);
            const existingHistory = prev && prev.phase === phase ? prev.history : [];
            const known = new Set(existingHistory.map((h) => h.text));
            const newEntries = thoughts
                .filter((t) => !known.has(t))
                .map((text) => ({ id: `${phase}-${Date.now()}-${Math.random().toString(16).slice(2)}`, text, timestamp: Date.now() }));
            return { phase, label, raw, cleaned, thoughts, history: [...existingHistory, ...newEntries] };
        });
    }, []);

    // Validation based on toggles
    const validateHtml = (html: string) => {
        const issues: string[] = [];
        if (ruleFlags.html && !/<html[\s>]/i.test(html)) issues.push("Missing <html> tag.");
        if (ruleFlags.head && !/<head[\s>]/i.test(html)) issues.push("Missing <head> tag.");
        if (ruleFlags.body && !/<body[\s>]/i.test(html)) issues.push("Missing <body> tag.");
        if (ruleFlags.title && !/<title>[^<]{1,100}<\/title>/i.test(html)) issues.push("Missing <title> tag.");
        if (ruleFlags.noExternalScript && /<script[^>]+src=("|')https?:\/\//i.test(html))
            issues.push("External script src detected — must be self-contained.");
        return { valid: issues.length === 0, issues };
    };

    const runAccessibilityAudit = (html: string) => {
        const issues: string[] = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            if (!doc.querySelector("main")) {
                issues.push("Missing <main> landmark for primary content.");
            }

            const labelForIds = new Set<string>();
            doc.querySelectorAll("label[for]").forEach((label) => {
                const target = label.getAttribute("for");
                if (target) labelForIds.add(target);
            });

            const unlabeledControls: string[] = [];
            const controlSelector = "input, select, textarea";
            doc.querySelectorAll(controlSelector).forEach((element) => {
                const tag = element.tagName.toLowerCase();
                const type = element.getAttribute("type")?.toLowerCase();
                if (tag === "input" && ["hidden", "submit", "button", "reset"].includes(type || "")) return;

                const ariaLabel = element.getAttribute("aria-label");
                const ariaLabelledBy = element.getAttribute("aria-labelledby");
                const id = element.getAttribute("id");

                let labeled = Boolean(ariaLabel && ariaLabel.trim().length > 0);

                if (!labeled && ariaLabelledBy) {
                    const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
                    labeled = ids.some((labelId) => Boolean(doc.getElementById(labelId)));
                }

                if (!labeled && id && labelForIds.has(id)) {
                    labeled = true;
                }

                if (!labeled) {
                    const ancestorLabel = element.closest?.("label");
                    if (ancestorLabel) labeled = true;
                }

                if (!labeled) {
                    unlabeledControls.push(`${tag}${id ? `#${id}` : ""}`);
                }
            });

            if (unlabeledControls.length > 0) {
                issues.push(`Form controls missing accessible label: ${unlabeledControls.join(", ")}`);
            }

            const imagesMissingAlt: string[] = [];
            doc.querySelectorAll("img").forEach((img, index) => {
                const alt = img.getAttribute("alt");
                const role = img.getAttribute("role");
                const ariaHidden = img.getAttribute("aria-hidden");
                if (ariaHidden === "true" || role === "presentation") return;
                if (!alt || alt.trim().length === 0) {
                    const id = img.getAttribute("id");
                    imagesMissingAlt.push(id ? `img#${id}` : `img[index ${index}]`);
                }
            });
            if (imagesMissingAlt.length > 0) {
                issues.push(`Images missing descriptive alt text: ${imagesMissingAlt.join(", ")}`);
            }

            const outlinePattern = /outline\s*:\s*(none|0(?:px)?)/i;
            const styleTags = Array.from(doc.querySelectorAll("style"));
            const strippedStyles = styleTags.map((style) => style.textContent || "").join("\n");
            let outlineRemoved = outlinePattern.test(strippedStyles);
            if (!outlineRemoved) {
                outlineRemoved = Array.from(doc.querySelectorAll("[style]")).some((el) => {
                    const styleAttr = el.getAttribute("style") || "";
                    return outlinePattern.test(styleAttr);
                });
            }
            if (outlineRemoved) {
                issues.push("Detected CSS that removes focus outlines (outline: none/0).");
            }
        } catch {
            issues.push("Could not parse HTML for accessibility audit.");
        }
        return issues;
    };

    const checkCrossPageLinks = (built: BuiltPage[]) => {
        const issues: Record<string, { href: string; text?: string | null }[]> = {};
        try {
            const parser = new DOMParser();
            const targets = new Set(built.map((page) => `${page.id}.html`));

            built.forEach((page) => {
                try {
                    const doc = parser.parseFromString(page.html, "text/html");
                    const broken: { href: string; text?: string | null }[] = [];
                    doc.querySelectorAll("a[href]").forEach((anchor) => {
                        const rawHref = anchor.getAttribute("href") || "";
                        if (!rawHref) return;
                        if (/^(https?:|mailto:|tel:|#)/i.test(rawHref)) return;
                        const cleaned = rawHref.replace(/^\.\//, "").split(/[?#]/)[0];
                        if (!/\.html$/i.test(cleaned)) return;
                        if (!targets.has(cleaned)) {
                            broken.push({ href: rawHref, text: anchor.textContent?.trim() || null });
                        }
                    });
                    if (broken.length) issues[page.id] = broken;
                } catch {
                    // Ignore parsing issues for this page.
                }
            });
        } catch {
            // DOMParser unavailable (should not happen in client runtime)
        }
        return issues;
    };

    const injectMetaTags = (html: string, tags: string[]) => {
        if (!tags?.length) return html;
        const trimmed = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        if (!trimmed.length) return html;
        const unique = trimmed.filter((tag, index, arr) => arr.indexOf(tag) === index);
        const newTags = unique.filter((tag) => !html.includes(tag));
        if (!newTags.length) return html;
        const closeHeadIndex = html.search(/<\/head>/i);
        const injection = `${newTags.join("\n")}\n`;
        if (closeHeadIndex === -1) {
            return `${html}\n${injection}`;
        }
        return `${html.slice(0, closeHeadIndex)}${injection}${html.slice(closeHeadIndex)}`;
    };

    // Compose optional Ollama options
    const aiOptions = useMemo(() => {
        return useCustomCtx ? { options: { num_ctx: Math.max(1024, Math.floor(ctxLen)) } } : {};
    }, [useCustomCtx, ctxLen]);

    // ---------- Main workflow: per-page plan → code → validate/fix ----------
    const runWorkflow = async () => {
        if (!model) return;

        // Reset
        setStatus(""); setStatusLines([]);
        setPages([]);
        setPlan(null); setSharedLayout(null);
        setDesignTokens(null); setSeoArtifacts(null);
        setExportHref(null);
        setStepIndex(0); setLiveStream(null);

        const runAiStep = async (
            phase: LiveStreamPhase,
            label: string,
            prompt: string,
            options: CallAiOptions = {},
        ) => {
            beginLiveStream(phase, label);
            const response = await callAi(
                model,
                prompt,
                {
                    prePrompt,
                    stream: true,
                    ...aiOptions,
                    ...options,
                    onChunk: (chunk) => appendLiveStream(phase, label, chunk),
                },
            );
            return response;
        };

        let tokensForBuild: DesignTokens | null = null;
        let seoPack: SeoArtifacts | null = null;

        try {
            // 1) Shared layout
            log("1) Layout: crafting shared header and footer…");
            const layoutLabel = "Designing shared chrome";
            const layoutRaw = await runAiStep("layout", layoutLabel, buildSharedLayoutPrompt(pageCount, userPrompt), {
                json: true,
            });

            const layoutJsonText = extractJsonObject(layoutRaw);
            let layoutParsed: { site_title?: string; header?: string; footer?: string } | null = null;
            try { layoutParsed = JSON.parse(layoutJsonText); } catch { throw new Error("Could not parse shared header/footer JSON"); }
            if (!layoutParsed?.header || !layoutParsed?.footer) throw new Error("Shared header/footer response missing required fields");

            const sharedChrome: SharedLayout = {
                header: layoutParsed.header.trim(),
                footer: layoutParsed.footer.trim(),
                siteTitle: layoutParsed.site_title?.trim(),
                thinking: stripThinkingArtifacts(layoutRaw).thoughts,
            };
            setSharedLayout(sharedChrome);
            log("→ Generated unified header & footer.");
            setStepIndex(1);

            // 2) Site map
            log("2) Site map: drafting pages JSON…");
            const mapLabel = "Planning site map";
            const planRaw = await runAiStep("plan", mapLabel, buildPlanPrompt(pageCount, sharedChrome.siteTitle, userPrompt), {
                json: true,
            });

            let parsed: Plan | null = null;
            try {
                parsed = JSON.parse(extractJsonObject(planRaw));
                if (!parsed?.pages?.length) throw new Error("Missing pages");
            } catch {
                throw new Error("Could not parse plan JSON");
            }
            const normalisedPlan: Plan = { site_title: parsed!.site_title || sharedChrome.siteTitle, pages: parsed!.pages };
            setPlan(normalisedPlan);
            log(`→ Planned ${normalisedPlan.pages.length} page(s).`);
            setStepIndex(2);

            log("   • Deriving design tokens…");
            const tokensLabel = "Generating design tokens";
            const tokensRaw = await runAiStep(
                "plan",
                tokensLabel,
                buildDesignTokensPrompt(normalisedPlan.site_title || sharedChrome.siteTitle, userPrompt),
                { json: true },
            );

            try {
                const parsedTokens = JSON.parse(extractJsonObject(tokensRaw)) as DesignTokens;
                tokensForBuild = parsedTokens;
                setDesignTokens(parsedTokens);
                log("→ Design tokens captured.");
            } catch {
                throw new Error("Could not parse design tokens JSON");
            }

            // 3) Per page — PLAN → BUILD → VALIDATE/FIX
            const builtPages: BuiltPage[] = [];
            const allNav = normalisedPlan.pages.map(({ id, title }) => ({ id, title }));
            const brandContext = userPrompt;
            const siteLabel = normalisedPlan.site_title || sharedChrome.siteTitle || "My Site";
            const siteSlug = slugify(siteLabel);

            const processPage = async (p: Plan["pages"][number]) => {
                const planLabel = `Planning page "${p.title}"`;
                log(`3) ${planLabel}…`);
                const pagePlanRaw = await runAiStep(
                    "page",
                    planLabel,
                    buildPagePlanPrompt(siteLabel, p, allNav, brandContext || ""),
                    { json: true },
                );
                let pagePlan: PagePlan;
                try {
                    pagePlan = JSON.parse(extractJsonObject(pagePlanRaw)) as PagePlan;
                } catch {
                    throw new Error(`Could not parse page plan for ${p.title}`);
                }
                log(`→ Page plan ready for "${p.title}".`);

                type BuildCycleResult = {
                    html: string;
                    thoughts: string[];
                    valid: boolean;
                    issues: string[];
                    accessibilityIssues: string[];
                };

                const runBuildCycle = async (label: string, prompt: string): Promise<BuildCycleResult> => {
                    log(`   • ${label}…`);
                    const raw = await runAiStep(
                        "page",
                        label,
                        prompt,
                        { json: false, enforceCode: true },
                    );
                    const processed = stripThinkingArtifacts(raw);
                    let html = processed.cleaned;
                    let thoughts = [...processed.thoughts];
                    let { valid, issues } = validateHtml(html);

                    let attempts = 0;
                    while (!valid && attempts < maxFixes) {
                        attempts++;
                        const fixLabel = `Fixing "${p.title}" (pass ${attempts}/${maxFixes})`;
                        log(`   • ${fixLabel}…`);
                        const fixedRaw = await runAiStep(
                            "page",
                            fixLabel,
                            buildFixPrompt(siteLabel, p.title, issues, html),
                            { json: false, enforceCode: true },
                        );
                        const processedFix = stripThinkingArtifacts(fixedRaw);
                        html = processedFix.cleaned;
                        thoughts = [...thoughts, ...processedFix.thoughts];
                        const check = validateHtml(html);
                        valid = check.valid;
                        issues = check.issues;
                    }

                    let accessibilityIssues = runAccessibilityAudit(html);
                    if (accessibilityIssues.length > 0) {
                        log(`   • Accessibility audit found issues: ${accessibilityIssues.join("; ")}`);
                        const a11yFixLabel = `Patching accessibility for "${p.title}"`;
                        const a11yFixRaw = await runAiStep(
                            "page",
                            a11yFixLabel,
                            buildA11yFixPrompt(siteLabel, p.title, accessibilityIssues, html),
                            { json: false, enforceCode: true },
                        );
                        const processedA11y = stripThinkingArtifacts(a11yFixRaw);
                        html = processedA11y.cleaned;
                        thoughts = [...thoughts, ...processedA11y.thoughts];
                        const structuralAfterPatch = validateHtml(html);
                        valid = structuralAfterPatch.valid;
                        issues = structuralAfterPatch.issues;
                        accessibilityIssues = runAccessibilityAudit(html);
                        if (accessibilityIssues.length === 0) {
                            log("   • Accessibility patch ✅ Issues resolved.");
                        }
                    }

                    if (accessibilityIssues.length > 0) {
                        const tagged = accessibilityIssues.map((issue) => `Accessibility: ${issue}`);
                        issues = [...issues, ...tagged];
                        valid = false;
                        log(`   • Accessibility audit ⚠️ Remaining issues: ${accessibilityIssues.join("; ")}`);
                    }

                    return { html, thoughts, valid, issues, accessibilityIssues };
                };

                const basePrompt = buildPagePrompt(siteLabel, p, pagePlan, sharedChrome, allNav, tokensForBuild || designTokens);
                let result = await runBuildCycle(`Generating code for "${p.title}"`, basePrompt);
                let combinedThoughts = [...result.thoughts];

                if (!result.valid || result.accessibilityIssues.length > 0) {
                    const unresolved = [
                        ...result.issues,
                        ...result.accessibilityIssues.map((issue) => `Accessibility: ${issue}`),
                    ];
                    const reminder = unresolved.length
                        ? `Resolve these outstanding problems:
${unresolved.map((item) => `- ${item}`).join("\n")}`
                        : "Ensure the regenerated document passes all structural and accessibility checks.";
                    const retryPrompt = `${buildPagePrompt(siteLabel, p, pagePlan, sharedChrome, allNav, tokensForBuild || designTokens)}\n\nThe previous attempt failed validation. ${reminder}\n`;
                    const retry = await runBuildCycle(`Regenerating code for "${p.title}"`, retryPrompt);
                    combinedThoughts = [...combinedThoughts, ...retry.thoughts];
                    result = {
                        html: retry.html,
                        thoughts: combinedThoughts,
                        valid: retry.valid,
                        issues: retry.issues,
                        accessibilityIssues: retry.accessibilityIssues,
                    };
                } else {
                    result = { ...result, thoughts: combinedThoughts };
                }

                if (result.valid && result.issues.length === 0) {
                    log(`   • "${p.title}" ✅ Passed validation.`);
                } else {
                    const detail = result.issues.length ? result.issues.join("; ") : "Unknown validation issues";
                    log(`   • "${p.title}" ⚠️ Still has issues: ${detail}`);
                }

                const built: BuiltPage = {
                    id: p.id,
                    title: p.title,
                    html: result.html,
                    valid: result.valid,
                    issues: result.issues,
                    thinking: result.thoughts,
                };
                return built;
            };

            for (const p of normalisedPlan.pages) {
                const built = await processPage(p);
                builtPages.push(built);
                setPages((prev) => [...prev, built]);
            }

            setStepIndex(3);

            log("4) Delivery: running cross-page link audit…");
            const initialCrossLinks = checkCrossPageLinks(builtPages);
            let unresolvedLinks: Record<string, { href: string; text?: string | null }[]> = initialCrossLinks;
            if (Object.keys(initialCrossLinks).length > 0) {
                const brokenCount = Object.values(initialCrossLinks).reduce((sum, list) => sum + list.length, 0);
                log(`   • Found ${brokenCount} broken link(s); issuing corrective pass.`);
                for (const [pageId, brokenList] of Object.entries(initialCrossLinks)) {
                    const target = builtPages.find((page) => page.id === pageId);
                    if (!target || brokenList.length === 0) continue;
                    const fixLabel = `Fixing cross-links for "${target.title}"`;
                    const linkFixRaw = await runAiStep(
                        "page",
                        fixLabel,
                        buildLinkFixPrompt(siteLabel, target.title, brokenList, target.html, allNav),
                        { json: false, enforceCode: true },
                    );
                    const processedFix = stripThinkingArtifacts(linkFixRaw);
                    target.html = processedFix.cleaned;
                    target.thinking = [...target.thinking, ...processedFix.thoughts];
                }
                unresolvedLinks = checkCrossPageLinks(builtPages);
                if (Object.keys(unresolvedLinks).length === 0) {
                    log("   • Cross-page links patched successfully.");
                } else {
                    const summary = Object.entries(unresolvedLinks)
                        .map(([id, list]) => `${id}: ${list.map((item) => item.href).join(", ")}`)
                        .join(" | ");
                    log(`   • Cross-page links still unresolved: ${summary}`);
                }
            } else {
                log("   • All cross-page links already valid ✅");
                unresolvedLinks = {};
            }

            const baseUrl = `https://example.com/${siteSlug}/`;
            log("   • Generating SEO/meta pack…");
            const seoLabel = "Generating SEO pack";
            beginLiveStream("plan", seoLabel);
            const seoRaw = await callAi(
                model,
                buildSeoPackPrompt(siteLabel, normalisedPlan.pages, baseUrl),
                { prePrompt, json: true, stream: true, onChunk: (c) => appendLiveStream("plan", seoLabel, c), ...aiOptions },
            );
            try {
                seoPack = JSON.parse(extractJsonObject(seoRaw)) as SeoArtifacts;
                setSeoArtifacts(seoPack);
                log("   • SEO assets prepared (sitemap, robots, meta tags).");
            } catch {
                seoPack = null;
                log("   • Failed to parse SEO/meta pack JSON.");
            }

            if (seoPack) {
                seoPack.pages.forEach((metaPage) => {
                    const target = builtPages.find((page) => page.id === metaPage.page_id);
                    if (!target) return;
                    const combinedTags = [
                        ...(metaPage.extra || []),
                        ...(metaPage.open_graph || []),
                        ...(metaPage.twitter || []),
                    ];
                    target.html = injectMetaTags(target.html, combinedTags);
                });
            }

            builtPages.forEach((page) => {
                const structural = validateHtml(page.html);
                const a11y = runAccessibilityAudit(page.html);
                const aggregateIssues = [...structural.issues];
                if (a11y.length) aggregateIssues.push(...a11y.map((issue) => `Accessibility: ${issue}`));
                page.issues = aggregateIssues;
                page.valid = structural.valid && a11y.length === 0;
            });

            if (Object.keys(unresolvedLinks).length > 0) {
                for (const [pageId, brokenList] of Object.entries(unresolvedLinks)) {
                    const target = builtPages.find((page) => page.id === pageId);
                    if (!target) continue;
                    brokenList.forEach((item) => {
                        const message = `Broken internal link: ${item.href}`;
                        if (!target.issues.includes(message)) target.issues.push(message);
                    });
                    target.valid = false;
                }
            }

            setPages([...builtPages]);

            log("   • Packaging export bundle…");
            try {
                const exportFiles = builtPages.map((page) => ({ path: `${page.id}.html`, contents: page.html }));
                const tokensSource = tokensForBuild || designTokens;
                const seoSource = seoPack || seoArtifacts;
                if (seoSource?.sitemap) exportFiles.push({ path: "sitemap.xml", contents: seoSource.sitemap.trim() });
                if (seoSource?.robots) exportFiles.push({ path: "robots.txt", contents: seoSource.robots.trim() });
                if (tokensSource) exportFiles.push({ path: "design-tokens.json", contents: JSON.stringify(tokensSource, null, 2) });
                if (seoSource) exportFiles.push({ path: "meta-tags.json", contents: JSON.stringify(seoSource, null, 2) });

                const response = await fetch("/api/export", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ siteSlug, files: exportFiles }),
                });

                if (!response.ok) {
                    const text = await response.text().catch(() => "export failed");
                    throw new Error(text || `Export failed (${response.status})`);
                }

                const data: { href?: string } = await response.json().catch(() => ({}));
                if (data?.href) {
                    setExportHref(data.href);
                    log(`   • Export bundle ready: ${data.href}`);
                } else {
                    throw new Error("Missing download link in export response");
                }
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error ?? "Export error");
                log(`   • Export bundle failed: ${message}`);
                setExportHref(null);
            }

            const bad = builtPages.filter((b) => !b.valid);
            log(bad.length === 0 ? "5) Validation: all pages look OK ✅" : `5) Validation: ${bad.length} page(s) still have issues ⚠️`);
            setStepIndex(4);
            setTimeout(() => setStepIndex(STEPS.length), 120);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error ?? "unknown");
            log(`Error: ${message}`);
        }
    };

    // Preview dialog/tab (unchanged)
    const handleNext = () => {
        if (wizardStep === 0) {
            if (generationInFlight) return;
            if (userPrompt.trim().length === 0) {
                setPromptError("Please describe your website before continuing.");
                return;
            }
            setPromptError(null);
            setWizardStep(1);
            setActiveInsight("live");
            void runWorkflow();
            return;
        }

        if (wizardStep === 1) {
            if (!plan?.pages?.length) return;
            setWizardStep(2);
            return;
        }

        if (wizardStep === 2) {
            if (!generationComplete) return;
            setWizardStep(3);
            return;
        }

        resetAll();
    };

    // Preview dialog/tab (unchanged)
    const handlePreviewClick = useCallback(() => {
        if (pages.length === 0) return;

        const escapeHtml = (v: string) =>
            v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

        const sanitizedPages = pages.map((p) => ({ id: p.id, title: p.title, html: p.html.replace(/<\/script/gi, "<\\/script") }));
        const safeJson = JSON.stringify(sanitizedPages).replace(/<\//g, "<\\/");
        const siteTitle = escapeHtml(plan?.site_title || sharedLayout?.siteTitle || "Generated Site Preview");

        const previewDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>${siteTitle} — Preview</title><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#020617;color:#e2e8f0}
body{margin:0;min-height:100vh;display:flex;flex-direction:column}
.app{display:flex;flex:1;min-height:0}
aside{width:280px;padding:24px;border-right:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.82);backdrop-filter:blur(18px);display:flex;flex-direction:column;gap:16px}
h1{font-size:1.1rem;margin:0;letter-spacing:.08em;text-transform:uppercase;color:#38bdf8}
#nav{display:flex;flex-direction:column;gap:10px}
button.page-btn{appearance:none;border:1px solid rgba(148,163,184,.35);background:rgba(30,64,175,.18);color:inherit;border-radius:999px;padding:10px 16px;font:inherit;text-align:left;cursor:pointer;transition:border-color .2s,background .2s,transform .2s}
button.page-btn.active{border-color:rgba(56,189,248,.9);background:rgba(56,189,248,.25);transform:translateX(4px)}
button.page-btn:hover{border-color:rgba(56,189,248,.6)}
main{flex:1;display:flex;flex-direction:column;min-width:0;background:radial-gradient(circle at top right, rgba(56,189,248,.15), transparent 45%),radial-gradient(circle at bottom left, rgba(236,72,153,.12), transparent 55%),#020617}
.preview-header{padding:20px 28px;display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.9);backdrop-filter:blur(16px)}
.preview-header h2{margin:0;font-size:1.05rem;font-weight:600}
.preview-header span{opacity:.7;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase}
#open-tab{appearance:none;border-radius:999px;border:1px solid rgba(34,197,94,.45);background:rgba(22,163,74,.2);color:#bbf7d0;padding:8px 14px;font:inherit;cursor:pointer;transition:border .2s,background .2s}
#open-tab:hover{border-color:rgba(34,197,94,.8);background:rgba(22,163,74,.28)}
iframe{flex:1;border:none;width:100%;min-height:0;background:white}
@media (max-width:900px){.app{flex-direction:column}aside{flex-direction:row;overflow-x:auto;width:100%}button.page-btn{min-width:160px}}
</style></head>
<body>
<div class="app">
  <aside>
    <div><h1>${siteTitle}</h1><p style="font-size:.8rem;opacity:.65;margin-top:8px;">Select a page to preview.</p></div>
    <div id="nav"></div>
  </aside>
  <main>
    <div class="preview-header"><div><span>Currently viewing</span><h2 id="current-title">&nbsp;</h2></div><button id="open-tab" type="button">Open standalone tab</button></div>
    <iframe id="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>
  </main>
</div>
<script id="page-data" type="application/json">${safeJson}</script>
<script>
const pages=JSON.parse(document.getElementById('page-data').textContent);
const nav=document.getElementById('nav');const frame=document.getElementById('preview-frame');const titleEl=document.getElementById('current-title');const openBtn=document.getElementById('open-tab');let current=null;
function clean(html){return html.replace(/<\\/script/gi,'</'+'script>');}
function render(page){if(!page)return;current=page;frame.srcdoc=clean(page.html);titleEl.textContent=page.title;for(const btn of nav.querySelectorAll('button.page-btn')){btn.classList.toggle('active',btn.dataset.id===page.id);}}
openBtn.addEventListener('click',()=>{if(!current)return;const blob=new Blob([clean(current.html)],{type:'text/html'});const url=URL.createObjectURL(blob);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),120000);});
pages.forEach((page,i)=>{const btn=document.createElement('button');btn.type='button';btn.className='page-btn';btn.textContent=page.title;btn.dataset.id=page.id;btn.addEventListener('click',()=>render(page));nav.appendChild(btn);if(i===0)render(page);});
</script>
</body></html>`;

        const blob = new Blob([previewDocument], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
    }, [pages, plan, sharedLayout]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-neutral-100">
            {/* SINGLE STYLISH TOP BAR */}
            <header className="sticky top-0 z-40 border-b border-slate-800/70 bg-slate-900/80 backdrop-blur">
                <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
                    <h1 className="text-sm font-semibold tracking-wider">
                        <span className="mr-2 rounded-md bg-sky-500/15 px-2 py-1 text-sky-200">AI</span> Auto Website Builder
                    </h1>
                    <a
                        href="https://ollama.com"
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                    >
                        Powered by Ollama
                    </a>
                </div>
            </header>

            {/* STATUS HERO */}
            <section className="mx-auto w-full max-w-6xl px-6 py-6">
                <div className="flex flex-col gap-6 lg:flex-row">
                    <div className="flex-1">
                        <div className="relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/60 px-6 py-8 text-center shadow-lg shadow-sky-950/30 backdrop-blur lg:text-left">
                            <div className={`absolute inset-0 bg-gradient-to-r ${heroConfig.accent} opacity-30 blur-3xl`} />
                            <div className="relative z-10 flex flex-col items-center lg:items-start">
                                <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">{heroConfig.label}</p>
                                <h2 className="mt-3 text-3xl font-semibold text-white md:text-4xl">{heroConfig.title}</h2>
                                <p className="mt-3 max-w-2xl text-sm text-neutral-300 md:text-base">{heroConfig.subtitle}</p>

                                {heroConfig.variant === "idea" && (
                                    <div className="mt-6 w-full max-w-3xl space-y-5 text-left">
                                        <div>
                                            <label className="text-[0.65rem] uppercase tracking-[0.3em] text-neutral-400">Website idea</label>
                                            <textarea
                                                rows={4}
                                                value={userPrompt}
                                                onChange={(e) => {
                                                    setPromptError(null);
                                                    setUserPrompt(e.target.value);
                                                }}
                                                placeholder="Describe the site you want…"
                                                className="mt-3 w-full resize-y rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-3 text-sm leading-relaxed text-neutral-100 outline-none placeholder:opacity-40 focus:border-slate-500"
                                            />
                                            {promptError && (
                                                <p className="mt-2 text-sm text-rose-300">{promptError}</p>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2 text-sm text-neutral-200 md:flex-row md:items-center md:justify-between">
                                            <label className="text-[0.65rem] uppercase tracking-[0.3em] text-neutral-400">Number of pages</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={8}
                                                value={pageCount}
                                                onChange={(e) => setPageCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
                                                className="w-28 rounded-xl border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:border-slate-500"
                                            />
                                        </div>
                                    </div>
                                )}

                                {heroConfig.variant === "plan" && (
                                    <div className="mt-6 w-full max-w-3xl rounded-2xl border border-slate-800/70 bg-slate-950/60 p-5 text-left">
                                        <div className="text-[0.65rem] uppercase tracking-[0.3em] text-neutral-400">Proposed pages</div>
                                        {plan?.pages?.length ? (
                                            <ul className="mt-3 space-y-2 text-sm text-neutral-200">
                                                {plan.pages.map((page) => (
                                                    <li key={page.id} className="flex flex-col gap-0.5">
                                                        <span className="font-medium text-white">{page.title}</span>
                                                        {page.purpose && <span className="text-xs text-neutral-400">{page.purpose}</span>}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="mt-3 text-sm text-neutral-300/80">Generating a plan…</p>
                                        )}
                                    </div>
                                )}

                                {heroConfig.variant === "progress" && (
                                    <div className="mt-6 w-full max-w-3xl rounded-2xl border border-slate-800/70 bg-slate-950/60 p-5 text-left">
                                        <div className="text-[0.65rem] uppercase tracking-[0.3em] text-neutral-400">Build progress</div>
                                        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-blue-500 to-purple-500 transition-all duration-500"
                                                style={{ width: `${Math.max(heroProgress, generationComplete ? 1 : 0) * 100}%` }}
                                            />
                                        </div>
                                        <p className="mt-3 text-sm text-neutral-300">
                                            {generationInFlight
                                                ? `Working through step ${Math.min(stepIndex + 1, STEPS.length)} of ${STEPS.length}…`
                                                : generationComplete
                                                    ? "Generation complete."
                                                    : "Waiting for build to start."}
                                        </p>
                                        {statusLines.length > 0 && (
                                            <p className="mt-2 text-xs text-neutral-400">Latest: {statusLines[statusLines.length - 1]}</p>
                                        )}
                                    </div>
                                )}

                                {heroConfig.variant === "preview" && (
                                    <div className="mt-6 w-full max-w-3xl rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-left">
                                        <div className="text-[0.65rem] uppercase tracking-[0.3em] text-emerald-200">Your build is ready</div>
                                        <p className="mt-3 text-sm text-emerald-100">
                                            Generated {pages.length} page{pages.length === 1 ? "" : "s"} with SEO extras packaged.
                                        </p>
                                        <div className="mt-4 flex flex-wrap gap-3">
                                            <button
                                                type="button"
                                                onClick={handlePreviewClick}
                                                className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/30"
                                            >
                                                Preview website
                                            </button>
                                            {exportHref && (
                                                <a
                                                    href={exportHref}
                                                    download
                                                    className="rounded-xl border border-slate-700/70 bg-slate-900/60 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
                                                >
                                                    Download zip
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
                                    <button
                                        type="button"
                                        onClick={handleNext}
                                        disabled={nextDisabled}
                                        className={`rounded-xl px-5 py-2 text-sm font-medium text-white shadow-lg shadow-sky-900/40 transition ${nextDisabled
                                            ? "cursor-not-allowed bg-slate-700/50"
                                            : "bg-gradient-to-r from-sky-600 to-indigo-500 hover:from-sky-500 hover:to-indigo-400"}`}
                                    >
                                        {nextLabel}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={resetAll}
                                        className="rounded-xl border border-slate-800/70 bg-slate-950/60 px-4 py-2 text-sm text-neutral-200 transition hover:border-slate-500"
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <aside className="w-full lg:w-80">
                        <div className="flex h-full flex-col gap-4 rounded-3xl border border-slate-800/60 bg-slate-900/70 p-4 backdrop-blur">
                            <h3 className="text-[0.65rem] uppercase tracking-[0.35em] text-slate-400">AI activity</h3>
                            <div className="flex flex-col gap-2">
                                {insightItems.map((item) => {
                                    const active = activeInsight === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setActiveInsight(item.id)}
                                            className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-sm transition ${active
                                                ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                                                : "border-slate-800/70 bg-slate-950/40 text-slate-200 hover:border-slate-600/70"}`}
                                        >
                                            <span>{item.label}</span>
                                            {item.count > 0 && (
                                                <span className={`inline-flex min-w-[1.5rem] justify-center rounded-full px-2 text-xs ${active ? "bg-sky-400/30 text-sky-100" : "bg-slate-800 text-slate-300"}`}>
                                                    {item.count}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="flex-1 overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4">
                                <div className="max-h-72 overflow-y-auto text-left text-sm text-neutral-200">
                                    {insightContent}
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </section>

            {/* CONTROLS */}
            <section className={`mx-auto w-full max-w-5xl px-6 pb-6 ${PANEL_CLASS} p-4 md:p-6`}>
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                        <label className="text-sm opacity-80">Model</label>
                        <div className="flex gap-3">
                            <select
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                className="w-full rounded-xl border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
                            >
                                {models.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <button
                                type="button"
                                onClick={async () => {
                                    const r = await fetch("/api/ollama/tags");
                                    const names: string[] = await r.json();
                                    setModels(names);
                                    if (!names.includes(model) && names[0]) setModel(names[0]);
                                }}
                                className="rounded-xl border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-sm transition hover:border-slate-500"
                            >
                                Refresh
                            </button>
                        </div>

                    </div>

                    <div className="space-y-3">
                        <label className="text-sm opacity-80">Pre-prompt (system)</label>
                        <textarea
                            rows={6} value={prePrompt} onChange={(e) => setPrePrompt(e.target.value)}
                            className="w-full resize-y rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-3 text-sm leading-relaxed outline-none placeholder:opacity-40 focus:border-slate-500"
                        />
                    </div>
                </div>

                {/* NEW: Settings row */}
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-3 rounded-xl border border-slate-800/70 bg-slate-950/60 p-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">Max fix attempts</label>
                            <input
                                type="number"
                                min={0}
                                max={6}
                                value={maxFixes}
                                onChange={(e) => setMaxFixes(Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
                                className="w-24 rounded-lg border border-slate-800/70 bg-slate-950/60 px-2 py-1 text-sm outline-none focus:border-slate-500"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">Use custom context</label>
                            <input
                                type="checkbox"
                                checked={useCustomCtx}
                                onChange={(e) => setUseCustomCtx(e.target.checked)}
                                className="h-4 w-4 accent-sky-500"
                            />
                        </div>
                        <div className="flex items-center justify-between opacity-90">
                            <label className="text-sm">Context length (num_ctx)</label>
                            <input
                                type="number"
                                min={1024}
                                step={512}
                                disabled={!useCustomCtx}
                                value={ctxLen}
                                onChange={(e) => setCtxLen(Math.max(1024, Number(e.target.value) || 1024))}
                                className={`w-28 rounded-lg border px-2 py-1 text-sm outline-none ${useCustomCtx ? "border-slate-800/70 bg-slate-950/60 focus:border-slate-500" : "border-slate-900/60 bg-slate-900/60 text-slate-500"}`}
                            />
                        </div>
                        {!useCustomCtx ? (
                            <p className="text-xs text-slate-400">Using model default context window.</p>
                        ) : (
                            <p className="text-xs text-slate-400">Make sure the selected model actually supports this window.</p>
                        )}
                    </div>

                    <div className="space-y-2 rounded-xl border border-slate-800/70 bg-slate-950/60 p-4">
                        <div className="text-sm font-medium">Validation rules</div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
                            <label className="inline-flex items-center gap-2">
                                <input type="checkbox" checked={ruleFlags.html} onChange={e => setRuleFlags(f => ({ ...f, html: e.target.checked }))} className="h-4 w-4 accent-sky-500" />
                                <span>&lt;html&gt; present</span>
                            </label>
                            <label className="inline-flex items-center gap-2">
                                <input type="checkbox" checked={ruleFlags.head} onChange={e => setRuleFlags(f => ({ ...f, head: e.target.checked }))} className="h-4 w-4 accent-sky-500" />
                                <span>&lt;head&gt; present</span>
                            </label>
                            <label className="inline-flex items-center gap-2">
                                <input type="checkbox" checked={ruleFlags.body} onChange={e => setRuleFlags(f => ({ ...f, body: e.target.checked }))} className="h-4 w-4 accent-sky-500" />
                                <span>&lt;body&gt; present</span>
                            </label>
                            <label className="inline-flex items-center gap-2">
                                <input type="checkbox" checked={ruleFlags.title} onChange={e => setRuleFlags(f => ({ ...f, title: e.target.checked }))} className="h-4 w-4 accent-sky-500" />
                                <span>&lt;title&gt; present</span>
                            </label>
                            <label className="inline-flex items-center gap-2 col-span-2">
                                <input type="checkbox" checked={ruleFlags.noExternalScript} onChange={e => setRuleFlags(f => ({ ...f, noExternalScript: e.target.checked }))} className="h-4 w-4 accent-sky-500" />
                                <span>Forbid external <code>script src=&quot;http(s)://…&quot;</code></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="mt-4">
                    <label className="mb-2 block text-sm opacity-80">User Prompt</label>
                    <textarea
                        rows={4} value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)}
                        placeholder="Describe the site you want…"
                        className="w-full resize-y rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-3 text-sm leading-relaxed outline-none placeholder:opacity-40 focus:border-slate-500"
                    />
                </div>
            </section>

            {/* WORKFLOW LOG (hero mirrors this) */}
            <section className={`mx-auto w-full max-w-5xl px-6 pb-24 ${PANEL_CLASS} p-4 md:p-6`}>
                <h2 className="mb-2 text-sm font-semibold opacity-80">Workflow Log</h2>
                <pre className="min-h-24 whitespace-pre-wrap rounded-xl border border-slate-800/70 bg-slate-950/50 p-4 text-xs leading-relaxed text-slate-200">
                    {status || "Idle"}
                </pre>
            </section>
        </div>
    );
}
