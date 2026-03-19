# Recap — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Author:** Pranav + Claude

## Problem

Engineers running multiple AI coding sessions daily (Claude Code, Codex, Cursor) need to communicate progress to product teams. The current workflow is manual: ask an AI to summarize, copy the markdown, paste into Slack. Product teams receive multiple raw MD files from multiple engineers and can't efficiently process them.

Two-sided pain:
- **Engineers:** 15+ minutes of manual summarization at end of day across 8-10 sessions
- **Product:** Unstructured MD files with no unified view, no way to query, no aggregation across engineers

## Product Concept

**Recap** is a CLI that reads AI coding sessions and git activity, synthesizes a structured daily digest, and delivers it to Slack. A companion Slack bot lets product teams query and aggregate updates across the team.

**Engineer UX:** Run `recap` at end of day. Review a 30-second auto-generated summary. Hit send.

**PM UX:** Structured Slack messages land in `#eng-updates`. Use `/recap team` or `/recap blockers` to get aggregated views.

### What Recap is NOT (v1)

- Not a web dashboard (v2)
- Not a real-time activity tracker
- Not a productivity metrics tool (no lines-of-code vanity metrics)

## Market Position

The competitive landscape has a clear gap:

| | Developer Audience | Product/Stakeholder Audience |
|---|---|---|
| **Git-level data** | GitHub insights, LinearB | Stepsize, CodeAnt |
| **AI session data** | agentsview, Agent Sessions | **Recap (unoccupied)** |

Closest competitor **agentsview** indexes sessions across tools with analytics and AI insights — but serves developers, not product teams. Recap's differentiation is the **translation layer**: turning rich session context into structured, audience-appropriate communication.

**TAM:** $180M-360M (10% of multi-tool developers paying $10-20/user/month).

## Architecture

Three layers, cleanly separated:

```
COLLECTORS (one per tool, adapter pattern)
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐
│ Claude   │ │ Codex    │ │ Cursor   │ │ Git  │
│ Collector│ │ Collector│ │ Collector│ │      │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └──┬───┘
     └──────────┬──┴──────────┬────────────┘
                ▼             ▼
SYNTHESIZER (LLM-powered, 2-stage)
┌───────────────────────────────────────────┐
│ Stage 1: Per-session micro-summaries      │
│          (parallel, cheap model)          │
│ Stage 2: Cross-session synthesis          │
│          (structured output, Sonnet)      │
└─────────────────┬─────────────────────────┘
                  ▼
DELIVERY (pluggable outputs)
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Slack    │ │ Markdown │ │ JSON API │
│ Webhook  │ │ File     │ │ (server) │
└──────────┘ └──────────┘ └──────────┘
```

### Design Decisions

1. **Adapter pattern for collectors** — Each tool gets its own module outputting a unified `ActivityEvent[]`. Adding a new tool = one adapter. No changes to synthesizer or delivery.
2. **LLM does classification** — The synthesizer doesn't heuristically categorize. It sends unified activity to an LLM that classifies into decisions/blockers/shipped/in-progress.
3. **Git is the anchor** — Sessions tell you what was attempted. Git tells you what stuck. Cross-referencing identifies shipped vs. exploratory work.
4. **Everything runs locally** — No cloud dependency for the CLI. Session data never leaves the machine except as the synthesized summary.
5. **Language: TypeScript** — Claude Agent SDK is TS-first, `better-sqlite3` for Codex/Cursor, Slack Block Kit SDK is JS-native, npm distribution is natural.

## Data Model

### Input: ActivityEvent (collector output)

```typescript
interface ActivityEvent {
  source: "claude" | "codex" | "cursor" | "git";
  sessionId: string;
  sessionTitle: string;
  project: string;               // normalized from cwd
  gitRepo?: string;
  gitBranch?: string;
  timestamp: Date;
  duration?: number;             // minutes, estimated

  actions: ActionSummary;

  // Truncated content for LLM synthesis
  userPrompts: string[];
  keyAssistantResponses: string[];
}

interface ActionSummary {
  filesModified: string[];
  filesCreated: string[];
  toolsUsed: Record<string, number>;
  commits: CommitInfo[];
  tokensUsed: number;
}

interface CommitInfo {
  sha: string;
  message: string;
  additions: number;
  deletions: number;
}
```

### Output: DailySummary (synthesizer output)

```typescript
interface DailySummary {
  date: string;
  engineer: string;

  decisions: DecisionItem[];     // what changed from the plan
  blockers: BlockerItem[];       // what needs product input
  shipped: ShippedItem[];        // what's done/deployable
  inProgress: ProgressItem[];    // what's still cooking

  sessionCount: number;
  projectsTouched: string[];
  totalTokensUsed: number;
  estimatedHoursActive: number;
}
```

## Collector Implementations

### Claude Code Collector

- **Input:** `~/.claude/projects/{encoded-cwd}/*.jsonl`
- **Method:** Claude Agent SDK (`listSessions`, `getSessionMessages`). Extract user prompts, `tool_use` blocks (Edit/Write = file changes, Bash = commands), git branch from message metadata.
- **Signal:** High — full conversations with tool calls.

### Codex Collector

- **Input:** `~/.codex/state_5.sqlite` (threads table) + `~/.codex/sessions/{date}/*.jsonl`
- **Method:** SQLite query for today's threads (title, cwd, git info, tokens). Parse session JSONL for `response_item` events.
- **Signal:** High — structured metadata + full transcripts.

