type RequestTrustOptions = {
  trustProxy?: boolean;
};

export function requestIsHttps(
  req: Request,
  options: RequestTrustOptions = {},
): boolean {
  const proto = options.trustProxy
    ? (req.headers.get("x-forwarded-proto") ??
      new URL(req.url).protocol.replace(":", ""))
    : new URL(req.url).protocol.replace(":", "");
  return proto.split(",")[0]?.trim() === "https";
}

export function clientKey(
  req: Request,
  options: RequestTrustOptions = {},
): string {
  if (!options.trustProxy) return "global";
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "global";
}
