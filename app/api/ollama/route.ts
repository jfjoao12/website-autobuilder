import { NextResponse } from "next/server";

import { generateCode, generatePlan, listModels } from "../ollama/scripts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { action, topic, plan, model } = await req.json();

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

      const planText = await generatePlan(topic, model);
      if (!planText || typeof planText !== "string") {
        return NextResponse.json({ error: "Plan generation failed" }, { status: 500 });
      }
      return NextResponse.json({ plan: planText });
    }

    if (action === "code") {
      if (!plan || typeof plan !== "string") {
        return NextResponse.json({ error: "Missing plan" }, { status: 400 });
      }

      const codeText = await generateCode(plan, model);
      if (!codeText || typeof codeText !== "string") {
        return NextResponse.json({ error: "Code generation failed" }, { status: 500 });
      }
      return NextResponse.json({ code: codeText });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
