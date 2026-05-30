import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Public paths that don't require a session.
const PUBLIC = ["/login", "/api/login"];

function withSecurityHeaders(res: NextResponse): NextResponse {
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
