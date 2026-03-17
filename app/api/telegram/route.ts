import { NextRequest, NextResponse } from "next/server";
import {
  parseInbound,
  answerCallbackQuery,
  sendMessage,
  sendWithButtons,
} from "@/lib/telegram";
import { conversationAgent } from "@/lib/agent";
import {
  supabaseAdmin,
  updateListingStatus,
  logConversation,
} from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseInbound(body);

    if (parsed) {
      if (parsed.text.startsWith("unsave:")) {
        const listingId = parsed.text.split(":")[1];
        if (listingId) {
          if (parsed.callbackQueryId) {
            await answerCallbackQuery(parsed.callbackQueryId);
          }
          await updateListingStatus(listingId, "dismissed");
          await sendMessage("Removed from saved properties.");
        }
        return NextResponse.json({ ok: true });
      }

      if (parsed.text.startsWith("scorecard:")) {
        const listingId = parsed.text.split(":")[1];
        if (listingId) {
          if (parsed.callbackQueryId) {
            await answerCallbackQuery(parsed.callbackQueryId);
          }
          const [
            { data: evaluation },
            { data: listing },
          ] = await Promise.all([
            supabaseAdmin
              .from("evaluations")
              .select("scorecard_text")
              .eq("listing_id", listingId)
              .order("created_at", { ascending: false })
              .limit(1)
              .single(),
            supabaseAdmin
              .from("listings")
              .select("status")
              .eq("id", listingId)
              .single(),
          ]);
          if (evaluation?.scorecard_text) {
            const saved = listing?.status === "saved";
            const saveButton = saved
              ? { text: "🗑 Unsave", callback_data: `unsave:${listingId}` }
              : { text: "💾 Save", callback_data: `save:${listingId}` };
            const scorecardButtons = [
              { text: "👁 View", callback_data: `view:${listingId}` },
              saveButton,
              ...(saved ? [] : [{ text: "⏭ Skip", callback_data: `skip:${listingId}` }]),
              { text: "❓ Why?", callback_data: `why:${listingId}` },
            ];
            const buttons = [scorecardButtons];
            await logConversation({
              direction: "outbound",
              message: evaluation.scorecard_text,
              listing_id: listingId,
              intent: null,
            });
            await sendWithButtons(evaluation.scorecard_text, buttons);
          }
        }
        return NextResponse.json({ ok: true });
      }

      await conversationAgent(parsed.text, parsed.messageId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
