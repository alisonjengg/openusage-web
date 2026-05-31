import "server-only";
import type { AccountRecord, ClaudeSecret, FetchResult, Provider } from "./types";
import {
  claudePlanTypeFromProfile,
  type ClaudeProfile,
} from "./claude-profile";
import { normalizeClaude, type ClaudeUsage } from "./normalize";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const USER_AGENT = "claude-code/1.0";

type RawUsage = ClaudeUsage & {
  extra_usage?: {
    is_enabled?: boolean;
    used_credits?: number;
    monthly_limit?: number;
  };
};

async function refresh(secret: ClaudeSecret): Promise<ClaudeSecret> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: secret.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`refresh failed (${res.status})`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? secret.refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  };
}

async function callUsage(accessToken: string): Promise<Response> {
  return fetch(USAGE_URL, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
}

async function callProfile(accessToken: string): Promise<ClaudeProfile | null> {
  const res = await fetch(PROFILE_URL, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as ClaudeProfile | null;
}

export const claudeProvider: Provider = {
  id: "claude",
  async fetchUsage(account: AccountRecord): Promise<FetchResult> {
    let secret = account.secret as ClaudeSecret;
    let updatedSecret: ClaudeSecret | undefined;

    const base = {
      accountId: account.id,
      provider: "claude" as const,
      label: account.label,
      fetchedAt: new Date().toISOString(),
    };

    // Proactive refresh if we know the token is expired.
    if (secret.expiresAt && secret.expiresAt <= Date.now()) {
      try {
        secret = await refresh(secret);
        updatedSecret = secret;
      } catch {
        return {
          snapshot: {
            ...base,
            windows: [],
            error: "Re-authentication needed (token expired).",
            needsReauth: true,
          },
        };
      }
    }

    let res = await callUsage(secret.accessToken);

    // Reactive refresh on 401.
    if (res.status === 401) {
      try {
        secret = await refresh(secret);
        updatedSecret = secret;
        res = await callUsage(secret.accessToken);
      } catch {
        return {
          snapshot: {
            ...base,
            windows: [],
            error: "Re-authentication needed (401).",
            needsReauth: true,
          },
          updatedSecret,
        };
      }
    }

    if (res.status === 429) {
      return {
        snapshot: {
          ...base,
          windows: [],
          error: "Rate-limited by Anthropic. Try again later.",
        },
        updatedSecret,
      };
    }

    if (!res.ok) {
      return {
        snapshot: { ...base, windows: [], error: `HTTP ${res.status}` },
        updatedSecret,
      };
    }

    const [raw, profile] = await Promise.all([
      res.json() as Promise<RawUsage>,
      callProfile(secret.accessToken),
    ]);
    const credits = raw.extra_usage?.is_enabled
      ? {
          hasCredits: true,
          unlimited: false,
          balance:
            raw.extra_usage.monthly_limit !== undefined &&
            raw.extra_usage.used_credits !== undefined
              ? raw.extra_usage.monthly_limit - raw.extra_usage.used_credits
              : undefined,
        }
      : undefined;

    return {
      snapshot: {
        ...base,
        planType: claudePlanTypeFromProfile(profile),
        windows: normalizeClaude(raw),
        credits,
      },
      updatedSecret,
    };
  },
};
