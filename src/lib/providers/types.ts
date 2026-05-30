export type ProviderId = "claude" | "codex";

// Decrypted token material, provider-specific.
export type ClaudeSecret = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number; // epoch ms; optional (refresh on 401 if unknown)
};

export type CodexSecret = {
  accessToken: string;
  refreshToken: string;
  accountId?: string; // optional; can be decoded from the JWT if absent
};

export type AccountSecret = ClaudeSecret | CodexSecret;

export type AccountRecord = {
  id: string;
  provider: ProviderId;
  label: string;
  secret: AccountSecret;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

// Normalized output the dashboard consumes (no tokens).
export type UsageWindow = {
  key: string; // "5h" | "7d" | "7d_opus" | ...
  label: string;
  usedPercent: number; // 0–100
  resetsAt: string | null; // ISO 8601
  windowSeconds?: number; // provider-reported limit window length, if known
};

export type UsageSnapshot = {
  accountId: string;
  provider: ProviderId;
  label: string;
  planType?: string;
  windows: UsageWindow[];
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: number };
  fetchedAt: string; // ISO 8601
  error?: string;
  needsReauth?: boolean;
};

// A provider knows how to fetch usage for one account. It may refresh tokens;
// when it does, it returns the updated secret so the caller can persist it.
export type FetchResult = {
  snapshot: UsageSnapshot;
  updatedSecret?: AccountSecret;
};

export interface Provider {
  id: ProviderId;
  fetchUsage(account: AccountRecord): Promise<FetchResult>;
}
