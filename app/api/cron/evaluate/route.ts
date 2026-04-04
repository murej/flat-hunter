import { NextResponse } from "next/server";
import { reportError } from "@/lib/core/reporting";
import {
  claimListingsForEvaluationBatch,
  getEvaluatingStaleMinutes,
} from "@/lib/supabase/evaluation-claim";
import { runEvaluationsAndNotify } from "@/lib/agents/ingest/tools";
import { flushRejectSummary } from "@/lib/agents/notifications";
import { cronSecretFromEnv, envIntClamped } from "@/lib/utils/env-utils";

// Import agents to trigger registration
import "@/lib/agents/property-expert";
import "@/lib/agents/area-expert";

export const maxDuration = 60;

/** Derive the base URL for internal API calls — localhost in dev, request origin in production. */
function internalBaseUrl(requestUrl: string): string {
  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT ?? "3000";
    return `http://localhost:${port}`;
  }
  return new URL(requestUrl).origin;
}

/** Fire-and-forget: trigger another invocation on the same server to drain remaining pending listings. */
function triggerNextInvocation(cronSecret: string | undefined, requestUrl: string): void {
  const base = internalBaseUrl(requestUrl);
  fetch(`${base}/api/cron/evaluate`, {
    method: "GET",
    headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
  }).catch((err) => console.error("[cron-trigger]", err));
}

export async function GET(request: Request) {
  // Verify caller (e.g. Supabase pg_net) when CRON_SECRET is set
  const authHeader = request.headers.get("authorization");
  const cronSecret = cronSecretFromEnv();
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batchSize = envIntClamped("EVALUATE_CRON_BATCH_SIZE", 1, 20, 1);
  const staleMinutes = getEvaluatingStaleMinutes();

  let ids: string[];
  try {
    ids = await claimListingsForEvaluationBatch(batchSize, staleMinutes);
  } catch (err) {
    await reportError(err, { source: "api/cron/evaluate", telemetryTag: "claim" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (ids.length === 0) {
    // Backlog drained — send consolidated reject summary if any
    await flushRejectSummary();
    return NextResponse.json({ ok: true, processed: 0 });
  }

  try {
    await runEvaluationsAndNotify(ids, { preClaimed: true, skipIntro: true });
  } catch (err) {
    await reportError(err, { source: "api/cron/evaluate" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Chain: trigger another invocation on the same server to pick up remaining pending listings
  triggerNextInvocation(cronSecret, request.url);

  return NextResponse.json({ ok: true, processed: ids.length });
}
