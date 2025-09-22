import { NextResponse } from "next/server";
import { callOllamaTwo } from "../../lib/ollama";

/**
 * Body: { plan: { site_title: string, pages: { id: string, title: string, purpose?: string }[] } }
 * Returns: { files: { path: string, content: string }[], validation: { ok: boolean, issues?: string[] } }
 */
export async function POST(req: Request) {
  try {
    const { plan } = await req.json();

    // 1) Generate code (keep it simple: static HTML files with Tailwind CDN)
    const genSystem =
      "Output ONLY valid minified JSON with an array of files for a tiny static site.";
    const genPrompt = `Given this plan (JSON): ${JSON.stringify(
      plan
    )}\nReturn JSON: { files: [{ path: string, content: string }] }.\nRules: Use minimal HTML per page. Include navigation links between pages. Use Tailwind via CDN. No comments.`;
    const gen = await callOllamaTwo(
      "qwen3:3b-instruct",
      genPrompt,
      true,
      genSystem
    );

    if (!gen.json || !(gen.json as any).files) {
      return NextResponse.json(
        { error: "Code generation failed", raw: gen },
        { status: 400 }
      );
    }

    const files = (gen.json as any).files as {
      path: string;
      content: string;
    }[];

    // 2) Validate code (light pass)
    const valSystem =
      "Output ONLY valid minified JSON with { ok: boolean, issues?: string[] }";
    const valPrompt = `Validate the following file list for a static website. Ensure basic HTML structure and working relative links. Return { ok: boolean, issues?: string[] } only. Files: ${JSON.stringify(
      files
    )}`;

    const val = await callOllamaTwo(
      "qwen3:3b-instruct",
      valPrompt,
      true,
      valSystem
    );
    const validation = (val.json as any) ?? { ok: true };

    return NextResponse.json({ files, validation });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
