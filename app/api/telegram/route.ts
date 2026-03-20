import { NextResponse } from "next/server";
import { parseInbound } from "@/lib/telegram";
import { handleTelegramUpdate } from "@/lib/agents/conversation/handler";

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
    return NextResponse.json({ ok: true }); // Always 200 to prevent Telegram retries
  }
}
