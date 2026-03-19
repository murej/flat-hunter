# Agent and Tool Architecture

When modifying agents or tools, read the docs first:

- [docs/README.md](docs/README.md) — Overview
- [docs/structure.md](docs/structure.md) — Directory layout
- [docs/agents.md](docs/agents.md) — Agent setup and lifecycle
- [docs/tools.md](docs/tools.md) — Tool levels and setup

Follow the structure: agents in `lib/agents/{name}/` with `index.ts`, `prompts.ts`, `tools.ts`. Use core ToolSet for generic tools; add agent-specific tools in the agent's `tools.ts`.
