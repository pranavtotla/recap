import { describe, it, expect } from "vitest";
import { parseGitLogDetailed, GitCollector } from "../../src/collectors/git.js";

describe("parseGitLogDetailed", () => {
  it("parses git log with numstat into detailed commits", () => {
    const logOutput = `abc1234\x00Fix login validation bug
3\t1\tsrc/auth.ts
2\t0\ttests/auth.test.ts

def5678\x00Add user registration tests
5\t0\ttests/register.test.ts`;

    const commits = parseGitLogDetailed(logOutput);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("abc1234");
    expect(commits[0].message).toBe("Fix login validation bug");
    expect(commits[0].additions).toBe(5);
    expect(commits[0].deletions).toBe(1);
    expect(commits[0].filesChanged).toEqual(["src/auth.ts", "tests/auth.test.ts"]);
  });

  it("handles empty output", () => {
    expect(parseGitLogDetailed("")).toEqual([]);
    expect(parseGitLogDetailed("  \n  ")).toEqual([]);
  });

  it("handles commits with no file changes", () => {
    const logOutput = `abc1234\x00Empty merge commit`;
    const commits = parseGitLogDetailed(logOutput);
    expect(commits).toHaveLength(1);
    expect(commits[0].additions).toBe(0);
    expect(commits[0].filesChanged).toEqual([]);
  });

  it("handles commit messages containing pipes and special chars", () => {
    const logOutput = `abc1234\x00fix: handle A | B case in parser`;
    const commits = parseGitLogDetailed(logOutput);
    expect(commits[0].message).toBe("fix: handle A | B case in parser");
  });
});

describe("GitCollector", () => {
  it("implements the Collector interface", () => {
    const collector = new GitCollector();
    expect(collector.name).toBe("git");
    expect(typeof collector.collect).toBe("function");
  });
});
