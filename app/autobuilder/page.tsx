"use client";

import { useEffect, useMemo, useState } from "react";
import { callAi } from "../lib/ollama";
import { stripThinking } from "../scripts/stripThinking";

const DEFAULT_PREPROMPT =
  "You are a concise front-end engineer. Return a single, production-ready HTML document with inline CSS and no explanations. Keep the aesthetic anchored to a cohesive colour story.";

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

const buildPrompt = (
  brief: string
) => `Build a responsive, dark-friendly HTML page.
Brief:
${brief.trim() || "Create something welcoming and modern."}
Rules:
- Return only the completed HTML document.
- Inline all CSS.
- Keep copy realistic and positive.
- Keep visuals rooted in one cohesive colour scheme; choose the tones and stay consistent.
- Make sure to create a full website experience, not just a fragment. 
- Create a header and footer. 
- Return ONLY the code. DO NOT include any explanations or notes.
`;

export default function AutoBuilder() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [prePrompt, setPrePrompt] = useState(DEFAULT_PREPROMPT);
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);
  const [html, setHtml] = useState<string>("");
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveContext = useMemo(
    () => defaultCtxForModel(model || "unknown"),
    [model]
  );

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
    setThoughts([]);

    try {
      const response = await callAi(model, buildPrompt(userPrompt), {
        prePrompt,
      });
      const processed = stripThinking(response);
      setHtml(processed.cleaned);
      setThoughts(processed.thoughts);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate page.";
      setError(message);
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

            {thoughts.length > 0 && (
              <div className="space-y-3 rounded-xl border border-slate-800/60 bg-slate-900/60 p-4">
                <h2 className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  Model thoughts
                </h2>
                <ul className="space-y-2 text-xs text-slate-300">
                  {thoughts.map((line, index) => (
                    <li key={`${index}-${line.slice(0, 16)}`}>{line}</li>
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
              <button
                type="button"
                onClick={openPreview}
                disabled={!html}
                className="rounded-lg border border-slate-800 px-3 py-1 text-xs text-slate-300 transition hover:border-sky-500 hover:text-white disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-600"
              >
                Open tab
              </button>
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
