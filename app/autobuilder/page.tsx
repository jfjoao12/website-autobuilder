"use client";

import { useEffect, useMemo, useState } from "react";
import { callAi } from "../lib/ollama";
import { slugify } from "../lib/slug";
import { extractJsonObject, stripThinking } from "../scripts/stripThinking";

type SharedChrome = {
  site_title?: string;
  header: string;
  footer: string;
};

type ThoughtEntry = {
  id: string;
  source: string;
  text: string;
};

const insertAfterBodyOpen = (html: string, snippet: string) => {
  const bodyMatch = html.match(/<body[^>]*>/i);
  if (!bodyMatch) return `${snippet}\n${html}`;
  const idx = html.indexOf(bodyMatch[0]) + bodyMatch[0].length;
  return `${html.slice(0, idx)}\n${snippet}\n${html.slice(idx)}`;
};

const insertBeforeBodyClose = (html: string, snippet: string) => {
  const closeIdx = html.toLowerCase().lastIndexOf("</body>");
  if (closeIdx === -1) return `${html}\n${snippet}`;
  return `${html.slice(0, closeIdx)}\n${snippet}\n${html.slice(closeIdx)}`;
};

const applySharedChrome = (html: string, chrome: SharedChrome | null): string => {
  if (!chrome) return html;
  const header = chrome.header?.trim();
  const footer = chrome.footer?.trim();
  let output = html || "";

  if (header) {
    output = output.replace(/<header[^>]*data-shared[\s\S]*?<\/header>/i, "");
    output = insertAfterBodyOpen(output, header);
  }

  if (footer) {
    output = output.replace(/<footer[^>]*data-shared[\s\S]*?<\/footer>/i, "");
    output = insertBeforeBodyClose(output, footer);
  }

  if (chrome.site_title) {
    const safeTitle = chrome.site_title.trim();
    if (safeTitle) {
      const titleTag = /<title>[^<]*<\/title>/i;
      output = titleTag.test(output)
        ? output.replace(titleTag, `<title>${safeTitle}</title>`)
        : output.replace(/<head>/i, `<head>\n<title>${safeTitle}</title>`);
    }
  }

  return output;
};

const DEFAULT_PREPROMPT = [
  "You are **Website Builder AI — Polished Vanilla One-Pager**.",
  "Deliver one production-ready HTML document with inline CSS (and optional inline JS).",
  "",
  "## Craft principles",
  "- Compose semantic HTML with purposeful class names, landmarks, and clear hierarchy.",
  "- Keep CSS lean and intentional: group layout → typography → visuals → effects.",
  "- Anchor the palette to a cohesive colour story with accessible contrast (≥4.5:1 for body copy).",
  "- Maintain rhythmic spacing (multiples of 4px/8px) and confident alignment.",
  "- Write polished, marketing-ready copy—never lorem ipsum or filler text.",
  "- Add tasteful gradients, blur, or texture only when it supports the look and stays performant.",
  "- Final output must be clean, professional, and free of placeholder comments or dead code.",
].join("\n");

const DEFAULT_USER_PROMPT =
  "Create a single-page website for a friendly phone repair shop with a hero, list of services, testimonials, and a contact call to action.";

const defaultCtxForModel = (model: string): number => {
  const match = model?.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b/);
  if (!match) return 2048;
  const size = Number(match[1]);
  if (Number.isNaN(size)) return 2048;
  if (size <= 1) return 1024;
  if (size <= 8) return 2048;
  return 3072;
};

const buildSharedChromePrompt = (brief: string) => `
You are designing the shared chrome for a single-page marketing site.

Return ONLY JSON with this exact shape:
{
  "site_title": string,
  "header": string,
  "footer": string
}

Rules:
- header must be a <header data-shared> section with a brand link, optional nav, and scoped <style>.
- footer must be a <footer data-shared> section with contact/CTA details, small print, and scoped <style>.
- Both snippets should use the same colour story, glassy gradients welcome, and stay dark-friendly.
- Include CSS custom properties at the top of each snippet so pages can stay consistent.
- Keep markup free of lorem ipsum.

Brief:
${brief.trim() || "Create something welcoming and modern."}
`;

