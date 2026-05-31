import "server-only";
import { env } from "./env";
import { listAccountEntries, updateAccountSecret } from "./db";
import { claudeProvider } from "./providers/claude";
import { codexProvider } from "./providers/codex";
import { singleFlight } from "./single-flight";
import { usageCacheDecision } from "./usage-cache";
import type { AccountEntry } from "./account-row";
import type { AccountRecord, Provider, UsageSnapshot } from "./providers/types";

const providers: Record<string, Provider> = {
  claude: claudeProvider,
  codex: codexProvider,
};

// In-memory snapshot cache, kept on globalThis so it survives dev hot-reloads.
type CacheEntry = { snapshot: UsageSnapshot; at: number };
const g = globalThis as unknown as { __ouCache?: Map<string, CacheEntry> };
const cache = (g.__ouCache ??= new Map<string, CacheEntry>());

// Hard floor between live fetches per account, even on a forced refresh, so
// rapid manual refreshes can't trip provider rate limits (notably Claude's).
const FLOOR_MS = 180_000;

export type UsageRefreshMeta = {
  live: number;
  cached: number;
  nextLiveRefreshAt: string | null;
};

export type UsageResult = {
  snapshots: UsageSnapshot[];
  refresh: UsageRefreshMeta;
};

type AccountUsageResult = {
  snapshot: UsageSnapshot;
  source: "live" | "cache" | "error";
  nextLiveRefreshAt?: number;
};

async function fetchOne(
  account: AccountRecord,
  force: boolean,
): Promise<AccountUsageResult> {
  const ttlMs = env.cacheTtlSeconds * 1000;
  const cached = cache.get(account.id);
  if (cached) {
    const decision = usageCacheDecision({
      cachedAt: cached.at,
      now: Date.now(),
      ttlMs,
      force,
      floorMs: FLOOR_MS,
    });
    if (decision.useCache) {
      return {
        snapshot: cached.snapshot,
        source: "cache",
        nextLiveRefreshAt: decision.nextLiveRefreshAt,
      };
    }
  }

  const provider = providers[account.provider];
  if (!provider) {
    return {
      snapshot: {
        accountId: account.id,
        provider: account.provider,
        label: account.label,
        windows: [],
        fetchedAt: new Date().toISOString(),
        error: `Unknown provider "${account.provider}"`,
      },
      source: "error",
    };
  }

  const snapshot = await singleFlight(`usage:${account.id}`, () =>
    fetchLive(account, provider),
  );
  return { snapshot, source: snapshot.error ? "error" : "live" };
}

async function fetchLive(
  account: AccountRecord,
  provider: Provider,
): Promise<UsageSnapshot> {
  try {
    const { snapshot, updatedSecret } = await provider.fetchUsage(account);
    if (updatedSecret) updateAccountSecret(account.id, updatedSecret);
    // Cache successful results; let errors retry on next poll (still ≥ TTL apart
    // via the client, but never cache a transient failure for the full window).
    if (!snapshot.error) cache.set(account.id, { snapshot, at: Date.now() });
    return snapshot;
  } catch (err) {
    return {
      accountId: account.id,
      provider: account.provider,
      label: account.label,
      windows: [],
      fetchedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Fetch failed",
    };
  }
}

export async function getAllUsageResult(force = false): Promise<UsageResult> {
  const entries = listAccountEntries();
  const results = await Promise.all(
    entries.map((entry) =>
      entry.ok ? fetchOne(entry.account, force) : corruptAccountSnapshot(entry),
    ),
  );
  const nextLiveRefreshAt = results
    .map((result) => result.nextLiveRefreshAt)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];

  return {
    snapshots: results.map((result) => result.snapshot),
    refresh: {
      live: results.filter((result) => result.source === "live").length,
      cached: results.filter((result) => result.source === "cache").length,
      nextLiveRefreshAt: nextLiveRefreshAt
        ? new Date(nextLiveRefreshAt).toISOString()
        : null,
    },
  };
}

export async function getAllUsage(force = false): Promise<UsageSnapshot[]> {
  return (await getAllUsageResult(force)).snapshots;
}

export function invalidateCache(accountId?: string): void {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

function corruptAccountSnapshot(
  entry: Extract<AccountEntry, { ok: false }>,
): AccountUsageResult {
  return {
    snapshot: {
      accountId: entry.summary.id,
      provider: entry.summary.provider,
      label: entry.summary.label,
      windows: [],
      fetchedAt: new Date().toISOString(),
      error: `${entry.error} Re-add credentials or check APP_SECRET.`,
      needsReauth: true,
    },
    source: "error",
  };
}
