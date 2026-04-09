import { getSupabaseAdmin } from "@/lib/supabase";
import type { DbToolConfig } from "@/lib/core/tools";

export const areaExpertDbConfig: DbToolConfig = {
  supabaseClient: getSupabaseAdmin(),
  allowlistedTables: ["preferences", "agent_context"],
  rowShaping: {
    agent_context: (rows) =>
      (rows as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        content: r.content
          ? (JSON.stringify(r.content).slice(0, 2500) +
            (JSON.stringify(r.content).length > 2500 ? "..." : ""))
          : null,
      })),
  },
};
