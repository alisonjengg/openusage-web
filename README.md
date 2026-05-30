# openusage-web

A personal, self-hosted dashboard that shows usage limits and reset times for
your **Claude** (Pro/Max) and **Codex** (ChatGPT-backed) subscription accounts
— several of each — on one page. You paste each account's OAuth token once; the
app queries each provider and shows how much of your 5-hour and weekly windows
you've used and when they reset.

It's a web counterpart to the macOS app
[robinebers/openusage](https://github.com/robinebers/openusage).

## How it works

- **Server-side only.** All provider calls happen in Next.js API routes. Tokens
  never reach the browser; the page only receives computed usage numbers.
- **Encrypted at rest.** Tokens are AES-256-GCM encrypted in a local SQLite file
  using a key derived from `APP_SECRET`.
- **Single-password login.** Every route is gated behind one password; the
  session is a signed, HTTP-only cookie.
- **Auto token refresh.** Expired access tokens are refreshed automatically
  (and the rotated refresh tokens are persisted).

| Provider | Usage endpoint | Windows |
|---|---|---|
| Claude | `GET api.anthropic.com/api/oauth/usage` | 5-hour, weekly (+ Opus/Sonnet) |
| Codex  | `GET chatgpt.com/backend-api/wham/usage` | 5-hour, weekly |

> These are internal, undocumented endpoints and may change. If one breaks, the
> affected account shows an error badge; the others keep working.

## Setup

Requires **Node 24+**. The app currently uses Node's built-in `node:sqlite`,
which is still marked experimental by Node; the Docker image pins Node 24.

```bash
npm install
```

Create `.env.local` (copy from `env.example`):

```bash
APP_PASSWORD=your-dashboard-password
APP_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
DATABASE_PATH=./data/openusage.db
USAGE_CACHE_TTL_SECONDS=300
TRUST_PROXY=0
```

`APP_PASSWORD` must not be a placeholder such as `change-me`. `APP_SECRET`
must be at least 32 bytes; use the command above to generate a 64-character
hex value.

## Run

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm run start
```

Open the URL, sign in with `APP_PASSWORD`, go to **Accounts**, and add each
account.

Docker:

```bash
docker build -t openusage-web .
docker run --rm -p 3000:3000 \
  -v openusage-data:/data \
  -e APP_PASSWORD='your-dashboard-password' \
  -e APP_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  openusage-web
```

Or set `APP_PASSWORD` and `APP_SECRET` in your shell or a compose `.env` file,
then run:

```bash
docker compose up -d
```

## Getting your tokens

When adding an account, paste the contents of the relevant credentials file:

- **Claude** → `~/.claude/.credentials.json`
  (the JSON containing `claudeAiOauth.accessToken` and `refreshToken`).
  On macOS this may live in the Keychain instead; you can read it with:
  `security find-generic-password -s "Claude Code-credentials" -w`
- **Codex** → `~/.codex/auth.json`
  (the JSON containing `tokens.access_token` and `refresh_token`).

The form accepts the whole file — it extracts only the token fields it needs.

## Deploying

This is meant to run on a private server you control. Because it holds real
OAuth tokens:

- Put it behind **HTTPS** (a reverse proxy such as Caddy/nginx). The session
  cookie is marked `Secure` when the request reaches the app as HTTPS.
- Set `TRUST_PROXY=1` only when a trusted reverse proxy overwrites
  `X-Forwarded-*` headers. Leave it off for direct LAN/localhost access.
- Prefer a **private network** (VPN / Tailscale) on top of the password.
- Keep `.env.local` and the `data/` directory off version control (already
  gitignored).

## Tests

```bash
npm test
```

Covers token encryption round-trips, provider response normalization,
credential parsing, session invalidation, OAuth state validation, rate limiting,
and account reorder helpers.

## Project layout

```
src/
  app/
    page.tsx              Dashboard (usage cards)
    accounts/page.tsx     Add / remove accounts
    login/page.tsx        Password login
    api/                  login, logout, accounts, usage
  components/             Nav, UsageCard
  lib/
    crypto.ts             AES-256-GCM seal/open
    db.ts                 SQLite accounts store (encrypted)
    session.ts            Signed session cookie (HMAC)
    env.ts                Env config (lazy-validated)
    parse-credentials.ts  Parse pasted credentials JSON
    usage.ts              Orchestrates fetch + cache per account
    providers/
      types.ts            Provider interface + normalized shapes
      normalize.ts        Pure response -> windows (unit-tested)
      claude.ts           Claude fetch + refresh
      codex.ts            Codex fetch + refresh
  middleware.ts           Auth gate on all routes
```
