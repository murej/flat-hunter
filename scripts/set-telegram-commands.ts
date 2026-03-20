const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

const commands = [
  { command: "start", description: "Set up or reset your search preferences" },
];

async function main() {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    },
  );
  const data = await res.json();
  console.log("setMyCommands:", data);
}

main().catch(console.error);
