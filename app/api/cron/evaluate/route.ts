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

/** Fire-and-forget: trigger another invocation to drain remaining pending listings. */
function triggerNextInvocation(cronSecret: string | undefined): void {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return;
  fetch(`${appUrl}/api/cron/evaluate`, {
    method: "GET",
    headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
  }).catch(() => {});
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

  // Chain: trigger another invocation to pick up remaining pending listings
  triggerNextInvocation(cronSecret);

  return NextResponse.json({ ok: true, processed: ids.length });
}
