import { readFile, readdir, open } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { expandPath, formatLocalDate } from "../utils.js";
import type { ActivityEvent, Collector, RecapConfig } from "../types.js";

const MAX_USER_PROMPTS = 20;

export class ClaudeCollector implements Collector {
  name = "claude";

  async collect(date: Date, config: RecapConfig): Promise<ActivityEvent[]> {
    const projectsDir = join(homedir(), ".claude", "projects");
    const targetDate = formatLocalDate(date, config.timezone);

    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      return [];
    }

    const events: ActivityEvent[] = [];

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

      // Parse matching files concurrently within each project
      const results = await Promise.all(
        jsonlFiles.map(async (file) => {
          try {
            const filePath = join(projPath, file);
            // Cheap date pre-filter: peek first timestamp before full parse
            if (!(await matchesDate(filePath, targetDate, config.timezone))) {
              return null;
            }
            return await parseClaudeSession(filePath, projectName);
          } catch {
            return null;
          }
        })
      );

      for (const event of results) {
        if (event) events.push(event);
      }
    }

    return events;
  }
}

/**
 * Read just enough of the file to extract the first timestamp and check
 * if it falls on the target date. Avoids fully parsing sessions from other days.
 */
async function matchesDate(filePath: string, targetDate: string, timezone: string): Promise<boolean> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(4096);
    await fh.read(buf, 0, 4096, 0);
    const chunk = buf.toString("utf-8");
    const match = chunk.match(/"timestamp"\s*:\s*"([^"]+)"/);
    if (!match) return true; // Can't determine — parse fully
    return formatLocalDate(new Date(match[1]), timezone) === targetDate;
  } finally {
    await fh.close();
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
    userPrompts: userPrompts.slice(0, MAX_USER_PROMPTS),
    keyAssistantResponses: keyResponses.slice(0, 10),
  };
}

function resolveProjectName(encodedDir: string, projects: { path: string; name: string }[]): string {
  const decodedPath = "/" + encodedDir.replace(/^-/, "").replace(/-/g, "/");
  for (const p of projects) {
    const normalizedConfigPath = expandPath(p.path);
    if (decodedPath.startsWith(normalizedConfigPath) || decodedPath === normalizedConfigPath) {
      return p.name;
    }
  }
  return decodedPath.split("/").filter(Boolean).pop() || "unknown";
}
