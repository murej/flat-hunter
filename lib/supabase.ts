import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Service role client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Anon client for public operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getPreferences() {
  const { data, error } = await supabaseAdmin
    .from("preferences")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getListing(id: string) {
  const { data, error } = await supabaseAdmin
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function updateListingStatus(id: string, status: string) {
  const { error } = await supabaseAdmin
    .from("listings")
    .update({ status })
    .eq("id", id);

  if (error) throw error;
}

export async function logConversation(params: {
  telegram_message_id?: string;
  direction: "inbound" | "outbound";
  message: string;
  listing_id?: string | null;
  intent?: string | null;
}) {
  const { error } = await supabaseAdmin.from("conversations").insert({
    telegram_message_id: params.telegram_message_id ?? null,
    direction: params.direction,
    message: params.message,
    listing_id: params.listing_id ?? null,
    intent: params.intent ?? null,
  });

  if (error) throw error;
}
