import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { handleIngestWebhook } from "@/lib/agents/ingest/handler";
import { reportError } from "@/lib/core/reporting";

// Import agents to trigger registration
import "@/lib/agents/property-expert";
import "@/lib/agents/area-expert";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { response, backgroundWork } = await handleIngestWebhook(request);

    if (backgroundWork) {
      waitUntil(backgroundWork());
    }

    return response;
  } catch (err) {
    await reportError(err, { source: "api/ingest" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
