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
