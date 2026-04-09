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

/** Max characters of email-derived body text passed to the listing parser (before listing URL block). */
export const MAX_INPUT_CHARS = 20_000;

/** Stored listing description cap after parse (reduces parse completion + evaluation prompt size). */
export const MAX_LISTING_DESCRIPTION_CHARS = 2000;

/**
 * Regex sources for UK portal property detail URLs (flags applied when compiling).
 * Keep in sync with path rules in tools.ts (listing URL validation / repair).
 */
export const LISTING_URL_PATTERN_SOURCES = [
  String.raw`https?://(?:www\.)?rightmove\.co\.uk/properties/\d+`,
  String.raw`https?://(?:www\.)?zoopla\.co\.uk/(?:for-sale|to-rent)/details/\d+`,
  String.raw`https?://(?:www\.)?zoopla\.co\.uk/details/\d+`,
  String.raw`https?://(?:www\.)?onthemarket\.com/details/\d+`,
  String.raw`https?://(?:www\.)?primelocation\.com/(?:for-sale|to-rent)/details/\d+`,
  String.raw`https?://(?:www\.)?primelocation\.com/details/\d+`,
  String.raw`https?://(?:www\.)?ostrich\.co\.uk/property/[a-z0-9][a-z0-9-]*`,
  String.raw`https?://(?:www\.)?ostrich\.co\.uk/sign-up/\?slug=[a-z0-9][a-z0-9-]*`,
] as const;

/** Shown in LLM context and referenced in parse instructions (no trailing colon). */
export const INGEST_LISTING_URLS_SECTION_HEADING =
  "Detected listing URLs (property detail pages only)";
