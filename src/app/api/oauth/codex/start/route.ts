import { NextResponse } from "next/server";
import {
  CODEX_DEVICE_COOKIE,
  requestDeviceCode,
} from "@/lib/providers/codex-oauth";
import { requestIsHttps } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let device;
  try {
    device = await requestDeviceCode();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start login." },
      { status: 400 },
    );
  }

  const res = NextResponse.json({
    verificationUrl: device.verificationUrl,
    userCode: device.userCode,
    interval: device.interval,
  });
  res.cookies.set(CODEX_DEVICE_COOKIE, JSON.stringify(device), {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsHttps(req, { trustProxy: env.trustProxy }),
    path: "/",
    maxAge: 15 * 60,
  });
  return res;
}
