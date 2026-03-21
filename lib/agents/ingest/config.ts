/** Label used for LLM usage logging when parsing verification emails. */
export const TELEMETRY_TAG_VERIFICATION = "email_verification";

/** Label used for LLM usage logging when parsing listing emails. */
export const TELEMETRY_TAG_PARSE = "ingest_parse";

/** Label used for LLM usage logging when generating ingest notifications. */
export const TELEMETRY_TAG_NOTIFICATION = "ingest_notification";

/**
 * Maximum LLM steps for parse and verification calls.
 * Both are one-shot structured-output calls with no tool use,
 * so 1 step is sufficient.
 * Default: 1
 */
export const MAX_PARSE_STEPS = 1;
