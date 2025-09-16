// /app/autobuilder/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { callAi } from "../lib/ollama";

type Plan = {
    site_title?: string;
    pages: { id: string; title: string; purpose?: string }[];
};

type BuiltPage = {
    id: string;
    title: string;
    html: string;         // self-contained HTML (inline CSS & JS)
    valid: boolean;
    issues: string[];
};

const DEFAULT_PREPROMPT =
    `You are an expert full-stack product engineer and web designer.
- Prefer semantic HTML5 with inline <style> and optional inline <script>.
- Produce self-contained pages without external assets or imports.
- Keep CSS minimal, modern, and accessible (dark-friendly).
- If asked for multiple pages, each page should be stand-alone HTML (doctype, html, head, body).
- Use a simple top <header> with the site title and a nav placeholder (no external links).`;

const DEFAULT_USER_PROMPT = `Build a minimal website for a small repair shop that sells cases and does phone repairs.
Tone: professional, friendly.
Target pages: suggest a realistic set for this business.`;

const VALIDATION_RULES = [
    {
        name: "Contains <html>",
        check: (s: string) => /<html[\s>]/i.test(s),
        issue: "Missing <html> tag.",
    },
    {
        name: "Contains <head>",
        check: (s: string) => /<head[\s>]/i.test(s),
        issue: "Missing <head> tag.",
    },
    {
        name: "Contains <body>",
        check: (s: string) => /<body[\s>]/i.test(s),
        issue: "Missing <body> tag.",
    },
    {
        name: "Has <title>",
        check: (s: string) => /<title>[^<]{1,100}<\/title>/i.test(s),
        issue: "Missing <title> tag.",
    },
];

