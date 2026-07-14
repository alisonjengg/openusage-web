import "server-only";
import {
  envFlag,
  usageCacheTtlSeconds,
  validateAppPassword,
  validateAppSecret,
} from "./env-validation";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. See env.example.`,
    );
  }
  return v;
}

// Lazy getters: validation happens when a value is first read at request time,
// not at module import — so `next build` (which evaluates route modules without
// real secrets) doesn't fail.
export const env = {
  get password() {
    return validateAppPassword(required("APP_PASSWORD"));
  },
  get secret() {
    return validateAppSecret(required("APP_SECRET"));
  },
  get trustProxy() {
    return envFlag(process.env.TRUST_PROXY);
  },
  get databasePath() {
    return process.env.DATABASE_PATH ?? "./data/openusage.db";
  },
  get cacheTtlSeconds() {
    return usageCacheTtlSeconds(process.env.USAGE_CACHE_TTL_SECONDS);
  },
};
