import { hostname, networkInterfaces } from "node:os";

const localDevOrigins = Array.from(
  new Set(
    [
      hostname(),
      `${hostname()}.local`,
      ...Object.values(networkInterfaces()).flatMap((entries) =>
        (entries ?? [])
          .filter((entry) => entry.family === "IPv4" && !entry.internal)
          .map((entry) => entry.address),
      ),
    ].filter(Boolean),
  ),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained server bundle (.next/standalone) for a small
  // Docker image. node:sqlite is built into Node — no native deps needed.
  output: "standalone",
  allowedDevOrigins: localDevOrigins,
};

export default nextConfig;
