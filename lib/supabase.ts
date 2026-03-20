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

// Convenience alias for backward compat
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAdmin() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export async function getPreferences(): Promise<Preferences | null> {
  const { data } = await supabaseAdmin
    .from("preferences")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data as Preferences | null;
}

export async function getListing(id: number): Promise<Listing | null> {
  const { data } = await supabaseAdmin
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();
  return data as Listing | null;
}

export async function updateListingStatus(
  id: number,
  status: string,
): Promise<void> {
  await supabaseAdmin
    .from("listings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function logConversation(row: {
  telegram_message_id: number;
  direction: "inbound" | "outbound";
  message: string;
  listing_id?: number | null;
  intent?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("conversations").insert(row);
  // 23505 = unique_violation — dedup
  if (error && error.code !== "23505") {
    console.error("logConversation error:", error.message);
  }
}

export async function getConversationHistory(
  limit = 8,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("direction, message")
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
  const { data } = await supabaseAdmin
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
  await supabaseAdmin.from("agent_context").upsert(
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
  await supabaseAdmin
    .from("agent_context")
    .delete()
    .eq("agent_id", "session")
    .eq("scope", "mode")
    .eq("scope_value", "current");
}

export async function getActiveListingId(
  lookback = 10,
): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("listing_id")
    .not("listing_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(lookback);

  if (!data || data.length === 0) return null;
  return (data[0] as { listing_id: number }).listing_id;
}
