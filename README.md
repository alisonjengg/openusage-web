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
USAGE_CACHE_TTL_SECONDS=60
TRUST_PROXY=0
```

`APP_PASSWORD` must not be a placeholder such as `change-me`. `APP_SECRET`
must be at least 32 bytes; use the command above to generate a 64-character
hex value.

## Run Locally

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

Local Docker:

```bash
docker build -t openusage-web .
docker run --rm -p 3000:3000 \
  -v openusage-data:/data \
  -e APP_PASSWORD='your-dashboard-password' \
  -e APP_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  openusage-web
```

Local Docker Compose:

```bash
docker compose up -d
```

The included `docker-compose.yml` maps `3000:3000` for local use. Do not use
that host port mapping in Coolify unless you intentionally want to bypass
Coolify's proxy.

## Deploy on Coolify with Dockerfile

Use the **Dockerfile** build pack for Coolify. This lets Coolify build the app
from GitHub and route traffic through its proxy. Do not deploy this repository
with the included `docker-compose.yml` unless you customize it for Coolify.

Why Dockerfile instead of Compose on Coolify:

- The app is a single container; Compose is not needed.
- Coolify can route to the container's internal port `3000`.
- Avoiding `ports: "3000:3000"` prevents host-port conflicts and keeps traffic
  behind Coolify's HTTPS proxy.

### 1. Create the application

1. In Coolify, choose **New Resource** -> **Application**.
2. Select the GitHub repository.
3. Select branch `main`.
4. Set **Build Pack** to **Dockerfile**.
5. Set **Dockerfile Location** to:

```txt
/Dockerfile
```

Leave the base directory empty unless you moved the project into a subfolder.

### 2. Configure ports

Set **Port Exposes** to:

```txt
3000
```

Leave **Port Mappings** empty.

`Port Exposes` tells Coolify which port the app listens on inside the
container. It does not publish `server-ip:3000`. Coolify's proxy connects to
the container internally and serves the app through your configured domain.

The Dockerfile already matches this:

```dockerfile
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
```

### 3. Add environment variables

In Coolify's environment variables page, add:

```txt
APP_PASSWORD=replace-with-a-strong-password
APP_SECRET=replace-with-a-64-character-random-hex-string
DATABASE_PATH=/data/openusage.db
USAGE_CACHE_TTL_SECONDS=60
TRUST_PROXY=1
```

Generate `APP_SECRET` on your own machine:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the generated 64-character hex string as `APP_SECRET`.

`APP_PASSWORD` must not be a placeholder such as `change-me`, `changeme`, or
`password`.

If Coolify offers a **Build Variable** toggle for these values, keep these as
runtime variables. The app does not need `APP_PASSWORD` or `APP_SECRET` during
the image build.

### 4. Add persistent storage

Add a persistent volume:

```txt
Destination Path: /data
```

The SQLite database is stored at `/data/openusage.db`. Without persistent
storage, accounts may disappear after redeploys or container recreation.

### 5. Add a domain and deploy

1. Add your domain in Coolify.
2. Keep **Force HTTPS** enabled.
3. Deploy the application.
4. Open the domain, sign in with `APP_PASSWORD`, then go to **Accounts**.

### 6. Health checks

The Dockerfile includes a container healthcheck that calls:

```txt
/api/health
```

The endpoint returns HTTP `200` with:

```json
{ "status": "ok" }
```

In most Coolify Dockerfile deployments, you can rely on the Dockerfile
healthcheck. If you configure health checks in the Coolify UI instead, use:

```txt
Path: /api/health
Expected Status Code: 200
```

Do not protect `/api/health` with login; Coolify must be able to call it before
the app receives user traffic. The health endpoint does not expose account,
token, or usage data.

### Coolify troubleshooting

- **Port already allocated / bind error:** remove host port mappings. Use
  **Port Exposes** = `3000`; leave **Port Mappings** empty.
- **502 / app not reachable:** confirm **Port Exposes** is `3000` and the build
  pack is **Dockerfile**.
- **Health status missing or unhealthy:** redeploy after this version and use
  `/api/health` with expected status `200` if configuring health checks in the
  Coolify UI.
- **Login works on HTTP but not HTTPS / cookie issues:** confirm
  `TRUST_PROXY=1`.
- **Setup message asks to change password:** `APP_PASSWORD` is empty or a
  blocked placeholder. Set a stronger value and redeploy.
- **Accounts disappear after deploy:** persistent storage was not mounted at
  `/data`.
- **Cannot open `server-ip:3000`:** this is expected. With Coolify, use the
  domain URL. The app is intentionally not published directly on host port
  `3000`.

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
