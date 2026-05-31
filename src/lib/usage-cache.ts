export type UsageCacheDecision = {
  useCache: boolean;
  ageMs: number;
  minAgeMs: number;
  nextLiveRefreshAt?: number;
};

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
