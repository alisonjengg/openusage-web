import type { UsageWindow } from "./providers/types";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WINDOW_MS_BY_KEY: Record<string, number> = {
  "5h": 5 * HOUR_MS,
  "7d": 7 * DAY_MS,
  "7d_opus": 7 * DAY_MS,
  "7d_sonnet": 7 * DAY_MS,
};

export type UsagePace = {
  kind: "buffer" | "short" | "on_pace";
  label: string;
};

export function remainingPercent(usedPercent: number): number {
  const used = Math.min(100, Math.max(0, usedPercent));
  return 100 - used;
}

export function usageLeftColor(leftPercent: number): string {
  if (leftPercent <= 10) return "var(--danger)";
  if (leftPercent <= 30) return "var(--warn)";
  return "var(--ok)";
}

function windowDurationMs(window: UsageWindow): number | null {
  if (
    typeof window.windowSeconds === "number" &&
    Number.isFinite(window.windowSeconds) &&
    window.windowSeconds > 0
  ) {
    return window.windowSeconds * 1000;
  }
  return WINDOW_MS_BY_KEY[window.key] ?? null;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function usagePace(
  window: UsageWindow,
  nowMs = Date.now(),
): UsagePace | null {
  if (!window.resetsAt) return null;

  const durationMs = windowDurationMs(window);
  if (!durationMs) return null;

  const resetMs = new Date(window.resetsAt).getTime();
  if (Number.isNaN(resetMs)) return null;

  const timeLeftMs = Math.min(Math.max(resetMs - nowMs, 0), durationMs);
  const expectedLeft = (timeLeftMs / durationMs) * 100;
  const actualLeft = remainingPercent(window.usedPercent);
  const diffMs = ((actualLeft - expectedLeft) / 100) * durationMs;

  if (Math.abs(diffMs) < MINUTE_MS) {
    return { kind: "on_pace", label: "on pace" };
  }

  if (diffMs > 0) {
    return { kind: "buffer", label: `${formatDuration(diffMs)} buffer` };
  }
  return { kind: "short", label: `${formatDuration(Math.abs(diffMs))} short` };
}
