import { reportError } from "@/lib/core/reporting";
import { getSupabaseAdmin, storeMessageListing } from "@/lib/supabase";
import { sendMessage, sendMarkdown, sendWithButtons } from "@/lib/telegram";
import { sleep } from "@/lib/utils/retry";

const SCORECARD_DELAY_MS = 500;

type NotificationRow = {
  id: number;
  batch_id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
};

export async function consumePendingNotifications(
  batchId: string,
): Promise<void> {
  const { data: notifications } = await getSupabaseAdmin()
    .from("pending_notifications")
    .select("*")
    .eq("batch_id", batchId)
    .is("consumed_at", null)
    .order("sequence", { ascending: true });

  if (!notifications || notifications.length === 0) return;

  for (const notif of notifications as NotificationRow[]) {
    try {
      if (notif.type === "scorecard") {
        const { listing_id, text, buttons, parse_mode } = notif.payload as {
          listing_id?: string;
          text: string;
          buttons: Array<Array<{ text: string; callback_data: string }>>;
          parse_mode?: "Markdown" | "HTML";
        };
        const telegramMessageId = await sendWithButtons(text, buttons, parse_mode ?? "Markdown");
        if (listing_id) {
          await storeMessageListing(telegramMessageId, listing_id);
        }
        await sleep(SCORECARD_DELAY_MS);
      } else {
        await sendMessage(notif.payload.text as string, {
          parse_mode: (notif.payload.parse_mode as "Markdown" | "HTML") ?? "Markdown",
        });
      }

      await getSupabaseAdmin()
        .from("pending_notifications")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", notif.id);
    } catch (err) {
      await reportError(err, {
        source: "notifications/consumePending",
        telemetryTag: `notification:${notif.id}`,
      });
    }
  }
}

export async function flushRejectSummary(): Promise<void> {
  const { data: rejects } = await getSupabaseAdmin()
    .from("pending_notifications")
    .select("*")
    .eq("type", "reject")
    .is("consumed_at", null)
    .order("sequence", { ascending: true });

  if (!rejects || rejects.length === 0) return;

  const lines = (rejects as NotificationRow[]).map((r) => {
    const { title, url, score } = r.payload as {
      title: string;
      url: string;
      score: number;
    };
    return url
      ? `• [${title}](${url}) — ${score}/10`
      : `• ${title} — ${score}/10`;
  });

  const text = `*Filtered out (below 6/10):*\n${lines.join("\n")}`;

  try {
    await sendMessage(text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch {
    // Fallback without Markdown if formatting fails
    const plain = `Filtered out (below 6/10):\n${(rejects as NotificationRow[]).map((r) => {
      const { title, score } = r.payload as { title: string; score: number };
      return `• ${title} — ${score}/10`;
    }).join("\n")}`;
    await sendMessage(plain, { disable_web_page_preview: true });
  }

  const ids = (rejects as NotificationRow[]).map((r) => r.id);
  await getSupabaseAdmin()
    .from("pending_notifications")
    .update({ consumed_at: new Date().toISOString() })
    .in("id", ids);
}
