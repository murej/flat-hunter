import { NextResponse } from "next/server";
import { getPreferences } from "@/lib/supabase";
import { propertySearchAgent } from "@/lib/agents/propertySearchAgent";
import { sendMessage } from "@/lib/telegram";

async function runSearch() {
  const preferences = await getPreferences();

  if (!preferences) {
    return { ok: false, message: "No preferences set — run preference setup first." };
  }

  const result = await propertySearchAgent(preferences);

  let summary: string;
  if (result.newCount === 0) {
    summary = `🔍 Search complete: no new properties found across ${result.searched} ${result.searched === 1 ? "area" : "areas"}.`;
  } else if (result.suppressedCount > 0) {
    summary = `🔍 Search complete: found *${result.newCount}* new ${result.newCount === 1 ? "property" : "properties"} — showing *${result.sentCount}* scorecard${result.sentCount === 1 ? "" : "s"}, plus *${result.suppressedCount}* more that scored 5/10 or below.`;
  } else {
    summary = `🔍 Search complete: found *${result.newCount}* new ${result.newCount === 1 ? "property" : "properties"} across ${result.searched} ${result.searched === 1 ? "area" : "areas"}.`;
  }

  await sendMessage(summary);

  return { ok: true, searched: result.searched, new: result.newCount };
}

// GET — called by Vercel cron
export async function GET() {
  try {
    const result = await runSearch();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Property search error (cron):", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST — called by conversationAgent on-demand
export async function POST() {
  try {
    const result = await runSearch();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Property search error (on-demand):", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
