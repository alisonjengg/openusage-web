export const LOGIN_SETUP_PASSWORD_MESSAGE =
  "Server setup is incomplete. Set APP_PASSWORD to a non-placeholder value and restart.";

export const LOGIN_SETUP_SECRET_MESSAGE =
  "Server setup is incomplete. Set APP_SECRET to a 32-byte-or-longer value and restart.";

type LoginErrorBody = {
  error?: unknown;
  message?: unknown;
};

export function loginErrorMessage(
  status: number,
  body: LoginErrorBody | null,
): string {
  if (
    status === 503 &&
    body?.error === "setup_required" &&
    typeof body.message === "string"
  ) {
    return body.message;
  }
  if (status === 429) return "Too many login attempts. Try again later.";
  return "Incorrect password.";
}
