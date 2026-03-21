/** Registry key used to register this agent with the agent registry. */
export const AGENT_NAME = "preference";

/** Label used for LLM usage logging via telemetry. */
export const TELEMETRY_TAG = "preference";

/**
 * Maximum number of LLM tool-use rounds per invocation.
 * Preference collection is multi-turn so needs several rounds to
 * read existing prefs, ask follow-ups, and write the final row.
 * Default: 5
 */
export const PREFERENCE_MAX_STEPS = 5;
