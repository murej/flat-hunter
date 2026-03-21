/**
 * Side-effect imports so specialist agents are registered before the conversation
 * pipeline runs (runAgent / call_agent tool).
 */
import "@/lib/agents/property-expert";
import "@/lib/agents/area-expert";
import "@/lib/agents/preference";
