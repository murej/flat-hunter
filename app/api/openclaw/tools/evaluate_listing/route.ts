import { NextRequest, NextResponse } from "next/server";
import { runEvaluationPipeline } from "@/lib/tools/evaluator";
import { buildScorecardButtons } from "@/lib/tools/scorecard";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 },
      );
    }

    const result = await runEvaluationPipeline(listing_id);

    if (typeof result !== "object" || !("scorecardText" in result)) {
      return NextResponse.json({ error: "Evaluation failed" }, { status: 500 });
    }

    const buttons = buildScorecardButtons(
      result.listing.id,
      result.listing.status === "saved",
    );

    return NextResponse.json({
      scorecardText: result.scorecardText,
      buttons,
      listingId: result.listing.id,
      overall_score: result.overall_score,
      unknownScores: result.unknownScores,
      shouldSendNoScore: result.shouldSendNoScore,
    });
  } catch (error) {
    console.error("evaluate_listing error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
