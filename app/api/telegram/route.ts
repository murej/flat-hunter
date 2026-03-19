import { NextRequest, NextResponse } from "next/server";
import { parseInbound } from "@/lib/telegram";
import { sendError } from "@/lib/core/agent";
import { handleTelegramUpdate } from "@/lib/agents/conversation/handler";

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
