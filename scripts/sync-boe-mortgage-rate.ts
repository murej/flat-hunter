import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Manual rate sync — update the mortgage rate stored in agent_context
  const rate = parseFloat(process.env.MORTGAGE_RATE || "4.5");

  const { error } = await supabase.from("agent_context").upsert(
    {
      agent_id: "system",
      scope: "global",
      scope_value: "mortgage_rate",
      content: { rate, updated_at: new Date().toISOString() },
    },
    { onConflict: "agent_id,scope,scope_value" },
  );

  if (error) {
    console.error("Error syncing rate:", error.message);
    process.exit(1);
  }

  console.log(`Mortgage rate synced: ${rate}%`);
}

main().catch(console.error);
