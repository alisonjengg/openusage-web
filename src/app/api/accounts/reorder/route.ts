import { NextResponse } from "next/server";
import { reorderAccounts } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (
    !Array.isArray(body.ids) ||
    !body.ids.every((id): id is string => typeof id === "string")
  ) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  try {
    reorderAccounts(body.ids);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid account order" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
