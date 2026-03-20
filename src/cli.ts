#!/usr/bin/env node

import { loadConfig, getDefaultConfigPath } from "./config/loader.js";
import { ClaudeCollector } from "./collectors/claude.js";
import { GitCollector } from "./collectors/git.js";
import { synthesize } from "./synthesizer/synthesizer.js";
import { renderMarkdown } from "./delivery/markdown.js";
import { runInit } from "./init/init.js";
import { formatLocalDate } from "./utils.js";
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

  // Run collectors concurrently — they are independent
  const collectors: Collector[] = [new ClaudeCollector(), new GitCollector()];
  const results = await Promise.allSettled(
    collectors.map((c) => c.collect(date, config))
  );

  const allEvents: ActivityEvent[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      allEvents.push(...result.value);
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Warning: ${collectors[i].name} collector failed: ${msg}`);
    }
  }

  if (allEvents.length === 0) {
    console.log("No activity found for today.");
    return;
  }

  allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  console.log(`Found ${allEvents.length} activity events. Synthesizing...\n`);

  const summary = await synthesize(allEvents, {
    engineer: config.engineer,
    date: formatLocalDate(date, config.timezone),
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
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Error:", msg);
  process.exit(1);
});
