export function parseClaudeOAuthCode(
  rawCode: string,
  expectedState: string,
): { code: string; state: string } {
  const hashIdx = rawCode.indexOf("#");
  if (hashIdx === -1) {
    throw new Error("OAuth state is required. Start the Claude login again.");
  }

  const code = rawCode.slice(0, hashIdx).trim();
  const state = rawCode.slice(hashIdx + 1).trim();

  if (!code) throw new Error("OAuth code is required.");
  if (state !== expectedState) {
    throw new Error("OAuth state did not match. Start the Claude login again.");
  }

  return { code, state };
}
