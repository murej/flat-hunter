const BASE = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN!}`;
const CHAT_ID = () => process.env.TELEGRAM_CHAT_ID!;

type SendOptions = {
  parse_mode?: "Markdown" | "HTML";
  reply_markup?: unknown;
};

async function callTelegram(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram ${method} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export async function sendMessage(
  text: string,
  opts?: SendOptions,
): Promise<number> {
  const json = await callTelegram("sendMessage", {
    chat_id: CHAT_ID(),
    text,
    ...opts,
  });
  return (json.result as Record<string, unknown>).message_id as number;
}

export async function sendWithButtons(
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>,
  parseMode?: "Markdown" | "HTML",
): Promise<number> {
  const markup = { inline_keyboard: buttons };
  try {
    return await sendMessage(text, { parse_mode: parseMode, reply_markup: markup });
  } catch {
    return await sendMessage(text, { reply_markup: markup });
  }
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

/** Send with Markdown parse_mode, falling back to plain text on failure. */
export async function sendMarkdown(
  text: string,
  opts?: Omit<SendOptions, "parse_mode">,
): Promise<number> {
  try {
    return await sendMessage(text, { ...opts, parse_mode: "Markdown" });
  } catch {
    return await sendMessage(text, opts);
  }
}

/** Send plain text with no parse_mode — safe for arbitrary error strings. */
export async function sendPlainText(text: string): Promise<number> {
  const json = await callTelegram("sendMessage", {
    chat_id: CHAT_ID(),
    text: text.slice(0, 4096), // Telegram limit
  });
  return (json.result as Record<string, unknown>).message_id as number;
}

export function startTypingIndicator(): { stop: () => void } {
  const send = () => {
    callTelegram("sendChatAction", {
      chat_id: CHAT_ID(),
      action: "typing",
    }).catch(() => {});
  };
  send();
  const interval = setInterval(send, 4000);
  return { stop: () => clearInterval(interval) };
}

export async function deleteMessage(messageId: number): Promise<void> {
  await callTelegram("deleteMessage", {
    chat_id: CHAT_ID(),
    message_id: messageId,
  });
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

export function parseReaction(body: Record<string, unknown>): {
  messageId: number;
  added: boolean;
} | null {
  const mr = body.message_reaction as Record<string, unknown> | undefined;
  if (!mr) return null;

  const newReaction = mr.new_reaction as Array<unknown>;
  const oldReaction = mr.old_reaction as Array<unknown>;

  return {
    messageId: mr.message_id as number,
    added: newReaction.length > oldReaction.length,
  };
}
