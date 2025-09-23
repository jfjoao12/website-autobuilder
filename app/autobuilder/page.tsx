"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, Download, Eye } from "lucide-react";
import JSZip from "jszip";

const DEFAULT_MODELS = [
  "autobuilder-ai:latest",
  "qwen3:0.6b",
  "qwen3:3b-instruct",
  "qwen3:7b-instruct",
];

type Step = 1 | 2 | 3;

type GeneratedFile = { path: string; content: string };

type ValidationResult = {
  ok: boolean;
  issues?: string[];
};

type LayoutFragments = {
  header: string;
  footer: string;
};

type OllamaAction = "plan" | "models" | "code" | "layout";

async function requestOllama<T extends Record<string, unknown>>(
  model: string,
  action: OllamaAction,
  payload: Record<string, unknown> = {}
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

function mockValidate(files: GeneratedFile[]): ValidationResult {
  const issues: string[] = [];

  files.forEach((file) => {
    if (!file.content.includes("<!doctype html>") || !file.content.includes("<html")) {
      issues.push(`${file.path}: Missing basic HTML structure`);
    }
  });

  return {
    ok: issues.length === 0,
    issues: issues.length ? issues : undefined,
  };
}

function summarizePlan(plan: string) {
  const firstHeading = plan
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^[-*\d]/.test(line));

  return firstHeading?.replace(/^###\s*/, "") ?? plan.slice(0, 64);
}

function appendLayout(html: string, header: string, footer: string) {
  const cleanHeader = header.trim();
  const cleanFooter = footer.trim();

  if (!cleanHeader && !cleanFooter) {
    return html;
  }

  const hasBody = /<body[\s>]/i.test(html);
  const hasHtml = /<html[\s>]/i.test(html);

  let output = html;

  if (hasBody) {
    const headerAlreadyPresent = cleanHeader
      ? output.includes(cleanHeader)
      : false;
    const footerAlreadyPresent = cleanFooter
      ? output.includes(cleanFooter)
      : false;

    if (cleanHeader && !headerAlreadyPresent) {
      let headerInjected = false;
      output = output.replace(/<body([^>]*)>/i, (match, attrs) => {
        headerInjected = true;
        return `<body${attrs}>\n${cleanHeader}\n`;
      });

      if (!headerInjected) {
        output = output.replace(/<body>/i, `<body>\n${cleanHeader}\n`);
      }
    }

    if (cleanFooter && !footerAlreadyPresent) {
      if (/<\/body>/i.test(output)) {
        output = output.replace(/<\/body>/i, `${cleanFooter}\n</body>`);
      } else {
        output = `${output}\n${cleanFooter}`;
      }
    }

    return output;
  }

  const bodyWrapped = [
    cleanHeader,
    output.trim(),
    cleanFooter,
  ]
    .filter((segment) => segment.length > 0)
    .join("\n");

  if (hasHtml) {
    return output.replace(/<html([^>]*)>/i, (match, attrs) => {
      return `<html${attrs}>\n<body>\n${bodyWrapped}\n</body>`;
    });
  }

  return `<html>\n<body>\n${bodyWrapped}\n</body>\n</html>`;
}

function PlanMarkup({ plan }: { plan: string }) {
  const lines = plan.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    const { type, items } = listBuffer;
    const ListTag = type === "ul" ? "ul" : "ol";
    elements.push(
      <ListTag key={`${elements.length}-list`} className="ml-5 list-inside space-y-1">
        {items.map((item, idx) => (
          <li key={`${elements.length}-item-${idx}`} className="leading-relaxed text-slate-300">
            {item}
          </li>
        ))}
      </ListTag>
    );
    listBuffer = null;
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      elements.push(<div key={`${index}-spacer`} className="h-2" />);
      return;
    }

    if (/^###\s+/.test(line)) {
      flushList();
      elements.push(
        <h3 key={`${index}-h3`} className="text-base font-semibold text-indigo-200">
          {line.replace(/^###\s*/, "")}
        </h3>
      );
      return;
    }

    if (/^##\s+/.test(line)) {
      flushList();
      elements.push(
        <h2 key={`${index}-h2`} className="text-lg font-semibold text-slate-100">
          {line.replace(/^##\s*/, "")}
        </h2>
      );
      return;
    }

    if (/^[-*]\s+/.test(line)) {
      const content = line.replace(/^[-*]\s+/, "").trim();
      if (!listBuffer || listBuffer.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [] };
      }
      listBuffer.items.push(content);
      return;
    }

    if (/^\d+\.\s+/.test(line)) {
      const content = line.replace(/^\d+\.\s+/, "").trim();
      if (!listBuffer || listBuffer.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [] };
      }
      listBuffer.items.push(content);
      return;
    }

    flushList();
    elements.push(
      <p key={`${index}-p`} className="text-sm leading-relaxed text-slate-200">
        {line}
      </p>
    );
  });

  flushList();

  return <div className="space-y-2">{elements}</div>;
}

