import { NextResponse } from "next/server";
import { reportError } from "@/lib/core/reporting";
import {
  claimListingsForEvaluationBatch,
  getEvaluatingStaleMinutes,
} from "@/lib/supabase/evaluation-claim";
import { runEvaluationsAndNotify } from "@/lib/agents/ingest/tools";
import { envIntClamped } from "@/lib/utils/env-utils";

// Import agents to trigger registration
import "@/lib/agents/property-expert";
import "@/lib/agents/area-expert";

export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify caller (e.g. Supabase pg_net) when CRON_SECRET is set
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batchSize = envIntClamped("EVALUATE_CRON_BATCH_SIZE", 1, 20, 2);
  const staleMinutes = getEvaluatingStaleMinutes();

  let ids: string[];
  try {
    ids = await claimListingsForEvaluationBatch(batchSize, staleMinutes);
  } catch (err) {
    await reportError(err, { source: "api/cron/evaluate", telemetryTag: "claim" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  try {
    await runEvaluationsAndNotify(ids, { preClaimed: true });
  } catch (err) {
    await reportError(err, { source: "api/cron/evaluate" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, processed: ids.length });
}
