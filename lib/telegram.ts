const BASE = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN!}`;
const CHAT_ID = () => process.env.TELEGRAM_CHAT_ID!;

type SendOptions = {
  parse_mode?: "Markdown" | "HTML";
  reply_markup?: unknown;
};

async function callTelegram(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Telegram ${method} error:`, text);
  }
  return res;
}

export async function sendMessage(
  text: string,
  opts?: SendOptions,
): Promise<void> {
  await callTelegram("sendMessage", {
    chat_id: CHAT_ID(),
    text,
    ...opts,
  });
}

export async function sendWithButtons(
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>,
  parseMode?: "Markdown" | "HTML",
): Promise<void> {
  await sendMessage(text, {
    parse_mode: parseMode,
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function sendWithReplyKeyboard(
  text: string,
  keyboard: string[][],
): Promise<void> {
  await sendMessage(text, {
    reply_markup: {
      keyboard: keyboard.map((row) =>
        row.map((text) => ({ text })),
      ),
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

export function parseInbound(body: Record<string, unknown>): {
  text: string;
  messageId: number;
  callbackQueryId?: string;
} {
  // Callback query (inline button press)
  if (body.callback_query) {
    const cq = body.callback_query as Record<string, unknown>;
    const msg = cq.message as Record<string, unknown> | undefined;
    return {
      text: (cq.data as string) || "",
      messageId: (msg?.message_id as number) || 0,
      callbackQueryId: cq.id as string,
    };
  }

  // Regular message
  const msg = body.message as Record<string, unknown> | undefined;
  return {
    text: (msg?.text as string) || "",
    messageId: (msg?.message_id as number) || 0,
  };
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text && { text }),
  });
}
