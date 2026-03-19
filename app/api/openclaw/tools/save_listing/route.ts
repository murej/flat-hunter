import { NextRequest, NextResponse } from "next/server";
import { saveListing } from "@/lib/openclaw/tools";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 }
      );
    }

    await saveListing(listing_id);
    return NextResponse.json({ ok: true, status: "saved" });
  } catch (error) {
    console.error("save_listing error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
