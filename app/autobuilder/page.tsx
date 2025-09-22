"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Download, Eye } from "lucide-react";
import JSZip from "jszip";

// Types
type PageItem = { id: string; title: string; purpose?: string };
interface Plan {
  site_title?: string;
  pages: PageItem[];
}
interface GenResponse {
  files: { path: string; content: string }[];
  validation: { ok: boolean; issues?: string[] };
}

export default function Page() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [topic, setTopic] = useState("A stylish portfolio for a creator");
  const [pageCount, setPageCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [files, setFiles] = useState<GenResponse["files"]>([]);
  const [validation, setValidation] = useState<
    GenResponse["validation"] | null
  >(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

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

  // API helpers
  async function createPlan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, pageCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create plan");
      setPlan(data.plan as Plan);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateAndValidate() {
    if (!plan) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data: GenResponse = await res.json();
      if (!res.ok)
        throw new Error((data as any)?.error || "Failed to generate code");
      setFiles(data.files);
      setValidation(data.validation);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // UX helpers
}
