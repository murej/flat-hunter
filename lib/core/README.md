# Layer 1 — Generic Agent Infrastructure

Domain-free, reusable LLM agent runtime. Depends only on Vercel AI SDK, Zod, and `@supabase/supabase-js`. Must never import from Layer 2.

## Modules

### `agent.ts`

`runAgent(input: RunAgentInput): Promise<RunAgentOutput>` — thin wrapper around `generateText()`. No domain logic, no side effects beyond the LLM call and optional usage logging.

- Default model: `claude-haiku-4-5` (override via `LLM_DEFAULT_MODEL`)
- Retries 429/529 via AI SDK `maxRetries: 4`
- Step limit via `stopWhen: stepCountIs(maxSteps)`
- Supports structured output via `Output.object()`
- Provider tools (e.g. web search) passed through `providerOptions`
- Usage logging when `LLM_USAGE_LOG=true`

### `types.ts`

- **RunAgentInput** — system prompt, tools, provider tools, model, messages, max steps, telemetry tag, output schema
- **RunAgentOutput** — `{ message: string }`
- **DirectToolResult** — `{ type: "direct", message, payload? }` for short-circuiting agent responses
- **DataToolResult** — `{ type: "data", data, toolName }` for chaining to sub-agents
- **ToolResult** — `DirectToolResult | DataToolResult`
- **AgentConfig** — registry entry shape

### `registry.ts`

`Map<string, AgentConfig>` — `registerAgent(name, config)` and `getAgentConfig(name)`. Used by the `call_agent` tool for cross-agent delegation.

### `tools/`

`buildTools(sets, config?)` returns Zod-based tools with `execute`. `buildProviderTools(sets)` returns Anthropic native tools.

| Tool | File | Description |
|------|------|-------------|
| `db_read` | `db.ts` | Query rows with filters, ordering, limits. Table allowlist enforced. |
| `db_write` | `db.ts` | Insert or update rows. Requires filters for updates. |
| `call_agent` | `call-agent.ts` | Delegate to a registered agent by name. |
| `web_search` | `web-search.ts` | Anthropic native web search (`webSearch_20250305`, max 3 uses). |

`DbToolConfig` accepts `columnOverrides` (exclude blob columns) and `rowShaping` (truncate long fields) for token optimization.

## Utilities (`../utils/`)

| File | Exports |
|------|---------|
| `env-utils.ts` | `envBool()`, `envIntClamped()`, `envModel()` |
| `retry.ts` | `retryWithBackoff()`, `isRateLimitError()`, `sleep()` — for external APIs only |
| `tool-result.ts` | `truncateForToolResult()` — cap tool output at ~8000 chars |
| `agent-output.ts` | `clampScore(n, fallback)` — clamp to [1, 10] |
