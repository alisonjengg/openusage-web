import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requestOriginAllowed } from "@/lib/request";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Public paths that don't require a session.
const PUBLIC = ["/login", "/api/login", "/api/health"];

function trustProxyEnabled(): boolean {
  const value = process.env.TRUST_PROXY;
  return value
    ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
    : false;
}

function withSecurityHeaders(res: NextResponse): NextResponse {
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      scriptSrc,
      "connect-src 'self'",
    ].join("; "),
  );
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!requestOriginAllowed(req, { trustProxy: trustProxyEnabled() })) {
    return withSecurityHeaders(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
    );
  }

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return withSecurityHeaders(NextResponse.next());
  }

  const secret = (process.env.APP_SECRET ?? "").trim();
  const password = (process.env.APP_PASSWORD ?? "").trim();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok =
    secret && password ? await verifySession(token, secret, password) : false;
  if (ok) return withSecurityHeaders(NextResponse.next());

  // API routes get a 401; page routes redirect to /login.
  if (pathname.startsWith("/api/")) {
    return withSecurityHeaders(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return withSecurityHeaders(NextResponse.redirect(url));
}

export const config = {
  // Guard everything except Next internals and static assets.
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
