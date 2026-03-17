/**
 * One-time setup: register bot commands with Telegram.
 * Run with: npm run set-commands
 * Loads TELEGRAM_BOT_TOKEN from .env.local if not in env.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      process.env[key] = val;
    }
  }
}

loadEnvLocal();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

const COMMANDS = [
  { command: "start", description: "Start or reset" },
  { command: "saved", description: "View saved properties" },
  { command: "preferences", description: "Show search preferences" },
];

async function setMyCommands() {
  const res = await fetch(`${BASE_URL}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands: COMMANDS }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`setMyCommands failed: ${body}`);
  }

  console.log("Bot commands registered:", COMMANDS.map((c) => `/${c.command}`).join(", "));
}

setMyCommands().catch((err) => {
  console.error(err);
  process.exit(1);
});
