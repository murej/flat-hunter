import { NextRequest } from "next/server";
import { handleIngestWebhook } from "@/lib/agents/ingest";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handleIngestWebhook(req);
}
