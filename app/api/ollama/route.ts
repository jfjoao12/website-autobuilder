import { NextResponse } from "next/server";

import {
  generateCode,
  generateLayoutFragments,
  generatePlan,
  listModels,
  streamCode,
} from "../ollama/scripts";

export const runtime = "nodejs";

type RequestBody = {
  action?: string;
  topic?: string;
  plan?: string;
  model?: string;
  pageCount?: number;
  allPlans?: unknown;
  pageIndex?: unknown;
  plans?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const { action, topic, plan, model, pageCount, allPlans, pageIndex, plans } =
      body;

    if (typeof action !== "string") {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    if (action === "models") {
      const models = await listModels();
      return NextResponse.json({ models });
    }

    if (!model || typeof model !== "string") {
      return NextResponse.json({ error: "Missing model" }, { status: 400 });
    }

    if (action === "plan") {
      if (!topic || typeof topic !== "string") {
        return NextResponse.json({ error: "Missing topic" }, { status: 400 });
      }

      const plans = await generatePlan(
        topic,
        model,
        typeof pageCount === "number" && Number.isFinite(pageCount)
          ? Math.max(1, Math.floor(pageCount))
          : 1
      );

      if (!Array.isArray(plans) || plans.length === 0) {
        return NextResponse.json(
          { error: "Plan generation failed" },
          { status: 500 }
        );
      }

      return NextResponse.json({ plans });
    }

    if (action === "code" || action === "code-stream") {
      if (!plan || typeof plan !== "string") {
        return NextResponse.json({ error: "Missing plan" }, { status: 400 });
      }

      const normalizedPlans = Array.isArray(allPlans)
        ? allPlans.filter((entry): entry is string => typeof entry === "string")
        : [];
      const normalizedIndex =
        typeof pageIndex === "number" && Number.isFinite(pageIndex)
          ? pageIndex
          : undefined;

      if (action === "code") {
        const codeText = await generateCode(plan, model, {
          allPlans: normalizedPlans,
          pageIndex: normalizedIndex,
        });

        if (!codeText || typeof codeText !== "string") {
          return NextResponse.json(
            { error: "Code generation failed" },
            { status: 500 }
          );
        }

        return NextResponse.json({ code: codeText });
      }

      try {
        const modelStream = await streamCode(plan, model, {
          allPlans: normalizedPlans,
          pageIndex: normalizedIndex,
        });
        const encoder = new TextEncoder();

        const readable = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of modelStream) {
                const text = chunk?.response ?? "";
                if (text) {
                  controller.enqueue(encoder.encode(text));
                }
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to stream code";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (action === "layout") {
      const planList = Array.isArray(plans)
        ? plans.filter((entry): entry is string => typeof entry === "string")
        : [];

      if (planList.length === 0) {
        return NextResponse.json({ error: "Missing plans" }, { status: 400 });
      }

      const fragments = await generateLayoutFragments(planList, model);
      return NextResponse.json(fragments);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
