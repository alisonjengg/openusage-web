export type LoginAttemptDecision = "rate_limited" | "invalid" | "valid";

export function evaluateLoginAttempt(input: {
  password: string | undefined;
  passwordConfig: string;
  rateLimited: boolean;
  matches: (password: string, passwordConfig: string) => boolean;
}): LoginAttemptDecision {
  if (input.rateLimited) return "rate_limited";
  if (!input.password || !input.matches(input.password, input.passwordConfig)) {
    return "invalid";
  }
  return "valid";
}
