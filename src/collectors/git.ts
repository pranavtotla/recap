import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expandPath, formatLocalDate } from "../utils.js";
import type { ActivityEvent, Collector, RecapConfig } from "../types.js";

const execFileAsync = promisify(execFile);

export class GitCollector implements Collector {
  name = "git";

  async collect(date: Date, config: RecapConfig): Promise<ActivityEvent[]> {
    if (config.projects.length === 0) return [];

    const dateStr = formatLocalDate(date, config.timezone);

    const results = await Promise.allSettled(
      config.projects.map((project) =>
        collectFromRepo(project.name, expandPath(project.path), dateStr, config)
      )
    );

    const events: ActivityEvent[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        events.push(result.value);
      }
    }
    return events;
  }
}

async function collectFromRepo(
  projectName: string,
  repoPath: string,
  dateStr: string,
  config: RecapConfig
): Promise<ActivityEvent | null> {
  const { stdout } = await execFileAsync("git", [
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
  });

  const logOutput = stdout.trim();
  if (!logOutput) return null;

  const commits = parseGitLogDetailed(logOutput);
  if (commits.length === 0) return null;

  const allFiles = new Set<string>();
  for (const c of commits) {
    for (const f of c.filesChanged) allFiles.add(f);
  }

  return {
    source: "git",
    sessionId: `git-${projectName}-${dateStr}`,
    sessionTitle: `${commits.length} commit(s) in ${projectName}`,
    project: projectName,
    timestamp: new Date(dateStr),
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
  };
}

interface DetailedCommit {
  sha: string;
  message: string;
  additions: number;
  deletions: number;
  filesChanged: string[];
}

export function parseGitLogDetailed(output: string): DetailedCommit[] {
  const commits: DetailedCommit[] = [];
  const lines = output.split("\n");
  let current: DetailedCommit | null = null;

  for (const line of lines) {
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
