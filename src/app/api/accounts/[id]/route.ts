import { NextResponse } from "next/server";
import {
  deleteAccount,
  getAccount,
  updateAccountLabel,
  updateAccountSecret,
} from "@/lib/db";
import { parseCredentials } from "@/lib/parse-credentials";
import { invalidateCache } from "@/lib/usage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const account = getAccount(id);
  if (!account) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    label?: string;
    credentials?: string;
  };

  if (body.label?.trim()) updateAccountLabel(id, body.label.trim());

  if (body.credentials?.trim()) {
    try {
      const secret = parseCredentials(account.provider, body.credentials);
      updateAccountSecret(id, secret);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "invalid credentials" },
        { status: 400 },
      );
    }
  }

  invalidateCache(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  deleteAccount(id);
  invalidateCache(id);
  return NextResponse.json({ ok: true });
}
