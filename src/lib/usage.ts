import "server-only";
import { env } from "./env";
import { listAccountEntries, updateAccountSecret } from "./db";
import { claudeProvider } from "./providers/claude";
import { codexProvider } from "./providers/codex";
import { singleFlight } from "./single-flight";
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

async function fetchOne(
  account: AccountRecord,
  force: boolean,
): Promise<UsageSnapshot> {
  const ttlMs = env.cacheTtlSeconds * 1000;
  const minAge = force ? FLOOR_MS : ttlMs;
  const cached = cache.get(account.id);
  if (cached && Date.now() - cached.at < minAge) {
    return cached.snapshot;
  }

  const provider = providers[account.provider];
  if (!provider) {
    return {
      accountId: account.id,
      provider: account.provider,
      label: account.label,
      windows: [],
      fetchedAt: new Date().toISOString(),
      error: `Unknown provider "${account.provider}"`,
    };
  }

  return singleFlight(`usage:${account.id}`, () => fetchLive(account, provider));
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

export async function getAllUsage(force = false): Promise<UsageSnapshot[]> {
  const entries = listAccountEntries();
  return Promise.all(
    entries.map((entry) =>
      entry.ok ? fetchOne(entry.account, force) : corruptAccountSnapshot(entry),
    ),
  );
}

export function invalidateCache(accountId?: string): void {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

function corruptAccountSnapshot(
  entry: Extract<AccountEntry, { ok: false }>,
): UsageSnapshot {
  return {
    accountId: entry.summary.id,
    provider: entry.summary.provider,
    label: entry.summary.label,
    windows: [],
    fetchedAt: new Date().toISOString(),
    error: `${entry.error} Re-add credentials or check APP_SECRET.`,
    needsReauth: true,
  };
}
