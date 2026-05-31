export type UsageCacheDecision = {
  useCache: boolean;
  ageMs: number;
  minAgeMs: number;
  nextLiveRefreshAt?: number;
};

export const FORCE_REFRESH_FLOOR_MS = 5_000;

export function usageCacheDecision(input: {
  cachedAt: number;
  now: number;
  ttlMs: number;
  force: boolean;
  floorMs: number;
}): UsageCacheDecision {
  const minAgeMs = input.force ? input.floorMs : input.ttlMs;
  const ageMs = Math.max(0, input.now - input.cachedAt);
  if (ageMs < minAgeMs) {
    return {
      useCache: true,
      ageMs,
      minAgeMs,
      nextLiveRefreshAt: input.cachedAt + minAgeMs,
    };
  }
  return { useCache: false, ageMs, minAgeMs };
}

export function refreshCooldownLabel(
  nextLiveRefreshAt: string,
  nowMs = Date.now(),
): string {
  const nextMs = new Date(nextLiveRefreshAt).getTime();
  if (!Number.isFinite(nextMs)) return "soon";

  const remainingMs = nextMs - nowMs;
  if (remainingMs <= 0) return "now";

  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 60) return `in ${seconds}s`;

  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes}m`;
}
