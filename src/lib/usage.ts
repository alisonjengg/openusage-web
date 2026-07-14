import "server-only";
import { env } from "./env";
import { listAccountEntries, updateAccountSecret } from "./db";
import { claudeProvider } from "./providers/claude";
import { codexProvider } from "./providers/codex";
import {
  createUsageService,
  type UsageCacheEntry,
  type UsageRefreshMeta,
  type UsageResult,
} from "./usage-service";
import type { Provider } from "./providers/types";

const providers: Record<string, Provider> = {
  claude: claudeProvider,
  codex: codexProvider,
};

// In-memory usage state, kept on globalThis so it survives dev hot-reloads.
const g = globalThis as unknown as {
  __ouCache?: Map<string, UsageCacheEntry>;
  __ouAttempts?: Map<string, UsageCacheEntry>;
};

const service = createUsageService({
  providers,
  listAccountEntries,
  updateAccountSecret,
  cache: (g.__ouCache ??= new Map<string, UsageCacheEntry>()),
  attempts: (g.__ouAttempts ??= new Map<string, UsageCacheEntry>()),
  cacheTtlSeconds: () => env.cacheTtlSeconds,
  now: () => Date.now(),
});

export type { UsageRefreshMeta, UsageResult };

export const getAllUsageResult = service.getAllUsageResult;
export const getAllUsage = service.getAllUsage;
export const invalidateCache = service.invalidateCache;
