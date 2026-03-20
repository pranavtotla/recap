import type { ActivityEvent } from "../types.js";

export function buildSynthesisPrompt(events: ActivityEvent[], engineer: string, date: string): string {
  const eventsText = events
    .map((e, i) => {
      const toolsSummary = Object.entries(e.actions.toolsUsed)
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");

      const commitsSummary = e.actions.commits
        .map((c) => `  - ${c.sha}: ${c.message} (+${c.additions}/-${c.deletions})`)
        .join("\n");

      return `### Session ${i + 1}: ${e.sessionTitle}
- Source: ${e.source}
- Project: ${e.project}
- Branch: ${e.gitBranch || "unknown"}
- Duration: ${e.duration ? `${e.duration} min` : "unknown"}
- Tools used: ${toolsSummary || "none"}
- Files modified: ${e.actions.filesModified.join(", ") || "none"}
- Files created: ${e.actions.filesCreated.join(", ") || "none"}
${commitsSummary ? `- Commits:\n${commitsSummary}` : "- Commits: none"}

User prompts:
${e.userPrompts.map((p) => `> ${p.slice(0, 200)}`).join("\n")}`;
    })
    .join("\n\n---\n\n");

  return `You are an engineering activity summarizer. Analyze the following AI coding sessions and git activity for ${engineer} on ${date}, and produce a structured daily summary.

IMPORTANT RULES:
1. Classify each piece of work into exactly ONE category: shipped, decisions, inProgress, or blockers.
2. "Shipped" = work that resulted in commits. Cross-reference session activity with git commits.
3. "Decisions" = choices that diverge from a previous plan or represent significant technical decisions.
4. "Blockers" = anything explicitly waiting on someone else's input or blocked by external factors.
5. "In Progress" = work started but not yet committed/completed.
6. Do NOT duplicate items across categories.
7. Do NOT hallucinate commits or file names — only reference what appears in the data.
8. Group related work across sessions (same feature in multiple sessions = one item).

SESSION DATA:
${eventsText}

Respond with ONLY valid JSON matching this schema:
{
  "decisions": [{"title": "...", "project": "...", "description": "...", "rationale": "...", "relatedCommits": ["sha"], "previousApproach": "..."}],
  "blockers": [{"title": "...", "project": "...", "description": "...", "needsInputFrom": "product|engineering|design|external", "severity": "blocking|slowing"}],
  "shipped": [{"title": "...", "project": "...", "description": "...", "commits": ["sha"], "filesChanged": 0}],
  "inProgress": [{"title": "...", "project": "...", "description": "...", "estimatedCompletion": "..."}]
}`;
}
