import { NextRequest, NextResponse } from "next/server";
import { ingestAgent } from "@/lib/agents/ingest";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const secret = req.headers.get("x-cloudmailin-secret");
    if (
      process.env.CLOUDMAILIN_SECRET &&
      secret !== process.env.CLOUDMAILIN_SECRET
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const html = body.html || body.plain || "";
    await ingestAgent(html);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ingest webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
