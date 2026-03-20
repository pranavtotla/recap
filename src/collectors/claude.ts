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
      const ts = new Date(msg.timestamp);
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