const buildPagePrompt = (brief: string, chrome: SharedChrome) => `
Build a single self-contained HTML5 document for the site described below.

Requirements:
- Include <!doctype html>, <html lang="en">, <head> with <meta charset="utf-8"> and <title>.
- Reuse the shared header/footer snippets exactly once each. Place them inside <body> near the top/bottom.
- Treat the area between them as the main content. Provide a rich hero, sections, testimonials, and a decisive CTA.
- Keep the visual system consistent with the shared chrome (colours, spacing, typography, effects).
- No external assets or libraries; inline all CSS/JS.
- Copy must feel premium, confident, and specific to the brief.

Shared header snippet:
${chrome.header}

Shared footer snippet:
${chrome.footer}

Brief:
${brief.trim() || "Create something welcoming and modern."}
`;

export default function AutoBuilder() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [prePrompt, setPrePrompt] = useState(DEFAULT_PREPROMPT);
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);
  const [html, setHtml] = useState<string>("");
  const [thoughtFeed, setThoughtFeed] = useState<ThoughtEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string[]>([]);
  const [exportHref, setExportHref] = useState<string | null>(null);

  const effectiveContext = useMemo(
    () => defaultCtxForModel(model || "unknown"),
    [model]
  );

  const pushThoughts = (source: string, lines: string[]) => {
    if (!lines?.length) return;
    setThoughtFeed((prev) => [
      ...prev,
      ...lines
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({
          id: `${source}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          source,
          text,
        })),
    ]);
  };

  const pushStatus = (message: string) => {
    if (!message) return;
    setStatus((prev) => [...prev, message]);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ollama/tags");
        const names: string[] = await res.json();
        setModels(names);
        setModel((prev) => prev || names[0] || "qwen3:4b");
      } catch {
        setModels(["error"]);
        setModel((prev) => prev || "qwen3:4b");
      }
    })();
  }, []);

  const handleGenerate = async () => {
    if (!model) return;
    setIsLoading(true);
    setError(null);
    setHtml("");
    setThoughtFeed([]);
    setStatus([]);
    setExportHref(null);

    try {
      pushStatus("Designing shared header & footer…");
      const chromeRaw = await callAi(model, buildSharedChromePrompt(userPrompt), {
        prePrompt,
        json: true,
      });
      const chromeProcessed = stripThinking(chromeRaw);
      pushThoughts("Shared chrome", chromeProcessed.thoughts);

      let chrome: SharedChrome;
      try {
        chrome = JSON.parse(extractJsonObject(chromeRaw)) as SharedChrome;
      } catch {
        throw new Error("Could not parse shared chrome JSON.");
      }

      if (!chrome?.header || !chrome?.footer) {
        throw new Error("Shared chrome response missing header/footer sections.");
      }

      pushStatus("Shared chrome ready.");

      pushStatus("Authoring page HTML…");
      const pageRaw = await callAi(model, buildPagePrompt(userPrompt, chrome), {
        prePrompt,
      });
      const pageProcessed = stripThinking(pageRaw);
      pushThoughts("Page build", pageProcessed.thoughts);

      const merged = applySharedChrome(pageProcessed.cleaned, chrome).trim();
      if (!merged) {
        throw new Error("Model returned empty HTML document.");
      }

      setHtml(merged);
      pushStatus("Page compiled.");

      const siteTitle = chrome.site_title?.trim() || "Generated Site";
      pushStatus("Packaging download…");
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteSlug: slugify(siteTitle),
          files: [{ path: "index.html", contents: merged }],
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || "Failed to create zip archive.");
      }

      const data = await response.json().catch(() => null);
      if (data?.href) {
        setExportHref(data.href);
        pushStatus("Download ready.");
      } else {
        throw new Error("Export service did not return a download link.");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate page.";
      setError(message);
      pushStatus(`Error: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const openPreview = () => {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-900/70 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-sm font-semibold tracking-[0.35em] uppercase text-slate-300">
            Auto Builder
          </h1>
          <span className="text-xs text-slate-500">
            Context ≈ {effectiveContext.toLocaleString()} tokens
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <section className="relative overflow-hidden rounded-3xl border border-slate-900/60 bg-slate-950/70 px-8 py-10 shadow-xl shadow-sky-900/40">
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-sky-500 via-blue-500 to-purple-500 opacity-30 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-3 text-center md:text-left">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-300">
                One-pass builder
              </p>
              <h2 className="text-3xl font-semibold text-white md:text-4xl">
                Generate cohesive pages fast
              </h2>
              <p className="text-sm text-slate-200 md:text-base">
                Describe the experience you want and the AI will return a full
                HTML document that sticks to a matching colour palette.
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 md:items-end">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading || !model}
                className="rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700/60"
              >
                {isLoading ? "Generating…" : "Build page"}
              </button>
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Context ≈ {effectiveContext.toLocaleString()} tokens
              </span>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="space-y-6 rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-lg shadow-black/30">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
              >
                {models.length === 0 && <option value="">Loading…</option>}
                {models.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                System prompt
              </label>
              <textarea
                rows={3}
                value={prePrompt}
                onChange={(e) => setPrePrompt(e.target.value)}
                className="w-full resize-y rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm leading-relaxed outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Brief
              </label>
              <textarea
                rows={6}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="Describe the site you want…"
                className="w-full resize-y rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm leading-relaxed outline-none focus:border-sky-500"
              />
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isLoading || !model}
              className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700/60"
            >
              {isLoading ? "Generating…" : "Build page"}
            </button>

            {error && (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </p>
            )}

            {status.length > 0 && (
              <div className="space-y-3 rounded-xl border border-slate-800/60 bg-slate-900/60 p-4">
                <h2 className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  Progress
                </h2>
                <ul className="space-y-2 text-xs text-slate-300">
                  {status.map((line, index) => (
                    <li key={`status-${index}`} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
                      <span className="whitespace-pre-wrap">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {thoughtFeed.length > 0 && (
              <div className="space-y-3 rounded-xl border border-slate-800/60 bg-slate-900/60 p-4">
                <h2 className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  Model thoughts
                </h2>
                <ul className="space-y-2 text-xs text-slate-300">
                  {thoughtFeed.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-slate-800/60 bg-slate-950/60 p-3">
                      <div className="text-[0.6rem] uppercase tracking-[0.25em] text-slate-500">
                        {entry.source}
                      </div>
                      <p className="mt-1 leading-relaxed text-slate-200">{entry.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-lg shadow-black/30">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
                Preview
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openPreview}
                  disabled={!html}
                  className="rounded-lg border border-slate-800 px-3 py-1 text-xs text-slate-300 transition hover:border-sky-500 hover:text-white disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-600"
                >
                  Open tab
                </button>
                {exportHref && (
                  <a
                    href={exportHref}
                    download
                    className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20"
                  >
                    Download zip
                  </a>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-hidden rounded-2xl border border-slate-900 bg-black/50">
              {html ? (
                <iframe
                  title="Generated preview"
                  sandbox="allow-scripts allow-same-origin"
                  srcDoc={html}
                  className="h-full min-h-[420px] w-full"
                />
              ) : (
                <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-slate-500">
                  {isLoading
                    ? "Waiting for HTML…"
                    : "Generate to see a preview."}
                </div>
              )}
            </div>

            {html && (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  Raw HTML
                </h3>
                <pre className="max-h-72 overflow-auto rounded-xl border border-slate-900/60 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">
                  {html}
                </pre>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
