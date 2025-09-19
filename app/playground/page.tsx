"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion, type Variants, type PanInfo } from "framer-motion";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";

// Drop this file into /app/page.tsx (Next.js App Router)
// TailwindCSS + Framer Motion required.
// npm i framer-motion lucide-react && (Tailwind already set up)

export default function Page() {
    const slides = useMemo(
        () => [
            {
                eyebrow: "Introducing",
                title: "Elegance in Motion",
                subtitle:
                    "A hero card carousel with buttery-smooth slide transitions. Crafted for modern product showcases.",
                badge: "Concept • 2025",
            },
            {
                eyebrow: "Focus",
                title: "Tell One Story at a Time",
                subtitle:
                    "Keep users in flow—each card is a chapter. Click Next to glide through your narrative.",
                badge: "Minimal • Clean",
            },
            {
                eyebrow: "Make it yours",
                title: "Composable & Aesthetic",
                subtitle:
                    "Swap content, colors, and accents. The motion system stays delightfully consistent.",
                badge: "Customizable",
            },
            {
                eyebrow: "Ready?",
                title: "Ship the Experience",
                subtitle:
                    "This is a mockup page, but the vibe is production. Reuse the component anywhere in your app.",
                badge: "Dev-ready",
            },
        ],
        []
    );

    const [index, setIndex] = useState(0);
    const [direction, setDirection] = useState(1); // 1 = next, -1 = prev
    const [isPaused, setIsPaused] = useState(false);
    const [progress, setProgress] = useState(0); // 0..100

    const DURATION_MS = 4500; // autoplay per slide
    const TICK_MS = 50; // progress ticker granularity
    const hoverRef = useRef<HTMLDivElement | null>(null);

    const clampIndex = useCallback(
        (i: number) => (i + slides.length) % slides.length,
        [slides.length]
    );

    const next = useCallback(() => {
        setDirection(1);
        setIndex((i) => clampIndex(i + 1));
    }, [clampIndex]);

    const prev = useCallback(() => {
        setDirection(-1);
        setIndex((i) => clampIndex(i - 1));
    }, [clampIndex]);

    // Keyboard navigation
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") next();
            if (e.key === "ArrowLeft") prev();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [next, prev]);

    // Pause on hover
    useEffect(() => {
        const el = hoverRef.current;
        if (!el) return;
        const onEnter = () => setIsPaused(true);
        const onLeave = () => setIsPaused(false);
        el.addEventListener("mouseenter", onEnter);
        el.addEventListener("mouseleave", onLeave);
        return () => {
            el.removeEventListener("mouseenter", onEnter);
            el.removeEventListener("mouseleave", onLeave);
        };
    }, []);

    // Pause when the tab is hidden
    useEffect(() => {
        const handler = () => setIsPaused(document.hidden);
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
    }, []);

    // Autoplay + progress bar
    useEffect(() => {
        setProgress(0); // reset progress when slide changes
        if (isPaused) return;
        let elapsed = 0;
        const int = setInterval(() => {
            elapsed += TICK_MS;
            const pct = Math.min(100, (elapsed / DURATION_MS) * 100);
            setProgress(pct);
            if (pct >= 100) {
                clearInterval(int);
                next();
            }
        }, TICK_MS);
        return () => clearInterval(int);
    }, [index, isPaused, next]);

    const variants: Variants = {
        enter: (custom: number) => ({
            x: custom > 0 ? 120 : -120,
            opacity: 0,
            scale: 0.98,
            filter: "blur(6px)",
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
            },
        },
        exit: (custom: number) => ({
            x: custom > 0 ? -120 : 120,
            opacity: 0,
            scale: 0.98,
            filter: "blur(6px)",
            transition: {
                type: "spring",
                stiffness: 360,
                damping: 34,
            },
        }),
    };

    const onDragEnd = (
        _event: MouseEvent | TouchEvent | PointerEvent,
        info: PanInfo,
    ) => {
        const threshold = 80; // pixels
        if (info.offset.x < -threshold) {
            next();
        } else if (info.offset.x > threshold) {
            prev();
        }
    };

    return (
        <main className="min-h-dvh bg-[radial-gradient(1200px_600px_at_50%_-20%,#0b1220_0%,#05080f_60%,#03060d_100%)] text-slate-100 antialiased selection:bg-indigo-400/30">
            <div className="mx-auto max-w-6xl px-4 py-14">
                {/* Header */}
                <header className="mb-10 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl bg-indigo-500/20 ring-1 ring-indigo-400/30" />
                        <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Prototype</p>
                            <h1 className="text-lg font-semibold text-slate-200">Hero Swipe Mockup</h1>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">Next.js</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">Tailwind</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">Framer Motion</span>
                    </div>
                </header>

                {/* Stage */}
                <div
                    ref={hoverRef}
                    className="relative isolate overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-2xl shadow-black/30 backdrop-blur-xl"
                >
                    {/* Accent gradients */}
                    <div className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-indigo-500/20 blur-3xl" />
                    <div className="pointer-events-none absolute -right-24 -bottom-24 size-64 rounded-full bg-cyan-500/20 blur-3xl" />

                    <div className="relative grid min-h-[460px] place-items-center rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0))] p-4">
                        {/* Card viewport */}
                        <div className="relative w-full max-w-3xl">
                            <AnimatePresence initial={false} custom={direction} mode="popLayout">
                                <motion.article
                                    key={index}
                                    custom={direction}
                                    variants={variants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                    drag="x"
                                    dragConstraints={{ left: 0, right: 0 }}
                                    dragElastic={0.2}
                                    onDragEnd={onDragEnd}
                                    className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] p-8 md:p-10 shadow-xl"
                                >
                                    {/* Progress bar */}
                                    <div className="absolute inset-x-0 top-0 h-1 bg-white/5">
                                        <div
                                            className="h-full bg-gradient-to-r from-indigo-400 to-cyan-400"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>

                                    {/* Top badge */}
                                    <div className="mb-3 mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
                                        <span className="size-1.5 rounded-full bg-emerald-400" /> {slides[index].badge}
                                        {isPaused ? (
                                            <span className="ml-2 inline-flex items-center gap-1 text-slate-400"><Pause className="size-3" />Paused</span>
                                        ) : (
                                            <span className="ml-2 inline-flex items-center gap-1 text-slate-400"><Play className="size-3" />Auto</span>
                                        )}
                                    </div>

                                    <p className="text-sm uppercase tracking-[0.22em] text-indigo-300/90">
                                        {slides[index].eyebrow}
                                    </p>
                                    <h2 className="mt-2 text-3xl font-semibold leading-tight text-slate-50 md:text-5xl">
                                        {slides[index].title}
                                    </h2>
                                    <p className="mt-3 max-w-prose text-slate-300/90 md:text-lg">
                                        {slides[index].subtitle}
                                    </p>

                                    {/* Bottom controls */}
                                    <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                        {/* Progress dots (clickable) */}
                                        <div className="flex items-center gap-2">
                                            {slides.map((_, i) => (
                                                <button
                                                    aria-label={`Go to slide ${i + 1}`}
                                                    key={i}
                                                    onClick={() => {
                                                        setDirection(i > index ? 1 : -1);
                                                        setIndex(i);
                                                    }}
                                                    className={[
                                                        "h-1.5 rounded-full transition-all duration-300",
                                                        i === index ? "w-6 bg-indigo-400" : "w-2 bg-white/20 hover:bg-white/30",
                                                    ].join(" ")}
                                                />
                                            ))}
                                        </div>

                                        {/* Prev / Next buttons */}
                                        <div className="flex items-center gap-2 self-end md:self-auto">
                                            <button
                                                onClick={prev}
                                                className="group inline-flex items-center gap-2 rounded-2xl border border-slate-300/20 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 backdrop-blur-md transition hover:border-slate-300/30 hover:bg-white/10"
                                            >
                                                <ArrowLeft className="size-4" /> Prev
                                            </button>
                                            <button
                                                onClick={next}
                                                className="group inline-flex items-center gap-2 rounded-2xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-sm font-medium text-indigo-200 backdrop-blur-md transition hover:border-indigo-300/50 hover:bg-indigo-400/15 hover:text-indigo-100"
                                            >
                                                Next <ArrowRight className="size-4 -translate-x-0 transition group-hover:translate-x-0.5" />
                                            </button>
                                            <button
                                                onClick={() => setIsPaused((p) => !p)}
                                                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
                                                aria-pressed={isPaused}
                                                aria-label={isPaused ? "Resume autoplay" : "Pause autoplay"}
                                            >
                                                {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />} {isPaused ? "Play" : "Pause"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Decorative lines */}
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                                    <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />
                                </motion.article>
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Footer note */}
                <footer className="mx-auto mt-6 max-w-3xl text-center text-sm text-slate-400">
                    Tips: Swipe horizontally (or use ← / →). Hover to pause. Click dots to jump. Want multi-page scaffolding (Features, Contact) using this hero as the landing centerpiece? Ping me and I&rsquo;ll add routes.
                </footer>
            </div>
        </main>
    );
}
