/** Label used for LLM usage logging for the main conversation agent. */
export const TELEMETRY_TAG = "conversation";

/** Label used for LLM usage logging for why-explanation sub-agent chains. */
export const TELEMETRY_TAG_WHY = "why_explanation";

/** Label used for LLM usage logging for property comparison sub-agent chains. */
export const TELEMETRY_TAG_COMPARISON = "comparison";

/**
 * Maximum LLM steps for chained why/comparison sub-agents.
 * These are single-shot text generation calls (no tool use),
 * so 1 step is sufficient.
 * Default: 1
 */
export const SUB_AGENT_MAX_STEPS = 1;
