import { NextResponse } from "next/server";
import { syncMortgageRateFromEnv } from "@/lib/sync-boe-mortgage-rate";
import { cronSecretFromEnv } from "@/lib/utils/env-utils";

export const maxDuration = 30;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = cronSecretFromEnv();
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
