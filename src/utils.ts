import { homedir } from "node:os";

/**
 * Expand leading ~ to the user's home directory.
 */
export function expandPath(p: string): string {
  return p.replace(/^~/, homedir());
}

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone.
 * Uses en-CA locale which natively produces ISO date format.
 */
export function formatLocalDate(date: Date, timezone: string): string {
  return getDateFormatter(timezone).format(date);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timezone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    formatterCache.set(timezone, f);
  }
  return f;
}
