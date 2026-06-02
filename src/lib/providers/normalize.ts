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
  key: string;
  label: string;
}[] = [
  { field: "primary_window", key: "5h", label: "5-hour" },
  { field: "secondary_window", key: "7d", label: "Weekly" },
];

export function normalizeCodex(raw: CodexUsage): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const rl = raw.rate_limit;
  if (!rl) return windows;
  for (const def of CODEX_DEFS) {
    const w = rl[def.field];
    if (!w || typeof w.used_percent !== "number") continue;
    // ChatGPT sometimes reports a phantom <=1% on a window that hasn't started
    // yet (reset timer still at the full window length, e.g. shared team quota
    // rounding up). Treat that as unused so a fresh window shows 100% left.
    const notStarted =
      typeof w.reset_after_seconds === "number" &&
      typeof w.limit_window_seconds === "number" &&
      w.reset_after_seconds === w.limit_window_seconds;
    const usedPercent = notStarted && w.used_percent <= 1 ? 0 : w.used_percent;
    windows.push({
      key: def.key,
      label: def.label,
      usedPercent,
      resetsAt:
        typeof w.reset_at === "number"
          ? new Date(w.reset_at * 1000).toISOString()
          : null,
      windowSeconds:
        typeof w.limit_window_seconds === "number"
          ? w.limit_window_seconds
          : undefined,
    });
  }
  return windows;
}
