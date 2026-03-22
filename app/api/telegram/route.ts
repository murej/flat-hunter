import { NextResponse } from "next/server";
import { parseInbound } from "@/lib/telegram";
import { tryHandleMessageReaction } from "@/lib/telegram/webhook-reaction";
import { sendTelegramRouteCatchUserMessage } from "@/lib/telegram/llm-outbound";
import { handleTelegramUpdate } from "@/lib/agents/conversation/handler";
import { reportError } from "@/lib/core/reporting";

import { ensureDbToolAgentsRegistered } from "@/lib/agents/registry-bootstrap";

export const maxDuration = 60;

function ok() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  try {
    await ensureDbToolAgentsRegistered();

    const body = (await request.json()) as Record<string, unknown>;

    if (await tryHandleMessageReaction(body)) {
      return ok();
    }

    const input = parseInbound(body);
    if (!input.text) {
      return ok();
    }

    await handleTelegramUpdate(input);
    return ok();
  } catch (err) {
    await reportError(err, { source: "api/telegram" });
    try {
      await sendTelegramRouteCatchUserMessage();
    } catch (sendErr) {
      console.error("Failed to send error to Telegram:", sendErr);
    }
    return ok();
  }
}
