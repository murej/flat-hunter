import { NextRequest, NextResponse } from "next/server";
import { getListing } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 }
      );
    }

    const listing = await getListing(listing_id);
    return NextResponse.json({ listing });
  } catch (error) {
    console.error("get_listing error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
