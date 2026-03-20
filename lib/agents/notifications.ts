import { supabaseAdmin } from "@/lib/supabase";
import { sendMessage, sendWithButtons } from "@/lib/telegram";
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
  const { data: notifications } = await supabaseAdmin
    .from("pending_notifications")
    .select("*")
    .eq("batch_id", batchId)
    .is("consumed_at", null)
    .order("sequence", { ascending: true });

  if (!notifications || notifications.length === 0) return;

  for (const notif of notifications as NotificationRow[]) {
    try {
      if (notif.type === "scorecard") {
        const { text, buttons, parse_mode } = notif.payload as {
          text: string;
          buttons: Array<Array<{ text: string; callback_data: string }>>;
          parse_mode?: "Markdown" | "HTML";
        };
        await sendWithButtons(text, buttons, parse_mode ?? "Markdown");
        await sleep(SCORECARD_DELAY_MS);
      } else {
        await sendMessage(notif.payload.text as string, {
          parse_mode: (notif.payload.parse_mode as "Markdown" | "HTML") ?? "Markdown",
        });
      }

      await supabaseAdmin
        .from("pending_notifications")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", notif.id);
    } catch (err) {
      console.error(`Notification ${notif.id} failed:`, err);
    }
  }
}
