# Agents Inspect

> **Know what your AI agents actually do.**

Agents Inspect is a local, read-only dashboard that turns AI coding-agent session logs into cost, usage, and workflow analytics.

Instead of guessing which skills earn their keep, which MCP servers slow you down, or where your budget goes, Agents Inspect lets you **measure sessions, analyze tooling, classify workflows, and drill into any session** — without touching your agent setup.

Works with the logs **Claude Code** and **GitHub Copilot CLI** already write to your machine. No plugins, no instrumentation, no data leaving localhost.

## Why?

AI agents are easy to run.

But they are hard to **understand**.

Questions like:

```
How much did I spend this month?
    ↓
Which skills actually help?
    ↓
Which MCP servers just burn context?
    ↓
How much time goes to debugging vs. shipping?
```

usually go unanswered, because the answers are buried in JSONL logs.

Agents Inspect turns those logs into answers:

```
        ┌─────────────────┐
        │    Measure      │
        │  cost & tokens  │
        └────────┬────────┘
                 ↓
        ┌─────────────────┐
        │    Analyze      │
        │  skills & MCPs  │
        └────────┬────────┘
                 ↓
        ┌─────────────────┐
        │    Classify     │
        │    workflow     │
        └────────┬────────┘
                 ↓
        ┌─────────────────┐
        │     Drill in    │
        │  any session    │
        └────────┬────────┘
                 ↓
        Decide what to change
```

Everything runs on `127.0.0.1`. The logs are only read, never modified.

---

## Quick start

### 1. Install

Clone and install:

```bash
git clone https://github.com/andresdigiovanni/agents-inspect.git
cd agents-inspect
make install
```

You need Node.js 25+ (the server runs TypeScript directly on Node) and existing Claude Code or Copilot CLI session logs on the same machine.

### 2. Run it

Development mode (API + hot-reloading UI):

```bash
make dev
```

Or build and serve everything from one origin:

```bash
make start
```

### 3. Open the dashboard

```
http://127.0.0.1:3001
```

That's the basic loop:

```
open dashboard → scope by agent/project/date → drill into anything
```

No configuration, no environment variables, no database.

---

## What Agents Inspect shows you

### 📊 Overview

Cost, sessions, active time, cost per commit, cache hit rate, lines changed, tool errors — with trend badges comparing against the previous period.

Daily cost by model, weekday×hour heatmaps, and breakdowns by project, git branch, agent version, permission mode, and reasoning effort.

### 🧰 Tooling

The "what should I uninstall" analysis.

Every skill and MCP server gets a verdict — **Problematic, Useful, Occasional, Unused** — computed from adoption, cost per use, interruption rate, and commit outcomes.

Plus skill sequences, a skill-graph visualization, built-in tool stats, and hook context injection.

### 🔄 Workflow

Every assistant message is classified into a phase — **explore, plan, implement, test, review, debug, ship** — so you can see where the money actually goes.

Subagent costs grouped by type and phase, model comparison, and rework detection on hot files.

### 🗂️ History

Search every session by title, project, skill, MCP server, or git branch.

Expand a session to see its full event trace — user messages, tool calls, subagent sidechains, context usage over time — down to the raw JSONL.

---

## Which agents are supported

| Agent | Logs read |
|---|---|
| Claude Code | `~/.claude/projects/**.jsonl` (incl. subagents) |
| GitHub Copilot CLI | `~/.copilot/session-state/*/events.jsonl` |

Missing directories are handled gracefully — you only need one of the two.

The dashboard can be scoped to All, Claude Code only, or Copilot only, and to Interactive or Automated (SDK/IDE) sessions.

---

## How it works

Agents Inspect does not install anything into your agents.

It reads the session logs they already write:

```
  ~/.claude/projects/      ~/.copilot/session-state/
          │                        │
          └───────────┬────────────┘
                      ↓
               Parse JSONL
                      ↓
        Cache (mtime + size, so live
         sessions refresh as they grow)
                      ↓
              Aggregate & analyze
                      ↓
            ┌──────────┴──────────┐
            │                     │
        JSON API            React UI
        Fastify             Vite + Tailwind
```

In development, the API runs on `127.0.0.1:3001` and the Vite dev server on `127.0.0.1:5173` (with `/api/` proxied).

In production (`make start`), one server serves both the API and the built frontend on `127.0.0.1:3001`.

---

## API

Everything the UI shows is also available as JSON:

| Endpoint | Purpose |
|---|---|
| `/api/summary` | KPIs, trends, daily series, heatmaps |
| `/api/tooling` | Skills, MCP servers, hooks analysis |
| `/api/workflow` | Phases, subagents, models, rework |
| `/api/sessions` | Session list in range |
| `/api/sessions/:id/detail` | Per-session drill-down |
| `/api/sessions/:id/trace` | Full event trace |
| `/api/sessions/:id/raw` | Raw JSONL |
| `/api/projects` | Project list |

All endpoints accept `from`/`to` dates and optional `agent`, `source`, and `project` scopes.

---

## Cost model

Claude Code sessions report their own USD cost, which is apportioned to messages by token weight.

Copilot logs do not include USD, so costs are **estimates** computed from a public list-price table.

Estimated values are labeled as such in the UI.

---

## A better mental model

Think of Agents Inspect as a **fitness tracker for your agents**.

Without it:

```
Agent runs
 ↓
Something feels expensive
 ↓
Maybe uninstall that skill?
 ↓
Guess
```

With it:

```
Agent runs
 ↓
Measure cost, tokens, time
 ↓
See which skills & MCPs pay off
 ↓
See which phases burn money
 ↓
Decide based on data
```

The goal is not to supervise the agent.

The goal is to **improve the setup over time**.

---

## Requirements

End users need:

- Node.js 25+
- Claude Code or GitHub Copilot CLI session logs on the machine

That's it. No database, no external services.

---

## Development

Clone the repository:

```bash
git clone https://github.com/andresdigiovanni/agents-inspect.git
cd agents-inspect
make install
```

Run the test suite:

```bash
make test
```

Everything that must pass before a commit:

```bash
make check
```

(`make check` runs lint, typecheck, tests, and build.)

---

## Project structure

```
agents-inspect/
├── server/          # Fastify API + parsing/aggregation (runs directly on Node)
│   └── copilot/     # GitHub Copilot CLI support
├── web/             # React SPA (Vite + Tailwind)
├── shared/          # Types shared by server and web
├── Makefile
└── README.md
```

---

## Design principles

Agents Inspect is built around a few simple principles:

### Local and read-only

Logs are read from disk and never modified. The server binds to localhost only.

### Zero instrumentation

No plugins, no hooks, no agent configuration. If the logs exist, it works.

### Documented estimates

When a number is an estimate (e.g. Copilot costs, injected context tokens), the UI says so.

### One tool, whole picture

Cost, tooling, workflow, and history in one place, scoped by agent, project, and date.

---

## Contributing

Contributions, ideas, and bug reports are welcome.

If there is a question about your agent usage you cannot answer with the current dashboard, that's a good candidate for a new view or metric.
