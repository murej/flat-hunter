import { NextRequest, NextResponse } from "next/server";
import { parseInbound } from "@/lib/telegram";
import { sendMessage } from "@/lib/telegram";
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
      await sendMessage("Something went wrong. Please try again.");
    } catch (_) {}
    return NextResponse.json({ ok: true });
  }
}
