import { NextResponse } from "next/server";
import { createAccount, listAccountSummaries } from "@/lib/db";
import { parseCredentials } from "@/lib/parse-credentials";
import { invalidateCache } from "@/lib/usage";
import type { ProviderId } from "@/lib/providers/types";

export const runtime = "nodejs";

// Return accounts WITHOUT secrets — just id/provider/label for the manager UI.
export async function GET() {
  const accounts = listAccountSummaries().map((a) => ({
    id: a.id,
    provider: a.provider,
    label: a.label,
    sortOrder: a.sortOrder,
    createdAt: a.createdAt,
  }));
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    label?: string;
    credentials?: string;
  };
  const provider = body.provider as ProviderId;
  if (provider !== "claude" && provider !== "codex") {
    return NextResponse.json({ error: "invalid provider" }, { status: 400 });
  }
  if (!body.label?.trim()) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  if (!body.credentials?.trim()) {
    return NextResponse.json({ error: "credentials required" }, { status: 400 });
  }

  let secret;
  try {
    secret = parseCredentials(provider, body.credentials);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid credentials" },
      { status: 400 },
    );
  }

  const account = createAccount({ provider, label: body.label.trim(), secret });
  invalidateCache(account.id);
  return NextResponse.json({
    account: { id: account.id, provider, label: account.label },
  });
}
