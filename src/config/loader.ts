import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
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
    throw new Error("Config missing 'projects' array");
  }
}

export function getDefaultConfigPath(): string {
  return join(homedir(), ".recap", "config.yaml");
}
