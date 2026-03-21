import { NextResponse } from "next/server";
import { reportError } from "@/lib/core/reporting";
import { supabaseAdmin } from "@/lib/supabase";
import { runEvaluationsAndNotify } from "@/lib/agents/ingest/tools";

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

  const { data: pending } = await supabaseAdmin
    .from("listings")
    .select("id")
    .eq("status", "pending_evaluation")
    .order("created_at", { ascending: true })
    .limit(4); // ~4 per invocation within 60s ceiling

  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const ids = pending.map((r: { id: string }) => r.id);
  try {
    await runEvaluationsAndNotify(ids);
  } catch (err) {
    await reportError(err, { source: "api/cron/evaluate" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, processed: ids.length });
}
