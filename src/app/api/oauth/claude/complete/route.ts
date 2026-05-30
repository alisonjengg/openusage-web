import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/providers/claude-oauth";
import { createAccount } from "@/lib/db";
import { invalidateCache } from "@/lib/usage";

export const runtime = "nodejs";

const PKCE_COOKIE = "ou_pkce";

export async function POST(req: Request) {
  const { label, code } = (await req.json().catch(() => ({}))) as {
    label?: string;
    code?: string;
  };
  if (!label?.trim() || !code?.trim()) {
    return NextResponse.json(
      { error: "label and code are required" },
      { status: 400 },
    );
  }

  const jar = await cookies();
  const raw = jar.get(PKCE_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json(
      { error: "Login session expired — start the Claude login again." },
      { status: 400 },
    );
  }

  let pkce: { verifier: string; state: string };
  try {
    pkce = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad login session." }, { status: 400 });
  }

  let secret;
  try {
    secret = await exchangeCode(code.trim(), pkce.verifier, pkce.state);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Token exchange failed" },
      { status: 400 },
    );
  }

  const account = createAccount({
    provider: "claude",
    label: label.trim(),
    secret,
  });
  invalidateCache(account.id);

  const res = NextResponse.json({
    account: { id: account.id, label: account.label },
  });
  res.cookies.set(PKCE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
