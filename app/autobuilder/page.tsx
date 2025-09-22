// ==================================
// /app/page.tsx (UI ONLY — no backend)
// ==================================
"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Download, Eye } from "lucide-react";
import JSZip from "jszip";

// ------------------------------
// Types
// ------------------------------
type PageItem = { id: string; title: string; purpose?: string };
interface Plan {
  site_title?: string;
  pages: PageItem[];
}
interface GenResponse {
  files: { path: string; content: string }[];
  validation: { ok: boolean; issues?: string[] };
}

// ------------------------------
// Tiny helpers (client-side mock)
// ------------------------------
function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function mockPlan(topic: string, pageCount: number): Plan {
  const base = topic || "My Site";
  const titles: string[] = [];
  if (pageCount >= 1) titles.push("Home");
  for (let i = 2; i < pageCount; i++) titles.push(`Section ${i - 1}`);
  if (pageCount >= 2) titles.push("Contact");

  return {
    site_title: base,
    pages: titles.map((t, idx) => ({
      id: idx === 0 ? "index" : slugify(t),
      title: t,
      purpose:
        idx === 0
          ? "Landing page with hero and quick overview."
          : t === "Contact"
          ? "Ways to reach you, form and social links."
          : `Content section for ${base}.`,
    })),
  };
}

function mockFiles(plan: Plan): GenResponse["files"] {
  const nav = plan.pages
    .map(
      (p) =>
        `<a href="${
          p.id === "index" ? "index" : p.id
        }.html" class="hover:underline">${p.title}</a>`
    )
    .join(' <span class="opacity-50">•</span> ');

  const head = `
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <script src="https://cdn.tailwindcss.com"></script>
      <title>${plan.site_title}</title>
    </head>`;

  const files = plan.pages.map((p, i) => {
    const body = `
    <body class="min-h-dvh bg-[radial-gradient(1200px_600px_at_50%_-20%,#0b1220_0%,#05080f_60%,#03060d_100%)] text-slate-100">
      <main class="mx-auto max-w-4xl px-6 py-12">
        <nav class="mb-8 flex flex-wrap gap-3 text-sm text-indigo-200">${nav}</nav>
        <header class="mb-8">
          <h1 class="text-3xl md:text-5xl font-semibold">${p.title}</h1>
          <p class="mt-2 text-slate-300">${p.purpose ?? "Page"}</p>
        </header>
        <section class="space-y-4 text-slate-300">
          <p>This is a static mock page generated client-side. Replace with your real content.</p>
          <p>Site: <span class="text-slate-200 font-medium">${
            plan.site_title
          }</span></p>
        </section>
        <footer class="mt-14 text-xs text-slate-400">Built with a UI-only flow.</footer>
      </main>
    </body>`;

    const html = `<!doctype html><html>${head}${body}</html>`;
    const path = `${p.id === "index" ? "index" : p.id}.html`;
    return { path, content: html };
  });

  return files;
}

function mockValidate(files: GenResponse["files"]): GenResponse["validation"] {
  const issues: string[] = [];
  files.forEach((f) => {
    if (
      !f.content.includes("<!doctype html>") ||
      !f.content.includes("<html>")
    ) {
      issues.push(`${f.path}: Missing basic HTML structure`);
    }
  });
  return {
    ok: issues.length === 0,
    issues: issues.length ? issues : undefined,
  };
}

