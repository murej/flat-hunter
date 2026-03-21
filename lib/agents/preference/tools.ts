import { buildDbWriteTool } from "@/lib/core/tools/db";
import { dbConfig } from "@/lib/config/db-config";

export function getPreferenceTools() {
  return { db_write: buildDbWriteTool(dbConfig) };
}
