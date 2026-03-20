import { NextResponse } from "next/server";
import { parseInbound, sendPlainText } from "@/lib/telegram";
import { handleTelegramUpdate } from "@/lib/agents/conversation/handler";
import { envBool } from "@/lib/utils/env-utils";

// Import agents to trigger registration
import "@/lib/agents/property-expert";
import "@/lib/agents/area-expert";
import "@/lib/agents/preference";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = parseInbound(body);

    if (!input.text) {
      return NextResponse.json({ ok: true });
    }

    await handleTelegramUpdate(input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    try {
      const verbose = envBool("TELEGRAM_VERBOSE_MODE");
      const detail = err instanceof Error ? err.message : "Unknown error";
      const text = verbose
        ? `Error: ${detail}`
        : "Something went wrong.";
      await sendPlainText(text);
    } catch (sendErr) {
      console.error("Failed to send error to Telegram:", sendErr);
    }
    return NextResponse.json({ ok: true }); // Always 200 to prevent Telegram retries
  }
}
