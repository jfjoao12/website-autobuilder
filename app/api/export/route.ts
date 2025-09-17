// /app/api/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

import { slugify } from "@/app/lib/slug";
import { createZip } from "@/app/lib/zip";

export const runtime = "nodejs";

type ExportFile = {
    path: string;
    contents: string;
};

type ExportPayload = {
    siteSlug: string;
    files: ExportFile[];
};

export async function POST(req: NextRequest) {
    try {
        const payload = (await req.json()) as Partial<ExportPayload>;
        if (!payload?.siteSlug || !Array.isArray(payload.files)) {
            return new NextResponse("Invalid payload", { status: 400 });
        }

        const safeSlug = slugify(payload.siteSlug);
        const encoder = new TextEncoder();
        const zipBuffer = createZip(
            payload.files.map((file) => {
                if (!file || typeof file.path !== "string" || typeof file.contents !== "string") {
                    throw new Error("Invalid file entry");
                }
                const normalizedPath = file.path.replace(/^\/+/, "");
                return { filename: normalizedPath, data: encoder.encode(file.contents) };
            }),
        );

        const exportDir = join(process.cwd(), "public", "exports");
        await mkdir(exportDir, { recursive: true });
        const zipPath = join(exportDir, `${safeSlug}.zip`);
        await writeFile(zipPath, zipBuffer);

        return NextResponse.json({ ok: true, href: `/exports/${safeSlug}.zip` });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Export failed";
        return new NextResponse(message, { status: 500 });
    }
}