### Cursor Collector

- **Input:** `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- **Method:** Query `cursorDiskKV` for `composerData:*` with today's timestamps. Extract bubble texts, diffs, commits.
- **Caveat:** SQLite may be locked while Cursor runs. Use `PRAGMA query_only = ON` + WAL mode read. Skip with notice if locked.
- **Signal:** Medium — messages available, some assistant replies may be missing.

### Git Collector

- **Input:** Configured list of repo paths (auto-detected from session cwds).
- **Method:** `git log --since="today 00:00" --author={configured} --stat`
- **Signal:** Ground truth — what actually landed in the codebase.

## Synthesizer

Two-stage LLM pipeline:

**Stage 1: Micro-summaries (parallel)**
- Each session's `userPrompts` + `actionSummary` + `commits` → one paragraph
- Model: Haiku / GPT-4o-mini (cheap, fast)
- Runs in parallel across all sessions
- Purpose: compress ~200K tokens of raw transcripts to ~2K tokens

**Stage 2: Cross-session synthesis**
- All micro-summaries + git ground truth → structured `DailySummary`
- Model: Sonnet (smart enough for classification and deduplication)
- Handles: dedup across tools, decision vs. blocker classification, project grouping
- Output: structured JSON matching `DailySummary` schema

## Engineer Review UX

```
$ recap

Daily Recap — March 19, 2026

  Shipped
  - monorepo: Added input validation to user registration endpoint
  - snapai: Fixed token counting bug in prompt pipeline

  Decisions
  - Switched from Redis to in-memory caching for session store
    (simpler, sufficient for current scale)

  In Progress
  - Auth middleware rewrite — 60% done, blocked on schema migration

  Blockers
  - Need product input: should expired sessions show an error or
    silently redirect to login?

8 sessions | 3 projects | 47 files | 12 commits

[e]dit  [s]end to Slack  [q]uit
```

## Slack Delivery

### Webhook (engineer → channel)

Block Kit message with:
- Header: engineer name + date
- Sections for each category (shipped/decisions/in-progress/blockers)
- Blockers get a red indicator to draw PM attention
- Footer: session count, projects touched
- Thread-ready: PMs reply in-thread for clarification

### Slack Bot (PM queries)

Small Express server (Fly.io/Railway, ~$5/month) that:
- Receives daily summaries from each engineer's CLI via POST
- Stores in SQLite (or Postgres when scaling)
- Responds to slash commands:
  - `/recap team` — aggregated view across all engineers for today
  - `/recap blockers` — just blockers from everyone
  - `/recap @engineer` — specific engineer's update
  - `/recap project monorepo` — all activity on a specific project

This server becomes the v2 dashboard backend.

## Configuration

```yaml
# ~/.recap/config.yaml
engineer: pranav
projects:                     # auto-detected from session cwds, or manual
  - path: ~/snaptrude/monorepo
    name: monorepo
  - path: ~/snaptrude/snapai
    name: snapai
git:
  author: pranav
slack:
  webhook_url: ${RECAP_SLACK_WEBHOOK}
  channel: "#eng-updates"
server:
  url: ${RECAP_SERVER_URL}     # for bot aggregation
  api_key: ${RECAP_API_KEY}
llm:
  provider: anthropic
  model: claude-sonnet-4-6
  micro_summary_model: claude-haiku-4-5
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Cursor SQLite locked | Skip Cursor data, note in summary footer |
| No sessions found | Print "No activity found for today." Don't post |
| Massive session (3000+ msgs) | Truncate to first prompt + last 20 messages + all tool_use blocks |
| Overlapping sessions (same work in Claude + Cursor) | Git deduplicates by commit SHA; synthesizer handles narrative dedup |
| LLM API down/rate-limited | Fall back to structured template (facts only, no synthesis) |
| Bad summary quality | Engineer catches in review step; can regenerate or edit |
| Slack webhook fails | Save to `~/.recap/outbox/`, retry next run, print to stdout |
| Server unreachable | Post to Slack webhook directly, queue server push for retry |

## MVP Scope

### In

- Claude Code collector
- Codex collector
- Cursor collector
- Git collector
- 2-stage LLM synthesizer
- Engineer review TUI
- Slack webhook delivery
- Slack bot (team queries)
- `recap init` + `recap` commands
- Local markdown output
- Server for bot aggregation

### Out (v2+)

- Web dashboard
- Jira/Linear integration
- Audience-aware summaries (PM vs VP vs exec)
- Weekly/sprint rollups
- Historical analytics
- Custom summary templates

## Distribution

```
npm install -g @recap/cli
recap init          # guided setup: detect tools, configure Slack, authenticate
recap               # generate + review + send
recap --dry-run     # preview without posting
recap --date yesterday  # backfill
```

## Growth Path

1. **v1.0** — CLI + Slack webhook + Slack bot. Open source CLI, hosted bot service.
2. **v2.0** — Web dashboard for PMs. Team management. Monetization starts.
3. **v3.0** — Jira/Linear integration. Audience-aware summaries. Enterprise features.

## Monetization

- CLI: free forever (open source)
- Slack bot + dashboard: free for teams up to 5 engineers
- Paid: $10-15/engineer/month
