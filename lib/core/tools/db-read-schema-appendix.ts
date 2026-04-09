import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbToolConfig } from "./db";

type SchemaRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

/** How long to reuse the RPC schema result before refetching. */
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { configKey: string; text: string; fetchedAt: number } | null = null;

function configCacheKey(config: DbToolConfig): string {
  return [
    ...config.allowlistedTables,
    JSON.stringify(config.columnOverrides ?? {}),
  ].join("|");
}

function staticFallbackAppendix(config: DbToolConfig): string {
  const lines: string[] = ["### Allowed tables (fallback — RPC unavailable)"];
  for (const t of config.allowlistedTables) {
    const ov = config.columnOverrides?.[t];
    lines.push(
      ov
        ? `- **${t}** (default columns): ${ov}`
        : `- **${t}**: specify \`columns\` or use introspection when RPC is available`,
    );
  }
  return lines.join("\n");
}

function formatRowsToMarkdown(
  rows: SchemaRow[],
  config: DbToolConfig,
): string {
  const byTable = new Map<string, SchemaRow[]>();
  for (const r of rows) {
    const list = byTable.get(r.table_name) ?? [];
    list.push(r);
    byTable.set(r.table_name, list);
  }

  const out: string[] = ["### Schema (public, allowlisted tables)"];

  for (const table of config.allowlistedTables) {
    const cols = byTable.get(table);
    const override = config.columnOverrides?.[table];
    const want = override
      ? override.split(",").map((c) => c.trim()).filter(Boolean)
      : null;

    if (!cols?.length) {
      out.push(`- **${table}**: (no columns returned)`);
      continue;
    }

    const byName = new Map(cols.map((c) => [c.column_name, c]));
    const ordered: SchemaRow[] = [];
    if (want?.length) {
      for (const name of want) {
        const row = byName.get(name);
        if (row) ordered.push(row);
      }
    } else {
      ordered.push(...cols);
    }

    const body = ordered
      .map(
        (c) =>
          `  - \`${c.column_name}\` (${c.data_type}${c.is_nullable === "YES" ? ", nullable" : ""})`,
      )
      .join("\n");
    out.push(`- **${table}**\n${body}`);
  }

  return out.join("\n");
}

async function fetchRows(
  client: SupabaseClient,
  tables: string[],
): Promise<SchemaRow[] | null> {
  const { data, error } = await client.rpc("get_db_read_schema_subset", {
    p_tables: tables,
  });
  if (error) {
    console.warn("get_db_read_schema_subset RPC failed:", error.message);
    return null;
  }
  if (!data || !Array.isArray(data)) return null;
  return data as SchemaRow[];
}

function toolSemanticsAppendix(includeRelationships = true): string {
  const lines = [
    "### db_read usage",
    "- `filters`: equality (`.eq`) only — no substring or range.",
    "- `order_by`: column name; prefix `-` for descending (e.g. `-created_at`).",
    "- `limit`: default 20.",
    "- Omitting `columns` uses the **default column set** per table (subset above where columnOverrides apply).",
  ];

  if (includeRelationships) {
    lines.push(
      "### Relationships",
      "- `evaluations.listing_id` → `listings.id`",
      "- `conversations.listing_id` → `listings.id` (nullable)",
      "### listings.status",
      "Values: `pending_evaluation`, `evaluating`, `evaluated`, `saved`, `dismissed`, `viewing_requested`.",
    );
  }

  return lines.join("\n");
}

/**
 * Markdown appendix for the db_read tool: live introspection intersected with columnOverrides.
 */
export async function getDbReadSchemaDescriptionAppendix(
  config: DbToolConfig,
): Promise<string> {
  const key = configCacheKey(config);
  const now = Date.now();
  if (
    cache &&
    cache.configKey === key &&
    now - cache.fetchedAt < SCHEMA_CACHE_TTL_MS
  ) {
    return cache.text;
  }

  let schemaBlock: string;
  const rows = await fetchRows(
    config.supabaseClient,
    config.allowlistedTables,
  );

  if (rows?.length) {
    schemaBlock = formatRowsToMarkdown(rows, config);
  } else {
    console.warn("db_read schema: using static fallback (empty RPC or error)");
    schemaBlock = staticFallbackAppendix(config);
  }

  const includeRelationships = config.includeRelationships !== false;
  const full = `${schemaBlock}\n\n${toolSemanticsAppendix(includeRelationships)}`;
  cache = { configKey: key, text: full, fetchedAt: now };
  return full;
}
