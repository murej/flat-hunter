import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { truncateForToolResult } from "@/lib/utils/tool-result";

export type DbToolConfig = {
  supabaseClient: SupabaseClient;
  allowlistedTables: string[];
  columnOverrides?: Record<string, string>;
  rowShaping?: Record<string, (rows: unknown[]) => unknown[]>;
};

function validateTable(table: string, allowed: string[]): string | null {
  if (!allowed.includes(table)) {
    return `Table "${table}" not allowed. Allowed: ${allowed.join(", ")}`;
  }
  return null;
}

const DB_READ_BASE_DESCRIPTION =
  "Read rows from the database. Returns a JSON array of matching rows.";

export function buildDbReadTool(
  config: DbToolConfig,
  schemaAppendix: string,
) {
  return tool({
    description: `${DB_READ_BASE_DESCRIPTION}\n\n${schemaAppendix}`,
    inputSchema: z.object({
      table: z.string().describe("Table name to query"),
      columns: z
        .string()
        .optional()
        .describe(
          "Comma-separated columns to select (default: table-specific subset in schema below, or * if none)",
        ),
      filters: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Key-value equality filters"),
      order_by: z
        .string()
        .optional()
        .describe("Column to order by (prefix with - for descending)"),
      limit: z.number().optional().describe("Max rows to return (default 20)"),
    }),
    execute: async ({ table, columns, filters, order_by, limit }) => {
      const err = validateTable(table, config.allowlistedTables);
      if (err) return err;

      const selectCols =
        config.columnOverrides?.[table] ?? columns ?? "*";
      let query = config.supabaseClient
        .from(table)
        .select(selectCols);

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }
      }

      if (order_by) {
        const desc = order_by.startsWith("-");
        const col = desc ? order_by.slice(1) : order_by;
        query = query.order(col, { ascending: !desc });
      }

      query = query.limit(limit ?? 20);

      const { data, error } = await query;
      if (error) return `DB error: ${error.message}`;

      let rows = data as unknown[];
      if (config.rowShaping?.[table]) {
        rows = config.rowShaping[table](rows);
      }

      return truncateForToolResult(JSON.stringify(rows, null, 2));
    },
  });
}

export function buildDbWriteTool(config: DbToolConfig) {
  return tool({
    description:
      "Insert or update a row in the database. Returns the affected row.",
    inputSchema: z.object({
      table: z.string().describe("Table name"),
      operation: z
        .enum(["insert", "update"])
        .describe("insert or update"),
      data: z.record(z.string(), z.unknown()).describe("Row data as key-value pairs"),
      filters: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Equality filters for update (required for update)"),
    }),
    execute: async ({ table, operation, data, filters }) => {
      const err = validateTable(table, config.allowlistedTables);
      if (err) return err;

      if (operation === "insert") {
        const { data: result, error } = await config.supabaseClient
          .from(table)
          .insert(data)
          .select()
          .single();
        if (error) return `DB error: ${error.message}`;
        return JSON.stringify(result);
      }

      if (!filters || Object.keys(filters).length === 0) {
        return "Error: filters required for update operation.";
      }

      let query = config.supabaseClient.from(table).update(data);
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value as string);
      }
      const { data: result, error } = await query.select().single();
      if (error) return `DB error: ${error.message}`;
      return JSON.stringify(result);
    },
  });
}
