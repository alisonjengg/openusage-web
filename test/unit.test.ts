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
import { usageCacheDecision } from "../src/lib/usage-cache.ts";
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
      now: 31_000,
      ttlMs: 300_000,
      force: true,
      floorMs: 180_000,
    }),
    {
      useCache: true,
      ageMs: 30_000,
      minAgeMs: 180_000,
      nextLiveRefreshAt: 181_000,
    },
  );

  assert.deepEqual(
    usageCacheDecision({
      cachedAt: 1_000,
      now: 181_000,
      ttlMs: 300_000,
      force: true,
      floorMs: 180_000,
    }),
    {
      useCache: false,
      ageMs: 180_000,
      minAgeMs: 180_000,
    },
  );
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
