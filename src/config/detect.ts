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
