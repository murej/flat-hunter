import { NextResponse } from "next/server";
import { parseInbound, parseReaction, sendPlainText, sendMarkdown } from "@/lib/telegram";
import { handleTelegramUpdate } from "@/lib/agents/conversation/handler";
import { getListingByMessageId, updateListingStatus } from "@/lib/supabase";
import { saveListing } from "@/lib/tools/listing";
import { reportError } from "@/lib/core/reporting";
import { envBool } from "@/lib/utils/env-utils";

// Import agents to trigger registration
import "@/lib/agents/property-expert";
import "@/lib/agents/area-expert";
import "@/lib/agents/preference";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    // Handle message reactions (save/unsave via like)
    const reaction = parseReaction(body);
    if (reaction) {
      const listingId = await getListingByMessageId(reaction.messageId);
      if (listingId) {
        const verbose = envBool("TELEGRAM_VERBOSE_MODE");
        if (reaction.added) {
          await saveListing(listingId);
          if (verbose) await sendMarkdown("💾 Saved!");
        } else {
          await updateListingStatus(listingId, "evaluated");
          if (verbose) await sendMarkdown("📌 Unsaved.");
        }
      }
      return NextResponse.json({ ok: true });
    }

    const input = parseInbound(body);

    if (!input.text) {
      return NextResponse.json({ ok: true });
    }

    await handleTelegramUpdate(input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportError(err, { source: "api/telegram" });
    try {
      if (!envBool("TELEGRAM_VERBOSE_MODE")) {
        await sendPlainText("Something went wrong.");
      }
    } catch (sendErr) {
      console.error("Failed to send error to Telegram:", sendErr);
    }
    return NextResponse.json({ ok: true }); // Always 200 to prevent Telegram retries
  }
}
