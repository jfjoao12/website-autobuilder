"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, Download, Eye } from "lucide-react";
import JSZip from "jszip";

const DEFAULT_MODELS = [
  "autobuilder-ai:latest",
  "qwen3:0.6b",
  "qwen3:3b-instruct",
  "qwen3:7b-instruct",
];

const STEP_LABELS: Record<Step, string> = {
  1: "Plan",
  2: "Build",
  3: "Layout",
  4: "Review",
};

const TOTAL_STEPS = 4;

type Step = 1 | 2 | 3 | 4;

type GeneratedFile = { path: string; content: string };

type ValidationResult = {
  ok: boolean;
  issues?: string[];
};

type LayoutFragments = {
  header: string;
  footer: string;
};

type OllamaAction = "plan" | "models" | "code" | "layout" | "plan-page";

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
    if (
      !file.content.includes("<!doctype html>") ||
      !file.content.includes("<html")
    ) {
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

  const bodyWrapped = [cleanHeader, output.trim(), cleanFooter]
    .filter((segment) => segment.length > 0)
    .join("\n");

  if (hasHtml) {
    return output.replace(/<html([^>]*)>/i, (match, attrs) => {
      return `<html${attrs}>\n<body>\n${bodyWrapped}\n</body>`;
    });
  }

  return `<html>\n<body>\n${bodyWrapped}\n</body>\n</html>`;
}

