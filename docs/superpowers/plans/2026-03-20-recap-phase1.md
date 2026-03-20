# Recap Phase 1: Walking Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI that reads Claude Code sessions and git commits from today, synthesizes a daily summary via LLM, and prints it as markdown to stdout.

**Architecture:** Adapter-pattern collectors (Claude Code + Git) feed unified `ActivityEvent[]` into an LLM synthesizer that produces a structured `DailySummary`. A markdown renderer prints it. Everything runs locally — no server, no Slack.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, `@anthropic-ai/sdk`, `tsx` for dev, `tsup` for build.

**Spec:** `docs/superpowers/specs/2026-03-19-recap-design.md`

---

## File Structure

```
md-sharer/                          # project root: /Users/pranav/work/md-sharer
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    cli.ts                          # CLI entry point (recap command)
    types.ts                        # All shared interfaces (ActivityEvent, DailySummary, etc.)
    config/
      loader.ts                     # Load & validate ~/.recap/config.yaml
      detect.ts                     # Auto-detect installed AI tools
    collectors/
      claude.ts                     # Claude Code JSONL parser
      git.ts                        # Git log parser
    synthesizer/
      synthesizer.ts                # LLM synthesis (single-stage for Phase 1)
      prompts.ts                    # Prompt templates
    delivery/
      markdown.ts                   # Render DailySummary as terminal markdown
    init/
      init.ts                       # `recap init` interactive setup
  tests/
    collectors/
      claude.test.ts
      git.test.ts
    synthesizer/
      synthesizer.test.ts
    delivery/
      markdown.test.ts
    config/
      loader.test.ts
    fixtures/
      claude-session-simple.jsonl   # 10 messages: user + assistant + tool_use
      valid-config.yaml
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize project**

```bash
cd /Users/pranav/work/md-sharer
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @anthropic-ai/sdk yaml
npm install -D typescript vitest tsup tsx @types/node
```

- [ ] **Step 2b: Create `.gitignore`**

```
node_modules/
dist/
*.tgz
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Add scripts to `package.json`**

Add to `package.json`:
```json
{
  "type": "module",
  "bin": {
    "recap": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsup src/cli.ts --format esm --dts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: Create `src/types.ts` — all shared interfaces**

```typescript
// ── Collector types ──

export interface ActivityEvent {
  source: "claude" | "codex" | "cursor" | "git";
  sessionId: string;
  sessionTitle: string;
  project: string;
  gitRepo?: string;
  gitBranch?: string;
  timestamp: Date;
  duration?: number;
  actions: ActionSummary;
  userPrompts: string[];
  keyAssistantResponses: string[];
}

export interface ActionSummary {
  filesModified: string[];
  filesCreated: string[];
  toolsUsed: Record<string, number>;
  commits: CommitInfo[];
  tokensUsed: number;
}

export interface CommitInfo {
  sha: string;
  message: string;
  additions: number;
  deletions: number;
}

// ── Synthesizer output types ──

export interface SummaryItem {
  title: string;
  project: string;
  description: string;
  relatedCommits?: string[];
  relatedSessions?: string[];
}

export interface DecisionItem extends SummaryItem {
  previousApproach?: string;
  rationale: string;
}

export interface BlockerItem extends SummaryItem {
  needsInputFrom: "product" | "engineering" | "design" | "external";
  severity: "blocking" | "slowing";
}

export interface ShippedItem extends SummaryItem {
  commits: string[];
  filesChanged: number;
}

export interface ProgressItem extends SummaryItem {
  estimatedCompletion?: string;
}

export interface DailySummary {
  date: string;
  engineer: string;
  timezone: string;
  decisions: DecisionItem[];
  blockers: BlockerItem[];
  shipped: ShippedItem[];
  inProgress: ProgressItem[];
  sessionCount: number;
  projectsTouched: string[];
  totalTokensUsed: number;
  estimatedHoursActive: number;
}

// ── Config types ──

export interface RecapConfig {
  engineer: string;
  timezone: string;
  projects: ProjectConfig[];
  git: { author: string };
  llm: {
    provider: "anthropic" | "openai";
    model: string;
    micro_summary_model?: string;
  };
  slack?: {
    webhook_url: string;
    channel: string;
  };
  server?: {
    url: string;
    api_key: string;
  };
}

export interface ProjectConfig {
  path: string;
  name: string;
}

// ── Collector interface ──

export interface Collector {
  name: string;
  collect(date: Date, config: RecapConfig): Promise<ActivityEvent[]>;
}
```

- [ ] **Step 7: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json tsconfig.json vitest.config.ts src/types.ts
git commit -m "scaffold: init TypeScript project with shared types"
```

---

## Task 2: Config Loader

**Files:**
- Create: `src/config/loader.ts`
- Create: `src/config/detect.ts`
- Create: `tests/config/loader.test.ts`
- Create: `tests/fixtures/valid-config.yaml`

- [ ] **Step 1: Create test fixture `tests/fixtures/valid-config.yaml`**

```yaml
engineer: testuser
timezone: Asia/Kolkata
projects:
  - path: /tmp/test-project
    name: test-project
git:
  author: testuser@example.com
llm:
  provider: anthropic
  model: claude-sonnet-4-6
```

