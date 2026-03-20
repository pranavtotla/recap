import { describe, it, expect } from "vitest";
import { ClaudeCollector, parseClaudeSession } from "../../src/collectors/claude.js";
import path from "node:path";

const FIXTURES = path.join(import.meta.dirname, "../fixtures");

describe("parseClaudeSession", () => {
  it("extracts user prompts from a session JSONL file", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.userPrompts).toContain("Fix the login bug where users get 403 on valid credentials");
    expect(event.userPrompts).toContain("Now add a test for this fix");
    expect(event.userPrompts).toHaveLength(2);
  });

  it("extracts tool usage counts", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.actions.toolsUsed["Read"]).toBe(1);
    expect(event.actions.toolsUsed["Edit"]).toBe(1);
    expect(event.actions.toolsUsed["Write"]).toBe(1);
    expect(event.actions.toolsUsed["Bash"]).toBe(1);
  });

  it("extracts modified and created files", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.actions.filesModified).toContain("/Users/test/project-a/src/auth.ts");
    expect(event.actions.filesCreated).toContain("/Users/test/project-a/tests/auth.test.ts");
  });

  it("sets source to claude", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.source).toBe("claude");
  });

  it("extracts git branch and cwd", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.gitBranch).toBe("main");
    expect(event.project).toBe("test-project");
  });

  it("calculates duration from first to last timestamp", async () => {
    const event = await parseClaudeSession(
      path.join(FIXTURES, "claude-session-simple.jsonl"),
      "test-project"
    );
    expect(event.duration).toBe(6); // 09:00 to 09:06 = 6 minutes
  });
});

describe("ClaudeCollector", () => {
  it("implements the Collector interface", () => {
    const collector = new ClaudeCollector();
    expect(collector.name).toBe("claude");
    expect(typeof collector.collect).toBe("function");
  });
});
