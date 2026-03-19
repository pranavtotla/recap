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

**TAM estimate:** ~30M professional developers worldwide. 95% use AI tools weekly (Pragmatic Engineer 2026), 70% use 2-4 tools simultaneously. Assuming 20M multi-tool devs, 10% conversion at $12/user/month = ~$290M ARR ceiling. Conservative near-term: 1% of addressable = ~$29M.

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
interface SummaryItem {
  title: string;                 // one-line description
  project: string;               // which project this relates to
  description: string;           // 1-2 sentence detail
  relatedCommits?: string[];     // commit SHAs that support this item
  relatedSessions?: string[];    // session IDs that produced this
}

interface DecisionItem extends SummaryItem {
  previousApproach?: string;     // what was the plan before
  rationale: string;             // why the change was made
}

interface BlockerItem extends SummaryItem {
  needsInputFrom: "product" | "engineering" | "design" | "external";
  severity: "blocking" | "slowing";
}

interface ShippedItem extends SummaryItem {
  commits: string[];             // commit SHAs
  filesChanged: number;
}

interface ProgressItem extends SummaryItem {
  estimatedCompletion?: string;  // e.g. "tomorrow", "end of sprint"
}

interface TeamSummary {
  date: string;
  teamId: string;
  engineers: string[];
  allShipped: ShippedItem[];
  allBlockers: BlockerItem[];
  allDecisions: DecisionItem[];
  allInProgress: ProgressItem[];
  totalSessions: number;
  projectsTouched: string[];
}

interface DailySummary {
  date: string;                  // ISO date
  engineer: string;
  timezone: string;              // IANA timezone, e.g. "Asia/Kolkata"

  decisions: DecisionItem[];
  blockers: BlockerItem[];
  shipped: ShippedItem[];
  inProgress: ProgressItem[];

