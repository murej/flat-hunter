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

/** Avoid select("*") for tables with huge columns (e.g. raw_email_html). */
function selectColumnsForAgentRead(table: AllowlistedTable): string {
  switch (table) {
    case "listings":
      return [
        "id",
        "created_at",
        "portal_id",
        "url",
        "title",
        "price",
        "address",
        "postcode",
        "bedrooms",
        "bathrooms",
        "sqft",
        "description",
        "image_urls",
        "floorplan_url",
        "agent_name",
        "agent_email",
        "listed_date",
        "status",
      ].join(",");
    case "evaluations":
      return [
        "id",
        "listing_id",
        "created_at",
        "price_score",
        "size_score",
        "fit_score",
        "area_score",
        "commute_score",
        "overall_score",
        "deal_breaker_flags",
        "commute_minutes",
        "commute_route",
        "monthly_mortgage",
        "monthly_interest_only",
        "stamp_duty",
        "estimated_monthly_total",
        "property_summary",
        "area_summary",
        "property_scores_unknown",
        "area_score_unknown",
        "commute_score_unknown",
      ].join(",");
    case "preferences":
      return [
        "id",
        "created_at",
        "updated_at",
        "areas",
        "max_price",
        "min_bedrooms",
        "must_haves",
        "deal_breakers",
        "commute_anchor",
        "commute_anchor_postcode",
        "max_commute_minutes",
        "style_notes",
        "freeform_notes",
        "deposit",
        "area_preferences",
      ].join(",");
    default:
      return "*";
  }
}

const MAX_LISTING_DESCRIPTION_AGENT_CHARS = 3500;
const MAX_CONVERSATION_MESSAGE_AGENT_CHARS = 1500;
const MAX_AGENT_CONTEXT_FINDINGS_CHARS = 2500;

function shapeRowsForAgentRead(
  table: AllowlistedTable,
  rows: unknown[],
): unknown[] {
  if (table === "listings") {
    return rows.map((r) => {
      if (!r || typeof r !== "object") return r;
      const row = { ...(r as Record<string, unknown>) };
      const d = row.description;
      if (typeof d === "string" && d.length > MAX_LISTING_DESCRIPTION_AGENT_CHARS) {
        row.description = `${d.slice(0, MAX_LISTING_DESCRIPTION_AGENT_CHARS - 1)}…`;
      }
      return row;
    });
  }
  if (table === "conversations") {
    return rows.map((r) => {
      if (!r || typeof r !== "object") return r;
      const row = { ...(r as Record<string, unknown>) };
      const m = row.message;
      if (typeof m === "string" && m.length > MAX_CONVERSATION_MESSAGE_AGENT_CHARS) {
        row.message = `${m.slice(0, MAX_CONVERSATION_MESSAGE_AGENT_CHARS - 1)}…`;
      }
      return row;
    });
  }
  if (table === "agent_context") {
    return rows.map((r) => {
      if (!r || typeof r !== "object") return r;
      const row = { ...(r as Record<string, unknown>) };
      const c = row.content;
      if (c && typeof c === "object") {
        const content = { ...(c as Record<string, unknown>) };
        const findings = content.findings;
        if (
          typeof findings === "string" &&
          findings.length > MAX_AGENT_CONTEXT_FINDINGS_CHARS
        ) {
          content.findings = `${findings.slice(0, MAX_AGENT_CONTEXT_FINDINGS_CHARS - 1)}…`;
        }
        row.content = content;
      }
      return row;
    });
  }
  return rows;
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
    const columns = selectColumnsForAgentRead(table);
    let query = supabaseAdmin.from(table).select(columns);

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

    const shaped = shapeRowsForAgentRead(table, data ?? []);
    return { ok: true, data: shaped };
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
        description:
          "Max rows to return (default 100, capped at 100). Listings omit raw_email_html; evaluations omit raw_* json blobs; preferences omit raw_json — use the Property/Preferences JSON in the user message for full prefs.",
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
