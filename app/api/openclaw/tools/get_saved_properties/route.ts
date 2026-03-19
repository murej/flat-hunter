import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data: listings } = await supabaseAdmin
      .from("listings")
      .select("id, title, price, address, url")
      .eq("status", "saved")
      .order("created_at", { ascending: false });

    return NextResponse.json({ listings: listings ?? [] });
  } catch (error) {
    console.error("get_saved_properties error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
