import type { CodexSecret } from "./types";

const ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_API_BASE = `${ISSUER}/api/accounts/deviceauth`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
const MAX_AGE_MS = 15 * 60 * 1000;

export const CODEX_DEVICE_COOKIE = "ou_codex_device";

export type CodexDeviceSession = {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  interval: number;
  expiresAt: number;
};

type DeviceCodeResponse = {
  device_auth_id: string;
  user_code?: string;
  usercode?: string;
  interval?: string | number;
};

type DeviceTokenResponse = {
  authorization_code: string;
  code_verifier: string;
};

export type CodexTokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token: string;
};

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function accountIdFromIdToken(idToken: string): string | undefined {
  const claims = decodeJwt(idToken);
  const auth = claims?.["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: unknown }
    | undefined;
  return typeof auth?.chatgpt_account_id === "string"
    ? auth.chatgpt_account_id
    : undefined;
}

export function codexSecretFromTokenResponse(
  data: CodexTokenResponse,
): CodexSecret {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accountId: accountIdFromIdToken(data.id_token),
  };
}

async function readError(res: Response): Promise<string> {
  await res.body?.cancel().catch(() => undefined);
  return "";
}

export async function requestDeviceCode(): Promise<CodexDeviceSession> {
  const res = await fetch(`${DEVICE_API_BASE}/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!res.ok) {
    throw new Error(`Device code request failed (${res.status}).${await readError(res)}`);
  }

  const data = (await res.json()) as DeviceCodeResponse;
  const userCode = data.user_code ?? data.usercode;
  const interval = Number(data.interval ?? 5) || 5;
  if (!data.device_auth_id || !userCode) {
    throw new Error("Device code response was missing required fields.");
  }

  return {
    verificationUrl: `${ISSUER}/codex/device`,
    userCode,
    deviceAuthId: data.device_auth_id,
    interval,
    expiresAt: Date.now() + MAX_AGE_MS,
  };
}

async function pollForAuthorizationCode(
  session: CodexDeviceSession,
): Promise<DeviceTokenResponse | "pending"> {
  const res = await fetch(`${DEVICE_API_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_auth_id: session.deviceAuthId,
      user_code: session.userCode,
    }),
  });

  if (res.ok) return (await res.json()) as DeviceTokenResponse;
  if (res.status === 403 || res.status === 404) return "pending";
  throw new Error(`Device authorization failed (${res.status}).${await readError(res)}`);
}

async function exchangeAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
): Promise<CodexSecret> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorizationCode,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}).${await readError(res)}`);
  }

  return codexSecretFromTokenResponse((await res.json()) as CodexTokenResponse);
}

export async function completeDeviceLogin(
  session: CodexDeviceSession,
): Promise<CodexSecret | "pending"> {
  if (session.expiresAt <= Date.now()) {
    throw new Error("Device code expired. Start OpenAI login again.");
  }

  const code = await pollForAuthorizationCode(session);
  if (code === "pending") return "pending";
  return exchangeAuthorizationCode(code.authorization_code, code.code_verifier);
}
