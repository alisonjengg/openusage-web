import "server-only";
import type { AccountRecord, CodexSecret, FetchResult, Provider } from "./types";
import { normalizeCodex, type CodexUsage } from "./normalize";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const USER_AGENT = "codex-cli/1.0";

type RawUsage = CodexUsage;

// Decode the middle segment of a JWT without verifying (we only read claims).
function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function accountIdFrom(secret: CodexSecret): string | undefined {
  if (secret.accountId) return secret.accountId;
  const claims = decodeJwt(secret.accessToken);
  const auth = claims?.["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string }
    | undefined;
  return auth?.chatgpt_account_id;
}

function isExpired(token: string): boolean {
  const claims = decodeJwt(token);
  const exp = typeof claims?.exp === "number" ? (claims.exp as number) : null;
  return exp !== null && exp * 1000 <= Date.now();
}

async function refresh(secret: CodexSecret): Promise<CodexSecret> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: secret.refreshToken,
      scope: "openid profile email",
    }),
  });
  if (!res.ok) throw new Error(`refresh failed (${res.status})`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? secret.refreshToken, // tokens rotate
    accountId: secret.accountId,
  };
}

async function callUsage(secret: CodexSecret): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret.accessToken}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  const accountId = accountIdFrom(secret);
  if (accountId) headers["chatgpt-account-id"] = accountId;
  return fetch(USAGE_URL, { cache: "no-store", headers });
}

export const codexProvider: Provider = {
  id: "codex",
  async fetchUsage(account: AccountRecord): Promise<FetchResult> {
    let secret = account.secret as CodexSecret;
    let updatedSecret: CodexSecret | undefined;

    const base = {
      accountId: account.id,
      provider: "codex" as const,
      label: account.label,
      fetchedAt: new Date().toISOString(),
    };

    if (isExpired(secret.accessToken)) {
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

    let res = await callUsage(secret);

    if (res.status === 401 || res.status === 403) {
      try {
        secret = await refresh(secret);
        updatedSecret = secret;
        res = await callUsage(secret);
      } catch {
        return {
          snapshot: {
            ...base,
            windows: [],
            error: "Re-authentication needed.",
            needsReauth: true,
          },
          updatedSecret,
        };
      }
    }

    if (!res.ok) {
      return {
        snapshot: { ...base, windows: [], error: `HTTP ${res.status}` },
        updatedSecret,
      };
    }

    const raw = (await res.json()) as RawUsage;
    const credits = raw.credits?.has_credits
      ? {
          hasCredits: true,
          unlimited: Boolean(raw.credits.unlimited),
          balance: raw.credits.balance,
        }
      : undefined;

    return {
      snapshot: {
        ...base,
        planType: raw.plan_type,
        windows: normalizeCodex(raw),
        credits,
      },
      updatedSecret,
    };
  },
};
