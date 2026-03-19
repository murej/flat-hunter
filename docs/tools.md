# Tools

## Tool levels

Three levels of tools:

| Level | Location | Scope | Example |
|-------|----------|-------|---------|
| **Core** | `lib/core/tools/` | All agents | `db`, `call_agent`, `web_search` |
| **Agent-specific** | `lib/agents/{name}/tools.ts` | Single agent | Custom schemas + execute logic |
| **Shared** | `lib/tools/` | Multiple agents | Domain helpers (e.g. fetch external API) |

## Core tools (ToolSet pattern)

Core tools are composed via `ToolSet[]`:

- `db` — `db_read`, `db_write` (allowlisted tables)
- `call_agent` — Delegate to another registered agent
- `web_search` — Anthropic native web search

### Using core tools only

```typescript
// lib/agents/my-agent/tools.ts
import {
  buildTools,
  createExecuteTool,
  type ToolSet,
} from "@/lib/core/tools";

export const MY_AGENT_TOOL_SETS: ToolSet[] = ["db", "web_search"];

export function buildMyAgentTools() {
  return buildTools(MY_AGENT_TOOL_SETS);
}

export function createMyAgentExecuteTool() {
  return createExecuteTool(MY_AGENT_TOOL_SETS);
}
```

## Agent-specific tools

When an agent needs custom tools (schemas + execute logic):

1. Define schemas in Anthropic tool format.
2. Implement `executeToolInternal` that handles each tool name.
3. Compose with core tools: `[...buildTools(["call_agent", "db"]), ...CUSTOM_SCHEMAS]`.
4. Wrap in a custom execute function that routes core tools to `createExecuteTool(ToolSet[])` and custom tools to your handler.

### Example: custom tool + core tools

```typescript
// lib/agents/orchestrator/tools.ts
import type { Anthropic } from "@anthropic-ai/sdk";
import { buildTools, executeCallAgent } from "@/lib/core/tools";
import { dbRead, dbWrite } from "@/lib/core/tools/db";
import type { ToolResult } from "@/lib/core/agent";
import { fetchFromApi } from "@/lib/tools/external-api";

export const CUSTOM_TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: "get_item",
    description: "Fetch an item by ID from the external API.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Item ID" },
      },
      required: ["id"],
    },
  },
];

export function buildOrchestratorTools(): Anthropic.Tool[] {
  return [...buildTools(["call_agent", "db"]), ...CUSTOM_TOOL_SCHEMAS];
}

export function createOrchestratorExecuteTool() {
  return async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> => {
    // Route core tools
    if (name === "call_agent") {
      const data = await executeCallAgent(
        String(input.agent),
        String(input.prompt),
      );
      return { type: "data", data, toolName: name };
    }
    if (name === "db_read") {
      const result = await dbRead(
        String(input.table),
        input.filters as Record<string, unknown>,
        (input.limit as number) ?? 100,
      );
      const data = result.ok ? JSON.stringify(result.data) : result.error;
      return { type: "data", data, toolName: name };
    }
    // db_write: similar pattern, or delegate to createExecuteTool for core-only agents

    // Route custom tools
    if (name === "get_item") {
      const data = await fetchFromApi(input.id as string);
      return { type: "data", data: JSON.stringify(data), toolName: name };
    }

    return { type: "data", data: `Unknown tool: ${name}`, toolName: name };
  };
}
```

## Shared tools

Shared tools live in `lib/tools/` and are plain functions imported by agents. They are not LLM tool schemas — they are called from within execute logic:

```typescript
// lib/tools/external-api.ts
export async function fetchFromApi(id: string): Promise<Data> {
  const res = await fetch(`https://api.example.com/items/${id}`);
  return res.json();
}
```

```typescript
// In agent's tools.ts execute logic
case "get_item": {
  const data = await fetchFromApi(toolInput.id as string);
  return { type: "data", data: JSON.stringify(data), toolName };
}
```

## Adding a new core tool

1. Add to `lib/core/tools/index.ts`: extend `ToolSet` type, add to `buildTools` and `createExecuteTool`.
2. Add schema (e.g. `MY_TOOL`) and implementation (e.g. `executeMyTool`) in a new file under `lib/core/tools/`.
3. Agents can then include it in their `ToolSet[]`.

## Adding a new agent

1. Create `lib/agents/{name}/` with `index.ts`, `prompts.ts`, `tools.ts`.
2. In `index.ts`: import prompts and tools, call `registerAgent` if the agent should be delegatable.
3. In `tools.ts`: use `buildTools`/`createExecuteTool` for core tools only, or add custom schemas and routing.
4. Ensure the agent module is imported somewhere so registration runs (e.g. via handler or API route).
