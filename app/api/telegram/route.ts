import { NextRequest, NextResponse } from "next/server";
import { parseInbound } from "@/lib/telegram";
import { conversationAgent } from "@/lib/agent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseInbound(body);

    if (parsed) {
      await conversationAgent(parsed.text, parsed.messageId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
