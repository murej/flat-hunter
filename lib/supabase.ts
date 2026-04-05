import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Preferences, Listing } from "@/types";

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _client;
}

export async function getPreferences(): Promise<Preferences | null> {
  const { data } = await getSupabaseAdmin()
    .from("preferences")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data as Preferences | null;
}

export async function deletePreferences(): Promise<void> {
  await getSupabaseAdmin().from("preferences").delete().neq("id", 0);
}

export async function getListing(id: string): Promise<Listing | null> {
  const { data } = await getSupabaseAdmin()
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();
  return data as Listing | null;
}

export async function countListings(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from("listings")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.error("countListings:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function updateListingStatus(
  id: string,
  status: string,
): Promise<void> {
  await getSupabaseAdmin()
    .from("listings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function logConversation(row: {
  telegram_message_id: number;
  direction: "inbound" | "outbound";
  message: string;
  listing_id?: string | null;
  intent?: string | null;
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from("conversations").insert(row);
  // 23505 = unique_violation — dedup
  if (error && error.code !== "23505") {
    console.error("logConversation error:", error.message);
  }
}

export async function getConversationHistory(
  limit = 8,
  excludeIntents: string[] = [],
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const baseExcluded = ["save", "skip", "unsave", "greeting", "stop", "restart", "preferences", "liked"];
  const allExcluded = [...baseExcluded, ...excludeIntents];
  const excludeList = `(${allExcluded.map(i => `"${i}"`).join(",")})`;
  const { data } = await getSupabaseAdmin()
    .from("conversations")
    .select("direction, message")
    .not("intent", "in", excludeList)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data
    .reverse()
    .map((row: { direction: string; message: string }) => ({
      role: (row.direction === "inbound" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content:
        row.message.length > 1600
          ? row.message.slice(0, 1600) + "..."
          : row.message,
    }));
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function getSessionMode(): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("agent_context")
    .select("content")
    .eq("agent_id", "session")
    .eq("scope", "mode")
    .eq("scope_value", "current")
    .single();
  if (!data) return null;
  const content = data.content as { mode?: string; entered_at?: string };
  if (content.entered_at) {
    const elapsed = Date.now() - new Date(content.entered_at).getTime();
    if (elapsed > SESSION_TIMEOUT_MS) {
      await clearSessionMode();
      return null;
    }
  }
  return content.mode ?? null;
}

export async function setSessionMode(mode: string): Promise<void> {
  await getSupabaseAdmin().from("agent_context").upsert(
    {
      agent_id: "session",
      scope: "mode",
      scope_value: "current",
      content: { mode, entered_at: new Date().toISOString() },
    },
    { onConflict: "agent_id,scope,scope_value" },
  );
}

export async function clearSessionMode(): Promise<void> {
  await getSupabaseAdmin()
    .from("agent_context")
    .delete()
    .eq("agent_id", "session")
    .eq("scope", "mode")
    .eq("scope_value", "current");
}

export async function storeMessageListing(
  telegramMessageId: number,
  listingId: string,
): Promise<void> {
  await getSupabaseAdmin()
    .from("message_listings")
    .upsert({ telegram_message_id: telegramMessageId, listing_id: listingId });
}

export async function getListingByMessageId(
  telegramMessageId: number,
): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("message_listings")
    .select("listing_id")
    .eq("telegram_message_id", telegramMessageId)
    .single();
  return (data as { listing_id: string } | null)?.listing_id ?? null;
}

export async function storeMessagePreferenceSection(
  telegramMessageId: number,
  sectionKey: string,
): Promise<void> {
  await getSupabaseAdmin()
    .from("message_preference_sections")
    .upsert({ telegram_message_id: telegramMessageId, section_key: sectionKey });
}

export async function getPreferenceSectionForMessage(
  telegramMessageId: number,
): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("message_preference_sections")
    .select("section_key")
    .eq("telegram_message_id", telegramMessageId)
    .single();
  return (data as { section_key: string } | null)?.section_key ?? null;
}

export async function getActiveListingId(
  lookback = 10,
): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("conversations")
    .select("listing_id")
    .not("listing_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(lookback);

  if (!data || data.length === 0) return null;
  const id = (data[0] as { listing_id: string | number | null }).listing_id;
  return id == null ? null : String(id);
}
