import type { UsageWindow } from "./types";

// Pure normalization of raw provider responses -> UsageWindow[]. No I/O, no
// server-only deps, so these are unit-testable in plain node.

type ClaudeWindow =
  | { utilization?: number; resets_at?: string }
  | null
  | undefined;
export type ClaudeUsage = {
  five_hour?: ClaudeWindow;
  seven_day?: ClaudeWindow;
  seven_day_opus?: ClaudeWindow;
  seven_day_sonnet?: ClaudeWindow;
};

const CLAUDE_DEFS: { field: keyof ClaudeUsage; key: string; label: string }[] = [
  { field: "five_hour", key: "5h", label: "5-hour" },
  { field: "seven_day", key: "7d", label: "Weekly" },
  { field: "seven_day_opus", key: "7d_opus", label: "Weekly (Opus)" },
  { field: "seven_day_sonnet", key: "7d_sonnet", label: "Weekly (Sonnet)" },
];

export function normalizeClaude(raw: ClaudeUsage): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const def of CLAUDE_DEFS) {
    const w = raw[def.field];
    if (!w || typeof w.utilization !== "number") continue;
    windows.push({
      key: def.key,
      label: def.label,
      usedPercent: w.utilization,
      resetsAt: w.resets_at ?? null,
    });
  }
  return windows;
}

type CodexWindow = {
  used_percent?: number;
  reset_at?: number; // epoch seconds
  reset_after_seconds?: number;
  limit_window_seconds?: number;
} | null;
export type CodexUsage = {
  plan_type?: string;
  rate_limit?: { primary_window?: CodexWindow; secondary_window?: CodexWindow };
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: number };
};

const CODEX_DEFS: {
  field: "primary_window" | "secondary_window";
  fallbackKey: string;
  fallbackLabel: string;
}[] = [
  { field: "primary_window", fallbackKey: "5h", fallbackLabel: "5-hour" },
  { field: "secondary_window", fallbackKey: "7d", fallbackLabel: "Weekly" },
];

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WEEK_SECONDS = 7 * DAY_SECONDS;
const FIVE_HOURS_SECONDS = 5 * HOUR_SECONDS;
const MONTH_MIN_SECONDS = 28 * DAY_SECONDS;
const MONTH_MAX_SECONDS = 32 * DAY_SECONDS;

function codexWindowMeta(
  w: NonNullable<CodexWindow>,
  fallback: (typeof CODEX_DEFS)[number],
): { key: string; label: string } {
  const seconds = w.limit_window_seconds;
  if (typeof seconds !== "number") {
    return { key: fallback.fallbackKey, label: fallback.fallbackLabel };
  }
  if (seconds === FIVE_HOURS_SECONDS) return { key: "5h", label: "5-hour" };
  if (seconds === WEEK_SECONDS) return { key: "7d", label: "Weekly" };
  if (seconds >= MONTH_MIN_SECONDS && seconds <= MONTH_MAX_SECONDS) {
    return { key: "monthly", label: "Monthly" };
  }
  if (seconds % WEEK_SECONDS === 0) {
    const weeks = seconds / WEEK_SECONDS;
    return {
      key: `${seconds}s`,
      label: `${weeks}-week`,
    };
  }
  if (seconds % DAY_SECONDS === 0) {
    const days = seconds / DAY_SECONDS;
    return {
      key: `${seconds}s`,
      label: `${days}-day`,
    };
  }
  if (seconds % HOUR_SECONDS === 0) {
    const hours = seconds / HOUR_SECONDS;
    return {
      key: `${seconds}s`,
      label: `${hours}-hour`,
    };
  }
  return { key: `${seconds}s`, label: "Custom" };
}

export function normalizeCodex(raw: CodexUsage): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const rl = raw.rate_limit;
  if (!rl) return windows;
  for (const def of CODEX_DEFS) {
    const w = rl[def.field];
    if (!w || typeof w.used_percent !== "number") continue;
    const meta = codexWindowMeta(w, def);
    // ChatGPT sometimes reports a phantom <=1% on a window that hasn't started
    // yet (reset timer still at the full window length, e.g. shared team quota
    // rounding up). Treat that as unused so a fresh window shows 100% left.
    const notStarted =
      typeof w.reset_after_seconds === "number" &&
      typeof w.limit_window_seconds === "number" &&
      w.reset_after_seconds === w.limit_window_seconds;
    const usedPercent = notStarted && w.used_percent <= 1 ? 0 : w.used_percent;
    windows.push({
      key: meta.key,
      label: meta.label,
      usedPercent,
      // A not-yet-started window's reset_at is just "now + full window"; it's
      // not a real countdown, so suppress it and render "—" like Claude does.
      resetsAt:
        notStarted || typeof w.reset_at !== "number"
          ? null
          : new Date(w.reset_at * 1000).toISOString(),
      windowSeconds:
        typeof w.limit_window_seconds === "number"
          ? w.limit_window_seconds
          : undefined,
    });
  }
  return windows;
}
