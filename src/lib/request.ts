type RequestTrustOptions = {
  trustProxy?: boolean;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requestIsHttps(
  req: Request,
  options: RequestTrustOptions = {},
): boolean {
  const directProto = new URL(req.url).protocol.replace(":", "");
  if (directProto === "https") return true;

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const proto = options.trustProxy
    ? (forwardedProto ?? directProto)
    : directProto;
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

export function requestOriginAllowed(
  req: Request,
  options: RequestTrustOptions = {},
): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const origin = req.headers.get("origin");
  if (!origin) return fetchSite === "same-origin";

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const url = new URL(req.url);
  const forwardedHost = options.trustProxy
    ? req.headers.get("x-forwarded-host")
    : null;
  const forwardedProto = options.trustProxy
    ? req.headers.get("x-forwarded-proto")
    : null;
  const host = (forwardedHost ?? req.headers.get("host") ?? url.host)
    .split(",")[0]
    .trim();
  const proto = (forwardedProto ?? url.protocol.replace(":", ""))
    .split(",")[0]
    .trim();

  return (
    originUrl.host === host && originUrl.protocol.replace(":", "") === proto
  );
}
