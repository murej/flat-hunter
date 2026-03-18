import { TelegramMessage } from "@/types";
import type { AgentButton } from "@/lib/agent-core";

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
    console.error("Telegram sendMessage failed:", body);
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

export async function sendTextAsDocument(
  filename: string,
  text: string,
  options: { caption?: string; parse_mode?: string | null | false } = {},
): Promise<void> {
  const form = new FormData();
  form.set("chat_id", CHAT_ID);
  form.set(
    "document",
    new Blob([text], { type: "text/plain; charset=utf-8" }),
    filename,
  );
  if (options.caption) form.set("caption", options.caption);
  if (options.parse_mode !== null && options.parse_mode !== false) {
    form.set("parse_mode", (options.parse_mode ?? "Markdown") as string);
  }

  const res = await fetch(`${BASE_URL}/sendDocument`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Telegram sendDocument failed:", body);
    throw new Error(`Telegram sendDocument failed: ${body}`);
  }
}

export async function sendWithButtons(
  text: string,
  buttons: AgentButton[][],
  options: Record<string, unknown> = {}
): Promise<void> {
  await sendMessage(text, {
    reply_markup: {
      inline_keyboard: buttons,
    },
    ...options,
  });
}

export type ReplyKeyboardRow = Array<{ text: string }>;

export async function sendWithReplyKeyboard(
  text: string,
  keyboardRows: ReplyKeyboardRow[],
  options: { is_persistent?: boolean; resize_keyboard?: boolean } = {}
): Promise<void> {
  const { is_persistent = true, resize_keyboard = true } = options;
  await sendMessage(text, {
    reply_markup: {
      keyboard: keyboardRows,
      is_persistent,
      resize_keyboard,
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

  const callbackQuery = body.callback_query as Record<string, unknown> | undefined;
  const callbackQueryId = callbackQuery?.id as string | undefined;

  const text =
    (message.text as string | undefined) ||
    (message.data as string | undefined) ||
    "";

  const messageId = String(
    (message.message_id as number | undefined) ||
      (message.id as number | undefined) ||
      ""
  );

  return { text, messageId, callbackQueryId };
}

export async function answerCallbackQuery(
  callbackQueryId: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Telegram answerCallbackQuery failed:", body);
    throw new Error(`Telegram answerCallbackQuery failed: ${body}`);
  }
}
