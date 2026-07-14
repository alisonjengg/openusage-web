import type {
  AccountSecret,
  ClaudeSecret,
  CodexSecret,
  ProviderId,
} from "./providers/types";

// Accept either a pasted credentials-file JSON or a minimal object, and extract
// the token material we store. Throws a clear error if required fields missing.
//
// Claude: ~/.claude/.credentials.json -> { claudeAiOauth: { accessToken, refreshToken, expiresAt } }
//         (also accepts a flat object with those keys, or snake_case variants)
// Codex:  ~/.codex/auth.json          -> { tokens: { access_token, refresh_token, account_id } }
export function parseCredentials(
  provider: ProviderId,
  input: string,
): AccountSecret {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(input);
  } catch {
    throw new Error("Credentials must be valid JSON.");
  }

  if (provider === "claude") return parseClaude(obj);
  return parseCodex(obj);
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}

function parseClaude(obj: Record<string, unknown>): ClaudeSecret {
  const src =
    (obj.claudeAiOauth as Record<string, unknown> | undefined) ?? obj;
  const accessToken = pick(src, "accessToken", "access_token") as
    | string
    | undefined;
  const refreshToken = pick(src, "refreshToken", "refresh_token") as
    | string
    | undefined;
  const expiresAt = pick(src, "expiresAt", "expires_at") as number | undefined;
  if (!accessToken || !refreshToken) {
    throw new Error(
      "Claude credentials need accessToken and refreshToken (paste the contents of ~/.claude/.credentials.json).",
    );
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: typeof expiresAt === "number" ? expiresAt : undefined,
  };
}

function parseCodex(obj: Record<string, unknown>): CodexSecret {
  const src = (obj.tokens as Record<string, unknown> | undefined) ?? obj;
  const accessToken = pick(src, "access_token", "accessToken") as
    | string
    | undefined;
  const refreshToken = pick(src, "refresh_token", "refreshToken") as
    | string
    | undefined;
  const accountId = pick(src, "account_id", "accountId") as string | undefined;
  if (!accessToken || !refreshToken) {
    throw new Error(
      "Codex credentials need access_token and refresh_token (paste the contents of ~/.codex/auth.json).",
    );
  }
  return { accessToken, refreshToken, accountId };
}
