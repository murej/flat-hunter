import { supabaseAdmin } from "@/lib/supabase";

const ALLOWLISTED_TABLES = [
  "preferences",
  "listings",
  "evaluations",
  "conversations",
  "agent_context",
] as const;

type AllowlistedTable = (typeof ALLOWLISTED_TABLES)[number];

function isAllowlisted(table: string): table is AllowlistedTable {
  return ALLOWLISTED_TABLES.includes(table as AllowlistedTable);
}

function sanitizeFilters(
  filters: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof key !== "string" || key.includes(";") || key.includes("--")) {
      continue;
    }
    if (value !== null && value !== undefined) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export async function dbRead(
  table: string,
  filters?: Record<string, unknown>,
  limit = 100,
): Promise<{ ok: true; data: unknown[] } | { ok: false; error: string }> {
  if (!isAllowlisted(table)) {
    return { ok: false, error: `Table "${table}" is not allowlisted` };
  }

  try {
    let query = supabaseAdmin.from(table).select("*");

    if (filters && Object.keys(filters).length > 0) {
      const sanitized = sanitizeFilters(filters);
      for (const [key, value] of Object.entries(sanitized)) {
        if (Array.isArray(value)) {
          query = query.in(key, value);
        } else {
          query = query.eq(key, value);
        }
      }
    }

    query = query.limit(Math.min(limit, 100)).order("created_at", {
      ascending: false,
    });

    const { data, error } = await query;

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: data ?? [] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function dbWrite(
  table: string,
  operation: "insert" | "upsert" | "update",
  data: Record<string, unknown>,
  filters?: Record<string, unknown>,
): Promise<{ ok: true; data?: unknown } | { ok: false; error: string }> {
  if (!isAllowlisted(table)) {
    return { ok: false, error: `Table "${table}" is not allowlisted` };
  }

  try {
    if (operation === "insert") {
      const { data: inserted, error } = await supabaseAdmin
        .from(table)
        .insert(data)
        .select()
        .single();

      if (error) return { ok: false, error: error.message };
      return { ok: true, data: inserted };
    }

    if (operation === "upsert") {
      const upsertData = { ...data, updated_at: new Date().toISOString() };
      const options =
        table === "agent_context"
          ? { onConflict: "agent_id,scope,scope_value" as const }
          : {};
      const { data: upserted, error } = await supabaseAdmin
        .from(table)
        .upsert(upsertData, options)
        .select()
        .single();

      if (error) return { ok: false, error: error.message };
      return { ok: true, data: upserted };
    }

    if (operation === "update") {
      if (!filters || Object.keys(filters).length === 0) {
        return { ok: false, error: "Update requires filters" };
      }

      let query = supabaseAdmin.from(table).update(data);

      const sanitized = sanitizeFilters(filters);
      for (const [key, value] of Object.entries(sanitized)) {
        query = query.eq(key, value);
      }

      const { data: updated, error } = await query.select().single();

      if (error) return { ok: false, error: error.message };
      return { ok: true, data: updated };
    }

    return { ok: false, error: `Unknown operation: ${operation}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export const DB_READ_TOOL = {
  name: "db_read",
  description:
    "Read rows from an allowlisted table. Tables: preferences, listings, evaluations, conversations, agent_context.",
  input_schema: {
    type: "object" as const,
    properties: {
      table: {
        type: "string",
        description:
          "Table name (preferences, listings, evaluations, conversations, agent_context)",
      },
      filters: {
        type: "object",
        description: "Optional filters as key-value pairs",
      },
      limit: {
        type: "number",
        description: "Max rows to return (default 100)",
      },
    },
    required: ["table"],
  },
};

export const DB_WRITE_TOOL = {
  name: "db_write",
  description:
    "Insert, upsert, or update rows in an allowlisted table. For agent_context use upsert to refine findings.",
  input_schema: {
    type: "object" as const,
    properties: {
      table: { type: "string", description: "Table name" },
      operation: {
        type: "string",
        enum: ["insert", "upsert", "update"],
        description: "Operation type",
      },
      data: { type: "object", description: "Row data" },
      filters: {
        type: "object",
        description: "Required for update: key-value filters",
      },
    },
    required: ["table", "operation", "data"],
  },
};
