// Signed session token using Web Crypto (HMAC-SHA256) so it works both in
// edge middleware and Node route handlers. Token = base64url(payload).base64url(sig).

export const SESSION_COOKIE = "ou_session";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string, password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`openusage-session-v1\0${secret}\0${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSession(
  secret: string,
  password: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ exp: Date.now() + ttlMs })),
  );
  const key = await hmacKey(secret, password);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string,
  password: string,
): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  try {
    const key = await hmacKey(secret, password);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(sig),
      new TextEncoder().encode(payload),
    );
    if (!ok) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}
