export type ClaudeProfile = {
  account?: {
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
  };
  organization?: {
    rate_limit_tier?: string | null;
  };
};

export function claudePlanTypeFromProfile(
  profile: ClaudeProfile | null | undefined,
): string | undefined {
  const tier = profile?.organization?.rate_limit_tier ?? "";

  if (tier.includes("claude_max_20x")) return "max 20x";
  if (tier.includes("claude_max_5x")) return "max 5x";
  if (profile?.account?.has_claude_max) return "max";
  if (profile?.account?.has_claude_pro || tier.includes("claude_pro")) {
    return "pro";
  }

  return undefined;
}
