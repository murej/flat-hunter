import { NextRequest, NextResponse } from "next/server";
import { parseInbound } from "@/lib/openclaw/telegram";
import { sendError } from "@/lib/openclaw/sendError";
import { handleTelegramUpdate } from "@/lib/openclaw/agent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseInbound(body);

    if (parsed) {
      await handleTelegramUpdate(parsed);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    try {
      await sendError();
    } catch (_) {}
    return NextResponse.json({ ok: true });
  }
}