export default function AutoBuilder() {
    const [models, setModels] = useState<string[]>([]);
    const [model, setModel] = useState<string>("");
    const [prePrompt, setPrePrompt] = useState(DEFAULT_PREPROMPT);
    const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);
    const [pageCount, setPageCount] = useState<number>(3);
    const [status, setStatus] = useState<string>("");
    const [plan, setPlan] = useState<Plan | null>(null);
    const [pages, setPages] = useState<BuiltPage[]>([]);
    const [activeId, setActiveId] = useState<string>("");

    const [busy, setBusy] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    // Load model list from local Ollama tags (via our API)
    useEffect(() => {
        (async () => {
            try {
                const r = await fetch("/api/ollama/tags");
                const names: string[] = await r.json();
                setModels(names);
                setModel((prev) => prev || names[0] || "qwen3:8b");
            } catch {
                setModels([
                    "qwen3:8b",
                    "qwen2.5:7b-instruct",
                    "qwen2.5:0.5b"
                ]);
                setModel((prev) => prev || "qwen3:8b");
            }
        })();
    }, []);

    const log = (line: string) => setStatus((s) => s + (s ? "\n" : "") + line);

    const resetAll = () => {
        setPlan(null);
        setPages([]);
        setActiveId("");
        setStatus("");
    };

    const buildPlanPrompt = (count: number) => `
You will propose a small website plan as compact JSON only.

Rules:
- Return ONLY a valid JSON object.
- The JSON must be: { "site_title": string, "pages": [{ "id": string, "title": string, "purpose": string }] }
- "id" must be kebab-case, unique.
- Suggest exactly ${count} pages that make sense for the user's request.

User goal/context:
${userPrompt}
`;

    const buildPagePrompt = (siteTitle: string, page: { id: string; title: string; purpose?: string }) => `
Generate a single, self-contained HTML5 document for the page below.

Constraints:
- Include <!doctype html>, <html lang="en">, <head> with <meta charset="utf-8"> and a <title>.
- Inline <style> with a minimal, modern, dark-friendly palette.
- Optional <script> allowed for small interactions only (no external imports).
- The page must be fully functional if saved as a standalone .html file.
- Include a simple <header> featuring "${siteTitle}" and a nav placeholder (no broken links).
- Use the page "purpose" to drive content. Avoid lorem ipsum.

Return ONLY the final HTML document. Do not wrap in Markdown.

Page:
{
  "id": "${page.id}",
  "title": "${page.title}",
  "purpose": ${JSON.stringify(page.purpose || "")}
}
`;

    const validateHtml = (html: string) => {
        const issues: string[] = [];
        for (const r of VALIDATION_RULES) {
            if (!r.check(html)) issues.push(r.issue);
        }
        // quick sanity: forbid <script src="http to avoid remote pulls
        if (/<script[^>]+src=("|')https?:\/\//i.test(html)) {
            issues.push("External script src detected — must be self-contained.");
        }
        return { valid: issues.length === 0, issues };
    };

    const runWorkflow = async () => {
        if (!model) return;
        setBusy(true);
        setStatus("");
        setPages([]);
        setPlan(null);
        setActiveId("");

        try {
            // 1) Idealizing (site plan)
            log("1) Idealizing: drafting pages JSON…");
            const planRaw = await callAi(model, buildPlanPrompt(pageCount), {
                prePrompt,
                json: true,
            });
            let parsed: Plan | null = null;
            try {
                parsed = JSON.parse(planRaw);
                if (!parsed?.pages?.length) throw new Error("Missing pages");
            } catch {
                // If model added text around JSON, try extracting the JSON block:
                const match = planRaw.match(/\{[\s\S]*\}$/);
                if (match) {
                    parsed = JSON.parse(match[0]);
                } else {
                    throw new Error("Could not parse plan JSON");
                }
            }
            setPlan(parsed!);
            log(`→ Planned ${parsed!.pages.length} page(s).`);

            // 2) Code Generation (one prompt per page)
            log("2) Code Generation: generating each page…");
            const built: BuiltPage[] = [];
            for (const p of parsed!.pages) {
                log(`   • Generating "${p.title}"…`);
                const html = await callAi(model, buildPagePrompt(parsed!.site_title || "My Site", p), {
                    prePrompt,
                    json: false,
                });

                // 3) Organization: push into our pages map
                const { valid, issues } = validateHtml(html);
                built.push({ id: p.id, title: p.title, html, valid, issues });
            }
            setPages(built);
            setActiveId(built[0]?.id || "");

            // 4) Validation summary
            const bad = built.filter((b) => !b.valid);
            if (bad.length === 0) {
                log("4) Validation: all pages look OK ✅");
            } else {
                log(`4) Validation: ${bad.length} page(s) have issues. Review below ⚠️`);
            }
        } catch (e: any) {
            log(`Error: ${e?.message || "unknown"}`);
        } finally {
            setBusy(false);
        }
    };

    // Render active page into sandboxed iframe
    const activePage = useMemo(() => pages.find((p) => p.id === activeId) || null, [pages, activeId]);
    useEffect(() => {
        if (!iframeRef.current || !activePage) return;
        const doc = iframeRef.current.contentDocument;
        if (!doc) return;
        doc.open();
        doc.write(activePage.html);
        doc.close();
    }, [activePage]);

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100">
            <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
                <h1 className="text-xl font-semibold tracking-tight">
                    AI Auto Website Builder
                </h1>
                <a
                    href="https://ollama.com"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-neutral-800 px-3 py-1 text-sm opacity-70 hover:opacity-100"
                >
                    Ollama
                </a>
            </header>

            <main className="mx-auto grid max-w-5xl gap-6 px-6 pb-24">
                {/* Controls */}
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 md:p-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-3">
                            <label className="text-sm opacity-80">Model</label>
                            <div className="flex gap-3">
                                <select
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-700"
                                >
                                    {models.map((m) => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const r = await fetch("/api/ollama/tags");
                                        const names: string[] = await r.json();
                                        setModels(names);
                                        if (!names.includes(model) && names[0]) setModel(names[0]);
                                    }}
                                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:border-neutral-700"
                                >
                                    Refresh
                                </button>
                            </div>

                            <label className="text-sm opacity-80"># Pages</label>
                            <input
                                type="number"
                                min={1}
                                max={8}
                                value={pageCount}
                                onChange={(e) => setPageCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
                                className="w-28 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-700"
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="text-sm opacity-80">Pre-prompt (system)</label>
                            <textarea
                                rows={6}
                                value={prePrompt}
                                onChange={(e) => setPrePrompt(e.target.value)}
                                className="w-full resize-y rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm leading-relaxed outline-none placeholder:opacity-40 focus:border-neutral-700"
                            />
                        </div>
                    </div>

                    <div className="mt-4">
                        <label className="mb-2 block text-sm opacity-80">User Prompt</label>
                        <textarea
                            rows={4}
                            value={userPrompt}
                            onChange={(e) => setUserPrompt(e.target.value)}
                            placeholder="Describe the site you want…"
                            className="w-full resize-y rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm leading-relaxed outline-none placeholder:opacity-40 focus:border-neutral-700"
                        />
                    </div>

                    <div className="mt-4 flex gap-2">
                        <button
                            type="button"
                            onClick={runWorkflow}
                            disabled={busy}
                            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${busy ? "bg-neutral-800 text-neutral-400" : "bg-blue-600 hover:bg-blue-500"}`}
                        >
                            {busy ? "Working…" : "Generate"}
                        </button>
                        <button
                            type="button"
                            onClick={resetAll}
                            disabled={busy}
                            className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm hover:border-neutral-700"
                        >
                            Reset
                        </button>
                    </div>
                </section>

                {/* Status */}
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 md:p-6">
                    <h2 className="mb-2 text-sm font-semibold opacity-80">Workflow Log</h2>
                    <pre className="min-h-24 whitespace-pre-wrap rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-xs leading-relaxed">
                        {status || "Idle"}
                    </pre>
                </section>

                {/* Plan */}
                {plan && (
                    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 md:p-6">
                        <h2 className="mb-3 text-sm font-semibold opacity-80">Plan</h2>
                        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-sm">
                            <div className="mb-2 opacity-80">Site: {plan.site_title || "Untitled"}</div>
                            <ul className="space-y-1">
                                {plan.pages.map((p) => (
                                    <li key={p.id} className="opacity-80">• {p.title} <span className="opacity-50">({p.id})</span></li>
                                ))}
                            </ul>
                        </div>
                    </section>
                )}

                {/* Generated Pages */}
                {pages.length > 0 && (
                    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 md:p-6">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-semibold opacity-80">Generated Pages</h2>
                            <div className="flex flex-wrap gap-2">
                                {pages.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => setActiveId(p.id)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs ${activeId === p.id ? "border-blue-500 bg-blue-600/20" : "border-neutral-800 hover:border-neutral-700"}`}
                                    >
                                        {p.title} {p.valid ? "✅" : "⚠️"}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            {/* Code */}
                            <div className="space-y-2">
                                <div className="text-xs opacity-70">Code</div>
                                <pre className="max-h-[480px] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 text-xs leading-relaxed">
                                    {activePage?.html || "Select a page"}
                                </pre>
                                {activePage && activePage.issues.length > 0 && (
                                    <div className="rounded-xl border border-amber-900/40 bg-amber-950/40 p-3 text-xs">
                                        <div className="mb-1 font-medium">Validation issues:</div>
                                        <ul className="list-disc pl-4">
                                            {activePage.issues.map((i, idx) => <li key={idx}>{i}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </div>


                        </div>
                        {/* Preview */}
                        <div className="space-y-2">
                            <div className="text-xs opacity-70">Preview (sandboxed)</div>
                            <iframe
                                ref={iframeRef}
                                sandbox="allow-scripts allow-same-origin"
                                className="h-[520px] w-full rounded-xl border border-neutral-800 bg-white"
                            />
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
