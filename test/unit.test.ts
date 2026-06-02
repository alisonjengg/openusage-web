import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveKey, sealJSON, openJSON, open } from "../src/lib/crypto.ts";
import {
  accountEntryFromRow,
  type StoredAccountRow,
} from "../src/lib/account-row.ts";
import {
  setupErrorPayload,
  usageCacheTtlSeconds,
  validateAppPassword,
  validateAppSecret,
} from "../src/lib/env-validation.ts";
import { loginErrorMessage } from "../src/lib/login-errors.ts";
import { evaluateLoginAttempt } from "../src/lib/login-attempt.ts";
import {
  clientKey,
  requestIsHttps,
  requestOriginAllowed,
} from "../src/lib/request.ts";
import { createSession, verifySession } from "../src/lib/session.ts";
import { singleFlight } from "../src/lib/single-flight.ts";
import {
  FORCE_REFRESH_FLOOR_MS,
  refreshCooldownLabel,
  usageCacheDecision,
} from "../src/lib/usage-cache.ts";
import {
  normalizeClaude,
  normalizeCodex,
} from "../src/lib/providers/normalize.ts";
import { parseClaudeOAuthCode } from "../src/lib/providers/claude-oauth-code.ts";
import { claudePlanTypeFromProfile } from "../src/lib/providers/claude-profile.ts";
import { codexSecretFromTokenResponse } from "../src/lib/providers/codex-oauth.ts";
import { parseCredentials } from "../src/lib/parse-credentials.ts";
import {
  clearLoginFailures,
  isLoginRateLimited,
  recordLoginFailure,
} from "../src/lib/rate-limit.ts";
import { fetchWithTimeout } from "../src/lib/fetch-timeout.ts";
import {
  isCompleteIdOrder,
  moveItemBefore,
  moveItemWithinGroupByOffset,
  moveProviderGroupByOffset,
} from "../src/lib/reorder.ts";
import {
  remainingPercent,
  usageLeftColor,
  usagePace,
} from "../src/lib/usage-display.ts";
import { finalizeUsageSnapshot } from "../src/lib/usage-snapshot.ts";
import { createUsageService } from "../src/lib/usage-service.ts";
import type {
  AccountRecord,
  AccountSecret,
  Provider,
} from "../src/lib/providers/types.ts";

function unsignedJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${encoded}.sig`;
}

test("crypto: seal/open round-trips JSON", () => {
  const key = deriveKey("my-secret");
  const value = { accessToken: "a", refreshToken: "b", expiresAt: 123 };
  const sealed = sealJSON(value, key);
  assert.deepEqual(openJSON(sealed, key), value);
});

test("crypto: wrong key fails to open", () => {
  const sealed = sealJSON({ x: 1 }, deriveKey("k1"));
  assert.throws(() => open(sealed, deriveKey("k2")));
});

test("env: rejects placeholder password and short app secret", () => {
  assert.throws(() => validateAppPassword("change-me"), /APP_PASSWORD/);
  assert.throws(() => validateAppSecret("hunter2"), /APP_SECRET/);

  assert.equal(validateAppPassword("correct horse battery staple"), "correct horse battery staple");
  assert.equal(validateAppSecret("a".repeat(32)), "a".repeat(32));
});

test("env: blocked password exposes a safe setup error", () => {
  let err: unknown;
  try {
    validateAppPassword("changeme");
  } catch (caught) {
    err = caught;
  }
  assert.deepEqual(setupErrorPayload(err), {
    error: "setup_required",
    message:
      "Server setup is incomplete. Set APP_PASSWORD to a non-placeholder value and restart.",
  });
  assert.equal(JSON.stringify(setupErrorPayload(err)).includes("changeme"), false);
  assert.equal(setupErrorPayload(new Error("invalid password")), null);
});

test("login errors: setup failure message is shown instead of incorrect password", () => {
  assert.equal(
    loginErrorMessage(503, {
      error: "setup_required",
      message:
        "Server setup is incomplete. Set APP_PASSWORD to a non-placeholder value and restart.",
    }),
    "Server setup is incomplete. Set APP_PASSWORD to a non-placeholder value and restart.",
  );
  assert.equal(loginErrorMessage(401, { error: "invalid password" }), "Incorrect password.");
});

test("env: usage cache ttl defaults to one minute and floors at one minute", () => {
  assert.equal(usageCacheTtlSeconds(undefined), 60);
  assert.equal(usageCacheTtlSeconds("30"), 60);
  assert.equal(usageCacheTtlSeconds("90"), 90);
  assert.equal(usageCacheTtlSeconds("nope"), 60);
});

test("request: client key ignores spoofed forwarding headers unless proxy is trusted", () => {
  const req = new Request("http://localhost/api/login", {
    headers: {
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.100",
    },
  });

  assert.equal(clientKey(req), "global");
  assert.equal(clientKey(req, { trustProxy: true }), "203.0.113.99");
});

test("request: rejects cross-origin unsafe requests", () => {
  assert.equal(
    requestOriginAllowed(
      new Request("https://openusage.example/api/accounts", {
        method: "POST",
        headers: { origin: "https://openusage.example" },
      }),
    ),
    true,
  );
  assert.equal(
    requestOriginAllowed(
      new Request("https://openusage.example/api/accounts", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    ),
    false,
  );
  assert.equal(
    requestOriginAllowed(
      new Request("https://internal:3000/api/accounts", {
        method: "POST",
        headers: {
          origin: "https://openusage.example",
          "x-forwarded-host": "openusage.example",
          "x-forwarded-proto": "https",
        },
      }),
      { trustProxy: true },
    ),
    true,
  );
  assert.equal(
    requestOriginAllowed(
      new Request("https://internal:3000/api/accounts", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
      }),
    ),
    false,
  );
  assert.equal(
    requestOriginAllowed(
      new Request("https://openusage.example/api/accounts", {
        method: "GET",
        headers: { origin: "https://evil.example" },
      }),
    ),
    true,
  );
  assert.equal(
    requestOriginAllowed(
      new Request("https://openusage.example/api/accounts", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    ),
    false,
  );
  assert.equal(
    requestOriginAllowed(
      new Request("https://openusage.example/api/accounts", {
        method: "POST",
      }),
    ),
    false,
  );
  assert.equal(
    requestOriginAllowed(
      new Request("https://openusage.example/api/accounts", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    ),
    true,
  );
});

test("request: forwarded https is detected for secure cookies", () => {
  assert.equal(
    requestIsHttps(
      new Request("http://internal:3000/api/login", {
        headers: { "x-forwarded-proto": "https" },
      }),
    ),
    false,
  );
  assert.equal(
    requestIsHttps(
      new Request("http://internal:3000/api/login", {
        headers: { "x-forwarded-proto": "https" },
      }),
      { trustProxy: true },
    ),
    true,
  );
});

test("login attempt: rate limit blocks password evaluation", () => {
  let checks = 0;
  const matches = () => {
    checks += 1;
    return true;
  };

  assert.equal(
    evaluateLoginAttempt({
      password: "correct",
      passwordConfig: "correct",
      rateLimited: true,
      matches,
    }),
    "rate_limited",
  );
  assert.equal(checks, 0);

  assert.equal(
    evaluateLoginAttempt({
      password: "correct",
      passwordConfig: "correct",
      rateLimited: false,
      matches,
    }),
    "valid",
  );
  assert.equal(checks, 1);
});

test("session: password rotation invalidates existing cookies", async () => {
  const secret = "a".repeat(32);
  const token = await createSession(secret, "old-password", 60_000);

  assert.equal(await verifySession(token, secret, "old-password"), true);
  assert.equal(await verifySession(token, secret, "new-password"), false);
});

test("session: rejects tokens with extra segments", async () => {
  const secret = "a".repeat(32);
  const token = await createSession(secret, "password", 60_000);

  assert.equal(await verifySession(`${token}.extra`, secret, "password"), false);
});

test("account rows: decrypt failures are isolated per row", () => {
  const key = deriveKey("a".repeat(32));
  const sealed = sealJSON({ accessToken: "a", refreshToken: "r" }, key);
  const base = {
    provider: "codex",
    sort_order: 1,
    created_at: 1,
    updated_at: 1,
  };
  const good = accountEntryFromRow(
    {
      ...base,
      id: "good",
      label: "good",
      secret_blob: sealed.blob,
      iv: sealed.iv,
    } satisfies StoredAccountRow,
    key,
    openJSON,
  );
  const bad = accountEntryFromRow(
    {
      ...base,
      id: "bad",
      label: "bad",
      secret_blob: Buffer.from("not encrypted"),
      iv: sealed.iv,
    } satisfies StoredAccountRow,
    key,
    openJSON,
  );

  assert.equal(good.ok, true);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.summary.id, "bad");
    assert.match(bad.error, /decrypt/i);
  }
});

test("singleFlight: deduplicates concurrent work for the same key", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = singleFlight("account-1", async () => {
    calls += 1;
    await gate;
    return "first";
  });
  const second = singleFlight("account-1", async () => {
    calls += 1;
    return "second";
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "first");
  assert.equal(await second, "first");

  assert.equal(
    await singleFlight("account-1", async () => {
      calls += 1;
      return "third";
    }),
    "third",
  );
  assert.equal(calls, 2);
});

test("usage cache: forced refresh reports cooldown instead of silent cache hit", () => {
  assert.deepEqual(
    usageCacheDecision({
      cachedAt: 1_000,
      now: 3_000,
      ttlMs: 60_000,
      force: true,
      floorMs: FORCE_REFRESH_FLOOR_MS,
    }),
    {
      useCache: true,
      ageMs: 2_000,
      minAgeMs: 5_000,
      nextLiveRefreshAt: 6_000,
    },
  );

  assert.deepEqual(
    usageCacheDecision({
      cachedAt: 1_000,
      now: 6_000,
      ttlMs: 60_000,
      force: true,
      floorMs: FORCE_REFRESH_FLOOR_MS,
    }),
    {
      useCache: false,
      ageMs: 5_000,
      minAgeMs: 5_000,
    },
  );
});

test("usage cache: short manual refresh cooldown is shown in seconds", () => {
  assert.equal(refreshCooldownLabel("1970-01-01T00:00:06.000Z", 1_000), "in 5s");
});

test("usage cache: live snapshots are stamped at completion time", () => {
  const snapshot = {
    accountId: "a1",
    provider: "codex" as const,
    label: "Work",
    fetchedAt: "2026-05-31T15:41:00.000Z",
    windows: [],
  };

  assert.deepEqual(
    finalizeUsageSnapshot(snapshot, Date.parse("2026-05-31T15:42:05.000Z")),
    {
      ...snapshot,
      fetchedAt: "2026-05-31T15:42:05.000Z",
    },
  );
});

test("usage service: forced refresh throttles recent failed attempts", async () => {
  const account: AccountRecord = {
    id: "acct-1",
    provider: "codex",
    label: "Work",
    secret: { accessToken: "a", refreshToken: "r" },
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  let calls = 0;
  let now = 1_000;
  const provider: Provider = {
    id: "codex",
    async fetchUsage() {
      calls += 1;
      return {
        snapshot: {
          accountId: account.id,
          provider: "codex",
          label: account.label,
          windows: [],
          fetchedAt: "ignored",
          error: "HTTP 429",
        },
      };
    },
  };
  const service = createUsageService({
    providers: { codex: provider },
    listAccountEntries: () => [{ ok: true, account }],
    updateAccountSecret: () => undefined,
    cache: new Map(),
    attempts: new Map(),
    cacheTtlSeconds: () => 60,
    now: () => now,
  });

  const first = await service.getAllUsageResult(true);
  assert.equal(calls, 1);
  assert.equal(first.refresh.live, 0);
  assert.equal(first.refresh.cached, 0);
  assert.equal(first.snapshots[0].fetchedAt, "1970-01-01T00:00:01.000Z");

  now = 3_000;
  const second = await service.getAllUsageResult(true);
  assert.equal(calls, 1);
  assert.equal(second.refresh.live, 0);
  assert.equal(second.refresh.cached, 1);
  assert.equal(second.refresh.nextLiveRefreshAt, "1970-01-01T00:00:06.000Z");

  now = 6_000;
  await service.getAllUsageResult(true);
  assert.equal(calls, 2);
});

test("usage service: persists rotated secret returned with error snapshot", async () => {
  const account: AccountRecord = {
    id: "acct-1",
    provider: "claude",
    label: "Claude",
    secret: { accessToken: "old", refreshToken: "old-refresh" },
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const rotated: AccountSecret = {
    accessToken: "new",
    refreshToken: "new-refresh",
  };
  let saved: AccountSecret | null = null;
  const provider: Provider = {
    id: "claude",
    async fetchUsage() {
      return {
        snapshot: {
          accountId: account.id,
          provider: "claude",
          label: account.label,
          windows: [],
          fetchedAt: "ignored",
          error: "bad upstream response",
        },
        updatedSecret: rotated,
      };
    },
  };
  const service = createUsageService({
    providers: { claude: provider },
    listAccountEntries: () => [{ ok: true, account }],
    updateAccountSecret: (_id, secret) => {
      saved = secret;
    },
    cache: new Map(),
    attempts: new Map(),
    cacheTtlSeconds: () => 60,
    now: () => 1_000,
  });

  const result = await service.getAllUsageResult(true);

  assert.deepEqual(saved, rotated);
  assert.equal(result.snapshots[0].error, "bad upstream response");
});

test("usage service: unknown providers return an isolated error snapshot", async () => {
  const account: AccountRecord = {
    id: "acct-unknown",
    provider: "missing" as AccountRecord["provider"],
    label: "Unknown",
    secret: { accessToken: "a", refreshToken: "r" },
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const service = createUsageService({
    providers: {},
    listAccountEntries: () => [{ ok: true, account }],
    updateAccountSecret: () => undefined,
    cache: new Map(),
    attempts: new Map(),
    cacheTtlSeconds: () => 60,
    now: () => 1_000,
  });

  const result = await service.getAllUsageResult();

  assert.equal(result.snapshots[0].fetchedAt, "1970-01-01T00:00:01.000Z");
  assert.match(result.snapshots[0].error ?? "", /Unknown provider/);
  assert.equal(result.refresh.errors, 1);
});

test("fetch timeout: aborts stalled requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  }) as typeof fetch;

  try {
    await assert.rejects(() => fetchWithTimeout("https://example.test", {}, 1), {
      name: "AbortError",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("claude oauth: rejects pasted state that does not match the PKCE session", () => {
  assert.throws(
    () => parseClaudeOAuthCode("oauth-code", "expected-state"),
    /state/i,
  );
  assert.throws(
    () => parseClaudeOAuthCode("oauth-code#wrong-state", "expected-state"),
    /state/i,
  );
  assert.deepEqual(parseClaudeOAuthCode("oauth-code#expected-state", "expected-state"), {
    code: "oauth-code",
    state: "expected-state",
  });
});

test("normalizeClaude: maps present windows, skips missing", () => {
  const out = normalizeClaude({
    five_hour: { utilization: 25, resets_at: "2026-01-28T15:00:00Z" },
    seven_day: { utilization: 40, resets_at: "2026-02-01T00:00:00Z" },
    seven_day_opus: null,
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    key: "5h",
    label: "5-hour",
    usedPercent: 25,
    resetsAt: "2026-01-28T15:00:00Z",
  });
  assert.equal(out[1].key, "7d");
});

test("normalizeClaude: empty response -> no windows", () => {
  assert.deepEqual(normalizeClaude({}), []);
});

test("claude profile: maps subscription tier to plan type", () => {
  assert.equal(
    claudePlanTypeFromProfile({
      account: { has_claude_max: true, has_claude_pro: false },
      organization: { rate_limit_tier: "default_claude_max_5x" },
    }),
    "max 5x",
  );
  assert.equal(
    claudePlanTypeFromProfile({
      account: { has_claude_max: true, has_claude_pro: false },
      organization: { rate_limit_tier: "default_claude_max_20x" },
    }),
    "max 20x",
  );
  assert.equal(
    claudePlanTypeFromProfile({
      account: { has_claude_max: false, has_claude_pro: true },
      organization: { rate_limit_tier: "default_claude_pro" },
    }),
    "pro",
  );
});

test("normalizeCodex: maps primary/secondary, converts epoch reset", () => {
  const out = normalizeCodex({
    plan_type: "pro",
    rate_limit: {
      primary_window: {
        used_percent: 42,
        reset_at: 1735689600,
        limit_window_seconds: 18000,
      },
      secondary_window: {
        used_percent: 22,
        reset_at: 1736207000,
        limit_window_seconds: 604800,
      },
    },
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].key, "5h");
  assert.equal(out[0].usedPercent, 42);
  assert.equal(out[0].resetsAt, new Date(1735689600 * 1000).toISOString());
  assert.equal(out[0].windowSeconds, 18000);
  assert.equal(out[1].windowSeconds, 604800);
});

test("normalizeCodex: missing rate_limit -> no windows", () => {
  assert.deepEqual(normalizeCodex({ plan_type: "plus" }), []);
});

test("normalizeCodex: labels monthly windows by provider duration", () => {
  const out = normalizeCodex({
    plan_type: "team",
    rate_limit: {
      primary_window: {
        used_percent: 0,
        reset_at: 1783005512,
        limit_window_seconds: 2628000,
      },
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].key, "monthly");
  assert.equal(out[0].label, "Monthly");
  assert.equal(out[0].resetsAt, new Date(1783005512 * 1000).toISOString());
  assert.equal(out[0].windowSeconds, 2628000);
});

test("normalizeCodex: falls back to positional labels without provider duration", () => {
  const out = normalizeCodex({
    rate_limit: {
      primary_window: { used_percent: 12 },
      secondary_window: { used_percent: 34 },
    },
  });
  assert.equal(out[0].key, "5h");
  assert.equal(out[0].label, "5-hour");
  assert.equal(out[1].key, "7d");
  assert.equal(out[1].label, "Weekly");
});

test("normalizeCodex: labels uncommon provider durations generically", () => {
  const out = normalizeCodex({
    rate_limit: {
      primary_window: {
        used_percent: 10,
        limit_window_seconds: 14 * 24 * 60 * 60,
      },
      secondary_window: {
        used_percent: 20,
        limit_window_seconds: 10 * 24 * 60 * 60,
      },
    },
  });
  assert.equal(out[0].key, "1209600s");
  assert.equal(out[0].label, "2-week");
  assert.equal(out[1].key, "864000s");
  assert.equal(out[1].label, "10-day");
});

test("normalizeCodex: labels uncommon hourly and custom provider durations", () => {
  const hourly = normalizeCodex({
    rate_limit: {
      primary_window: {
        used_percent: 10,
        limit_window_seconds: 3 * 60 * 60,
      },
    },
  });
  assert.equal(hourly[0].key, "10800s");
  assert.equal(hourly[0].label, "3-hour");

  const custom = normalizeCodex({
    rate_limit: {
      primary_window: {
        used_percent: 10,
        limit_window_seconds: 12345,
      },
    },
  });
  assert.equal(custom[0].key, "12345s");
  assert.equal(custom[0].label, "Custom");
});

test("normalizeCodex: clamps phantom <=1% on a not-yet-started window to 0", () => {
  const out = normalizeCodex({
    plan_type: "team",
    rate_limit: {
      primary_window: {
        used_percent: 1,
        reset_at: 1780388277,
        reset_after_seconds: 18000,
        limit_window_seconds: 18000,
      },
      secondary_window: {
        used_percent: 6,
        reset_at: 1780929736,
        reset_after_seconds: 559460,
        limit_window_seconds: 604800,
      },
    },
  });
  assert.equal(out[0].usedPercent, 0); // 5h window not started, 1% -> 0
  assert.equal(out[0].resetsAt, null); // not started -> no reset shown
  assert.equal(out[1].usedPercent, 6); // 7d window in progress -> untouched
  assert.equal(out[1].resetsAt, new Date(1780929736 * 1000).toISOString());
});

test("normalizeCodex: keeps real usage on a started window even if <=1%", () => {
  const out = normalizeCodex({
    rate_limit: {
      primary_window: {
        used_percent: 1,
        reset_after_seconds: 12000, // below full window -> already started
        limit_window_seconds: 18000,
      },
    },
  });
  assert.equal(out[0].usedPercent, 1);
});

test("normalizeCodex: reports >1% truly even on a not-yet-started window", () => {
  const out = normalizeCodex({
    rate_limit: {
      primary_window: {
        used_percent: 5,
        reset_at: 1780388277,
        reset_after_seconds: 18000,
        limit_window_seconds: 18000,
      },
    },
  });
  assert.equal(out[0].usedPercent, 5);
  assert.equal(out[0].resetsAt, null); // not started -> no reset shown
});

test("parseCredentials: claude nested claudeAiOauth", () => {
  const secret = parseCredentials(
    "claude",
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-ant-oat01-x",
        refreshToken: "r",
        expiresAt: 999,
      },
    }),
  );
  assert.deepEqual(secret, {
    accessToken: "sk-ant-oat01-x",
    refreshToken: "r",
    expiresAt: 999,
  });
});

test("parseCredentials: codex tokens block", () => {
  const secret = parseCredentials(
    "codex",
    JSON.stringify({
      tokens: { access_token: "a", refresh_token: "r", account_id: "acc" },
    }),
  );
  assert.deepEqual(secret, {
    accessToken: "a",
    refreshToken: "r",
    accountId: "acc",
  });
});

test("parseCredentials: missing fields throws", () => {
  assert.throws(() => parseCredentials("claude", JSON.stringify({ foo: 1 })));
  assert.throws(() => parseCredentials("codex", "not json"));
});

test("codex oauth: maps token response into stored secret", () => {
  const secret = codexSecretFromTokenResponse({
    access_token: "access",
    refresh_token: "refresh",
    id_token: unsignedJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acc_123",
      },
    }),
  });

  assert.deepEqual(secret, {
    accessToken: "access",
    refreshToken: "refresh",
    accountId: "acc_123",
  });
});

test("usage display: remaining percent is inverse of used percent", () => {
  assert.equal(remainingPercent(0), 100);
  assert.equal(remainingPercent(42), 58);
  assert.equal(remainingPercent(100), 0);
  assert.equal(remainingPercent(-10), 100);
  assert.equal(remainingPercent(150), 0);
});

test("usage display: color reflects usage left", () => {
  assert.equal(usageLeftColor(80), "var(--ok)");
  assert.equal(usageLeftColor(30), "var(--warn)");
  assert.equal(usageLeftColor(10), "var(--danger)");
});

test("usage display: pace shows buffer, shortage, and on pace", () => {
  const now = Date.parse("2026-05-30T00:00:00Z");

  assert.deepEqual(
    usagePace(
      {
        key: "5h",
        label: "5-hour",
        usedPercent: 30,
        resetsAt: "2026-05-30T02:30:00Z",
      },
      now,
    ),
    { kind: "buffer", label: "1h buffer" },
  );

  assert.deepEqual(
    usagePace(
      {
        key: "7d",
        label: "Weekly",
        usedPercent: 75,
        resetsAt: "2026-06-02T00:00:00Z",
      },
      now,
    ),
    { kind: "short", label: "1d 6h short" },
  );

  assert.deepEqual(
    usagePace(
      {
        key: "5h",
        label: "5-hour",
        usedPercent: 50,
        resetsAt: "2026-05-30T02:30:00Z",
      },
      now,
    ),
    { kind: "on_pace", label: "on pace" },
  );
});

test("usage display: pace uses provider window duration and skips unknown resets", () => {
  const now = Date.parse("2026-05-30T00:00:00Z");

  assert.deepEqual(
    usagePace(
      {
        key: "custom",
        label: "Custom",
        usedPercent: 25,
        resetsAt: "2026-05-30T01:00:00Z",
        windowSeconds: 7200,
      },
      now,
    ),
    { kind: "buffer", label: "30m buffer" },
  );

  assert.equal(
    usagePace(
      {
        key: "5h",
        label: "5-hour",
        usedPercent: 25,
        resetsAt: null,
      },
      now,
    ),
    null,
  );
});

test("usage display: pace ignores tiny early-period deviations", () => {
  const now = Date.parse("2026-05-30T00:02:00Z");

  assert.deepEqual(
    usagePace(
      {
        key: "5h",
        label: "5-hour",
        usedPercent: 2.9,
        resetsAt: "2026-05-30T05:00:00Z",
      },
      now,
    ),
    { kind: "buffer", label: "on pace" },
  );

  assert.deepEqual(
    usagePace(
      {
        key: "5h",
        label: "5-hour",
        usedPercent: 3,
        resetsAt: "2026-05-30T05:00:00Z",
      },
      now,
    ),
    { kind: "short", label: "7m short" },
  );
});

test("reorder: moves an item before another id without mutating input", () => {
  const items = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ];

  const out = moveItemBefore(items, "c", "a");

  assert.deepEqual(
    out.map((item) => item.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("reorder: validates a complete same-id account order", () => {
  assert.equal(isCompleteIdOrder(["b", "a"], ["a", "b"]), true);
  assert.equal(isCompleteIdOrder(["a"], ["a", "b"]), false);
  assert.equal(isCompleteIdOrder(["a", "a"], ["a", "b"]), false);
  assert.equal(isCompleteIdOrder(["a", "x"], ["a", "b"]), false);
});

test("reorder: moves provider groups together", () => {
  const items = [
    { id: "c1", provider: "codex" },
    { id: "a1", provider: "claude" },
    { id: "c2", provider: "codex" },
    { id: "a2", provider: "claude" },
  ];

  assert.deepEqual(
    moveProviderGroupByOffset(items, "codex", 1).map((item) => item.id),
    ["a1", "a2", "c1", "c2"],
  );
  assert.deepEqual(
    moveProviderGroupByOffset(items, "claude", -1).map((item) => item.id),
    ["a1", "a2", "c1", "c2"],
  );
});

test("reorder: moves items only within the same provider group", () => {
  const items = [
    { id: "c1", provider: "codex" },
    { id: "c2", provider: "codex" },
    { id: "a1", provider: "claude" },
    { id: "a2", provider: "claude" },
  ];

  assert.deepEqual(
    moveItemWithinGroupByOffset(items, "c2", -1).map((item) => item.id),
    ["c2", "c1", "a1", "a2"],
  );
  assert.deepEqual(
    moveItemWithinGroupByOffset(items, "c2", 1).map((item) => item.id),
    ["c1", "c2", "a1", "a2"],
  );
  assert.deepEqual(
    moveItemWithinGroupByOffset(items, "a1", 1).map((item) => item.id),
    ["c1", "c2", "a2", "a1"],
  );
});

test("login rate limit: blocks after repeated failures and can be cleared", () => {
  const key = "unit-rate-limit";
  const now = Date.parse("2026-05-30T00:00:00Z");
  clearLoginFailures(key);

  for (let i = 0; i < 9; i++) recordLoginFailure(key, now);
  assert.equal(isLoginRateLimited(key, now), false);

  recordLoginFailure(key, now);
  assert.equal(isLoginRateLimited(key, now), true);

  clearLoginFailures(key);
  assert.equal(isLoginRateLimited(key, now), false);
});

test("middleware matcher skips Next.js internals", () => {
  const source = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  const matcher = source.match(/matcher:\s*\[\s*"([^"]+)"/)?.[1];
  assert.ok(matcher);
  const re = new RegExp(`^${matcher}$`);

  assert.equal(re.test("/_next/static/chunks/main.js"), false);
  assert.equal(re.test("/_next/image"), false);
  assert.equal(re.test("/_next/webpack-hmr"), false);
  assert.equal(re.test("/login"), true);
  assert.equal(re.test("/api/accounts"), true);
});

test("health check is public and declared in Dockerfile", () => {
  const middleware = readFileSync(
    new URL("../src/middleware.ts", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../src/app/api/health/route.ts", import.meta.url),
    "utf8",
  );
  const dockerfile = readFileSync(
    new URL("../Dockerfile", import.meta.url),
    "utf8",
  );

  assert.match(middleware, /"\/api\/health"/);
  assert.match(route, /status:\s*"ok"/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /\/api\/health/);
});

test("security headers include CSP and HSTS", () => {
  const middleware = readFileSync(
    new URL("../src/middleware.ts", import.meta.url),
    "utf8",
  );

  assert.match(middleware, /Content-Security-Policy/);
  assert.match(middleware, /Strict-Transport-Security/);
});

test("side-effecting API actions are not GET-only", () => {
  const claudeStart = readFileSync(
    new URL("../src/app/api/oauth/claude/start/route.ts", import.meta.url),
    "utf8",
  );
  const codexStart = readFileSync(
    new URL("../src/app/api/oauth/codex/start/route.ts", import.meta.url),
    "utf8",
  );
  const usage = readFileSync(
    new URL("../src/app/api/usage/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(claudeStart, /export async function POST/);
  assert.doesNotMatch(claudeStart, /export async function GET/);
  assert.match(codexStart, /export async function POST/);
  assert.doesNotMatch(codexStart, /export async function GET/);
  assert.match(usage, /export async function POST/);
});

test("usage refresh responses bypass browser and proxy caches", () => {
  const route = readFileSync(
    new URL("../src/app/api/usage/route.ts", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../src/app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /force-dynamic/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /no-store/);
  assert.match(dashboard, /cache:\s*"no-store"/);
});

test("provider usage fetches bypass framework data cache", () => {
  const claude = readFileSync(
    new URL("../src/lib/providers/claude.ts", import.meta.url),
    "utf8",
  );
  const codex = readFileSync(
    new URL("../src/lib/providers/codex.ts", import.meta.url),
    "utf8",
  );

  assert.match(claude, /cache:\s*"no-store"/);
  assert.match(codex, /cache:\s*"no-store"/);
  assert.match(claude, /fetchWithTimeout/);
  assert.match(codex, /fetchWithTimeout/);
});

test("dashboard ignores stale usage responses", () => {
  const dashboard = readFileSync(
    new URL("../src/app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dashboard, /useRef/);
  assert.match(dashboard, /requestSeq/);
});
