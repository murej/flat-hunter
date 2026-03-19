import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { listing_id } = await req.json();

    if (!listing_id) {
      return NextResponse.json(
        { error: "listing_id required" },
        { status: 400 }
      );
    }

    const [{ data: listing }, { data: evaluation }] = await Promise.all([
      supabaseAdmin
        .from("listings")
        .select("title, address, price, url")
        .eq("id", listing_id)
        .single(),
      supabaseAdmin
        .from("evaluations")
        .select("*")
        .eq("listing_id", listing_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (!evaluation) {
      return NextResponse.json(
        { error: "No evaluation found for this property" },
        { status: 404 }
      );
    }

    const context = listing
      ? `Property: ${listing.title} at ${listing.address} (£${listing.price?.toLocaleString()})\n\nEvaluation:\n${JSON.stringify(evaluation, null, 2)}`
      : `Evaluation:\n${JSON.stringify(evaluation, null, 2)}`;

    return NextResponse.json({
      context,
      listing: listing ?? null,
      evaluation,
    });
  } catch (error) {
    console.error("why_listing error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
