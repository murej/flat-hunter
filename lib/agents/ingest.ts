/**
 * Ingest agent: transforms email to structured listing, stores listing in db.
 * Re-exports from lib/tools/ingest for now; parsing uses direct Claude calls.
 */
export {
  ingestAgent,
  runEvaluationsAndNotify,
  computeIdempotencyKey,
  claimIdempotencyKey,
  type IngestResult,
} from "@/lib/tools/ingest";
