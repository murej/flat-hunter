const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

const commands = [
  { command: "start", description: "👋  Hi Stath" },
  { command: "preferences", description: "📝  My preferences" },
  { command: "liked", description: "❤️  Liked properties" },
  { command: "stop", description: "🛑  STOP TALKING" },
  { command: "restart", description: "❌  Clear preferences" },
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
