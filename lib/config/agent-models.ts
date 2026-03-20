/**
 * Anthropic model IDs for each agent path — override via env (see .env.example).
 */

import { envModel } from "@/lib/config/env-utils";

const HAIKU_DEFAULT = "claude-haiku-4-5";
const SONNET_DEFAULT = "claude-sonnet-4-6";

/** When `runAgent` omits `model` (e.g. simple text turns). */
export function getRunAgentDefaultModel(): string {
  return envModel(process.env.LLM_DEFAULT_MODEL, HAIKU_DEFAULT);
}

export function getPropertyExpertModel(): string {
  return envModel(process.env.PROPERTY_EXPERT_MODEL, SONNET_DEFAULT);
}

export function getAreaExpertModel(): string {
  return envModel(process.env.AREA_EXPERT_MODEL, SONNET_DEFAULT);
}

/** Telegram conversation router (tools + Haiku-class tasks). */
export function getConversationModel(): string {
  return envModel(process.env.CONVERSATION_MODEL, HAIKU_DEFAULT);
}

/** Why/compare explanation step after a data tool (defaults to CONVERSATION_MODEL). */
export function getConversationExplanationModel(): string {
  const explicit = process.env.CONVERSATION_EXPLANATION_MODEL?.trim();
  if (explicit) return explicit;
  return getConversationModel();
}

/** “Why?” callback from scorecard (defaults to conversation explanation model). */
export function getWhyExplanationModel(): string {
  const explicit = process.env.WHY_EXPLANATION_MODEL?.trim();
  if (explicit) return explicit;
  return getConversationExplanationModel();
}

export function getPreferenceCollectorModel(): string {
  return envModel(process.env.PREFERENCE_COLLECTOR_MODEL, HAIKU_DEFAULT);
}

/** Listing JSON extraction from alert email HTML. */
export function getIngestParseModel(): string {
  return envModel(process.env.INGEST_PARSE_MODEL, HAIKU_DEFAULT);
}

export function getEmailVerificationModel(): string {
  return envModel(process.env.EMAIL_VERIFICATION_MODEL, HAIKU_DEFAULT);
}

export function getAreaProfileModel(): string {
  return envModel(process.env.AREA_PROFILE_MODEL, HAIKU_DEFAULT);
}
