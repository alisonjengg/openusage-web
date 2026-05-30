export function parseClaudeOAuthCode(
  rawCode: string,
  expectedState: string,
): { code: string; state: string } {
  const hashIdx = rawCode.indexOf("#");
  const code = (hashIdx === -1 ? rawCode : rawCode.slice(0, hashIdx)).trim();
  const state =
    hashIdx === -1 ? expectedState : rawCode.slice(hashIdx + 1).trim();

  if (!code) throw new Error("OAuth code is required.");
  if (state !== expectedState) {
    throw new Error("OAuth state did not match. Start the Claude login again.");
  }

  return { code, state };
}
