import { NextResponse } from "next/server";
import { getAllUsageResult } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

async function usageResponse(force: boolean) {
  return NextResponse.json(await getAllUsageResult(force), {
    headers: noStoreHeaders,
  });
}

export async function GET() {
  return usageResponse(false);
}

export async function POST() {
  return usageResponse(true);
}
