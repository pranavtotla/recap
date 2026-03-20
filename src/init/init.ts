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
