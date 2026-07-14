import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CODEX_DEVICE_COOKIE,
  type CodexDeviceSession,
  completeDeviceLogin,
} from "@/lib/providers/codex-oauth";
import { createAccount } from "@/lib/db";
import { invalidateCache } from "@/lib/usage";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { label } = (await req.json().catch(() => ({}))) as {
    label?: string;
  };
  if (!label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const jar = await cookies();
  const raw = jar.get(CODEX_DEVICE_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json(
      { error: "Login session expired. Start OpenAI login again." },
      { status: 400 },
    );
  }

  let device: CodexDeviceSession;
  try {
    device = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad login session." }, { status: 400 });
  }

  let secret;
  try {
    secret = await completeDeviceLogin(device);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Login failed." },
      { status: 400 },
    );
  }

  if (secret === "pending") {
    return NextResponse.json(
      { pending: true, message: "Waiting for OpenAI authorization." },
      { status: 202 },
    );
  }

  const account = createAccount({
    provider: "codex",
    label: label.trim(),
    secret,
  });
  invalidateCache(account.id);

  const res = NextResponse.json({
    account: { id: account.id, label: account.label },
  });
  res.cookies.set(CODEX_DEVICE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
