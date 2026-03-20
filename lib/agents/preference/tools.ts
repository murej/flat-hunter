import { buildTools } from "@/lib/core/tools";
import { dbConfig } from "@/lib/config/db-config";

export function getPreferenceTools() {
  return buildTools(["db"], { db: dbConfig });
}