export default function Page() {
  const [step, setStep] = useState<Step>(1);

  const [topic, setTopic] = useState("A stylish portfolio for a creator");
  const [pageCount, setPageCount] = useState(3);
  const [model, setModel] = useState(DEFAULT_MODELS[0]!);
  const [models, setModels] = useState(DEFAULT_MODELS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [pagePlans, setPagePlans] = useState<string[]>([]);
  const [planApprovals, setPlanApprovals] = useState<boolean[]>([]);
  const [expandedPlans, setExpandedPlans] = useState<boolean[]>([]);

  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [layoutFragments, setLayoutFragments] = useState<LayoutFragments | null>(
    null
  );

  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);
  const [activeStreamIndex, setActiveStreamIndex] = useState<number | null>(
    null
  );
  const [streamedCode, setStreamedCode] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [showStreamPanel, setShowStreamPanel] = useState(false);

  const [stepTwoReady, setStepTwoReady] = useState(false);

  const streamControllerRef = useRef<AbortController | null>(null);

  const isStreaming = streamingIndex !== null;
  const allPlansApproved = pagePlans.length > 0 && planApprovals.every(Boolean);

  useEffect(() => {
    let active = true;

    async function loadModels() {
      try {
        const payload = await requestOllama<{ models?: string[] }>(
          model,
          "models"
        );
        if (!active) return;

        const names = Array.isArray(payload.models)
          ? payload.models
              .map((name) => (typeof name === "string" ? name.trim() : ""))
              .filter((name): name is string => Boolean(name))
          : [];

        if (names.length > 0) {
          const uniqueNames = Array.from(new Set(names));
          setModels(uniqueNames);
          setModelsError(null);
          setModel((current) =>
            uniqueNames.includes(current) ? current : uniqueNames[0]!
          );
        }
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Failed to load models";
        setModelsError(message);
      }
    }

    loadModels();

    return () => {
      active = false;
      streamControllerRef.current?.abort();
    };
  }, [model]);

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

  function resetOutputs() {
    streamControllerRef.current?.abort();
    setStreamingIndex(null);
    setActiveStreamIndex(null);
    setStreamedCode("");
    setStreamError(null);
    setShowStreamPanel(false);
    setFiles([]);
    setValidation(null);
    setLayoutFragments(null);
    setStepTwoReady(false);
  }

  async function createPlan() {
    resetOutputs();
    setStep(1);
    setLoading(true);
    setError(null);
    setPagePlans([]);

    try {
      const result = await requestOllama<{ plans?: string[] }>(model, "plan", {
        topic,
        pageCount,
      });

      if (!Array.isArray(result.plans) || result.plans.length === 0) {
        throw new Error("Plan generation failed");
      }

      const trimmedPlans = result.plans.map((plan) => plan.trim());
      setPagePlans(trimmedPlans);
      setPlanApprovals(new Array(trimmedPlans.length).fill(false));
      setExpandedPlans(new Array(trimmedPlans.length).fill(false));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create plan";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function generateAndValidate() {
    if (pagePlans.length === 0) return;

    streamControllerRef.current?.abort();
    setStreamingIndex(null);
    setStreamError(null);
    setStepTwoReady(false);

    setLoading(true);
    setError(null);

    try {
      const generated: GeneratedFile[] = [];

      for (let i = 0; i < pagePlans.length; i++) {
        const result = await requestOllama<{ code?: string }>(model, "code", {
          plan: pagePlans[i],
          allPlans: pagePlans,
          pageIndex: i,
        });

        const code = typeof result.code === "string" ? result.code.trim() : "";
        if (!code) {
          throw new Error(`Code generation failed for page ${i + 1}`);
        }

        generated.push({
          path: `page-${i + 1}.html`,
          content: code,
        });
      }

      const layout = await requestOllama<{ header?: string; footer?: string }>(
        model,
        "layout",
        { plans: pagePlans }
      );

      const headerFragment = layout?.header?.trim?.() ?? "";
      const footerFragment = layout?.footer?.trim?.() ?? "";

      if (!headerFragment || !footerFragment) {
        throw new Error("Layout generation failed");
      }

      const withLayout = generated.map((file) => ({
        path: file.path,
        content: appendLayout(file.content, headerFragment, footerFragment),
      }));

      setFiles(withLayout);
      setLayoutFragments({ header: headerFragment, footer: footerFragment });
      setValidation(mockValidate(withLayout));
      setStepTwoReady(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate code";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function streamCodePreview(index: number) {
    const plan = pagePlans[index];
    if (!plan) return;

    streamControllerRef.current?.abort();
    const controller = new AbortController();
    streamControllerRef.current = controller;

    setStreamError(null);
    setStreamingIndex(index);
    setActiveStreamIndex(index);
    setStreamedCode("");
    setValidation(null);

    let aggregated = "";
    let completed = false;

    try {
      const response = await fetch("/api/ollama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "code-stream",
          model,
          plan,
          allPlans: pagePlans,
          pageIndex: index,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const message =
          (await response.text()) || "Streaming request failed";
        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          aggregated += chunk;
          setStreamedCode(aggregated);
        }
      }

      const finalFlush = decoder.decode();
      if (finalFlush) {
        aggregated += finalFlush;
      }

      aggregated = aggregated.trim();
      if (aggregated.length === 0) {
        throw new Error("No code returned by the model");
      }

      if (layoutFragments) {
        aggregated = appendLayout(
          aggregated,
          layoutFragments.header,
          layoutFragments.footer
        );
      }

      completed = true;
      setStreamedCode(aggregated);
      setFiles((prev) => {
        const next = [...prev];
        next[index] = {
          path: `page-${index + 1}.html`,
          content: aggregated,
        };
        return next;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // streaming cancelled by user
      } else {
        const message = err instanceof Error ? err.message : "Failed to stream code";
        setStreamError(message);
        if (aggregated.trim().length === 0) {
          setActiveStreamIndex(null);
        }
      }
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
      setStreamingIndex(null);

      if (!completed && aggregated.trim().length > 0) {
        setStreamedCode(aggregated.trim());
      }
    }
  }

  function stopStreaming() {
    streamControllerRef.current?.abort();
  }

  function openPreview(path: string) {
    const file = files.find((f) => f.path === path) ?? files[0];
    if (!file) return;

    const blob = new Blob([file.content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function downloadZip() {
    const zip = new JSZip();
    const folder = zip.folder("site");
    if (!folder) return;

    files.forEach((file) => {
      if (!file?.content) return;
      folder.file(file.path, file.content);
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "site.zip";
    a.click();
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(1200px_600px_at_50%_-20%,#0b1220_0%,#05080f_60%,#03060d_100%)] text-slate-100 antialiased selection:bg-indigo-400/30">
      <div className="mx-auto max-w-6xl px-4 py-14">
        {header}

        <div className="mb-6 flex items-center gap-3">
          <label className="text-sm text-slate-300">AI Model:</label>
          <div className="flex flex-col gap-1">
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
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

              <DirectionalCard step={step} variants={variants}>
                {step === 1 && (
                  <StepOne
                    topic={topic}
                    setTopic={setTopic}
                    pageCount={pageCount}
                    setPageCount={setPageCount}
                    loading={loading}
                    onGenerate={createPlan}
                    pagePlans={pagePlans}
                    planApprovals={planApprovals}
                    expandedPlans={expandedPlans}
                    onToggleExpand={(index) =>
                      setExpandedPlans((prev) => {
                        const next = [...prev];
                        next[index] = !next[index];
                        return next;
                      })
                    }
                    onApprovePlan={(index) =>
                      setPlanApprovals((prev) => {
                        const next = [...prev];
                        next[index] = true;
                        return next;
                      })
                    }
                    onUndoPlan={(index) =>
                      setPlanApprovals((prev) => {
                        const next = [...prev];
                        next[index] = false;
                        return next;
                      })
                    }
                    canProceed={allPlansApproved}
                    onNext={() => setStep(2)}
                  />
                )}

                {step === 2 && (
                  <StepTwo
                    loading={loading}
                    isStreaming={isStreaming}
                    showStreamPanel={showStreamPanel}
                    pagePlans={pagePlans}
                    activeStreamIndex={activeStreamIndex}
                    streamingIndex={streamingIndex}
                    streamError={streamError}
                    streamedCode={streamedCode}
                    files={files}
                    validation={validation}
                    layoutFragments={layoutFragments}
                    stepTwoReady={stepTwoReady}
                    onGenerateAll={generateAndValidate}
                    onStream={streamCodePreview}
                    onStopStreaming={stopStreaming}
                    onPreview={openPreview}
                    onNext={() => setStep(3)}
                  />
                )}

                {step === 3 && (
                  <StepThree
                    files={files}
                    layoutFragments={layoutFragments}
                    onPreview={openPreview}
                    onDownload={downloadZip}
                  />
                )}
              </DirectionalCard>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              if (step >= 2) {
                setShowStreamPanel((prev) => !prev);
              }
            }}
            disabled={step < 2}
            className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-5 py-2 text-sm text-indigo-200 disabled:opacity-40"
          >
            {showStreamPanel ? "Hide live AI stream" : "View live AI stream"}
          </button>
          {step < 2 && (
            <p className="mt-2 text-xs text-slate-400">
              Accept all plans and press Next to unlock live code streaming.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function DirectionalCard({
  children,
  step,
  variants,
}: {
  children: React.ReactNode;
  step: Step;
  variants: Variants;
}) {
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

function StepOne({
  topic,
  setTopic,
  pageCount,
  setPageCount,
  loading,
  onGenerate,
  pagePlans,
  planApprovals,
  expandedPlans,
  onToggleExpand,
  onApprovePlan,
  onUndoPlan,
  canProceed,
  onNext,
}: {
  topic: string;
  setTopic: (value: string) => void;
  pageCount: number;
  setPageCount: (value: number) => void;
  loading: boolean;
  onGenerate: () => Promise<void>;
  pagePlans: string[];
  planApprovals: boolean[];
  expandedPlans: boolean[];
  onToggleExpand: (index: number) => void;
  onApprovePlan: (index: number) => void;
  onUndoPlan: (index: number) => void;
  canProceed: boolean;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-3xl font-semibold text-slate-50">
        What is this website about?
      </h2>

      <div className="mt-6 grid gap-3 md:grid-cols-[1fr,140px]">
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
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
            onChange={(event) => setPageCount(Number(event.target.value))}
            className="w-16 rounded-md bg-transparent text-center text-slate-100"
          />
        </div>
      </div>

      <div className="mt-4">
        <button
          disabled={loading}
          onClick={onGenerate}
          className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-200"
        >
          {loading ? "Generating…" : "Generate plan"}
        </button>
      </div>

      {pagePlans.length > 0 && (
        <div className="mt-6 space-y-3">
          {pagePlans.map((plan, index) => {
            const accepted = planApprovals[index];
            const expanded = expandedPlans[index];
            const summary = summarizePlan(plan);

            return (
              <div
                key={index}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <button
                  type="button"
                  onClick={() => onToggleExpand(index)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Page {index + 1}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-100">
                      {summary}
                    </p>
                  </div>
                  <span className="text-xs text-indigo-200">
                    {expanded ? "Collapse" : "Expand"}
                  </span>
                </button>

                {expanded && (
                  <div className="mt-4 space-y-4">
                    <PlanMarkup plan={plan} />
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => onApprovePlan(index)}
                        disabled={accepted}
                        className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200 disabled:opacity-60"
                      >
                        {accepted ? "Accepted" : "Accept"}
                      </button>
                      {accepted && (
                        <button
                          onClick={() => onUndoPlan(index)}
                          className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-200"
                        >
                          Undo
                        </button>
                      )}
                      {accepted && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                          <Check className="size-3" /> Approved
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-5 py-2 text-sm text-indigo-200 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function StepTwo({
  loading,
  isStreaming,
  showStreamPanel,
  pagePlans,
  activeStreamIndex,
  streamingIndex,
  streamError,
  streamedCode,
  files,
  validation,
  layoutFragments,
  stepTwoReady,
  onGenerateAll,
  onStream,
  onStopStreaming,
  onPreview,
  onNext,
}: {
  loading: boolean;
  isStreaming: boolean;
  showStreamPanel: boolean;
  pagePlans: string[];
  activeStreamIndex: number | null;
  streamingIndex: number | null;
  streamError: string | null;
  streamedCode: string;
  files: GeneratedFile[];
  validation: ValidationResult | null;
  layoutFragments: LayoutFragments | null;
  stepTwoReady: boolean;
  onGenerateAll: () => Promise<void>;
  onStream: (index: number) => Promise<void>;
  onStopStreaming: () => void;
  onPreview: (path: string) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-3xl font-semibold text-slate-50">Build the site</h2>

      <div className="mt-6 grid gap-4">
        <button
          disabled={loading || pagePlans.length === 0 || isStreaming}
          onClick={onGenerateAll}
          className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-200"
        >
          {loading ? "Working…" : "Generate Code → Validate"}
        </button>

        {!showStreamPanel && (
          <p className="text-sm text-slate-400">
            Use the “View live AI stream” toggle below once you are ready to monitor
            generation in real time.
          </p>
        )}

        {showStreamPanel && pagePlans.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">
                  Live code stream
                </h3>
                <p className="text-xs text-slate-400">
                  Pick a page to watch its HTML (without header/footer) render in real time.
                </p>
              </div>
              {isStreaming && (
                <button
                  onClick={onStopStreaming}
                  className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs text-red-200"
                >
                  Stop streaming
                </button>
              )}
            </div>

            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {pagePlans.map((planText, index) => {
                const descriptor = summarizePlan(planText);
                const isActive = activeStreamIndex === index;
                const label = isStreaming
                  ? streamingIndex === index
                    ? "Streaming…"
                    : "Busy"
                  : "Stream code";

                return (
                  <li
                    key={index}
                    className={`flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2 ${
                      isActive ? "border-indigo-400/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-slate-200">
                        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          Page {index + 1}
                        </span>
                        {isActive && !isStreaming && (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                            Last streamed
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-400">{descriptor}</p>
                    </div>
                    <button
                      onClick={() => onStream(index)}
                      disabled={loading || isStreaming}
                      className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200 disabled:opacity-50"
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>

            {streamError && (
              <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {streamError}
              </div>
            )}

            {(streamedCode || isStreaming) && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Output
                    {activeStreamIndex !== null
                      ? ` • Page ${activeStreamIndex + 1}`
                      : ""}
                  </span>
                  {isStreaming && <span className="text-indigo-200">Streaming…</span>}
                </div>
                <pre className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-4 text-[11px] leading-relaxed text-emerald-100 whitespace-pre-wrap">
                  {streamedCode || "Waiting for the model…"}
                </pre>
              </div>
            )}
          </div>
        )}

        {layoutFragments && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-semibold text-slate-100">Shared header & footer</h3>
            <p className="mt-1 text-xs text-slate-400">
              Generated once and appended to every page for a consistent experience.
            </p>
            <details className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-slate-300">
              <summary className="cursor-pointer text-indigo-200">Preview fragments</summary>
              <div className="mt-3 space-y-3 whitespace-pre-wrap break-words">
                <div>
                  <p className="font-semibold text-slate-200">Header</p>
                  <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-black/50 p-3 text-[11px] text-emerald-100">
                    {layoutFragments.header}
                  </pre>
                </div>
                <div>
                  <p className="font-semibold text-slate-200">Footer</p>
                  <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-black/50 p-3 text-[11px] text-emerald-100">
                    {layoutFragments.footer}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        )}

        {files.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-semibold text-slate-100">Artifacts</h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              {files.map((file) => (
                <li key={file.path} className="flex items-center justify-between gap-3">
                  <span className="truncate">{file.path}</span>
                  <button
                    onClick={() => onPreview(file.path)}
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

        <div className="mt-4 flex justify-end">
          <button
            onClick={onNext}
            disabled={!stepTwoReady}
            className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-2 text-sm text-emerald-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function StepThree({
  files,
  layoutFragments,
  onPreview,
  onDownload,
}: {
  files: GeneratedFile[];
  layoutFragments: LayoutFragments | null;
  onPreview: (path: string) => void;
  onDownload: () => Promise<void>;
}) {
  return (
    <div>
      <h2 className="text-3xl font-semibold text-slate-50">
        Your site is ready ✨
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        Each page includes the shared header and footer for a cohesive experience.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={() => onPreview("page-1.html")}
          disabled={files.length === 0}
          className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200 disabled:opacity-60"
        >
          <Eye className="size-4" /> Preview first page
        </button>
        <button
          onClick={onDownload}
          disabled={files.length === 0}
          className="rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-200 disabled:opacity-60"
        >
          <Download className="size-4" /> Download zip
        </button>
      </div>

      {layoutFragments && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-lg font-semibold text-slate-100">Shared layout recap</h3>
          <p className="mt-1 text-xs text-slate-400">
            These fragments were appended to every HTML document.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
                Header
              </p>
              <pre className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/60 p-3 text-[11px] text-emerald-100 whitespace-pre-wrap">
                {layoutFragments.header}
              </pre>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
                Footer
              </p>
              <pre className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/60 p-3 text-[11px] text-emerald-100 whitespace-pre-wrap">
                {layoutFragments.footer}
              </pre>
            </div>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-lg font-semibold text-slate-100">Pages</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {files.map((file) => (
              <li key={file.path} className="flex items-center justify-between gap-3">
                <span className="truncate">{file.path}</span>
                <button
                  onClick={() => onPreview(file.path)}
                  className="text-indigo-300 text-xs"
                >
                  Preview
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
