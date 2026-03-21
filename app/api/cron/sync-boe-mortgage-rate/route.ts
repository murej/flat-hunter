import { NextResponse } from "next/server";
import { syncMortgageRateFromEnv } from "@/lib/sync-boe-mortgage-rate";

export const maxDuration = 30;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { rate } = await syncMortgageRateFromEnv();
    return NextResponse.json({ ok: true, rate });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
