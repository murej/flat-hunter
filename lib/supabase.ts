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
}): Promise<{ inserted: boolean }> {
  const { error } = await supabaseAdmin.from("conversations").insert({
    telegram_message_id: params.telegram_message_id ?? null,
    direction: params.direction,
    message: params.message,
    listing_id: params.listing_id ?? null,
    intent: params.intent ?? null,
  });

  if (error) {
    if (error.code === "23505") return { inserted: false };
    throw error;
  }
  return { inserted: true };
}

/**
 * Returns the listing_id from the most recent conversation row that has one,
 * looking back through the last `lookback` rows. Used to resolve "it" / "that
 * property" references when no UUID appears in the user's message.
 */
export async function getActiveListingId(
  lookback = 10
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("listing_id")
    .not("listing_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(lookback);

  return data?.[0]?.listing_id ?? null;
}

/**
 * Returns the last `limit` conversation rows formatted as Claude message pairs
 * (inbound → "user", outbound → "assistant"), in chronological order.
 */
export async function getConversationHistory(
  limit = 8
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("direction, message")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? [])
    .reverse()
    .map((row) => ({
      role: (row.direction === "inbound" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: row.message as string,
    }));
}
