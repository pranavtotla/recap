import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/delivery/markdown.js";
import type { DailySummary } from "../../src/types.js";

const mockSummary: DailySummary = {
  date: "2026-03-19",
  engineer: "pranav",
  timezone: "Asia/Kolkata",
  shipped: [
    { title: "Fixed auth bug", project: "monorepo", description: "Token validation was sync", commits: ["abc1234"], filesChanged: 2 },
  ],
  decisions: [
    { title: "Switched to in-memory cache", project: "monorepo", description: "Redis was overkill", rationale: "Simpler for current scale", previousApproach: "Redis" },
  ],
  blockers: [
    { title: "Error UX for expired sessions", project: "monorepo", description: "Show error or redirect?", needsInputFrom: "product", severity: "blocking" },
  ],
  inProgress: [
    { title: "Auth middleware rewrite", project: "snapai", description: "60% done", estimatedCompletion: "tomorrow" },
  ],
  sessionCount: 5,
  projectsTouched: ["monorepo", "snapai"],
  totalTokensUsed: 50000,
  estimatedHoursActive: 3.5,
};

describe("renderMarkdown", () => {
  it("includes all four sections", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("Shipped");
    expect(output).toContain("Decisions");
    expect(output).toContain("Blockers");
    expect(output).toContain("In Progress");
  });

  it("includes item titles", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("Fixed auth bug");
    expect(output).toContain("Switched to in-memory cache");
    expect(output).toContain("Error UX for expired sessions");
    expect(output).toContain("Auth middleware rewrite");
  });

  it("includes the footer stats", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("5 sessions");
    expect(output).toContain("2 projects");
  });

  it("includes the date and engineer", () => {
    const output = renderMarkdown(mockSummary);
    expect(output).toContain("2026-03-19");
    expect(output).toContain("pranav");
  });

  it("handles empty categories gracefully", () => {
    const empty: DailySummary = {
      ...mockSummary, shipped: [], decisions: [], blockers: [], inProgress: [],
    };
    const output = renderMarkdown(empty);
    expect(output).toContain("No activity");
  });
});
