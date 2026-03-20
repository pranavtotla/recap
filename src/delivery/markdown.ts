import type { DailySummary } from "../types.js";

export function renderMarkdown(summary: DailySummary): string {
  const lines: string[] = [];

  lines.push(`# Daily Recap — ${summary.date}`);
  lines.push(`**${summary.engineer}**`);
  lines.push("");

  const hasContent =
    summary.shipped.length + summary.decisions.length +
    summary.blockers.length + summary.inProgress.length > 0;

  if (!hasContent) {
    lines.push("No activity to report today.");
    return lines.join("\n");
  }

  if (summary.shipped.length > 0) {
    lines.push("## Shipped");
    for (const item of summary.shipped) {
      lines.push(`- **${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      if (item.commits.length > 0) {
        lines.push(`  _Commits: ${item.commits.join(", ")}_`);
      }
    }
    lines.push("");
  }

  if (summary.decisions.length > 0) {
    lines.push("## Decisions");
    for (const item of summary.decisions) {
      lines.push(`- **${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      if (item.rationale) lines.push(`  _Rationale: ${item.rationale}_`);
    }
    lines.push("");
  }

  if (summary.inProgress.length > 0) {
    lines.push("## In Progress");
    for (const item of summary.inProgress) {
      lines.push(`- **${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      if (item.estimatedCompletion) lines.push(`  _ETA: ${item.estimatedCompletion}_`);
    }
    lines.push("");
  }

  if (summary.blockers.length > 0) {
    lines.push("## Blockers");
    for (const item of summary.blockers) {
      const sev = item.severity === "blocking" ? "BLOCKING" : "slowing";
      lines.push(`- **[${sev}] ${item.project}:** ${item.title}`);
      lines.push(`  ${item.description}`);
      lines.push(`  _Needs input from: ${item.needsInputFrom}_`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `${summary.sessionCount} sessions | ${summary.projectsTouched.length} projects | ~${summary.estimatedHoursActive}h active`
  );

  return lines.join("\n");
}
