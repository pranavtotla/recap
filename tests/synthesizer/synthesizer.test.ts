import { describe, it, expect, vi } from "vitest";
import { synthesize, parseLLMResponse } from "../../src/synthesizer/synthesizer.js";
import type { ActivityEvent } from "../../src/types.js";

const mockEvent: ActivityEvent = {
  source: "claude",
  sessionId: "sess-1",
  sessionTitle: "Fix login bug",
  project: "monorepo",
  gitBranch: "main",
  timestamp: new Date("2026-03-19T09:00:00Z"),
  duration: 30,
  actions: {
    filesModified: ["src/auth.ts"],
    filesCreated: ["tests/auth.test.ts"],
    toolsUsed: { Edit: 3, Read: 5, Bash: 2 },
    commits: [{ sha: "abc1234", message: "fix: auth token validation", additions: 15, deletions: 3 }],
    tokensUsed: 5000,
  },
  userPrompts: ["Fix the login bug where users get 403"],
  keyAssistantResponses: ["I found the issue in the auth middleware"],
};

describe("parseLLMResponse", () => {
  it("parses valid JSON response into DailySummary fields", () => {
    const json = JSON.stringify({
      decisions: [],
      blockers: [],
      shipped: [{ title: "Fixed auth", project: "monorepo", description: "Fixed token validation", commits: ["abc1234"], filesChanged: 2 }],
      inProgress: [],
    });

    const result = parseLLMResponse(json, "testuser", "2026-03-19", "Asia/Kolkata", [mockEvent]);
    expect(result.shipped).toHaveLength(1);
    expect(result.shipped[0].title).toBe("Fixed auth");
    expect(result.engineer).toBe("testuser");
    expect(result.date).toBe("2026-03-19");
    expect(result.sessionCount).toBe(1);
  });

  it("handles response with markdown code fences", () => {
    const json = "```json\n" + JSON.stringify({
      decisions: [], blockers: [], shipped: [], inProgress: [],
    }) + "\n```";

    const result = parseLLMResponse(json, "testuser", "2026-03-19", "UTC", []);
    expect(result.decisions).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLLMResponse("not json", "u", "d", "UTC", [])).toThrow();
  });

  it("filters out malformed items missing title or project", () => {
    const json = JSON.stringify({
      decisions: [{ wrong: "shape" }, { title: "Valid", project: "p", description: "d", rationale: "r" }],
      blockers: "not an array",
      shipped: [{ title: "No project field" }],
      inProgress: [],
    });

    const result = parseLLMResponse(json, "testuser", "2026-03-19", "UTC", []);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].title).toBe("Valid");
    expect(result.blockers).toEqual([]);
    expect(result.shipped).toEqual([]);
  });
});

describe("synthesize", () => {
  it("calls the LLM and returns a DailySummary", async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      decisions: [],
      blockers: [{ title: "Need PM input", project: "monorepo", description: "Error UX?", needsInputFrom: "product", severity: "blocking" }],
      shipped: [{ title: "Fixed auth", project: "monorepo", description: "Fixed it", commits: ["abc1234"], filesChanged: 1 }],
      inProgress: [],
    }));

    const result = await synthesize([mockEvent], {
      engineer: "testuser",
      date: "2026-03-19",
      timezone: "Asia/Kolkata",
      callLLM: mockLLM,
    });

    expect(result.shipped).toHaveLength(1);
    expect(result.blockers).toHaveLength(1);
    expect(result.sessionCount).toBe(1);
    expect(result.projectsTouched).toContain("monorepo");
    expect(mockLLM).toHaveBeenCalledOnce();
  });

  it("returns empty summary for no events", async () => {
    const result = await synthesize([], {
      engineer: "testuser",
      date: "2026-03-19",
      timezone: "UTC",
    });
    expect(result.sessionCount).toBe(0);
    expect(result.shipped).toEqual([]);
  });
});