- [ ] **Step 2: Write failing tests for config loader**

`tests/config/loader.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadConfig, validateConfig } from "../../src/config/loader.js";
import { RecapConfig } from "../../src/types.js";
import path from "node:path";

const FIXTURES = path.join(import.meta.dirname, "../fixtures");

describe("loadConfig", () => {
  it("loads a valid YAML config file", async () => {
    const config = await loadConfig(path.join(FIXTURES, "valid-config.yaml"));
    expect(config.engineer).toBe("testuser");
    expect(config.timezone).toBe("Asia/Kolkata");
    expect(config.projects).toHaveLength(1);
    expect(config.git.author).toBe("testuser@example.com");
    expect(config.llm.provider).toBe("anthropic");
  });

  it("throws on missing file", async () => {
    await expect(loadConfig("/nonexistent/config.yaml")).rejects.toThrow();
  });
});

describe("validateConfig", () => {
  it("rejects config missing engineer name", () => {
    const config = { timezone: "UTC", projects: [], git: { author: "a" }, llm: { provider: "anthropic", model: "x" } };
    expect(() => validateConfig(config as any)).toThrow("engineer");
  });

  it("rejects config missing llm provider", () => {
    const config = { engineer: "a", timezone: "UTC", projects: [], git: { author: "a" } };
    expect(() => validateConfig(config as any)).toThrow("llm");
  });

  it("accepts a valid config", () => {
    const config: RecapConfig = {
      engineer: "test",
      timezone: "UTC",
      projects: [],
      git: { author: "test@test.com" },
      llm: { provider: "anthropic", model: "claude-sonnet-4-6" },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/config/loader.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Implement config loader**

`src/config/loader.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { RecapConfig } from "../types.js";

export async function loadConfig(configPath: string): Promise<RecapConfig> {
  const raw = await readFile(configPath, "utf-8");
  const parsed = parseYaml(raw);
  validateConfig(parsed);
  return parsed as RecapConfig;
}

export function validateConfig(config: unknown): asserts config is RecapConfig {
  const c = config as Record<string, unknown>;
  if (!c || typeof c !== "object") throw new Error("Config must be an object");
  if (!c.engineer || typeof c.engineer !== "string") throw new Error("Config missing 'engineer' name");
  if (!c.timezone || typeof c.timezone !== "string") throw new Error("Config missing 'timezone'");
  if (!c.git || typeof (c.git as any).author !== "string") throw new Error("Config missing 'git.author'");
  if (!c.llm || typeof (c.llm as any).provider !== "string" || typeof (c.llm as any).model !== "string") {
    throw new Error("Config missing 'llm.provider' and 'llm.model'");
  }
  if (!Array.isArray(c.projects)) {
    (c as any).projects = [];
  }
}

export function getDefaultConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return `${home}/.recap/config.yaml`;
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/config/loader.test.ts
```

Expected: All PASS.

- [ ] **Step 6: Implement tool detection**

`src/config/detect.ts`:

```typescript
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DetectedTools {
  claude: { found: boolean; projectCount: number; sessionCount: number; path: string };
  codex: { found: boolean; path: string };
  cursor: { found: boolean; path: string };
  git: { found: boolean };
}

