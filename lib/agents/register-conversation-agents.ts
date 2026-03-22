/**
 * Side-effect imports so agents are registered before the conversation pipeline runs.
 * Property and area experts register asynchronously via ensureDbToolAgentsRegistered()
 * (db_read schema RPC); see app/api/telegram/route.ts and call_agent / evaluation entrypoints.
 */
import "@/lib/agents/preference";
