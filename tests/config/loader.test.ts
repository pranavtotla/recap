import { describe, it, expect } from "vitest";
import { loadConfig, validateConfig } from "../../src/config/loader.js";
import { RecapConfig } from "../../src/types.js";
import path from "node:path";

const FIXTURES = path.join(import.meta.dirname, "../fixtures");

describe("loadConfig", () => {
  it("loads a valid YAML config file", async () => {
    const config = await loadConfig(path.join(FIXTURES, "valid-config.yaml"));
    expect(config.engineer).toBe("testuser");
    expect(config.timezone).toBe("Asia/Kolkata");
    expect(config.projects).toHaveLength(1);
    expect(config.git.author).toBe("testuser@example.com");
    expect(config.llm.provider).toBe("anthropic");
  });

  it("throws on missing file", async () => {
    await expect(loadConfig("/nonexistent/config.yaml")).rejects.toThrow();
  });
});

describe("validateConfig", () => {
  it("rejects config missing engineer name", () => {
    const config = { timezone: "UTC", projects: [], git: { author: "a" }, llm: { provider: "anthropic", model: "x" } };
    expect(() => validateConfig(config as any)).toThrow("engineer");
  });

  it("rejects config missing llm provider", () => {
    const config = { engineer: "a", timezone: "UTC", projects: [], git: { author: "a" } };
    expect(() => validateConfig(config as any)).toThrow("llm");
  });

  it("accepts a valid config", () => {
    const config: RecapConfig = {
      engineer: "test",
      timezone: "UTC",
      projects: [],
      git: { author: "test@test.com" },
      llm: { provider: "anthropic", model: "claude-sonnet-4-6" },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });
});
