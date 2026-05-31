import { NextResponse } from "next/server";
import { getAllUsage } from "@/lib/usage";

export const runtime = "nodejs";

export async function GET() {
  const snapshots = await getAllUsage(false);
  return NextResponse.json({ snapshots });
}

export async function POST() {
  const snapshots = await getAllUsage(true);
  return NextResponse.json({ snapshots });
}