export function detectTools(): DetectedTools {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  const claudePath = join(home, ".claude", "projects");
  let claudeProjects = 0;
  let claudeSessions = 0;
  if (existsSync(claudePath)) {
    const dirs = readdirSync(claudePath, { withFileTypes: true });
    claudeProjects = dirs.filter((d) => d.isDirectory()).length;
    for (const dir of dirs.filter((d) => d.isDirectory())) {
      const files = readdirSync(join(claudePath, dir.name));
      claudeSessions += files.filter((f) => f.endsWith(".jsonl")).length;
    }
  }

  const codexPath = join(home, ".codex");
  const cursorPath = join(
    home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"
  );

  return {
    claude: {
      found: existsSync(claudePath) && claudeProjects > 0,
      projectCount: claudeProjects,
      sessionCount: claudeSessions,
      path: claudePath,
    },
    codex: {
      found: existsSync(join(codexPath, "state_5.sqlite")),
      path: codexPath,
    },
    cursor: {
      found: existsSync(cursorPath),
      path: cursorPath,
    },
    git: { found: true },
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/config/ tests/config/ tests/fixtures/valid-config.yaml
git commit -m "feat: config loader with YAML parsing and validation"
```

---

## Task 3: Claude Code Collector

**Files:**
- Create: `src/collectors/claude.ts`
- Create: `tests/collectors/claude.test.ts`
- Create: `tests/fixtures/claude-session-simple.jsonl`

- [ ] **Step 1: Create Claude session fixture**

`tests/fixtures/claude-session-simple.jsonl` — each line is one JSON object:

```jsonl
{"type":"progress","uuid":"p1","timestamp":"2026-03-19T09:00:00.000Z","sessionId":"sess-1","cwd":"/Users/test/project-a","gitBranch":"main"}
{"type":"user","uuid":"u1","parentUuid":"p1","timestamp":"2026-03-19T09:01:00.000Z","sessionId":"sess-1","message":{"role":"user","content":[{"type":"text","text":"Fix the login bug where users get 403 on valid credentials"}]}}
{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-03-19T09:02:00.000Z","sessionId":"sess-1","cwd":"/Users/test/project-a","gitBranch":"main","message":{"role":"assistant","content":[{"type":"text","text":"I'll look at the auth middleware."},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/Users/test/project-a/src/auth.ts"}},{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/Users/test/project-a/src/auth.ts","old_string":"checkToken(req)","new_string":"await checkToken(req)"}}]}}
{"type":"user","uuid":"u2","parentUuid":"a1","timestamp":"2026-03-19T09:05:00.000Z","sessionId":"sess-1","message":{"role":"user","content":[{"type":"text","text":"Now add a test for this fix"}]}}
{"type":"assistant","uuid":"a2","parentUuid":"u2","timestamp":"2026-03-19T09:06:00.000Z","sessionId":"sess-1","cwd":"/Users/test/project-a","gitBranch":"main","message":{"role":"assistant","content":[{"type":"text","text":"Adding a test for the auth fix."},{"type":"tool_use","id":"t3","name":"Write","input":{"file_path":"/Users/test/project-a/tests/auth.test.ts","content":"test code"}},{"type":"tool_use","id":"t4","name":"Bash","input":{"command":"npm test"}}]}}
```

- [ ] **Step 2: Write failing tests**

`tests/collectors/claude.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ClaudeCollector, parseClaudeSession } from "../../src/collectors/claude.js";
import path from "node:path";

const FIXTURES = path.join(import.meta.dirname, "../fixtures");

describe("parseClaudeSession", () => {
  it("extracts user prompts from a session JSONL file", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.userPrompts).toContain("Fix the login bug where users get 403 on valid credentials");
    expect(event.userPrompts).toContain("Now add a test for this fix");
    expect(event.userPrompts).toHaveLength(2);
  });

  it("extracts tool usage counts", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.actions.toolsUsed["Read"]).toBe(1);
    expect(event.actions.toolsUsed["Edit"]).toBe(1);
    expect(event.actions.toolsUsed["Write"]).toBe(1);
    expect(event.actions.toolsUsed["Bash"]).toBe(1);
  });

  it("extracts modified and created files", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.actions.filesModified).toContain("/Users/test/project-a/src/auth.ts");
    expect(event.actions.filesCreated).toContain("/Users/test/project-a/tests/auth.test.ts");
  });

  it("sets source to claude", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.source).toBe("claude");
  });

  it("extracts git branch and cwd", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.gitBranch).toBe("main");
    expect(event.project).toBe("test-project");
  });

  it("calculates duration from first to last timestamp", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.duration).toBe(6); // 09:00 to 09:06 = 6 minutes
  });
});

