/**
 * Shared prompt fragments and evaluation/highlights templates.
 * Agent-level system prompts live next to each agent (e.g. lib/agents/conversation/prompts.ts).
 */
export { STATH_PERSONALITY } from "./personality";
export { AREA_EVALUATION_CONTEXT, AREA_PROFILE_PROMPT } from "./area";
export { buildPropertyPrompt, buildAreaPrompt } from "./evaluation";
export { HIGHLIGHTS_SYSTEM } from "./highlights";
