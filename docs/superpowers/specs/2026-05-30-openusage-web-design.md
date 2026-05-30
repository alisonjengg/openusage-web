# openusage-web — Personal Usage Dashboard

**Date:** 2026-05-30
**Status:** Approved design

## Purpose

A self-hosted web app for personal use that shows, on a single dashboard, the
usage limits and reset times for multiple **Codex** (ChatGPT-subscription-backed)
and **Claude** (Pro/Max subscription) accounts. The owner adds each account's
OAuth token through the UI; the app queries each provider's usage endpoint and
displays remaining quota and reset times for the rolling 5-hour and weekly
windows.

This is a web counterpart to the macOS app [robinebers/openusage](https://github.com/robinebers/openusage),
whose provider definitions are the reference for the endpoint/header/refresh
details below.

## Goals

- One page showing every account's usage at a glance.
- Support several Codex accounts and several Claude accounts.
- Add/edit/remove accounts (paste OAuth token) from the UI.
- Show per-window utilization (%) and reset time for each account.
- Refresh manually and automatically (safe interval).

## Non-Goals

- Historical usage tracking / charts over time (only current snapshot).
- Multi-user accounts / roles (single owner).
- Provider support beyond Claude and Codex (extensible, but not built now).
- Cost/billing analytics.

## Decisions (confirmed with owner)

| Decision | Choice |
|---|---|
| Runtime | Self-hosted server (remote-accessible) |
| Token input | Paste tokens in the UI |
| Stack | Next.js (App Router) |
| App auth | Single shared password → session cookie |
| Token storage | AES-encrypted in a local SQLite file (key from env) |
| Refresh | Manual button + background auto-refresh every 5 min (≥180s floor) |

## Architecture

```
Browser (dashboard + accounts UI)
        │  (only sees normalized usage numbers, never tokens)
        ▼
Next.js API routes  ── server-side fetch ──►  provider usage endpoints
        │
        ├── encrypted token store (SQLite)
        └── server-side usage cache (per account, TTL ≥180s)
```

All provider HTTP calls happen **server-side** in Next.js API routes. Tokens are
decrypted only in memory on the server at request time; the browser never
receives them. This also avoids CORS issues with the provider endpoints.

### Components

- **`lib/crypto`** — AES-256-GCM encrypt/decrypt of token blobs using a master
  key from `APP_SECRET`. Pure functions; unit-tested.
- **`lib/db`** — SQLite access (better-sqlite3). One `accounts` table. CRUD for
  accounts; stores encrypted token material.
- **`lib/auth`** — single-password login: verifies against `APP_PASSWORD`,
  issues a signed HTTP-only session cookie; middleware guards all routes.
- **`lib/providers/types.ts`** — the normalized `Provider` interface and the
  shared `UsageSnapshot` shape.
- **`lib/providers/claude.ts`** — fetch + refresh for Claude.
- **`lib/providers/codex.ts`** — fetch + refresh for Codex.
- **`lib/usage`** — orchestrates: for each account, ensure a fresh token, call
  the provider, normalize, cache. Returns snapshots for the dashboard.
- **API routes** under `app/api/`:
  - `POST /api/login` — authenticate.
  - `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/[id]` — manage accounts.
  - `GET /api/usage` — return normalized snapshots for all accounts (uses cache).
- **`app/page.tsx`** — dashboard (cards grouped by provider).
- **`app/accounts/page.tsx`** — add/edit/remove accounts.

### Provider interface (normalized)

```ts
type UsageWindow = {
  key: string;            // "5h" | "7d" | "7d_opus" | ...
  label: string;          // human label
  usedPercent: number;    // 0–100
  resetsAt: string;       // ISO 8601
};

type UsageSnapshot = {
  accountId: string;
  provider: "claude" | "codex";
  label: string;          // user-given name
  planType?: string;
  windows: UsageWindow[];
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: number };
  fetchedAt: string;      // ISO 8601
  error?: string;         // populated if the fetch failed
};

interface Provider {
  id: "claude" | "codex";
  fetchUsage(account: AccountRecord): Promise<UsageSnapshot>;
}
```

Each provider module owns its own token-refresh logic and rewrites refreshed
tokens back into the store.

## Provider details (verified)

### Claude

- **Endpoint:** `GET https://api.anthropic.com/api/oauth/usage`
- **Headers:**
  - `Authorization: Bearer <accessToken>` (token is `sk-ant-oat01-…`)
  - `anthropic-beta: oauth-2025-04-20`
  - `User-Agent: claude-code/<version>` (required to avoid the aggressive 429
    bucket)
  - `Accept: application/json`
- **Response (null-guard optional fields):**
  ```json
  {
    "five_hour":        { "utilization": 25, "resets_at": "2026-01-28T15:00:00Z" },
    "seven_day":        { "utilization": 40, "resets_at": "2026-02-01T00:00:00Z" },
    "seven_day_opus":   { "utilization": 0,  "resets_at": "..." },
    "seven_day_sonnet": { "utilization": 0,  "resets_at": "..." },
    "extra_usage":      { "is_enabled": true, "used_credits": 500, "monthly_limit": 10000, "currency": "USD" }
  }
  ```
  `utilization` is 0–100; remaining = `100 - utilization`.
- **Refresh:** `POST https://platform.claude.com/v1/oauth/token` with
  `{ grant_type: "refresh_token", refresh_token, client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e" }`.
- **Stored material per account:** `accessToken`, `refreshToken`, `expiresAt`
  (epoch ms). Refresh when expired or on 401.

### Codex

- **Endpoint:** `GET https://chatgpt.com/backend-api/wham/usage`
- **Headers:**
  - `Authorization: Bearer <access_token>`
  - `chatgpt-account-id: <account_id>`
  - `Accept: application/json`
  - `User-Agent: codex-cli/<version>`
- **Response:**
  ```json
  {
    "plan_type": "pro",
    "rate_limit": {
      "primary_window":   { "used_percent": 42, "limit_window_seconds": 18000,  "reset_at": 1735689600 },
      "secondary_window": { "used_percent": 22, "limit_window_seconds": 604800, "reset_at": 1736207000 }
    },
    "credits": { "has_credits": true, "unlimited": false, "balance": 12.34 }
  }
  ```
  primary = 5h window, secondary = weekly; remaining = `100 - used_percent`;
  reset = `reset_at` (epoch seconds).
- **Refresh:** `POST https://auth.openai.com/oauth/token` with
  `{ client_id: "app_EMoamEEZ73f0CkXaXp7hrann", grant_type: "refresh_token", refresh_token, scope: "openid profile email" }`.
  Refresh tokens **rotate** — persist the new `refresh_token` each time.
- **Stored material per account:** `access_token`, `refresh_token`,
  `account_id`. Refresh when token near expiry (JWT `exp`) or on 401.

> Both endpoints are internal/undocumented and may change. Fallback signals exist
> (Anthropic `anthropic-ratelimit-unified-*` headers; Codex `x-codex-*` response
> headers) but are out of scope for v1; the dashboard surfaces a clear error per
> account if an endpoint fails.

## Data model

`accounts` table (SQLite):

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `provider` | TEXT | "claude" \| "codex" |
| `label` | TEXT | user-given name (e.g. "work max") |
| `secret_blob` | BLOB | AES-256-GCM ciphertext of the token JSON |
| `iv` | BLOB | GCM nonce |
| `created_at` | INTEGER | epoch ms |
| `updated_at` | INTEGER | epoch ms |

The decrypted `secret_blob` is provider-specific JSON (Claude: access/refresh/
expiresAt; Codex: access/refresh/account_id).

## Data flow

1. Browser loads dashboard → `GET /api/usage`.
2. Server loads all accounts; for each, checks the usage cache (TTL ≥180s).
3. Cache miss → decrypt token → if expired, refresh (and re-encrypt/persist new
   tokens) → call provider endpoint → normalize → cache.
4. Return `UsageSnapshot[]`; dashboard renders cards grouped by provider, each
   showing per-window bars (used %), remaining %, and reset time (relative +
   absolute).
5. Auto-refresh: client polls `/api/usage` every 5 min; manual refresh button
   forces `?force=1` (bypasses cache but still respects the 180s floor per
   account to avoid 429s).

## Error handling

- Per-account failures are isolated: one failing account shows an error badge;
  others still render.
- Refresh failure (e.g. revoked refresh token) → account marked
  "re-authentication needed".
- 429 from Claude → show "rate-limited, retry after cache window"; never retry
  faster than 180s.
- Missing/invalid `APP_SECRET` or `APP_PASSWORD` at boot → app refuses to start
  with a clear message.

## Security

- Tokens encrypted at rest (AES-256-GCM); key only in `APP_SECRET` env var,
  never in the DB or repo.
- Tokens never sent to the browser; only normalized numbers are.
- Single-password gate on every route via middleware; session cookie is
  HTTP-only, `SameSite=Lax`, signed.
- Recommend running behind HTTPS (reverse proxy) and ideally a private network;
  documented in README.
- `.env`, the SQLite file, and any token dumps are gitignored.

## Testing

- **Unit:** `lib/crypto` round-trip; provider response normalization (feed
  recorded sample JSON → expected `UsageSnapshot`); token-expiry/refresh
  decision logic.
- **Integration:** API routes with a temp SQLite DB and mocked `fetch` for
  provider endpoints (success, 401→refresh→retry, 429, malformed JSON).
- **Auth:** unauthenticated requests to protected routes are rejected.
- No live calls to real provider endpoints in the test suite.

## Configuration (env)

| var | purpose |
|---|---|
| `APP_PASSWORD` | the single login password |
| `APP_SECRET` | 32-byte key (base64/hex) for token encryption + cookie signing |
| `DATABASE_PATH` | SQLite file path (default `./data/openusage.db`) |
| `USAGE_CACHE_TTL_SECONDS` | default 300; floored at 180 |

## Open considerations (deferred)

- Importing tokens directly from local `~/.claude` / `~/.codex` files (the macOS
  app does this; deferred since this is a remote server and owner chose paste).
- Additional providers (Gemini, Copilot, etc.) — interface supports it later.