  sessionCount: number;
  projectsTouched: string[];
  totalTokensUsed: number;
  estimatedHoursActive: number;
}
```

## Collector Implementations

### Claude Code Collector

- **Input:** `~/.claude/projects/{encoded-cwd}/*.jsonl`
- **Method:** Parse JSONL files directly. The Claude Agent SDK exposes `listSessions` and `getSessionMessages` (TypeScript), but these APIs are relatively new and may change. Primary implementation should parse JSONL directly for stability; SDK can be used as an optional optimization path if available at build time.
- **Extract:** User prompts (`type: "user"`), `tool_use` blocks from assistant messages (Edit/Write = file changes, Bash = commands run), `gitBranch` and `cwd` from message metadata.
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
- **Method:** `git log --since="today 00:00" --author={configured} --stat`. Author matching uses email (`git log --author="<email>"`) to avoid substring collisions. The configured `git.author` field accepts either a name or email; email is recommended.
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

### Server API Contract

**Authentication:** Each team gets a team ID + API key pair generated server-side during `recap init --team` (server creates team, returns credentials). The CLI sends `Authorization: Bearer <api_key>` with every request over HTTPS (TLS required — server rejects non-HTTPS). Slack slash commands are verified using Slack's signing secret (`X-Slack-Signature` header validation). Rate limit: 1 summary per engineer per date per day.

**Endpoints:**

```
POST /api/v1/summaries
  Headers: Authorization: Bearer <api_key>
  Body: DailySummary (JSON)
  Response: 201 { id: string }
  Errors: 401 Unauthorized, 422 Validation error

GET /api/v1/summaries?date=2026-03-19&engineer=pranav
  Headers: Authorization: Bearer <api_key>
  Response: 200 { summaries: DailySummary[] }

GET /api/v1/summaries/team?date=2026-03-19
  Headers: Authorization: Bearer <api_key>
  Response: 200 { summaries: DailySummary[], aggregated: TeamSummary }

GET /api/v1/summaries/blockers?since=2026-03-17
  Headers: Authorization: Bearer <api_key>
  Response: 200 { blockers: BlockerItem[] }

POST /api/v1/slack/commands
  (Slack slash command webhook — verified via signing secret)
  Routes to appropriate query based on command text
```

**Stored data model:** The server stores only `DailySummary` objects — synthesized summaries, never raw session data. Raw session content stays on the engineer's machine.

## Privacy & Data Handling

- **What leaves the machine:** Only the synthesized `DailySummary` (decisions, blockers, shipped items, progress). Never raw session transcripts, prompts, or tool outputs.
- **LLM processing:** Raw session data is sent to the configured LLM provider (Anthropic/OpenAI) for synthesis. This is the same data the engineer already sent to those providers during their coding sessions. No new exposure.
- **Server storage:** Only `DailySummary` JSON. Retained for 90 days by default (configurable). Deleted when an engineer is removed from the team.
- **Redaction:** The engineer review step (`[e]dit`) is the redaction gate. Engineers can remove any item before sending. The CLI also auto-strips file paths that match `.env`, `credentials`, `secret`, `token`, `password` patterns from summary items.
- **No session linking:** The server never receives session IDs, transcript paths, or raw prompts. It cannot reconstruct what happened in a session — only what the engineer chose to share.

## Configuration

```yaml
# ~/.recap/config.yaml
engineer: pranav
projects:                     # auto-detected from session cwds, or manual
  - path: ~/snaptrude/monorepo
    name: monorepo
  - path: ~/snaptrude/snapai
    name: snapai
timezone: Asia/Kolkata              # IANA timezone for "today" boundary
git:
  author: pranav@snaptrude.com      # email recommended over name
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
| Massive session (3000+ msgs) | Token budget: 4K tokens per session for Stage 1. Priority: (1) first user prompt, (2) all commit messages, (3) tool_use blocks with file paths (names only, not content), (4) last 10 user prompts, (5) fill remaining budget with assistant text snippets |
| Overlapping sessions (same work in Claude + Cursor) | Git deduplicates by commit SHA; synthesizer handles narrative dedup |
| LLM API down/rate-limited | Fall back to structured template (facts only, no synthesis) |
| Bad summary quality | Engineer catches in review step; can regenerate or edit |
| Slack webhook fails | Save to `~/.recap/outbox/`, retry next run, print to stdout |
| Server unreachable | Post to Slack webhook directly, queue server push for retry |

## MVP Scope (Phased)

### Phase 1: Walking Skeleton (week 1)

Validates the core value proposition: can the tool produce useful summaries?

- Claude Code collector (JSONL parsing)
- Git collector
- Single-stage LLM synthesis (Sonnet, no micro-summary stage)
- Markdown output to stdout
- `recap init` (minimal: detect Claude Code, configure LLM key)
- `recap --dry-run`

**Done when:** Running `recap` on a day with 3+ Claude Code sessions produces a summary that an engineer rates as "accurate" for 4/5 items.

### Phase 2: Full Collection (week 2)

- Codex collector (SQLite + JSONL)
- Cursor collector (vscdb)
- 2-stage synthesizer (micro-summaries + synthesis)
- Token budget and truncation logic

**Done when:** Running `recap` with sessions across all three tools produces a unified summary with no duplicate items for the same work.

### Phase 3: Delivery (week 3)

- Engineer review TUI (`[e]dit` opens `$EDITOR` on a temp markdown file, `[s]end` posts, `[q]uit` aborts)
- Slack webhook delivery (Block Kit formatting)
- `recap init` full flow (detect tools, configure Slack webhook, test post)
- Outbox retry logic

**Done when:** An engineer can run `recap`, review, edit, and post to a Slack channel. A PM confirms the Slack message is readable and useful.

### Phase 4: Team Layer (week 4)

- Server (Express on Fly.io) with API endpoints
- CLI pushes `DailySummary` to server on send
- Slack bot with `/recap team`, `/recap blockers`, `/recap @engineer`, `/recap project`
- Team setup flow (`recap init --team`)

**Done when:** Two engineers post summaries. A PM runs `/recap team` and sees an aggregated view.

### Out (v2+)

- Web dashboard
- Jira/Linear integration
- Audience-aware summaries (PM vs VP vs exec)
- Weekly/sprint rollups
- Historical analytics
- Custom summary templates

## `recap init` Flow

```
$ recap init

Welcome to Recap!

Detecting AI coding tools...
  Claude Code: found (19 projects, 47 sessions)
  Codex CLI:   found (470 sessions across 54 projects)
  Cursor:      found (global state database detected)
  Git:         found

Your name (for summaries): pranav
Git author email (for commit matching): pranav@snaptrude.com

LLM provider:
  [1] Anthropic (recommended)
  [2] OpenAI
  > 1

Anthropic API key: sk-ant-...
  Testing... OK

Slack integration (optional, can configure later):
  Webhook URL: https://hooks.slack.com/services/T.../B.../...
  Testing... OK, posted to #eng-updates

Team server (optional, can configure later):
  Server URL: https://recap.yourteam.com
  API key: rk_...
  Testing... OK, connected to team "snaptrude"

Config written to ~/.recap/config.yaml
Run `recap --dry-run` to preview your first summary!
```

If run without flags, skips Slack and server setup. `recap init --slack` adds Slack. `recap init --team` adds server.

## Testing & Acceptance Criteria

### Collector tests
- **Claude:** Given a fixture JSONL file with 50 messages (user + assistant + tool_use), produces valid `ActivityEvent` with correct file lists and tool counts.
- **Codex:** Given a fixture SQLite with 5 threads, produces 5 `ActivityEvent`s with correct titles, cwds, and token counts.
- **Cursor:** Given a fixture vscdb with 3 composers, produces 3 `ActivityEvent`s. Handles locked database gracefully (returns empty array + warning).
- **Git:** Given a test repo with 10 commits across 2 branches, produces correct `CommitInfo[]` filtered by author and date.

### Synthesizer tests
- Given 8 `ActivityEvent`s across 3 projects, produces a `DailySummary` where:
  - All 4 categories (shipped/decisions/blockers/inProgress) are populated
  - No item appears in multiple categories
  - Every `ShippedItem` references at least one real commit SHA
  - Synthesis completes in under 15 seconds
- Given overlapping sessions (same files in Claude + Cursor), produces no duplicate items.
- Given an empty `ActivityEvent[]`, returns a summary with all empty categories.

### Delivery tests
- Slack Block Kit output is valid (passes Slack's block validation).
- Server POST succeeds with valid auth, returns 401 without auth.
- Outbox retry: failed Slack post is saved and retried on next `recap` run.

### End-to-end acceptance
- An engineer with 5+ real sessions across Claude Code + Codex runs `recap` and confirms the output is accurate for 80%+ of items without manual editing.

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
