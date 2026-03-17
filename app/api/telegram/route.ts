import { NextRequest, NextResponse } from "next/server";
import {
  parseInbound,
  answerCallbackQuery,
  sendMessage,
  sendWithButtons,
  sendWithReplyKeyboard,
} from "@/lib/telegram";
import { conversationAgent } from "@/lib/agent";
import { collectPreferences } from "@/lib/tools/preference";
import {
  supabaseAdmin,
  updateListingStatus,
  logConversation,
  getPreferences,
} from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = parseInbound(body);

    if (parsed) {
      if (parsed.text === "/start") {
        const preferences = await getPreferences();
        if (preferences) {
          await sendWithReplyKeyboard(
            "Welcome back. Use the buttons below or type a message.",
            [
              [{ text: "Saved" }, { text: "Preferences" }],
              [{ text: "New matches" }],
            ]
          );
          return NextResponse.json({ ok: true });
        }
      }

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

      if (parsed.text === "update preferences") {
        if (parsed.callbackQueryId) {
          await answerCallbackQuery(parsed.callbackQueryId);
        }
        const updatePrompt = "What would you like to update?";
        const updateButtons = [
          [
            { text: "📍 Areas", callback_data: "update:areas" },
            { text: "💰 Budget", callback_data: "update:budget" },
            { text: "🛏 Bedrooms", callback_data: "update:bedrooms" },
          ],
          [
            { text: "🚇 Commute", callback_data: "update:commute" },
            { text: "✅ Must-haves", callback_data: "update:must_haves" },
            { text: "❌ Deal-breakers", callback_data: "update:deal_breakers" },
          ],
          [{ text: "Other / Everything", callback_data: "update:other" }],
        ];
        await logConversation({
          direction: "outbound",
          message: updatePrompt,
          intent: "preferences",
        });
        await sendWithButtons(updatePrompt, updateButtons);
        return NextResponse.json({ ok: true });
      }

      if (parsed.text.startsWith("update:")) {
        if (parsed.callbackQueryId) {
          await answerCallbackQuery(parsed.callbackQueryId);
        }
        const part = parsed.text.replace(/^update:/, "");
        const messageMap: Record<string, string> = {
          areas: "I want to update my areas",
          budget: "I want to update my budget and deposit",
          bedrooms: "I want to update my minimum bedrooms",
          commute: "I want to update my commute settings",
          must_haves: "I want to update my must-haves",
          deal_breakers: "I want to update my deal-breakers",
          other: "I want to update my preferences",
        };
        const naturalMessage = messageMap[part] ?? "I want to update my preferences";
        const dedupId = parsed.callbackQueryId ?? parsed.messageId;
        await collectPreferences(naturalMessage, dedupId);
        return NextResponse.json({ ok: true });
      }

      if (parsed.callbackQueryId) {
        await answerCallbackQuery(parsed.callbackQueryId);
      }
      await conversationAgent(parsed.text, parsed.messageId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