export default function Page() {
  // Steps
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Inputs
  const [topic, setTopic] = useState("A stylish portfolio for a creator");
  const [pageCount, setPageCount] = useState(3);
  const [model, setModel] = useState("autobuilder-ai:latest"); // purely cosmetic now

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [files, setFiles] = useState<GenResponse["files"]>([]);
  const [validation, setValidation] = useState<
    GenResponse["validation"] | null
  >(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // Motion
  const variants: Variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 60 : -60,
      opacity: 0,
      scale: 0.98,
      filter: "blur(8px)",
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: { type: "spring", stiffness: 420, damping: 38 },
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -60 : 60,
      opacity: 0,
      scale: 0.98,
      filter: "blur(8px)",
      transition: { type: "spring", stiffness: 360, damping: 34 },
    }),
  };

  const header = useMemo(
    () => (
      <header className="mb-10 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl bg-indigo-500/20 ring-1 ring-indigo-400/30" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Prototype
            </p>
            <h1 className="text-lg font-semibold text-slate-200">
              AI Builder • Plan → Code → Validate
            </h1>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">
            Next.js
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">
            Tailwind
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">
            Framer Motion
          </span>
        </div>
      </header>
    ),
    []
  );

  // ------------------------------
  // UI actions (mocked — no backend)
  // ------------------------------
  async function createPlan() {
    setLoading(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 500));
      const draft = mockPlan(topic, Math.max(1, Math.min(12, pageCount)));
      setPlan(draft);
    } catch (e: any) {
      setError(e.message ?? "Failed to create plan");
    } finally {
      setLoading(false);
    }
  }

  async function generateAndValidate() {
    if (!plan) return;
    setLoading(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 700));
      const outFiles = mockFiles(plan);
      const val = mockValidate(outFiles);
      setFiles(outFiles);
      setValidation(val);
    } catch (e: any) {
      setError(e.message ?? "Failed to generate code");
    } finally {
      setLoading(false);
    }
  }

  function DirectionalCard({ children }: { children: React.ReactNode }) {
    return (
      <AnimatePresence initial={false} mode="popLayout">
        <motion.article
          key={step}
          custom={1}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] p-8 md:p-10 shadow-xl"
        >
          {children}
        </motion.article>
      </AnimatePresence>
    );
  }

  function openPreview(path = "index.html") {
    const file = files.find((f) => f.path.endsWith(path)) || files[0];
    if (!file) return;
    const html = file.content;
    const doc = `<!doctype html><html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/></head><body style=\"margin:0;\">${html}</body></html>`;
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setPreviewSrc(url);
  }

  async function downloadZip() {
    const zip = new JSZip();
    const folder = zip.folder(
      (plan?.site_title || "site").toLowerCase().replace(/\s+/g, "-")
    )!;
    files.forEach((f) => folder.file(f.path, f.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${plan?.site_title?.replace(/\s+/g, "-") || "site"}.zip`;
    a.click();
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(1200px_600px_at_50%_-20%,#0b1220_0%,#05080f_60%,#03060d_100%)] text-slate-100 antialiased selection:bg-indigo-400/30">
      <div className="mx-auto max-w-6xl px-4 py-14">
        {header}

        {/* Model selector (cosmetic only) */}
        <div className="mb-6 flex items-center gap-3">
          <label className="text-sm text-slate-300">AI Model:</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-slate-100"
          >
            <option value="autobuilder-ai:latest">autobuilder-ai:latest</option>
            <option value="qwen3:0.6b">qwen3:0.6b</option>
            <option value="qwen3:3b-instruct">qwen3:3b-instruct</option>
            <option value="qwen3:7b-instruct">qwen3:7b-instruct</option>
          </select>
          <span className="text-xs text-slate-400">(UI only)</span>
        </div>

        <div className="relative isolate overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
          {/* Accents */}
          <div className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 -bottom-24 size-64 rounded-full bg-cyan-500/20 blur-3xl" />

          <div className="relative grid min-h-[520px] place-items-center rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0))] p-4">
            <div className="relative w-full max-w-3xl">
              {error && (
                <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              {/* Step 1: Plan */}
              {step === 1 && (
                <DirectionalCard>
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
                    <span className="size-1.5 rounded-full bg-emerald-400" />{" "}
                    Step 1 • Plan
                  </div>

                  <h2 className="text-3xl font-semibold leading-tight text-slate-50 md:text-5xl">
                    What is this website about?
                  </h2>
                  <p className="mt-3 max-w-prose text-slate-300/90 md:text-lg">
                    Describe your idea and how many pages you want. We\'ll draft
                    a clean plan right here on the card.
                  </p>

                  <div className="mt-6 grid gap-3 md:grid-cols-[1fr,140px]">
                    <input
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g., A minimalist portfolio for a photographer"
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100 outline-none ring-0 placeholder:text-slate-400 focus:border-indigo-400/40"
                    />
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <label className="text-sm text-slate-300">Pages</label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={pageCount}
                        onChange={(e) => setPageCount(Number(e.target.value))}
                        className="w-16 rounded-md bg-transparent text-center text-slate-100 outline-none"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <button
                      disabled={loading}
                      onClick={createPlan}
                      className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm font-medium text-indigo-200 backdrop-blur-md transition hover:border-indigo-300/50 hover:bg-indigo-400/15 hover:text-indigo-100 disabled:opacity-60"
                    >
                      {loading ? "Generating plan…" : "Generate plan"}
                    </button>
                  </div>

                  {plan && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      className="mt-6 overflow-hidden"
                    >
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <h3 className="text-lg font-semibold text-slate-100">
                          Plan
                        </h3>
                        <p className="text-slate-300/90">
                          {plan.site_title || "Untitled site"}
                        </p>
                        <ul className="mt-3 space-y-2 text-sm text-slate-300">
                          {plan.pages?.map((p) => (
                            <li key={p.id} className="flex items-center gap-2">
                              <span className="inline-block size-1.5 rounded-full bg-indigo-400" />
                              <span className="font-medium">{p.title}</span>
                              {p.purpose && (
                                <span className="text-slate-400">
                                  — {p.purpose}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>

                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={() => setStep(2)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200 hover:border-emerald-300/50 hover:bg-emerald-400/15"
                          >
                            <Check className="size-4" /> Accept plan
                          </button>
                          <button
                            onClick={() => setPlan(null)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
                          >
                            Deny & revise
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div className="mt-8 flex items-center justify-between">
                    <button
                      disabled
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/20 bg-white/5 px-3 py-2 text-sm text-slate-400"
                    >
                      <ArrowLeft className="size-4" /> Prev
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      disabled={!plan}
                      className="group inline-flex items-center gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm font-medium text-indigo-200 backdrop-blur-md transition hover:border-indigo-300/50 hover:bg-indigo-400/15 hover:text-indigo-100 disabled:opacity-60"
                    >
                      Next{" "}
                      <ArrowRight className="size-4 -translate-x-0 transition group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </DirectionalCard>
              )}

              {/* Step 2: Generate + Validate */}
              {step === 2 && (
                <DirectionalCard>
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
                    <span className="size-1.5 rounded-full bg-emerald-400" />{" "}
                    Step 2 • Generate & Validate
                  </div>

                  <h2 className="text-3xl font-semibold leading-tight text-slate-50 md:text-5xl">
                    Build the site
                  </h2>
                  <p className="mt-3 max-w-prose text-slate-300/90 md:text-lg">
                    Two steps: we\'ll generate code and then validate it for
                    basic correctness.
                  </p>

                  <div className="mt-6 grid gap-3">
                    <button
                      disabled={loading || !plan}
                      onClick={generateAndValidate}
                      className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm font-medium text-indigo-200 backdrop-blur-md transition hover:border-indigo-300/50 hover:bg-indigo-400/15 hover:text-indigo-100 disabled:opacity-60"
                    >
                      {loading
                        ? "Working… (Generate + Validate)"
                        : "Generate Code → Validate Code"}
                    </button>

                    {files.length > 0 && (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <h3 className="text-lg font-semibold text-slate-100">
                          Artifacts
                        </h3>
                        <ul className="mt-2 space-y-1 text-sm text-slate-300">
                          {files.map((f) => (
                            <li
                              key={f.path}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="truncate">{f.path}</span>
                              <button
                                onClick={() => openPreview(f.path)}
                                className="text-indigo-300 hover:text-indigo-200 text-xs"
                              >
                                Preview
                              </button>
                            </li>
                          ))}
                        </ul>

                        {validation && (
                          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                            <div className="font-medium text-slate-200">
                              Validation:{" "}
                              {validation.ok ? "OK" : "Issues found"}
                            </div>
                            {!validation.ok && validation.issues && (
                              <ul className="mt-1 list-disc pl-5 text-slate-300">
                                {validation.issues.map((issue, i) => (
                                  <li key={i}>{issue}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-8 flex items-center justify-between">
                    <button
                      onClick={() => setStep(1)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/20 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
                    >
                      <ArrowLeft className="size-4" /> Prev
                    </button>
                    <button
                      onClick={() => setStep(3)}
                      disabled={files.length === 0}
                      className="group inline-flex items-center gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm font-medium text-indigo-200 backdrop-blur-md transition hover:border-indigo-300/50 hover:bg-indigo-400/15 hover:text-indigo-100 disabled:opacity-60"
                    >
                      Next{" "}
                      <ArrowRight className="size-4 -translate-x-0 transition group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </DirectionalCard>
              )}

              {/* Step 3: Ready + Preview / Download */}
              {step === 3 && (
                <DirectionalCard>
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
                    <span className="size-1.5 rounded-full bg-emerald-400" />{" "}
                    Step 3 • Ready
                  </div>

                  <h2 className="text-3xl font-semibold leading-tight text-slate-50 md:text-5xl">
                    Your site is ready ✨
                  </h2>
                  <p className="mt-3 max-w-prose text-slate-300/90 md:text-lg">
                    You can preview it right away or download a zip of the
                    files.
                  </p>

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => openPreview("index.html")}
                      disabled={files.length === 0}
                      className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200 hover:border-emerald-300/50 hover:bg-emerald-400/15 disabled:opacity-60"
                    >
                      <Eye className="size-4" /> Preview website
                    </button>

                    <button
                      onClick={downloadZip}
                      disabled={files.length === 0}
                      className="inline-flex items-center gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm font-medium text-indigo-200 hover:border-indigo-300/50 hover:bg-indigo-400/15 disabled:opacity-60"
                    >
                      <Download className="size-4" /> Download zip
                    </button>

                    <button
                      onClick={() => setStep(1)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
                    >
                      Start over
                    </button>
                  </div>

                  {/* Overlay preview */}
                  {previewSrc && (
                    <div className="fixed inset-0 z-50 bg-black/70 p-6">
                      <div className="mx-auto h-full max-w-5xl">
                        <div className="mb-3 flex items-center justify-between text-slate-200">
                          <div className="inline-flex items-center gap-2">
                            <Eye className="size-4" /> Live preview
                          </div>
                          <button
                            onClick={() => setPreviewSrc(null)}
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm hover:bg-white/10"
                          >
                            Close
                          </button>
                        </div>
                        <iframe
                          src={previewSrc}
                          className="h-[calc(100%-2rem)] w-full rounded-2xl border border-white/10 bg-white"
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-8 flex items-center justify-between">
                    <button
                      onClick={() => setStep(2)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/20 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
                    >
                      <ArrowLeft className="size-4" /> Prev
                    </button>
                    <button
                      onClick={() => setStep(3)}
                      className="group inline-flex items-center gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm font-medium text-indigo-200"
                    >
                      Done
                    </button>
                  </div>
                </DirectionalCard>
              )}
            </div>
          </div>
        </div>

        <footer className="mx-auto mt-6 max-w-3xl text-center text-sm text-slate-400">
          Flow: Plan → Generate → Validate → Preview/Download. (UI-only mock;
          plug in your API later.)
        </footer>
      </div>
    </main>
  );
}
