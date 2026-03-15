import { NextRequest, NextResponse } from "next/server";
import { runEvaluationPipeline } from "@/lib/agents/propertyEvaluator";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 }
      );
    }

    await runEvaluationPipeline(listing_id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Evaluate error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
