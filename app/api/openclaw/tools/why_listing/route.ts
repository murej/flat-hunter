import { NextRequest, NextResponse } from "next/server";
import { getWhyContext } from "@/lib/openclaw/tools";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 }
      );
    }

    const result = await getWhyContext(listing_id);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      );
    }

    return NextResponse.json({
      context: result.context,
      listing: result.listing,
      evaluation: result.evaluation,
    });
  } catch (error) {
    console.error("why_listing error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
