import { NextResponse } from "next/server";
import { getAllUsageResult } from "@/lib/usage";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getAllUsageResult(false));
}

export async function POST() {
  return NextResponse.json(await getAllUsageResult(true));
}