function sanitizeGeneratedCode(code: string) {
  let output = code.trim();

  if (output.startsWith("```") && output.endsWith("```")) {
    output = output.replace(/^```[a-zA-Z0-9-]*\s*/, "").replace(/```$/, "");
  }

  output = output.replace(/```html\s*/gi, "");

  return output.trim();
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
      <ListTag
        key={`${elements.length}-list`}
        className="ml-5 list-inside space-y-1"
      >
        {items.map((item, idx) => (
          <li
            key={`${elements.length}-item-${idx}`}
            className="leading-relaxed text-slate-300"
          >
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
        <h3
          key={`${index}-h3`}
          className="text-base font-semibold text-indigo-200"
        >
          {line.replace(/^###\s*/, "")}
        </h3>
      );
      return;
    }

    if (/^##\s+/.test(line)) {
      flushList();
      elements.push(
        <h2
          key={`${index}-h2`}
          className="text-lg font-semibold text-slate-100"
        >
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
      <p
        key={`${index}-p`}
        className="text-sm leading-relaxed text-slate-200 tracking-wide font-medium"
      >
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

  // Add a beautiful animated gradient background
  const gradientVariants: Variants = {
    animate: {
      background: [
        "linear-gradient(45deg, #2563eb, #3b82f6, #60a5fa)",
        "linear-gradient(45deg, #7c3aed, #8b5cf6, #a78bfa)",
        "linear-gradient(45deg, #2563eb, #3b82f6, #60a5fa)",
      ],
      transition: {
        duration: 10,
        repeat: Infinity,
        ease: "linear",
      },
    },
  };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [pagePlans, setPagePlans] = useState<string[]>([]);
  const [planApprovals, setPlanApprovals] = useState<boolean[]>([]);
  const [expandedPlanIndex, setExpandedPlanIndex] = useState<number | null>(
    null
  );
  const [editingPlanIndex, setEditingPlanIndex] = useState<number | null>(null);
  const [planLoadingIndex, setPlanLoadingIndex] = useState<number | null>(null);

  const [draftFiles, setDraftFiles] = useState<GeneratedFile[]>([]);
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [layoutFragments, setLayoutFragments] =
    useState<LayoutFragments | null>(null);
  const [sandboxPath, setSandboxPath] = useState<string | null>(null);

  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);
  const [activeStreamIndex, setActiveStreamIndex] = useState<number | null>(
    null
  );
  const [streamedCode, setStreamedCode] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [showStreamPanel, setShowStreamPanel] = useState(false);
  const [streamPanelDetached, setStreamPanelDetached] = useState(false);
  const [streamPanelPosition, setStreamPanelPosition] = useState({
    x: 80,
    y: 80,
  });
  const [streamPanelSize, setStreamPanelSize] = useState({
    width: 480,
    height: 340,
  });

  const [codeReady, setCodeReady] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
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
        const message =
          err instanceof Error ? err.message : "Failed to load models";
        setModelsError(message);
      }
    }

    loadModels();

    return () => {
      active = false;
      streamControllerRef.current?.abort();
    };
  }, [model]);

  useEffect(() => {
    if (files.length === 0) {
      setSandboxPath(null);
      return;
    }

    setSandboxPath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }
      return files[0]?.path ?? null;
    });
  }, [files]);

  const variants: Variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 60 : -60,
      opacity: 0,
      scale: 0.95,
      filter: "blur(8px)",
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: {
        type: "spring",
        stiffness: 420,
        damping: 38,
        mass: 0.8,
      },
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -60 : 60,
      opacity: 0,
      scale: 0.95,
      filter: "blur(8px)",
      transition: {
        type: "spring",
        stiffness: 360,
        damping: 34,
        mass: 0.8,
      },
    }),
    hover: {
      scale: 1.02,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 25,
      },
    },
  };

  const header = useMemo(
    () => (
      <header className="mb-10 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shadow-lg ring-1 ring-white/20" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300 font-medium">
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
    setStreamPanelDetached(false);
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
    setValidation(null);
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
      setExpandedPlanIndex(0); // Open the first plan by default
      setEditingPlanIndex(null);
      setPlanLoadingIndex(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create plan";
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
        const raw = await streamCodeForPage(i, pagePlans[i], {
          applyLayout: false,
          updateFiles: false,
          resetValidation: i === 0,
          context: {
            topic,
            plan: pagePlans[i],
            pageNumber: i + 1,
            totalPages: pagePlans.length,
          },
        });
        if (!raw) {
          throw new Error(`Code generation failed for page ${i + 1}`);
        }

        generated.push({
          path: `page-${i + 1}.html`,
          content: raw,
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
      setStreamedCode(withLayout[withLayout.length - 1]?.content ?? "");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate code";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStreamPreview(index: number) {
    const plan = pagePlans[index];
    if (!plan) return;

    try {
      await streamCodeForPage(index, plan, {
        applyLayout: Boolean(layoutFragments),
        updateFiles: true,
        resetValidation: true,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof Error ? err.message : "Failed to stream code";
      setError(message);
    }
  }

  async function streamCodeForPage(
    index: number,
    plan: string,
    options: {
      applyLayout?: boolean;
      updateFiles?: boolean;
      resetValidation?: boolean;
      context?: {
        topic: string;
        plan: string;
        pageNumber: number;
        totalPages: number;
      };
    } = {}
  ) {
    const {
      applyLayout = true,
      updateFiles = true,
      resetValidation = false,
    } = options;

    if (!plan) return "";

    // Include the website idea in the context
    const context = {
      topic,
      plan,
      pageNumber: index + 1,
      totalPages: pagePlans.length,
    };

    streamControllerRef.current?.abort();
    const controller = new AbortController();
    streamControllerRef.current = controller;

    setStreamError(null);
    setStreamingIndex(index);
    setActiveStreamIndex(index);
    setStreamedCode("");
    if (resetValidation) {
      setValidation(null);
    }

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
        const message = (await response.text()) || "Streaming request failed";
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

      aggregated = sanitizeGeneratedCode(aggregated);
      if (aggregated.length === 0) {
        throw new Error("No code returned by the model");
      }

      if (applyLayout && layoutFragments) {
        aggregated = appendLayout(
          aggregated,
          layoutFragments.header,
          layoutFragments.footer
        );
      }

      completed = true;

      if (updateFiles) {
        setFiles((prev) => {
          const next = [...prev];
          next[index] = {
            path: `page-${index + 1}.html`,
            content: aggregated,
          };
          return next;
        });
      }

      setStreamedCode(aggregated);
      return aggregated;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // streaming cancelled by user
      } else {
        const message =
          err instanceof Error ? err.message : "Failed to stream code";
        setStreamError(message);
        if (aggregated.trim().length === 0) {
          setActiveStreamIndex(null);
        }
      }
      throw err;
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

  function updatePlanText(index: number, value: string) {
    setPagePlans((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });

    setPlanApprovals((prev) => {
      const next = [...prev];
      next[index] = false;
      return next;
    });
  }

  async function regeneratePlan(index: number) {
    if (!pagePlans[index]) return;
    setPlanLoadingIndex(index);
    try {
      const payload = await requestOllama<{ plan?: string }>(
        model,
        "plan-page",
        {
          plans: pagePlans,
          pageIndex: index,
        }
      );

      if (!payload.plan || typeof payload.plan !== "string") {
        throw new Error("Plan regeneration failed");
      }

      setPagePlans((prev) => {
        const next = [...prev];
        next[index] = payload.plan?.trim() ?? "";
        return next;
      });

      setPlanApprovals((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Regeneration failed";
      setError(message);
    } finally {
      setPlanLoadingIndex((current) => (current === index ? null : current));
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

        <div className="relative isolate overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-2xl shadow-black/30 backdrop-blur-xl mx-auto max-w-4xl">
          <div className="relative grid min-h-[520px] place-items-center rounded-2xl p-4">
            <div className="relative w-full">
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
                    expandedPlanIndex={expandedPlanIndex}
                    editingPlanIndex={editingPlanIndex}
                    setEditingPlanIndex={setEditingPlanIndex}
                    onToggleExpand={(index) =>
                      setExpandedPlanIndex(
                        expandedPlanIndex === index ? null : index
                      )
                    }
                    onApprovePlan={(index) =>
                      setPlanApprovals((prev) => {
                        const next = [...prev];
                        next[index] = !next[index];
                        return next;
                      })
                    }
                    onChangePlan={updatePlanText}
                    onRegeneratePlan={regeneratePlan}
                    regeneratingIndex={planLoadingIndex}
                    canProceed={allPlansApproved}
                    onNext={() => setStep(2)}
                  />
                )}

                {step === 2 && (
                  <StepTwo
                    loading={loading}
                    isStreaming={isStreaming}
                    pagePlans={pagePlans}
                    files={files}
                    validation={validation}
                    layoutFragments={layoutFragments}
                    stepTwoReady={stepTwoReady}
                    onGenerateAll={generateAndValidate}
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
            className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-5 py-2 text-sm text-indigo-200 disabled:opacity-40 hover:bg-indigo-400/20 hover:border-indigo-400/50 transition-all duration-300 transform hover:scale-105 active:scale-95"
          >
            {showStreamPanel ? "Hide live AI stream" : "View live AI stream"}
          </button>
          {step < 2 && (
            <p className="mt-2 text-xs text-slate-400">
              Accept all plans and press Next to unlock live code streaming.
            </p>
          )}
        </div>

        <StreamConsole
          visible={showStreamPanel}
          detached={streamPanelDetached}
          position={streamPanelPosition}
          size={streamPanelSize}
          onMove={setStreamPanelPosition}
          onResize={setStreamPanelSize}
          onDetachToggle={() => setStreamPanelDetached((prev) => !prev)}
          isStreaming={isStreaming}
          pagePlans={pagePlans}
          activeStreamIndex={activeStreamIndex}
          streamingIndex={streamingIndex}
          streamError={streamError}
          streamedCode={streamedCode}
          onStream={handleStreamPreview}
          onStopStreaming={stopStreaming}
        />

        <SandboxPreview
          files={files}
          selectedPath={sandboxPath}
          onSelect={setSandboxPath}
        />
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
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-800/90 via-slate-900/95 to-slate-950 backdrop-blur-xl p-8 md:p-10 shadow-[0px_20px_60px_rgba(0,0,0,0.45)] hover:shadow-indigo-500/10 transition-all duration-500 transform hover:scale-[1.02] hover:border-indigo-500/20"
      >
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.25em] font-medium">
            <span className="text-indigo-300">{STEP_LABELS[step]}</span>
            <span className="text-slate-400 bg-slate-800/50 px-3 py-1 rounded-full">
              Step {step} of {TOTAL_STEPS}
            </span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/10 ring-1 ring-white/20">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shadow-lg shadow-indigo-500/20"
            />
          </div>
        </div>
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
  expandedPlanIndex,
  onToggleExpand,
  onApprovePlan,
  onChangePlan,
  onRegeneratePlan,
  regeneratingIndex,
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
  expandedPlanIndex: number | null;
  editingPlanIndex: number | null;
  setEditingPlanIndex: (index: number | null) => void;
  onToggleExpand: (index: number) => void;
  onApprovePlan: (index: number) => void;
  onChangePlan: (index: number, value: string) => void;
  onRegeneratePlan: (index: number) => Promise<void> | void;
  regeneratingIndex: number | null;
  canProceed: boolean;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-300 tracking-tight">
        What is this website about?
      </h2>

      <div className="mt-6 grid gap-3 md:grid-cols-[1fr,140px]">
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Topic"
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100 backdrop-blur-lg focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all duration-300 outline-none"
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
            const isExpanded = expandedPlanIndex === index;
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
                  <motion.span
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    className="text-xs text-indigo-200"
                  >
                    {isExpanded ? "Collapse" : "Expand"}
                  </motion.span>
                </button>

                {isExpanded && (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        Formatted plan
                      </p>
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/60 p-4 text-sm text-slate-200">
                        <PlanMarkup plan={plan} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">
                        Revise plan
                      </label>
                      <textarea
                        value={plan}
                        onChange={(event) =>
                          onChangePlan(index, event.target.value)
                        }
                        className="mt-2 min-h-32 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 shadow-inner focus:border-indigo-400 focus:outline-none"
                      />
                    </div>

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
                          onClick={() => onRegeneratePlan(index)}
                          className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-200"
                        >
                          Undo
                        </button>
                      )}
                      <button
                        onClick={() => onRegeneratePlan(index)}
                        disabled={regeneratingIndex === index}
                        className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200 disabled:opacity-60"
                      >
                        {regeneratingIndex === index
                          ? "Regenerating…"
                          : "Regenerate"}
                      </button>
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
  pagePlans,
  files,
  validation,
  layoutFragments,
  stepTwoReady,
  onGenerateAll,
  onPreview,
  onNext,
}: {
  loading: boolean;
  isStreaming: boolean;
  pagePlans: string[];
  files: GeneratedFile[];
  validation: ValidationResult | null;
  layoutFragments: LayoutFragments | null;
  stepTwoReady: boolean;
  onGenerateAll: () => Promise<void>;
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

        {!pagePlans.length && (
          <p className="text-sm text-slate-400">
            Capture a plan in step one to begin generating pages.
          </p>
        )}

        {pagePlans.length > 0 && (
          <p className="text-sm text-slate-400">
            The live streaming console below tracks generation in real time. You
            can detach it if you prefer a floating window.
          </p>
        )}

        {layoutFragments && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-lg font-semibold text-slate-100">
              Shared header & footer
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Generated once and appended to every page for a consistent
              experience.
            </p>
            <details className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-slate-300">
              <summary className="cursor-pointer text-indigo-200">
                Preview fragments
              </summary>
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
                <li
                  key={file.path}
                  className="flex items-center justify-between gap-3"
                >
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
        Each page includes the shared header and footer for a cohesive
        experience.
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
          <h3 className="text-lg font-semibold text-slate-100">
            Shared layout recap
          </h3>
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
              <li
                key={file.path}
                className="flex items-center justify-between gap-3"
              >
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

type StreamConsoleProps = {
  visible: boolean;
  detached: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onMove: (next: { x: number; y: number }) => void;
  onResize: (next: { width: number; height: number }) => void;
  onDetachToggle: () => void;
  isStreaming: boolean;
  pagePlans: string[];
  activeStreamIndex: number | null;
  streamingIndex: number | null;
  streamError: string | null;
  streamedCode: string;
  onStream: (index: number) => Promise<void>;
  onStopStreaming: () => void;
};

function StreamConsole({
  visible,
  detached,
  position,
  size,
  onMove,
  onResize,
  onDetachToggle,
  isStreaming,
  pagePlans,
  activeStreamIndex,
  streamingIndex,
  streamError,
  streamedCode,
  onStream,
  onStopStreaming,
}: StreamConsoleProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
  function clampSize(width: number, height: number) {
    const minWidth = 320;
    const minHeight = 200;
    const maxWidth = window.innerWidth - 40;
    const maxHeight = window.innerHeight - 40;
    return {
      width: Math.min(Math.max(width, minWidth), maxWidth),
      height: Math.min(Math.max(height, minHeight), maxHeight),
    };
  }

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const state = dragState.current;
      if (!state) return;

      if (state.mode === "move") {
        const panelWidth = panelRef.current?.offsetWidth ?? size.width;
        const panelHeight = panelRef.current?.offsetHeight ?? size.height;
        const nextX = state.originX + (event.clientX - state.startX);
        const nextY = state.originY + (event.clientY - state.startY);
        const clampedX = Math.min(
          Math.max(nextX, 0),
          window.innerWidth - panelWidth - 24
        );
        const clampedY = Math.min(
          Math.max(nextY, 0),
          window.innerHeight - panelHeight - 24
        );
        onMove({ x: clampedX, y: clampedY });
      } else {
        const nextWidth = state.originWidth + (event.clientX - state.startX);
        const nextHeight = state.originHeight + (event.clientY - state.startY);
        onResize(clampSize(nextWidth, nextHeight));
      }
    },
    [onMove, onResize, size.height, size.width]
  );

  const handlePointerUp = useCallback(() => {
    dragState.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  if (!visible) {
    return null;
  }

  function startInteraction(
    event: React.PointerEvent<HTMLDivElement>,
    mode: "move" | "resize"
  ) {
    if (!detached) return;
    event.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    dragState.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect ? rect.left : position.x,
      originY: rect ? rect.top : position.y,
      originWidth: rect ? rect.width : size.width,
      originHeight: rect ? rect.height : size.height,
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  const panelStyle = detached
    ? {
        position: "fixed" as const,
        top: position.y,
        left: position.x,
        width: size.width,
        height: size.height,
        zIndex: 50,
      }
    : {};

  return (
    <div
      ref={panelRef}
      style={panelStyle}
      className={`mt-6 ${
        detached
          ? "relative pointer-events-auto rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl"
          : visible
          ? "relative rounded-3xl border border-white/10 bg-white/5 p-4"
          : "hidden"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 ${
          detached ? "cursor-move px-4 py-3" : "px-1"
        }`}
        onPointerDown={(event) => startInteraction(event, "move")}
      >
        <div>
          <h3 className="text-lg font-semibold text-slate-100">
            Live code stream
          </h3>
          <p className="text-xs text-slate-400">
            Monitor generation and stream any page on demand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStreaming && (
            <button
              onClick={onStopStreaming}
              className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs text-red-200"
            >
              Stop
            </button>
          )}
          <button
            onClick={onDetachToggle}
            className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200"
          >
            {detached ? "Dock" : "Detach"}
          </button>
        </div>
      </div>

      <div className={`space-y-3 ${detached ? "px-4 pb-4" : "mt-4"}`}>
        {pagePlans.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-400">
            Generate plans to enable live streaming.
          </p>
        ) : (
          <ul className="space-y-2 text-sm text-slate-300">
            {pagePlans.map((planText, index) => {
              const descriptor = summarizePlan(planText);
              const isActive = activeStreamIndex === index;
              const label = isStreaming
                ? streamingIndex === index
                  ? "Streaming…"
                  : "Busy"
                : "Stream";

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
                    <p className="truncate text-xs text-slate-400">
                      {descriptor}
                    </p>
                  </div>
                  <button
                    onClick={() => onStream(index)}
                    disabled={isStreaming}
                    className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200 disabled:opacity-50"
                  >
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {streamError && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {streamError}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Output
              {activeStreamIndex !== null
                ? ` • Page ${activeStreamIndex + 1}`
                : ""}
            </span>
            {isStreaming && <span className="text-indigo-200">Streaming…</span>}
          </div>
          <pre
            ref={(el) => {
              if (el && isStreaming) {
                el.scrollTop = el.scrollHeight;
              }
            }}
            className="max-h-60 overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-4 text-[11px] leading-relaxed text-emerald-100 whitespace-pre-wrap scroll-smooth"
          >
            {streamedCode || (isStreaming ? "Waiting for the model…" : "")}
          </pre>
        </div>
      </div>

      {detached && (
        <div
          className="absolute bottom-2 right-2 h-4 w-4 cursor-se-resize"
          onPointerDown={(event) => startInteraction(event, "resize")}
        />
      )}
    </div>
  );
}

type SandboxPreviewProps = {
  files: GeneratedFile[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
};

function SandboxPreview({
  files,
  selectedPath,
  onSelect,
}: SandboxPreviewProps) {
  if (files.length === 0) {
    return null;
  }

  const current = files.find((file) => file.path === selectedPath) ?? files[0];

  return (
    <div className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-b from-slate-800/90 to-slate-900/95 backdrop-blur-xl p-6 shadow-[0px_20px_60px_rgba(0,0,0,0.35)] hover:shadow-indigo-500/10 transition-all duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">
            Sandbox preview
          </h3>
          <p className="text-xs text-slate-400">
            Inspect any generated page in an isolated iframe without leaving the
            flow.
          </p>
        </div>
        <select
          value={current?.path ?? ""}
          onChange={(event) => onSelect(event.target.value)}
          className="rounded-md border border-white/10 bg-black/40 px-3 py-1 text-sm text-slate-100"
        >
          {files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-black/40 relative group">
        <iframe
          title={current?.path ?? "sandbox"}
          className="h-full w-full"
          sandbox="allow-same-origin allow-scripts"
          srcDoc={current?.content ?? ""}
        />
        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            onClick={() => {
              const newWindow = window.open("", "_blank");
              if (newWindow) {
                newWindow.document.write(current?.content ?? "");
                newWindow.document.close();
              }
            }}
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors duration-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
