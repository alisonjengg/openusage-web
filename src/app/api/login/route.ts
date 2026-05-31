import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { setupErrorPayload } from "@/lib/env-validation";
import { evaluateLoginAttempt } from "@/lib/login-attempt";
import {
  clearLoginFailures,
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/rate-limit";
import { clientKey, requestIsHttps } from "@/lib/request";
import { SESSION_COOKIE, createSession } from "@/lib/session";

export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length === bb.length) return timingSafeEqual(ab, bb);
  timingSafeEqual(
    createHash("sha256").update(ab).digest(),
    createHash("sha256").update(bb).digest(),
  );
  return false;
}

export async function POST(req: Request) {
  let passwordConfig: string;
  let secretConfig: string;
  const trustProxy = env.trustProxy;
  try {
    passwordConfig = env.password;
    secretConfig = env.secret;
  } catch (err) {
    const payload = setupErrorPayload(err);
    if (payload) return NextResponse.json(payload, { status: 503 });
    throw err;
  }

  const key = clientKey(req, { trustProxy });
  const rateLimited = isLoginRateLimited(key);

  const { password } = (await req.json().catch(() => ({}))) as {
    password?: string;
  };
  const decision = evaluateLoginAttempt({
    password,
    passwordConfig,
    rateLimited,
    matches: safeEqual,
  });
  if (decision !== "valid") {
    if (decision === "invalid") recordLoginFailure(key);
    return NextResponse.json(
      {
        error:
          decision === "rate_limited"
            ? "too many login attempts"
            : "invalid password",
      },
      { status: decision === "rate_limited" ? 429 : 401 },
    );
  }
  clearLoginFailures(key);

  // Mark the cookie Secure only when the request actually arrived over HTTPS
  // (directly or via a reverse proxy). Forcing Secure on plain-HTTP access —
  // e.g. http://localhost during local/Docker testing — makes the browser
  // silently drop the session cookie, which looks like login doing nothing.
  const token = await createSession(secretConfig, passwordConfig);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsHttps(req, { trustProxy }),
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
