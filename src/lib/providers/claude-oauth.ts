import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { ClaudeSecret } from "./types";
import { parseClaudeOAuthCode } from "./claude-oauth-code";

// Claude Code's public OAuth client + the hosted "paste code" login flow.
// The authorize page lives on claude.ai; the callback/token endpoints live on
// console.anthropic.com. (Anthropic is migrating to platform.claude.com; if the
// console domain stops working, switch the two constants below.)
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SCOPE = "org:create_api_key user:profile user:inference";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type Pkce = { verifier: string; challenge: string; state: string };

export function createPkce(): Pkce {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(32));
  return { verifier, challenge, state };
}

export function authorizeUrl(challenge: string, state: string): string {
  const p = new URLSearchParams({
    code: "true", // triggers the "display a code to copy" page
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

// The user pastes the code Anthropic shows them — usually formatted "<code>#<state>".
export async function exchangeCode(
  rawCode: string,
  verifier: string,
  expectedState: string,
): Promise<ClaudeSecret> {
  const { code, state } = parseClaudeOAuthCode(rawCode, expectedState);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      state,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}).`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  };
}
