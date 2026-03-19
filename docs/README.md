# Documentation

## Overview

This codebase uses an agent-based architecture: LLM-backed modules with tools, orchestrated by a generic runtime.

### Local development

```
npm run dev:tunnel
```

NOTE: Requires [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) to expose the URL to the Telegram bot

## Docs

- [Structure](structure.md) — Directory layout and organization
- [Agents](agents.md) — What agents are, lifecycle, and how to set one up
- [Tools](tools.md) — Tool levels (core, agent-specific, shared) and setup
