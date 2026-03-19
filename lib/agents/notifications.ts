import { supabaseAdmin, logConversation } from "@/lib/supabase";
import { sendMessage, sendWithButtons } from "@/lib/telegram";
import { sleep } from "@/lib/utils/retry";

type PendingNotification = {
  id: string;
  batch_id: string;
  sequence: number;
  type: "intro" | "scorecard" | "summary";
  payload: Record<string, unknown>;
};

export async function consumePendingNotifications(
  batchId: string,
): Promise<void> {
  const { data: rows, error } = await supabaseAdmin
    .from("pending_notifications")
    .select("id, batch_id, sequence, type, payload")
    .eq("batch_id", batchId)
    .is("consumed_at", null)
    .order("sequence", { ascending: true });

  if (error) {
    console.error("consumePendingNotifications fetch error:", error);
    throw error;
  }

  if (!rows || rows.length === 0) return;

  const notifications = rows as PendingNotification[];
  const SCORECARD_DELAY_MS = parseInt(
    process.env.SCORECARD_DELAY_MS ?? "500",
    10,
  );

  let lastWasScorecard = false;

  for (let i = 0; i < notifications.length; i++) {
    const n = notifications[i];
    const payload = n.payload as Record<string, unknown>;

    try {
      if (n.type === "intro" || n.type === "summary") {
        const text = payload.text as string;
        if (text) {
          const opts: Record<string, unknown> = {};
          if (n.type === "summary" && payload.link_preview_options) {
            opts.link_preview_options = payload.link_preview_options;
          }
          if (payload.parse_mode === false) {
            opts.parse_mode = false;
          }
          await sendMessage(text, opts);
        }
      } else if (n.type === "scorecard") {
        const scorecardText = payload.scorecardText as string;
        const buttons = payload.buttons as Array<
          Array<{ text: string; callback_data: string }>
        >;
        if (scorecardText && buttons) {
          await sendWithButtons(scorecardText, buttons);
          const listingId = payload.listingId as string | undefined;
          if (listingId) {
            await logConversation({
              direction: "outbound",
              message: scorecardText,
              listing_id: listingId,
              intent: null,
            });
          }
        }
        lastWasScorecard = true;
      }
    } catch (e) {
      console.error(`consumePendingNotifications failed for ${n.id}:`, e);
      throw e;
    }

    await supabaseAdmin
      .from("pending_notifications")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", n.id);

    if (
      lastWasScorecard &&
      i < notifications.length - 1 &&
      notifications[i + 1]?.type === "scorecard"
    ) {
      await sleep(SCORECARD_DELAY_MS);
    }
    lastWasScorecard = false;
  }
}
