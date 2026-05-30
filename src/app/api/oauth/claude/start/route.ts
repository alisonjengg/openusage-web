import { NextResponse } from "next/server";
import { authorizeUrl, createPkce } from "@/lib/providers/claude-oauth";
import { requestIsHttps } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const PKCE_COOKIE = "ou_pkce";

export async function GET(req: Request) {
  const { verifier, challenge, state } = createPkce();
  const url = authorizeUrl(challenge, state);

  const res = NextResponse.json({ url });
  // Hold the PKCE verifier + state for the matching /complete call. HTTP-only,
  // short-lived; state is validated against the code the user pastes back.
  res.cookies.set(PKCE_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsHttps(req, { trustProxy: env.trustProxy }),
    path: "/",
    maxAge: 600,
  });
  return res;
}
