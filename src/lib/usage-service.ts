import { singleFlight } from "./single-flight.ts";
import { FORCE_REFRESH_FLOOR_MS, usageCacheDecision } from "./usage-cache.ts";
import { finalizeUsageSnapshot } from "./usage-snapshot.ts";
import type { AccountEntry } from "./account-row.ts";
import type {
  AccountRecord,
  AccountSecret,
  Provider,
  UsageSnapshot,
} from "./providers/types.ts";

export type UsageRefreshMeta = {
  live: number;
  cached: number;
  errors: number;
  nextLiveRefreshAt: string | null;
};

export type UsageResult = {
  snapshots: UsageSnapshot[];
  refresh: UsageRefreshMeta;
};

export type UsageCacheEntry = { snapshot: UsageSnapshot; at: number };

type AccountUsageResult = {
  snapshot: UsageSnapshot;
  source: "live" | "cache" | "error";
  nextLiveRefreshAt?: number;
};

export type UsageServiceDeps = {
  providers: Record<string, Provider>;
  listAccountEntries: () => AccountEntry[];
  updateAccountSecret: (id: string, secret: AccountSecret) => void;
  cache: Map<string, UsageCacheEntry>;
  attempts: Map<string, UsageCacheEntry>;
  cacheTtlSeconds: () => number;
  now: () => number;
};

export function createUsageService(deps: UsageServiceDeps) {
  async function fetchOne(
    account: AccountRecord,
    force: boolean,
  ): Promise<AccountUsageResult> {
    const ttlMs = deps.cacheTtlSeconds() * 1000;
    const now = deps.now();

    const attempted = deps.attempts.get(account.id);
    if (attempted?.snapshot.error) {
      const decision = usageCacheDecision({
        cachedAt: attempted.at,
        now,
        ttlMs: FORCE_REFRESH_FLOOR_MS,
        force: true,
        floorMs: FORCE_REFRESH_FLOOR_MS,
      });
      if (decision.useCache) {
        return {
          snapshot: attempted.snapshot,
          source: "cache",
          nextLiveRefreshAt: decision.nextLiveRefreshAt,
        };
      }
    }

    const cached = deps.cache.get(account.id);
    if (cached) {
      const decision = usageCacheDecision({
        cachedAt: cached.at,
        now,
        ttlMs,
        force,
        floorMs: FORCE_REFRESH_FLOOR_MS,
      });
      if (decision.useCache) {
        return {
          snapshot: cached.snapshot,
          source: "cache",
          nextLiveRefreshAt: decision.nextLiveRefreshAt,
        };
      }
    }

    const provider = deps.providers[account.provider];
    if (!provider) {
      return {
        snapshot: {
          accountId: account.id,
          provider: account.provider,
          label: account.label,
          windows: [],
          fetchedAt: new Date(deps.now()).toISOString(),
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
      if (updatedSecret) deps.updateAccountSecret(account.id, updatedSecret);
      const fetchedAt = deps.now();
      const finalized = finalizeUsageSnapshot(snapshot, fetchedAt);
      deps.attempts.set(account.id, { snapshot: finalized, at: fetchedAt });
      if (!finalized.error) {
        deps.cache.set(account.id, { snapshot: finalized, at: fetchedAt });
      }
      return finalized;
    } catch (err) {
      const fetchedAt = deps.now();
      const snapshot = {
        accountId: account.id,
        provider: account.provider,
        label: account.label,
        windows: [],
        fetchedAt: new Date(fetchedAt).toISOString(),
        error: err instanceof Error ? err.message : "Fetch failed",
      };
      deps.attempts.set(account.id, { snapshot, at: fetchedAt });
      return snapshot;
    }
  }

  async function getAllUsageResult(force = false): Promise<UsageResult> {
    const entries = deps.listAccountEntries();
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
        errors: results.filter((result) => result.snapshot.error).length,
        nextLiveRefreshAt: nextLiveRefreshAt
          ? new Date(nextLiveRefreshAt).toISOString()
          : null,
      },
    };
  }

  async function getAllUsage(force = false): Promise<UsageSnapshot[]> {
    return (await getAllUsageResult(force)).snapshots;
  }

  function invalidateCache(accountId?: string): void {
    if (accountId) {
      deps.cache.delete(accountId);
      deps.attempts.delete(accountId);
    } else {
      deps.cache.clear();
      deps.attempts.clear();
    }
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
        fetchedAt: new Date(deps.now()).toISOString(),
        error: `${entry.error} Re-add credentials or check APP_SECRET.`,
        needsReauth: true,
      },
      source: "error",
    };
  }

  return { getAllUsageResult, getAllUsage, invalidateCache };
}
