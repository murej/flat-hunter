import { envBool } from "@/lib/utils/env-utils";

export const CONVERSATION_MAX_STEPS = 3;
export const RE_EVAL_COOLDOWN_HOURS = 24;

export function isCallAgentEnabled(): boolean {
  return envBool("CONVERSATION_CALL_AGENT", true);
}

export function isReEvaluationAllowed(): boolean {
  return envBool("CONVERSATION_ALLOW_RE_EVALUATION", true);
}
