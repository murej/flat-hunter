import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/supabase";
import { runEvaluationPipeline } from "@/lib/tools/evaluator";
import { buildScorecardButtons } from "@/lib/tools/scorecard";
import { consumePendingNotifications } from "@/lib/openclaw/notifications";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 }
      );
    }

    const result = await runEvaluationPipeline(listing_id, {
      sendImmediately: false,
    });

    if (typeof result === "object" && result.sent) {
      const batchId = crypto.randomUUID();
      const buttons = buildScorecardButtons(
        result.listing.id,
        result.listing.status === "saved",
      );
      await supabaseAdmin.from("pending_notifications").insert({
        batch_id: batchId,
        sequence: 0,
        type: "scorecard",
        payload: {
          listingId: result.listing.id,
          scorecardText: result.scorecardText,
          buttons,
        },
      });
      if (process.env.VERCEL) {
        waitUntil(consumePendingNotifications(batchId));
      } else {
        await consumePendingNotifications(batchId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Evaluate error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
