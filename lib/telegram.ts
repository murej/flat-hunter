import { TelegramMessage } from "@/types";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function sendMessage(
  text: string,
  options: Record<string, unknown> = {}
): Promise<void> {
  const { parse_mode, ...rest } = options;
  const payload: Record<string, unknown> = {
    chat_id: CHAT_ID,
    text,
    ...rest,
  };
  if (parse_mode !== null && parse_mode !== false) {
    payload.parse_mode = parse_mode ?? "Markdown";
  }

  const res = await fetch(`${BASE_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

export async function sendWithButtons(
  text: string,
  buttons: Array<{ text: string; callback_data: string }>
): Promise<void> {
  await sendMessage(text, {
    reply_markup: {
      inline_keyboard: [buttons],
    },
  });
}

export function parseInbound(
  body: Record<string, unknown>
): TelegramMessage | null {
  const message =
    (body.message as Record<string, unknown> | undefined) ||
    (body.callback_query as Record<string, unknown> | undefined);

  if (!message) return null;

  const text =
    (message.text as string | undefined) ||
    (message.data as string | undefined) ||
    "";

  const messageId = String(
    (message.message_id as number | undefined) ||
      (message.id as number | undefined) ||
      ""
  );

  return { text, messageId };
}
