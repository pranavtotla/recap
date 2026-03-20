import Anthropic from "@anthropic-ai/sdk";
import { buildSynthesisPrompt } from "./prompts.js";
import type { ActivityEvent, DailySummary } from "../types.js";

export interface SynthesizeOptions {
  engineer: string;
  date: string;
  timezone: string;
  model?: string;
  callLLM?: (prompt: string) => Promise<string>;
}

export async function synthesize(
  events: ActivityEvent[],
  options: SynthesizeOptions
): Promise<DailySummary> {
  if (events.length === 0) {
    return emptySummary(options.engineer, options.date, options.timezone);
  }

  const prompt = buildSynthesisPrompt(events, options.engineer, options.date);
  const callLLM = options.callLLM || createAnthropicCaller(options.model);
  const response = await callLLM(prompt);

  return parseLLMResponse(response, options.engineer, options.date, options.timezone, events);
}

export function parseLLMResponse(
  raw: string,
  engineer: string,
  date: string,
  timezone: string,
  events: ActivityEvent[]
): DailySummary {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  const allProjects = new Set<string>();
  let totalTokens = 0;
  let totalMinutes = 0;

  for (const e of events) {
    allProjects.add(e.project);
    totalTokens += e.actions.tokensUsed;
    totalMinutes += e.duration || 0;
  }

  return {
    date,
    engineer,
    timezone,
    decisions: parsed.decisions || [],
    blockers: parsed.blockers || [],
    shipped: parsed.shipped || [],
    inProgress: parsed.inProgress || [],
    sessionCount: events.filter((e) => e.source !== "git").length,
    projectsTouched: [...allProjects],
    totalTokensUsed: totalTokens,
    estimatedHoursActive: Math.round((totalMinutes / 60) * 10) / 10,
  };
}

function emptySummary(engineer: string, date: string, timezone: string): DailySummary {
  return {
    date, engineer, timezone,
    decisions: [], blockers: [], shipped: [], inProgress: [],
    sessionCount: 0, projectsTouched: [],
    totalTokensUsed: 0, estimatedHoursActive: 0,
  };
}

function createAnthropicCaller(model?: string): (prompt: string) => Promise<string> {
  const client = new Anthropic();
  return async (prompt: string) => {
    const response = await client.messages.create({
      model: model || "claude-sonnet-4-6-20260320",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text || "";
  };
}
