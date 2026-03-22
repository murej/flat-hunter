import { CONVERSATION_AGENT_BASE, CONVERSATION_MODE_FRAGMENTS } from "./prompts";
import type { ConversationMode } from "./conversation-router";

export type { ConversationMode } from "./conversation-router";

export const MAX_STEPS_BY_MODE: Record<ConversationMode, number> = {
  general: 3,
  browse: 5,
  preferences: 4,
  insight: 5,
};

export function buildConversationSystemPrompt(mode: ConversationMode): string {
  const fragment = CONVERSATION_MODE_FRAGMENTS[mode];
  return `${CONVERSATION_AGENT_BASE}\n\n${fragment}`;
}
