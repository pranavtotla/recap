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