describe("ClaudeCollector", () => {
  it("implements the Collector interface", () => {
    const collector = new ClaudeCollector();
    expect(collector.name).toBe("claude");
    expect(typeof collector.collect).toBe("function");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/collectors/claude.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement Claude collector**

`src/collectors/claude.ts`:

```typescript
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ActivityEvent, Collector, RecapConfig } from "../types.js";

export class ClaudeCollector implements Collector {
  name = "claude";

  async collect(date: Date, config: RecapConfig): Promise<ActivityEvent[]> {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const projectsDir = join(home, ".claude", "projects");

    const events: ActivityEvent[] = [];
    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      return [];
    }

    for (const projDir of projectDirs) {
      const projPath = join(projectsDir, projDir);
      const projectName = resolveProjectName(projDir, config.projects);

      let files: string[];
      try {
        files = await readdir(projPath);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      for (const file of jsonlFiles) {
        try {
          const event = await parseClaudeSession(join(projPath, file), projectName);
          if (isFromDate(event.timestamp, date, config.timezone)) {
            events.push(event);
          }
        } catch {
          // Skip unparseable sessions
        }
      }
    }

    return events;
  }
}

export async function parseClaudeSession(
  filePath: string,
  projectName: string
): Promise<ActivityEvent> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const userPrompts: string[] = [];
  const keyResponses: string[] = [];
  const toolsUsed: Record<string, number> = {};
  const filesModified: Set<string> = new Set();
  const filesCreated: Set<string> = new Set();
  let sessionId = "";
  let gitBranch: string | undefined;
  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;

  for (const line of lines) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    // Track timestamps
    if (msg.timestamp) {
      const ts = new Date(typeof msg.timestamp === "number" ? msg.timestamp : msg.timestamp);
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
    }

    if (msg.sessionId && !sessionId) sessionId = msg.sessionId;
    if (msg.gitBranch && !gitBranch) gitBranch = msg.gitBranch;

    if (msg.type === "user") {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            userPrompts.push(block.text);
          }
        }
      }
    }

    if (msg.type === "assistant") {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use") {
            const toolName = block.name;
            toolsUsed[toolName] = (toolsUsed[toolName] || 0) + 1;

            const fp = block.input?.file_path;
            if (fp) {
              if (toolName === "Write") {
                filesCreated.add(fp);
              } else if (toolName === "Edit") {
                filesModified.add(fp);
              }
            }
          }
          if (block.type === "text" && block.text && block.text.length > 50) {
            keyResponses.push(block.text.slice(0, 500));
          }
        }
      }
    }
  }

  const duration =
    firstTimestamp && lastTimestamp
      ? Math.round((lastTimestamp.getTime() - firstTimestamp.getTime()) / 60000)
      : undefined;

  return {
    source: "claude",
    sessionId: sessionId || basename(filePath, ".jsonl"),
    sessionTitle: userPrompts[0]?.slice(0, 80) || "Untitled session",
    project: projectName,
    gitBranch,
    timestamp: firstTimestamp || new Date(),
    duration,
    actions: {
      filesModified: [...filesModified],
      filesCreated: [...filesCreated],
      toolsUsed,
      commits: [],
      tokensUsed: 0,
    },
    userPrompts,
    keyAssistantResponses: keyResponses.slice(0, 10),
  };
}

function resolveProjectName(encodedDir: string, projects: { path: string; name: string }[]): string {
  const decodedPath = "/" + encodedDir.replace(/^-/, "").replace(/-/g, "/");
  for (const p of projects) {
    const normalizedConfigPath = p.path.replace(/^~/, process.env.HOME || "");
    if (decodedPath.startsWith(normalizedConfigPath) || decodedPath === normalizedConfigPath) {
      return p.name;
    }
  }
  return decodedPath.split("/").filter(Boolean).pop() || "unknown";
}

function isFromDate(timestamp: Date, date: Date, timezone: string): boolean {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const eventDate = formatter.format(timestamp);
  const targetDate = formatter.format(date);
  return eventDate === targetDate;
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/collectors/claude.test.ts
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/claude.ts tests/collectors/claude.test.ts tests/fixtures/claude-session-simple.jsonl
git commit -m "feat: Claude Code collector — parse JSONL sessions into ActivityEvents"
```

---

## Task 4: Git Collector

**Files:**
- Create: `src/collectors/git.ts`
- Create: `tests/collectors/git.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/collectors/git.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseGitLogDetailed, GitCollector } from "../../src/collectors/git.js";

describe("parseGitLogDetailed", () => {
  it("parses git log with numstat into detailed commits", () => {
    // Format: %h\x00%s followed by numstat lines, blank line between commits
    const logOutput = `abc1234\x00Fix login validation bug
3\t1\tsrc/auth.ts
2\t0\ttests/auth.test.ts

def5678\x00Add user registration tests
5\t0\ttests/register.test.ts`;

    const commits = parseGitLogDetailed(logOutput);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("abc1234");
    expect(commits[0].message).toBe("Fix login validation bug");
    expect(commits[0].additions).toBe(5);
    expect(commits[0].deletions).toBe(1);
    expect(commits[0].filesChanged).toEqual(["src/auth.ts", "tests/auth.test.ts"]);
  });

  it("handles empty output", () => {
    expect(parseGitLogDetailed("")).toEqual([]);
    expect(parseGitLogDetailed("  \n  ")).toEqual([]);
  });

  it("handles commits with no file changes", () => {
    const logOutput = `abc1234\x00Empty merge commit`;
    const commits = parseGitLogDetailed(logOutput);
    expect(commits).toHaveLength(1);
    expect(commits[0].additions).toBe(0);
    expect(commits[0].filesChanged).toEqual([]);
  });

  it("handles commit messages containing pipes and special chars", () => {
    const logOutput = `abc1234\x00fix: handle A | B case in parser`;
    const commits = parseGitLogDetailed(logOutput);
    expect(commits[0].message).toBe("fix: handle A | B case in parser");
  });
});

describe("GitCollector", () => {
  it("implements the Collector interface", () => {
    const collector = new GitCollector();
    expect(collector.name).toBe("git");
    expect(typeof collector.collect).toBe("function");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/collectors/git.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Git collector**

`src/collectors/git.ts`:

```typescript
import { execFileSync } from "node:child_process";
import type { ActivityEvent, CommitInfo, Collector, RecapConfig } from "../types.js";

export class GitCollector implements Collector {
  name = "git";

  async collect(date: Date, config: RecapConfig): Promise<ActivityEvent[]> {
    const repoPaths = config.projects.map((p) =>
      p.path.replace(/^~/, process.env.HOME || "")
    );

    if (repoPaths.length === 0) return [];

    const events: ActivityEvent[] = [];
    const dateStr = formatDateForGit(date, config.timezone);

    for (const repoPath of repoPaths) {
      const projectName =
        config.projects.find(
          (p) => p.path.replace(/^~/, process.env.HOME || "") === repoPath
        )?.name || repoPath.split("/").pop() || "unknown";

      try {
        const logOutput = execFileSync("git", [
          "log",
          `--since=${dateStr} 00:00`,
          `--until=${dateStr} 23:59`,
          `--author=${config.git.author}`,
          "--format=%h%x00%s",
          "--numstat",
        ], {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 10000,
          env: { ...process.env, TZ: config.timezone },
        }).trim();

        if (!logOutput) continue;

        const commits = parseGitLogDetailed(logOutput);
        if (commits.length === 0) continue;

        const allFiles = new Set<string>();
        for (const c of commits) {
          for (const f of c.filesChanged) allFiles.add(f);
        }

        events.push({
          source: "git",
          sessionId: `git-${projectName}-${dateStr}`,
          sessionTitle: `${commits.length} commit(s) in ${projectName}`,
          project: projectName,
          timestamp: date,
          actions: {
            filesModified: [...allFiles],
            filesCreated: [],
            toolsUsed: {},
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.message,
              additions: c.additions,
              deletions: c.deletions,
            })),
            tokensUsed: 0,
          },
          userPrompts: commits.map((c) => c.message),
          keyAssistantResponses: [],
        });
      } catch {
        // Skip repos that fail (not a git repo, etc.)
      }
    }

    return events;
  }
}

interface DetailedCommit {
  sha: string;
  message: string;
  additions: number;
  deletions: number;
  filesChanged: string[];
}

// Uses \x00 (null byte) as delimiter in git format to avoid conflicts with commit messages
export function parseGitLogDetailed(output: string): DetailedCommit[] {
  const commits: DetailedCommit[] = [];
  const lines = output.split("\n");
  let current: DetailedCommit | null = null;

  for (const line of lines) {
    // Header line: sha\x00message (null byte separator)
    const nullIdx = line.indexOf("\x00");
    if (nullIdx !== -1 && /^[a-f0-9]+$/.test(line.slice(0, nullIdx))) {
      if (current) commits.push(current);
      current = {
        sha: line.slice(0, nullIdx),
        message: line.slice(nullIdx + 1),
        additions: 0,
        deletions: 0,
        filesChanged: [],
      };
      continue;
    }

    // Numstat line: additions\tdeletions\tfilename
    if (current) {
      const statMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (statMatch) {
        const add = statMatch[1] === "-" ? 0 : parseInt(statMatch[1], 10);
        const del = statMatch[2] === "-" ? 0 : parseInt(statMatch[2], 10);
        current.additions += add;
        current.deletions += del;
        current.filesChanged.push(statMatch[3]);
      }
    }
  }

  if (current) commits.push(current);
  return commits;
}

function formatDateForGit(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/collectors/git.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/git.ts tests/collectors/git.test.ts
git commit -m "feat: Git collector — parse git log into ActivityEvents"
```

---

## Task 5: LLM Synthesizer

**Files:**
- Create: `src/synthesizer/prompts.ts`
- Create: `src/synthesizer/synthesizer.ts`
- Create: `tests/synthesizer/synthesizer.test.ts`

- [ ] **Step 1: Create prompt template**

`src/synthesizer/prompts.ts`:

```typescript
import type { ActivityEvent } from "../types.js";

export function buildSynthesisPrompt(events: ActivityEvent[], engineer: string, date: string): string {
  const eventsText = events
    .map((e, i) => {
      const toolsSummary = Object.entries(e.actions.toolsUsed)
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");

      const commitsSummary = e.actions.commits
        .map((c) => `  - ${c.sha}: ${c.message} (+${c.additions}/-${c.deletions})`)
        .join("\n");

      return `### Session ${i + 1}: ${e.sessionTitle}
- Source: ${e.source}
- Project: ${e.project}
- Branch: ${e.gitBranch || "unknown"}
- Duration: ${e.duration ? `${e.duration} min` : "unknown"}
- Tools used: ${toolsSummary || "none"}
- Files modified: ${e.actions.filesModified.join(", ") || "none"}
- Files created: ${e.actions.filesCreated.join(", ") || "none"}
${commitsSummary ? `- Commits:\n${commitsSummary}` : "- Commits: none"}

User prompts:
${e.userPrompts.map((p) => `> ${p.slice(0, 200)}`).join("\n")}`;
    })
    .join("\n\n---\n\n");

  return `You are an engineering activity summarizer. Analyze the following AI coding sessions and git activity for ${engineer} on ${date}, and produce a structured daily summary.

IMPORTANT RULES:
1. Classify each piece of work into exactly ONE category: shipped, decisions, inProgress, or blockers.
2. "Shipped" = work that resulted in commits. Cross-reference session activity with git commits.
3. "Decisions" = choices that diverge from a previous plan or represent significant technical decisions.
4. "Blockers" = anything explicitly waiting on someone else's input or blocked by external factors.
5. "In Progress" = work started but not yet committed/completed.
6. Do NOT duplicate items across categories.
7. Do NOT hallucinate commits or file names — only reference what appears in the data.
8. Group related work across sessions (same feature in multiple sessions = one item).

SESSION DATA:
${eventsText}

Respond with ONLY valid JSON matching this schema:
{
  "decisions": [{"title": "...", "project": "...", "description": "...", "rationale": "...", "relatedCommits": ["sha"], "previousApproach": "..."}],
  "blockers": [{"title": "...", "project": "...", "description": "...", "needsInputFrom": "product|engineering|design|external", "severity": "blocking|slowing"}],
  "shipped": [{"title": "...", "project": "...", "description": "...", "commits": ["sha"], "filesChanged": 0}],
  "inProgress": [{"title": "...", "project": "...", "description": "...", "estimatedCompletion": "..."}]
}`;
}
```

- [ ] **Step 2: Write failing tests for synthesizer**

`tests/synthesizer/synthesizer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { synthesize, parseLLMResponse } from "../../src/synthesizer/synthesizer.js";
import type { ActivityEvent } from "../../src/types.js";

const mockEvent: ActivityEvent = {
  source: "claude",
  sessionId: "sess-1",
  sessionTitle: "Fix login bug",
  project: "monorepo",
  gitBranch: "main",
  timestamp: new Date("2026-03-19T09:00:00Z"),
  duration: 30,
  actions: {
    filesModified: ["src/auth.ts"],
    filesCreated: ["tests/auth.test.ts"],
    toolsUsed: { Edit: 3, Read: 5, Bash: 2 },
    commits: [{ sha: "abc1234", message: "fix: auth token validation", additions: 15, deletions: 3 }],
    tokensUsed: 5000,
  },
  userPrompts: ["Fix the login bug where users get 403"],
  keyAssistantResponses: ["I found the issue in the auth middleware"],
};

describe("parseLLMResponse", () => {
  it("parses valid JSON response into DailySummary fields", () => {
    const json = JSON.stringify({
      decisions: [],
      blockers: [],
      shipped: [{ title: "Fixed auth", project: "monorepo", description: "Fixed token validation", commits: ["abc1234"], filesChanged: 2 }],
      inProgress: [],
    });

    const result = parseLLMResponse(json, "testuser", "2026-03-19", "Asia/Kolkata", [mockEvent]);
    expect(result.shipped).toHaveLength(1);
    expect(result.shipped[0].title).toBe("Fixed auth");
    expect(result.engineer).toBe("testuser");
    expect(result.date).toBe("2026-03-19");
    expect(result.sessionCount).toBe(1);
  });

  it("handles response with markdown code fences", () => {
    const json = "```json\n" + JSON.stringify({
      decisions: [], blockers: [], shipped: [], inProgress: [],
    }) + "\n```";

    const result = parseLLMResponse(json, "testuser", "2026-03-19", "UTC", []);
    expect(result.decisions).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLLMResponse("not json", "u", "d", "UTC", [])).toThrow();
  });
});

describe("synthesize", () => {
  it("calls the LLM and returns a DailySummary", async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      decisions: [],
      blockers: [{ title: "Need PM input", project: "monorepo", description: "Error UX?", needsInputFrom: "product", severity: "blocking" }],
      shipped: [{ title: "Fixed auth", project: "monorepo", description: "Fixed it", commits: ["abc1234"], filesChanged: 1 }],
      inProgress: [],
    }));

    const result = await synthesize([mockEvent], {
      engineer: "testuser",
      date: "2026-03-19",
      timezone: "Asia/Kolkata",
      callLLM: mockLLM,
    });

    expect(result.shipped).toHaveLength(1);
    expect(result.blockers).toHaveLength(1);
    expect(result.sessionCount).toBe(1);
    expect(result.projectsTouched).toContain("monorepo");
    expect(mockLLM).toHaveBeenCalledOnce();
  });

  it("returns empty summary for no events", async () => {
    const result = await synthesize([], {
      engineer: "testuser",
      date: "2026-03-19",
      timezone: "UTC",
    });
    expect(result.sessionCount).toBe(0);
    expect(result.shipped).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/synthesizer/synthesizer.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement synthesizer**

`src/synthesizer/synthesizer.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { buildSynthesisPrompt } from "./prompts.js";
import type { ActivityEvent, DailySummary } from "../types.js";

export interface SynthesizeOptions {
  engineer: string;
  date: string;
  timezone: string;
  model?: string;
  callLLM?: (prompt: string) => Promise<string>;
}

export async function synthesize(
  events: ActivityEvent[],
  options: SynthesizeOptions
): Promise<DailySummary> {
  if (events.length === 0) {
    return emptySummary(options.engineer, options.date, options.timezone);
  }

  const prompt = buildSynthesisPrompt(events, options.engineer, options.date);
  const callLLM = options.callLLM || createAnthropicCaller(options.model);
  const response = await callLLM(prompt);

  return parseLLMResponse(response, options.engineer, options.date, options.timezone, events);
}

export function parseLLMResponse(
  raw: string,
  engineer: string,
  date: string,
  timezone: string,
  events: ActivityEvent[]
): DailySummary {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  const allProjects = new Set<string>();
  let totalTokens = 0;
  let totalMinutes = 0;

  for (const e of events) {
    allProjects.add(e.project);
    totalTokens += e.actions.tokensUsed;
    totalMinutes += e.duration || 0;
  }

  return {
    date,
    engineer,
    timezone,
    decisions: parsed.decisions || [],
    blockers: parsed.blockers || [],
    shipped: parsed.shipped || [],
    inProgress: parsed.inProgress || [],
    sessionCount: events.filter((e) => e.source !== "git").length,
    projectsTouched: [...allProjects],
    totalTokensUsed: totalTokens,
    estimatedHoursActive: Math.round((totalMinutes / 60) * 10) / 10,
  };
}

function emptySummary(engineer: string, date: string, timezone: string): DailySummary {
  return {
    date, engineer, timezone,
    decisions: [], blockers: [], shipped: [], inProgress: [],
    sessionCount: 0, projectsTouched: [],
    totalTokensUsed: 0, estimatedHoursActive: 0,
  };
}

function createAnthropicCaller(model?: string): (prompt: string) => Promise<string> {
  const client = new Anthropic();
  return async (prompt: string) => {
    const response = await client.messages.create({
      model: model || "claude-sonnet-4-6-20260320",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text || "";
  };
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/synthesizer/synthesizer.test.ts
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/synthesizer/ tests/synthesizer/
git commit -m "feat: LLM synthesizer — prompt building and response parsing"
```

---

## Task 6: Markdown Renderer

**Files:**
- Create: `src/delivery/markdown.ts`
- Create: `tests/delivery/markdown.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/delivery/markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/delivery/markdown.js";
import type { DailySummary } from "../../src/types.js";

const mockSummary: DailySummary = {
  date: "2026-03-19",
  engineer: "pranav",
  timezone: "Asia/Kolkata",
  shipped: [
    { title: "Fixed auth bug", project: "monorepo", description: "Token validation was sync", commits: ["abc1234"], filesChanged: 2 },
  ],
  decisions: [
    { title: "Switched to in-memory cache", project: "monorepo", description: "Redis was overkill", rationale: "Simpler for current scale", previousApproach: "Redis" },
  ],
  blockers: [
    { title: "Error UX for expired sessions", project: "monorepo", description: "Show error or redirect?", needsInputFrom: "product", severity: "blocking" },
  ],
  inProgress: [
    { title: "Auth middleware rewrite", project: "snapai", description: "60% done", estimatedCompletion: "tomorrow" },
  ],
  sessionCount: 5,
  projectsTouched: ["monorepo", "snapai"],
  totalTokensUsed: 50000,
  estimatedHoursActive: 3.5,
};

describe("renderMarkdown", () => {
  it("includes all four sections", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("Shipped");
    expect(output).toContain("Decisions");
    expect(output).toContain("Blockers");
    expect(output).toContain("In Progress");
  });

  it("includes item titles", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("Fixed auth bug");
    expect(output).toContain("Switched to in-memory cache");
    expect(output).toContain("Error UX for expired sessions");
    expect(output).toContain("Auth middleware rewrite");
  });

  it("includes the footer stats", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("5 sessions");
    expect(output).toContain("2 projects");
  });

  it("includes the date and engineer", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("2026-03-19");
    expect(output).toContain("pranav");
  });

  it("handles empty categories gracefully", () => {
    const empty: DailySummary = {
      ...mockSummary, shipped: [], decisions: [], blockers: [], inProgress: [],
    };
    const output = renderMarkdown(empty);
    expect(output).toContain("No activity");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/delivery/markdown.test.ts
```

- [ ] **Step 3: Implement markdown renderer**

`src/delivery/markdown.ts`:

```typescript
import type { DailySummary } from "../types.js";

export function renderMarkdown(summary: DailySummary): string {
  const lines: string[] = [];

  lines.push(`# Daily Recap — ${summary.date}`);
  lines.push(`**${summary.engineer}**`);
  lines.push("");

  const hasContent =
    summary.shipped.length + summary.decisions.length +
    summary.blockers.length + summary.inProgress.length > 0;

  if (!hasContent) {
    lines.push("No activity to report today.");
    return lines.join("\n");
  }

  if (summary.shipped.length > 0) {
    lines.push("## Shipped");
    for (const item of summary.shipped) {
      lines.push(`- **${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      if (item.commits.length > 0) {
        lines.push(`  _Commits: ${item.commits.join(", ")}_`);
      }
    }
    lines.push("");
  }

  if (summary.decisions.length > 0) {
    lines.push("## Decisions");
    for (const item of summary.decisions) {
      lines.push(`- **${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      if (item.rationale) lines.push(`  _Rationale: ${item.rationale}_`);
    }
    lines.push("");
  }

  if (summary.inProgress.length > 0) {
    lines.push("## In Progress");
    for (const item of summary.inProgress) {
      lines.push(`- **${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      if (item.estimatedCompletion) lines.push(`  _ETA: ${item.estimatedCompletion}_`);
    }
    lines.push("");
  }

  if (summary.blockers.length > 0) {
    lines.push("## Blockers");
    for (const item of summary.blockers) {
      const sev = item.severity === "blocking" ? "BLOCKING" : "slowing";
      lines.push(`- **[${sev}] ${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      lines.push(`  _Needs input from: ${item.needsInputFrom}_`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `${summary.sessionCount} sessions | ${summary.projectsTouched.length} projects | ~${summary.estimatedHoursActive}h active`
  );

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/delivery/markdown.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/delivery/markdown.ts tests/delivery/markdown.test.ts
git commit -m "feat: markdown renderer — format DailySummary for terminal output"
```

---

## Task 7: CLI Entry Point + Init

**Files:**
- Create: `src/cli.ts`
- Create: `src/init/init.ts`

- [ ] **Step 1: Create `src/init/init.ts`**

```typescript
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { detectTools } from "../config/detect.js";
import { stringify as stringifyYaml } from "yaml";

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log("\nWelcome to Recap!\n");

  console.log("Detecting AI coding tools...");
  const tools = detectTools();
  if (tools.claude.found) {
    console.log(`  Claude Code: found (${tools.claude.projectCount} projects, ${tools.claude.sessionCount} sessions)`);
  } else {
    console.log("  Claude Code: not found");
  }
  if (tools.codex.found) console.log("  Codex CLI:   found");
  if (tools.cursor.found) console.log("  Cursor:      found");
  console.log("  Git:         found\n");

  const engineer = await rl.question("Your name (for summaries): ");
  const gitAuthor = await rl.question("Git author email (for commit matching): ");

  console.log("\nLLM provider:");
  console.log("  [1] Anthropic (recommended)");
  console.log("  [2] OpenAI");
  const providerChoice = await rl.question("  > ");
  const provider = providerChoice === "2" ? "openai" : "anthropic";

  const apiKeyEnvVar = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (process.env[apiKeyEnvVar]) {
    console.log(`  ${apiKeyEnvVar} found in environment. OK\n`);
  } else {
    console.log(`  Warning: ${apiKeyEnvVar} not set. Set it before running recap.\n`);
  }

  const config = {
    engineer,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    projects: [] as { path: string; name: string }[],
    git: { author: gitAuthor },
    llm: {
      provider,
      model: provider === "anthropic" ? "claude-sonnet-4-6-20260320" : "gpt-4o",
    },
  };

  const configDir = join(process.env.HOME || "", ".recap");
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "config.yaml");
  await writeFile(configPath, stringifyYaml(config), "utf-8");

  console.log(`Config written to ${configPath}`);
  console.log('Run `recap --dry-run` to preview your first summary!\n');
  rl.close();
}
```

- [ ] **Step 2: Create `src/cli.ts`**

```typescript
#!/usr/bin/env node

import { loadConfig, getDefaultConfigPath } from "./config/loader.js";
import { ClaudeCollector } from "./collectors/claude.js";
import { GitCollector } from "./collectors/git.js";
import { synthesize } from "./synthesizer/synthesizer.js";
import { renderMarkdown } from "./delivery/markdown.js";
import { runInit } from "./init/init.js";
import type { ActivityEvent, Collector } from "./types.js";

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "init") {
    await runInit();
    return;
  }

  let config;
  try {
    config = await loadConfig(getDefaultConfigPath());
  } catch {
    console.error("No config found. Run `recap init` first.");
    process.exit(1);
  }

  let date = new Date();
  const dateArgIdx = args.indexOf("--date");
  if (dateArgIdx !== -1 && args[dateArgIdx + 1]) {
    const dateStr = args[dateArgIdx + 1];
    if (dateStr === "yesterday") {
      date = new Date(Date.now() - 86400000);
    } else {
      date = new Date(dateStr);
    }
  }

  const isDryRun = args.includes("--dry-run");

  const collectors: Collector[] = [new ClaudeCollector(), new GitCollector()];
  const allEvents: ActivityEvent[] = [];

  for (const collector of collectors) {
    try {
      const events = await collector.collect(date, config);
      allEvents.push(...events);
    } catch (e: any) {
      console.error(`Warning: ${collector.name} collector failed: ${e.message}`);
    }
  }

  if (allEvents.length === 0) {
    console.log("No activity found for today.");
    return;
  }

  allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  console.log(`Found ${allEvents.length} activity events. Synthesizing...\n`);

  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(date);
  const summary = await synthesize(allEvents, {
    engineer: config.engineer,
    date: dateStr,
    timezone: config.timezone,
    model: config.llm.model,
  });

  const markdown = renderMarkdown(summary);
  console.log(markdown);

  if (isDryRun) {
    console.log("\n(dry run — not posting to Slack)");
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/init/init.ts
git commit -m "feat: CLI entry point with recap init, --dry-run, and --date flags"
```

---

## Task 8: End-to-End Smoke Test

- [ ] **Step 1: Create a minimal config for testing**

```bash
mkdir -p ~/.recap
cat > ~/.recap/config.yaml << 'YAML'
engineer: pranav
timezone: Asia/Kolkata
projects: []
git:
  author: pranav
llm:
  provider: anthropic
  model: claude-sonnet-4-6-20260320
YAML
```

- [ ] **Step 2: Run the full pipeline against real data**

```bash
npx tsx src/cli.ts --dry-run
```

Verify: Claude sessions found, LLM produces summary, markdown prints.

- [ ] **Step 3: Test with a specific date**

```bash
npx tsx src/cli.ts --dry-run --date yesterday
```

- [ ] **Step 4: Build and verify the binary works**

```bash
npm run build && node dist/cli.js --dry-run
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Phase 1 complete — walking skeleton with Claude + Git collectors"
```

---

## Phase 1 Completion Criteria

Running `recap --dry-run` on a day with 3+ Claude Code sessions:
- [ ] Finds and parses Claude JSONL sessions
- [ ] Finds and parses git commits
- [ ] Sends activity data to LLM
- [ ] Receives structured JSON with decisions/blockers/shipped/inProgress
- [ ] Renders readable markdown to stdout
- [ ] All unit tests pass
- [ ] `recap init` creates a valid config file
