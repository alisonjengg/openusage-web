import { NextResponse } from "next/server";
import { getAllUsage } from "@/lib/usage";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const snapshots = await getAllUsage(force);
  return NextResponse.json({ snapshots });
}
