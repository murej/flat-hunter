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
  const cronSecret = process.env.CRON_SECRET;
  // #region agent log
  {
    const expectedBearer = cronSecret ? `Bearer ${cronSecret}` : "";
    const exactMatch = Boolean(
      cronSecret && authHeader === `Bearer ${cronSecret}`,
    );
    const authDebugData = {
      hypothesisId: "H1-H5",
      runId: process.env.VERCEL ? "vercel" : "local",
      hasCronSecretEnv: Boolean(cronSecret),
      cronSecretLen: cronSecret?.length ?? 0,
      cronSecretHasLeadingOrTrailingWs:
        cronSecret != null && cronSecret !== cronSecret.trim(),
      authPresent: authHeader !== null,
      authLen: authHeader?.length ?? 0,
      bearerPrefixOk: authHeader?.startsWith("Bearer ") ?? false,
      expectedBearerLen: expectedBearer.length,
      exactMatch,
      lenMismatch:
        Boolean(cronSecret) &&
        authHeader !== null &&
        authHeader.length !== expectedBearer.length,
    };
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75a44",
      },
      body: JSON.stringify({
        sessionId: "b75a44",
        location: "app/api/cron/evaluate/route.ts:GET",
        message: "cron evaluate auth check",
        data: authDebugData,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // Vercel/production: ingest is unreachable from the edge; mirror to function logs.
    console.log(
      JSON.stringify({
        debugSession: "b75a44",
        tag: "cron-evaluate-auth",
        ...authDebugData,
      }),
    );
  }
  // #endregion
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
