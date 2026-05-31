import type { UsageSnapshot } from "./providers/types";

export function finalizeUsageSnapshot(
  snapshot: UsageSnapshot,
  fetchedAtMs = Date.now(),
): UsageSnapshot {
  return {
    ...snapshot,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
  };
}
