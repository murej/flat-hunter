/**
 * Env-driven knobs for Telegram conversation + related LLM calls (token/cost control).
 */

import { envBool, envIntClamped } from "@/lib/config/env-utils";

export {
  getAreaProfileModel,
  getEmailVerificationModel,
} from "@/lib/config/agent-models";

/** Default true — set CONVERSATION_CALL_AGENT=false to avoid nested Sonnet experts from chat. */
export function isConversationCallAgentEnabled(): boolean {
  return envBool(
    process.env.CONVERSATION_CALL_AGENT,
    true,
    "CONVERSATION_CALL_AGENT",
  );
}

/** Default true — set CONVERSATION_ALLOW_RE_EVALUATION=false to block full pipeline re-runs from chat. */
export function isConversationReEvaluationAllowed(): boolean {
  return envBool(
    process.env.CONVERSATION_ALLOW_RE_EVALUATION,
    true,
    "CONVERSATION_ALLOW_RE_EVALUATION",
  );
}

/** Default 3, clamped 1–5. */
export function getConversationMaxToolIterations(): number {
  return envIntClamped(
    process.env.CONVERSATION_MAX_TOOL_ITERATIONS,
    3,
    1,
    5,
    "CONVERSATION_MAX_TOOL_ITERATIONS",
  );
}

/**
 * Full pipeline re-eval from chat: minimum hours since last evaluation. 0 = no cooldown.
 * Default 24.
 */
export function getReEvalCooldownHours(): number {
  return envIntClamped(
    process.env.RE_EVAL_COOLDOWN_HOURS,
    24,
    0,
    8760,
    "RE_EVAL_COOLDOWN_HOURS",
  );
}

/** Default 5 (matches previous implicit runAgent default), clamped 1–5. */
export function getPreferenceMaxToolIterations(): number {
  return envIntClamped(
    process.env.PREFERENCE_MAX_TOOL_ITERATIONS,
    5,
    1,
    5,
    "PREFERENCE_MAX_TOOL_ITERATIONS",
  );
}

/**
 * When true and 2+ areas, try one batched LLM call for area profiles; fallback to per-area on failure.
 * Default false.
 */
export function isAreaProfileBatchEnabled(): boolean {
  return envBool(
    process.env.AREA_PROFILE_BATCH,
    false,
    "AREA_PROFILE_BATCH",
  );
}
