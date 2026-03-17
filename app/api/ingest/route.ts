import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { ingestAgent, runEvaluationsAndNotify } from "@/lib/tools/ingest";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (process.env.CLOUDMAILIN_SECRET) {
      const authHeader = req.headers.get("authorization") ?? "";
      const base64 = authHeader.replace(/^Basic\s+/i, "");
      const decoded = Buffer.from(base64, "base64").toString("utf8");
      const password = decoded.split(":").slice(1).join(":");
      if (password !== process.env.CLOUDMAILIN_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Support both flat and normalized CloudMailin formats
    const html = body.html ?? body.body?.html ?? "";
    const plain = body.plain ?? body.body?.plain ?? "";
    const subject = (body.subject ??
      body.headers?.subject ??
      body.headers?.Subject) as string | undefined;
    const result = await ingestAgent(
      html || plain,
      subject,
      plain || undefined,
    );

    if (result.done) {
      return NextResponse.json({ ok: true });
    }

    waitUntil(runEvaluationsAndNotify(result.newIds));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ingest webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
