const PLACEHOLDER_PASSWORDS = new Set([
  "change-me",
  "changeme",
  "password",
  "admin",
  "secret",
  "test",
]);

const LOGIN_SETUP_PASSWORD_MESSAGE =
  "Server setup is incomplete. Set APP_PASSWORD to a non-placeholder value and restart.";

const LOGIN_SETUP_SECRET_MESSAGE =
  "Server setup is incomplete. Set APP_SECRET to a 32-byte-or-longer value and restart.";

type SetupErrorPayload = {
  error: "setup_required";
  message: string;
};

class SetupError extends Error {
  readonly payload: SetupErrorPayload;

  constructor(payload: SetupErrorPayload) {
    super(payload.message);
    this.name = "SetupError";
    this.payload = payload;
    Object.setPrototypeOf(this, SetupError.prototype);
  }
}

export function setupErrorPayload(err: unknown): SetupErrorPayload | null {
  return err instanceof SetupError ? err.payload : null;
}

export function validateAppPassword(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SetupError({
      error: "setup_required",
      message: LOGIN_SETUP_PASSWORD_MESSAGE,
    });
  }
  if (PLACEHOLDER_PASSWORDS.has(trimmed.toLowerCase())) {
    throw new SetupError({
      error: "setup_required",
      message: LOGIN_SETUP_PASSWORD_MESSAGE,
    });
  }
  return trimmed;
}

export function validateAppSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SetupError({
      error: "setup_required",
      message: LOGIN_SETUP_SECRET_MESSAGE,
    });
  }
  if (Buffer.byteLength(trimmed, "utf8") < 32) {
    throw new SetupError({
      error: "setup_required",
      message: LOGIN_SETUP_SECRET_MESSAGE,
    });
  }
  return trimmed;
}

export function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function usageCacheTtlSeconds(value: string | undefined): number {
  const parsed = Number(value ?? "60");
  return Math.max(60, Number.isFinite(parsed) && parsed > 0 ? parsed : 60);
}
