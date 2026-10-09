# Agents Inspect

### Understand your AI agents. Measure what matters.

A local-first analytics dashboard for AI coding agents.

Track costs, analyze skills and MCP servers, understand your workflow,
and explore every session - all from the logs your agents already produce.

**No instrumentation · No database · No external services**

[Getting Started](#-quick-start) ·
[Features](#-features) ·
[Architecture](#-how-it-works) ·
[Development](#-development)

---

## Why Agents Inspect?

AI coding agents make it easier to ship software.

But understanding how they work — and what they actually cost — is
another challenge.

- 💸 **Where does the money go?** Understand token usage, costs, and trends.
- 🧰 **Which tools are worth keeping?** Analyze skills and MCP servers using
  usage, cost, interruptions, and commit outcomes.
- 🔄 **How does your agent spend its time?** See how much work goes into
  exploration, implementation, testing, debugging, and shipping.
- 🔎 **What happened in a particular session?** Search your history and
  inspect individual events, tool calls, and subagent activity.

Agents Inspect turns existing session logs into actionable insights.

No plugins. No instrumentation. No changes to your agent setup.

## ✨ Features

### Overview

Understand your agent usage at a glance.

- Cost, sessions, active time, and cost per commit.
- Token usage and cache hit rate.
- Daily cost trends and time-of-day heatmaps.
- Breakdowns by project, branch, model, and agent configuration.
- Tool errors and code-change metrics.

### Tooling

Find out which tools help — and which ones get in the way.

- Skill and MCP server usage analysis.
- Adoption, cost per use, and interruption rates.
- Skill sequences and skill-graph visualization.
- Built-in tool statistics.
- Hook-injected context analysis.

### Workflow

Understand how your agent spends its time.

- Workflow phases: explore, plan, implement, test, review, debug, and ship.
- Cost breakdowns by phase, model, and subagent.
- Comparisons between models.
- Rework detection on frequently modified files.

### History

Explore individual sessions in detail.

- Search by session, project, skill, MCP server, or Git branch.
- Inspect user messages and tool calls.
- Explore subagent activity and event traces.
- Follow context usage throughout a session.
- Access the underlying JSONL events.

### Local-first by design

Your data stays on your machine.

- Reads existing session logs without modifying them.
- Binds the server to `127.0.0.1`.
- Requires no database or external service.
- Adds no plugins, hooks, or instrumentation to your agents.

---

## 🚀 Quick start

### Requirements

- Node.js 25 or later.
- Claude Code or GitHub Copilot CLI session logs on your machine.
- Git and Make.

### 1. Clone the repository

```bash
git clone https://github.com/andresdigiovanni/agents-inspect.git
cd agents-inspect
```

### 2. Install dependencies

```bash
make install
```

### 3. Start the dashboard

For development, with API and UI hot reloading:

```bash
make dev
```

Alternatively, build and serve the application from a single origin:

```bash
make start
```

### 4. Explore your data

Open the dashboard in your browser:

**http://127.0.0.1:3001**

Filter by agent, project, and date range to explore your usage.

That's it. No API keys, environment variables, or database setup required.

---

## 🤖 Supported agents

Agents Inspect currently reads session logs from:

| Agent | Log location |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| GitHub Copilot CLI | `~/.copilot/session-state/*/events.jsonl` |

You only need logs from one supported agent to get started.

The dashboard can filter by agent and distinguish interactive sessions
from automated sessions.

---

## 🔍 How it works

Agents Inspect uses the logs your agents already write to disk.

```text
┌─────────────────────┐
│   Agent session     │
│                     │
│ Claude Code         │
│ GitHub Copilot CLI  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│    Read JSONL       │
│    Session logs     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Parse and aggregate │
│ Cache and analyze   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│     JSON API        │
│                     │
│  Fastify + React    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│      Dashboard      │
│                     │
│ Costs · Tools       │
│ Workflow · History  │
└─────────────────────┘
```

The server reads logs, parses events, and aggregates the information
needed by the dashboard.

In development, the API runs on `127.0.0.1:3001` and Vite serves the
frontend on `127.0.0.1:5173`.

In production mode, `make start` serves both the API and the built
frontend from `127.0.0.1:3001`.

### A note on cost estimates

Claude Code sessions report their own USD cost, which is apportioned
to messages by token weight.

GitHub Copilot logs do not include USD costs, so their cost figures
are estimates based on a public list-price table.

Estimated values are identified as such in the UI.

---

## 🧭 Design principles

**Local and read-only**

Session logs are read from disk and never modified. The server binds
to localhost.

**Zero instrumentation**

No plugins, hooks, or agent configuration are required.

**Transparent estimates**

Estimated costs and other inferred metrics are identified as such.

**One unified view**

Cost, tooling, workflow, and session history in one place.

---

## 🤝 Contributing

Contributions, ideas, and bug reports are welcome.

If there's a question about your agent usage that the dashboard cannot
answer yet, consider proposing a new metric or visualization.

---

## License

See [LICENSE](LICENSE).
