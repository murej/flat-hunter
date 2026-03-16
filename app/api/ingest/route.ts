import { NextRequest, NextResponse } from "next/server";
import { ingestAgent } from "@/lib/tools/ingest";

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

    const html = body.html || body.plain || "";
    await ingestAgent(html);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ingest webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
