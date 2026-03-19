import { NextResponse } from "next/server";
import { getPreferences } from "@/lib/supabase";

export async function GET() {
  try {
    const preferences = await getPreferences();
    return NextResponse.json({ preferences: preferences ?? null });
  } catch (error) {
    console.error("get_preferences error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
