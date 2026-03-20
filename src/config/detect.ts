import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DetectedTools {
  claude: { found: boolean; projectCount: number; sessionCount: number; path: string };
  codex: { found: boolean; path: string };
  cursor: { found: boolean; path: string };
  git: { found: boolean };
}

export function detectTools(): DetectedTools {
  const home = homedir();

  const claudePath = join(home, ".claude", "projects");
  let claudeProjects = 0;
  let claudeSessions = 0;
  try {
    const dirs = readdirSync(claudePath, { withFileTypes: true }).filter((d) => d.isDirectory());
    claudeProjects = dirs.length;
    for (const dir of dirs) {
      const files = readdirSync(join(claudePath, dir.name));
      claudeSessions += files.filter((f) => f.endsWith(".jsonl")).length;
    }
  } catch {
    // Directory not found — Claude Code not installed
  }

  const codexPath = join(home, ".codex");
  const cursorPath = join(
    home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"
  );

  return {
    claude: {
      found: claudeProjects > 0,
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
