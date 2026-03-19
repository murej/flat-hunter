import { NextRequest, NextResponse } from "next/server";
import { skipListing } from "@/lib/openclaw/tools";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 }
      );
    }

    await skipListing(listing_id);
    return NextResponse.json({ ok: true, status: "dismissed" });
  } catch (error) {
    console.error("skip_listing error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
