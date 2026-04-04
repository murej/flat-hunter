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
  // Recover stale unconsumed notifications from previous batches (older than 5 min)
  const { data: stale } = await getSupabaseAdmin()
    .from("pending_notifications")
    .select("*")
    .is("consumed_at", null)
    .neq("batch_id", batchId)
    .neq("type", "reject")
    .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .order("created_at", { ascending: true })
    .limit(10);

  const { data: current } = await getSupabaseAdmin()
    .from("pending_notifications")
    .select("*")
    .eq("batch_id", batchId)
    .is("consumed_at", null)
    .neq("type", "reject")
    .order("sequence", { ascending: true });

  const notifications = [...(stale ?? []), ...(current ?? [])];
  if (notifications.length === 0) return;

  for (const notif of notifications as NotificationRow[]) {
    try {
      if (notif.type === "scorecard") {
        const { listing_id, text, buttons, parse_mode } = notif.payload as {
          listing_id?: string;
          text: string;
          buttons: Array<Array<{ text: string; callback_data: string }>>;
          parse_mode?: "Markdown" | "HTML";
        };
        const telegramMessageId = await sendWithButtons(
          text,
          buttons,
          parse_mode ?? "Markdown",
        );
        if (listing_id) {
          await storeMessageListing(telegramMessageId, listing_id);
        }
        await sleep(SCORECARD_DELAY_MS);
      } else {
        await sendMessage(notif.payload.text as string, {
          parse_mode:
            (notif.payload.parse_mode as "Markdown" | "HTML") ?? "Markdown",
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

  const header = `Ah, these are not worth your time:`;
  const MAX_MSG_LEN = 3800;

  // Chunk lines to stay under Telegram's 4096-char limit
  const chunks: string[][] = [[]];
  let currentLen = header.length + 1;
  for (const line of lines) {
    if (
      currentLen + line.length + 1 > MAX_MSG_LEN &&
      chunks[chunks.length - 1].length > 0
    ) {
      chunks.push([]);
      currentLen = header.length + 1;
    }
    chunks[chunks.length - 1].push(line);
    currentLen += line.length + 1;
  }

  for (const chunk of chunks) {
    const text = `${header}\n${chunk.join("\n")}`;
    try {
      await sendMessage(text, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
    } catch {
      const plain = `${header}\n${chunk.map((l) => l.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).join("\n")}`;
      await sendMessage(plain, { disable_web_page_preview: true });
    }
  }

  const ids = (rejects as NotificationRow[]).map((r) => r.id);
  await getSupabaseAdmin()
    .from("pending_notifications")
    .update({ consumed_at: new Date().toISOString() })
    .in("id", ids);
}
