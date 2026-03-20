import { execFileSync } from "node:child_process";
import type { ActivityEvent, Collector, RecapConfig } from "../types.js";

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

function formatDateForGit(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}
