import { NextRequest } from "next/server";
import { handleIngestWebhook } from "@/lib/agents/ingest/handler";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handleIngestWebhook(req);
}
