// ==================================
// /app/page.tsx (AI integrated version)
// ==================================
"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, Download, Eye } from "lucide-react";
import JSZip from "jszip";

const DEFAULT_MODELS = [
  "autobuilder-ai:latest",
  "qwen3:0.6b",
  "qwen3:3b-instruct",
  "qwen3:7b-instruct",
];

// ------------------------------
// Types
// ------------------------------
interface GenResponse {
  files: { path: string; content: string }[];
  validation: { ok: boolean; issues?: string[] };
}

// ------------------------------
// Validation helper
// ------------------------------
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
  const [model, setModel] = useState("autobuilder-ai:latest");
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS);

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [pagePlans, setPagePlans] = useState<string[]>([]);
  const [files, setFiles] = useState<GenResponse["files"]>([]);
  const [validation, setValidation] = useState<
    GenResponse["validation"] | null
  >(null);

  async function callOllamaApi<T extends Record<string, unknown>>(
    action: "plan" | "code",
    payload: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch("/api/ollama", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, model, ...payload }),
    });

    if (!response.ok) {
      const message = (await response.text()) || `${action} request failed`;
      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  useEffect(() => {
    let active = true;
    async function loadModels() {
      try {
        const response = await fetch("/api/ollama", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "models" }),
        });

        if (!response.ok) {
          const message =
            (await response.text()) || "Failed to fetch model list";
          throw new Error(message);
        }

        const payload = (await response.json()) as {
          models?: string[];
        };
        if (!active) return;

        const names = Array.isArray(payload.models)
          ? payload.models
              .map((name) => (typeof name === "string" ? name.trim() : ""))
              .filter((name): name is string => Boolean(name))
          : [];

        const uniqueNames = Array.from(new Set(names));

        if (uniqueNames.length > 0) {
          setModels(uniqueNames);
          setModelsError(null);
          setModel((current) =>
            uniqueNames.includes(current) ? current : uniqueNames[0]
          );
        }
      } catch (error: unknown) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Failed to load models";
        setModelsError(message);
      }
    }

    loadModels();
    return () => {
      active = false;
    };
  }, []);

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
  // Actions
  // ------------------------------
  async function createPlan() {
    setLoading(true);
    setError(null);
    setPagePlans([]);
    try {
      const plans: string[] = [];
      for (let i = 0; i < pageCount; i++) {
        const topicForPage = `${topic} — Page ${i + 1}`;
        const result = await callOllamaApi<{ plan?: string }>("plan", {
          topic: topicForPage,
        });
        if (typeof result.plan === "string") {
          plans.push(result.plan.trim());
        }
      }
      setPagePlans(plans);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create plan(s)";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function generateAndValidate() {
    if (pagePlans.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const outFiles: { path: string; content: string }[] = [];
      for (let i = 0; i < pagePlans.length; i++) {
        const result = await callOllamaApi<{ code?: string }>("code", {
          plan: pagePlans[i],
        });
        if (typeof result.code === "string") {
          outFiles.push({
            path: `page-${i + 1}.html`,
            content: result.code.trim(),
          });
        }
      }
      const val = mockValidate(outFiles);
      setFiles(outFiles);
      setValidation(val);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to generate code";
      setError(message);
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

  function openPreview(path: string) {
    const file = files.find((f) => f.path.endsWith(path)) || files[0];
    if (!file) return;
    const blob = new Blob([file.content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function downloadZip() {
    const zip = new JSZip();
    const folder = zip.folder("site")!;
    files.forEach((f) => folder.file(f.path, f.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "site.zip";
    a.click();
  }

  // ------------------------------
  // UI
  // ------------------------------
  return (
    <main className="min-h-dvh bg-[radial-gradient(1200px_600px_at_50%_-20%,#0b1220_0%,#05080f_60%,#03060d_100%)] text-slate-100 antialiased selection:bg-indigo-400/30">
      <div className="mx-auto max-w-6xl px-4 py-14">
        {header}

        {/* Model selector */}
        <div className="mb-6 flex items-center gap-3">
          <label className="text-sm text-slate-300">AI Model:</label>
          <div className="flex flex-col gap-1">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-slate-100"
            >
              {models.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {modelsError && (
              <span className="text-xs text-red-300">{modelsError}</span>
            )}
          </div>
        </div>

        <div className="relative isolate overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="relative grid min-h-[520px] place-items-center rounded-2xl p-4">
            <div className="relative w-full max-w-3xl">
              {error && (
                <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              {/* Step 1: Plan */}
              {step === 1 && (
                <DirectionalCard>
                  <h2 className="text-3xl font-semibold text-slate-50">
                    What is this website about?
                  </h2>

                  <div className="mt-6 grid gap-3 md:grid-cols-[1fr,140px]">
                    <input
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="Topic"
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100"
                    />
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <label className="text-sm text-slate-300">Pages</label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={pageCount}
                        onChange={(e) => setPageCount(Number(e.target.value))}
                        className="w-16 rounded-md bg-transparent text-center text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <button
                      disabled={loading}
                      onClick={createPlan}
                      className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-200"
                    >
                      {loading ? "Generating…" : "Generate plan"}
                    </button>
                  </div>

                  {pagePlans.length > 0 && (
                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <h3 className="text-lg font-semibold text-slate-100">
                        Page Plans
                      </h3>
                      <ul className="mt-3 space-y-2 text-sm text-slate-300">
                        {pagePlans.map((p, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="font-medium">Page {i + 1}:</span>
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => setStep(2)}
                          className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200"
                        >
                          <Check className="size-4" /> Accept plans
                        </button>
                        <button
                          onClick={() => setPagePlans([])}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200"
                        >
                          Deny & revise
                        </button>
                      </div>
                    </div>
                  )}
                </DirectionalCard>
              )}

              {/* Step 2: Generate + Validate */}
              {step === 2 && (
                <DirectionalCard>
                  <h2 className="text-3xl font-semibold text-slate-50">
                    Build the site
                  </h2>

                  <div className="mt-6 grid gap-3">
                    <button
                      disabled={loading || pagePlans.length === 0}
                      onClick={generateAndValidate}
                      className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-200"
                    >
                      {loading ? "Working…" : "Generate Code → Validate"}
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
                                className="text-indigo-300 text-xs"
                              >
                                Preview
                              </button>
                            </li>
                          ))}
                        </ul>
                        {validation && (
                          <div className="mt-3 text-sm">
                            Validation: {validation.ok ? "OK" : "Issues found"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </DirectionalCard>
              )}

              {/* Step 3: Ready */}
              {step === 3 && (
                <DirectionalCard>
                  <h2 className="text-3xl font-semibold text-slate-50">
                    Your site is ready ✨
                  </h2>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      onClick={() => openPreview("page-1.html")}
                      disabled={files.length === 0}
                      className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200"
                    >
                      <Eye className="size-4" /> Preview
                    </button>
                    <button
                      onClick={downloadZip}
                      disabled={files.length === 0}
                      className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-200"
                    >
                      <Download className="size-4" /> Download zip
                    </button>
                  </div>
                </DirectionalCard>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
