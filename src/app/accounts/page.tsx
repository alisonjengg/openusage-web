"use client";

import { useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import {
  moveItemWithinGroupByOffset,
  moveProviderGroupByOffset,
} from "@/lib/reorder";

type Account = {
  id: string;
  provider: "claude" | "codex";
  label: string;
  sortOrder: number;
  createdAt: number;
};

const HINTS: Record<string, string> = {
  claude:
    "Paste the contents of ~/.claude/.credentials.json (the JSON with claudeAiOauth.accessToken & refreshToken).",
  codex:
    "Paste the contents of ~/.codex/auth.json (the JSON with tokens.access_token & refresh_token).",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [label, setLabel] = useState("");
  const [credentials, setCredentials] = useState("");
  const [error, setError] = useState("");
  const [orderError, setOrderError] = useState("");
  const [draggingProvider, setDraggingProvider] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingBusy, setEditingBusy] = useState(false);
  const [editingError, setEditingError] = useState("");
  const [busy, setBusy] = useState(false);

  // Claude OAuth ("Log in with Claude") state.
  const [oauthStep, setOauthStep] = useState<"idle" | "code">("idle");
  const [oauthUrl, setOauthUrl] = useState("");
  const [oauthLabel, setOauthLabel] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthError, setOauthError] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);

  // OpenAI/Codex device-code login state.
  const [codexStep, setCodexStep] = useState<"idle" | "code">("idle");
  const [codexVerificationUrl, setCodexVerificationUrl] = useState("");
  const [codexUserCode, setCodexUserCode] = useState("");
  const [codexLabel, setCodexLabel] = useState("");
  const [codexError, setCodexError] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) {
      const data = (await res.json()) as { accounts: Account[] };
      setAccounts(data.accounts);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, label, credentials }),
    });
    setBusy(false);
    if (res.ok) {
      setLabel("");
      setCredentials("");
      load();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to add account.");
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove "${label}"?`)) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    load();
  }

  function sameOrder(next: Account[]): boolean {
    return (
      next.length === accounts.length &&
      next.every((account, index) => account.id === accounts[index]?.id)
    );
  }

  async function saveOrder(next: Account[]) {
    if (sameOrder(next)) return;
    setAccounts(next);
    setOrderError("");
    const res = await fetch("/api/accounts/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((account) => account.id) }),
    });
    if (!res.ok) {
      setOrderError("Could not save account order.");
      load();
    }
  }

  function accountGroups() {
    const groups: { provider: Account["provider"]; accounts: Account[] }[] = [];
    for (const account of accounts) {
      let group = groups.find((entry) => entry.provider === account.provider);
      if (!group) {
        group = { provider: account.provider, accounts: [] };
        groups.push(group);
      }
      group.accounts.push(account);
    }
    return groups;
  }

  function sameProviderOrder(next: Account[]): boolean {
    const before = accountGroups()
      .map((group) => group.provider)
      .join("|");
    const after: string[] = [];
    for (const account of next) {
      if (!after.includes(account.provider)) after.push(account.provider);
    }
    return before === after.join("|");
  }

  function moveProvider(providerId: Account["provider"], offset: -1 | 1) {
    const next = moveProviderGroupByOffset(accounts, providerId, offset);
    if (sameProviderOrder(next)) return;
    saveOrder(next);
  }

  function moveAccount(id: string, offset: -1 | 1) {
    const next = moveItemWithinGroupByOffset(accounts, id, offset);
    if (sameOrder(next)) return;
    saveOrder(next);
  }

  function dropProvider(
    e: React.DragEvent<HTMLDivElement>,
    targetProvider: Account["provider"],
  ) {
    e.preventDefault();
    const movingProvider =
      draggingProvider ?? e.dataTransfer.getData("text/plain");
    setDraggingProvider(null);
    if (!movingProvider || movingProvider === targetProvider) return;

    const groups = accountGroups();
    const movingIndex = groups.findIndex(
      (group) => group.provider === movingProvider,
    );
    const targetIndex = groups.findIndex(
      (group) => group.provider === targetProvider,
    );
    if (movingIndex < 0 || targetIndex < 0) return;

    const nextGroups = [...groups];
    const [movingGroup] = nextGroups.splice(movingIndex, 1);
    nextGroups.splice(targetIndex, 0, movingGroup);
    saveOrder(nextGroups.flatMap((group) => group.accounts));
  }

  function startEdit(account: Account) {
    setEditingId(account.id);
    setEditingLabel(account.label);
    setEditingError("");
  }

  async function saveLabel(id: string) {
    const nextLabel = editingLabel.trim();
    if (!nextLabel) {
      setEditingError("Label required.");
      return;
    }

    setEditingBusy(true);
    setEditingError("");
    const res = await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: nextLabel }),
    });
    setEditingBusy(false);

    if (res.ok) {
      setAccounts((current) =>
        current.map((account) =>
          account.id === id ? { ...account, label: nextLabel } : account,
        ),
      );
      setEditingId(null);
      setEditingLabel("");
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setEditingError(data.error ?? "Could not update label.");
    }
  }

  async function startClaudeLogin() {
    setOauthError("");
    setOauthBusy(true);
    const res = await fetch("/api/oauth/claude/start", { method: "POST" });
    setOauthBusy(false);
    if (res.ok) {
      const { url } = (await res.json()) as { url: string };
      setOauthUrl(url);
      setOauthStep("code");
    } else {
      setOauthError("Could not start login. Try again.");
    }
  }

  async function finishClaudeLogin(e: React.FormEvent) {
    e.preventDefault();
    setOauthBusy(true);
    setOauthError("");
    const res = await fetch("/api/oauth/claude/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: oauthLabel, code: oauthCode }),
    });
    setOauthBusy(false);
    if (res.ok) {
      setOauthStep("idle");
      setOauthLabel("");
      setOauthCode("");
      load();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setOauthError(data.error ?? "Login failed.");
    }
  }

  async function startCodexLogin() {
    setCodexError("");
    setCodexBusy(true);
    const res = await fetch("/api/oauth/codex/start", { method: "POST" });
    setCodexBusy(false);
    if (res.ok) {
      const data = (await res.json()) as {
        verificationUrl: string;
        userCode: string;
      };
      setCodexVerificationUrl(data.verificationUrl);
      setCodexUserCode(data.userCode);
      setCodexStep("code");
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setCodexError(data.error ?? "Could not start login. Try again.");
    }
  }

  async function finishCodexLogin(e: React.FormEvent) {
    e.preventDefault();
    setCodexBusy(true);
    setCodexError("");
    const res = await fetch("/api/oauth/codex/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: codexLabel }),
    });
    setCodexBusy(false);
    if (res.status === 202) {
      setCodexError("Still waiting for OpenAI approval.");
    } else if (res.ok) {
      setCodexStep("idle");
      setCodexVerificationUrl("");
      setCodexUserCode("");
      setCodexLabel("");
      load();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setCodexError(data.error ?? "Login failed.");
    }
  }

  return (
    <>
      <Nav />
      <div className="wrap" style={{ maxWidth: 720 }}>
        <h1 style={{ fontSize: 22 }}>Accounts</h1>

        <div className="card" style={{ marginBottom: 28 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Log in with Claude</h2>
          {oauthStep === "idle" ? (
            <>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Opens Anthropic&apos;s login in a new tab. Approve, copy the code
                it shows you, then paste it back here.
              </p>
              <button
                className="btn primary"
                onClick={startClaudeLogin}
                disabled={oauthBusy}
              >
                {oauthBusy ? "Opening…" : "Log in with Claude"}
              </button>
            </>
          ) : (
            <form onSubmit={finishClaudeLogin}>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Click below to open Anthropic&apos;s login in a new tab. Approve,
                copy the code it shows you, then paste it back here.
              </p>
              <a
                className="btn primary"
                href={oauthUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginBottom: 14 }}
              >
                Open Claude login ↗
              </a>
              <label className="field">
                <span>Label</span>
                <input
                  value={oauthLabel}
                  placeholder="e.g. personal-max"
                  onChange={(e) => setOauthLabel(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Code from Anthropic</span>
                <input
                  value={oauthCode}
                  placeholder="paste the code here"
                  onChange={(e) => setOauthCode(e.target.value)}
                />
              </label>
              {oauthError && <div className="banner error">{oauthError}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn primary" disabled={oauthBusy}>
                  {oauthBusy ? "Finishing…" : "Finish login"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setOauthStep("idle");
                    setOauthError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {oauthStep === "idle" && oauthError && (
            <div className="banner error" style={{ marginTop: 10 }}>
              {oauthError}
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 28 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Log in with OpenAI</h2>
          {codexStep === "idle" ? (
            <>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Opens OpenAI&apos;s Codex device login. Enter the one-time code
                shown here, approve access, then finish here.
              </p>
              <button
                className="btn primary"
                onClick={startCodexLogin}
                disabled={codexBusy}
              >
                {codexBusy ? "Opening…" : "Log in with OpenAI"}
              </button>
            </>
          ) : (
            <form onSubmit={finishCodexLogin}>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Open the login page, enter this one-time code, then return here
                after OpenAI confirms authorization.
              </p>
              <a
                className="btn primary"
                href={codexVerificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginBottom: 14 }}
              >
                Open OpenAI login ↗
              </a>
              <div
                className="banner"
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 18,
                  letterSpacing: 0,
                }}
              >
                {codexUserCode}
              </div>
              <label className="field">
                <span>Label</span>
                <input
                  value={codexLabel}
                  placeholder="e.g. personal-pro"
                  onChange={(e) => setCodexLabel(e.target.value)}
                />
              </label>
              {codexError && <div className="banner error">{codexError}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn primary" disabled={codexBusy}>
                  {codexBusy ? "Finishing…" : "Finish login"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setCodexStep("idle");
                    setCodexError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {codexStep === "idle" && codexError && (
            <div className="banner error" style={{ marginTop: 10 }}>
              {codexError}
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 28 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>
            Add account manually (paste token)
          </h2>
          <form onSubmit={add}>
            <label className="field">
              <span>Provider</span>
              <select
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as "claude" | "codex")
                }
              >
                <option value="claude">Claude (Pro / Max)</option>
                <option value="codex">Codex (ChatGPT)</option>
              </select>
            </label>
            <label className="field">
              <span>Label</span>
              <input
                value={label}
                placeholder="e.g. work-max, personal"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Credentials JSON</span>
              <textarea
                value={credentials}
                placeholder={HINTS[provider]}
                onChange={(e) => setCredentials(e.target.value)}
              />
            </label>
            <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
              {HINTS[provider]}
            </p>
            {error && <div className="banner error">{error}</div>}
            <button className="btn primary" disabled={busy}>
              {busy ? "Adding…" : "Add account"}
            </button>
          </form>
        </div>

        <h2 style={{ fontSize: 16 }}>Your accounts</h2>
        {orderError && <div className="banner error">{orderError}</div>}
        {accounts.length === 0 ? (
          <p className="muted">No accounts yet.</p>
        ) : (
          accountGroups().map((group, index, groups) => (
            <div
              className={`provider-group ${
                draggingProvider === group.provider ? "dragging" : ""
              }`}
              key={group.provider}
              draggable
              onDragStart={(e) => {
                setDraggingProvider(group.provider);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", group.provider);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => dropProvider(e, group.provider)}
              onDragEnd={() => setDraggingProvider(null)}
            >
              <div className="provider-group-head">
                <div className="account-main">
                  <span className="drag-handle" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className={`tag ${group.provider}`}>
                    {group.provider}
                  </span>
                  <span className="muted">
                    {group.accounts.length}{" "}
                    {group.accounts.length === 1 ? "account" : "accounts"}
                  </span>
                </div>
                <div className="account-actions">
                  <button
                    type="button"
                    className="icon-btn reorder-btn"
                    aria-label={`Move ${group.provider} group up`}
                    disabled={index === 0}
                    onClick={() => moveProvider(group.provider, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn reorder-btn"
                    aria-label={`Move ${group.provider} group down`}
                    disabled={index === groups.length - 1}
                    onClick={() => moveProvider(group.provider, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
              {group.accounts.map((a, accountIndex) => (
                <div className="list-item account-item" key={a.id}>
                  <div className="account-main">
                    {editingId === a.id ? (
                      <input
                        className="inline-input"
                        value={editingLabel}
                        autoFocus
                        onChange={(e) => setEditingLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveLabel(a.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      <span>{a.label}</span>
                    )}
                  </div>
                  <div className="account-actions">
                    <button
                      type="button"
                      className="icon-btn reorder-btn"
                      aria-label={`Move ${a.label} up within ${a.provider}`}
                      disabled={accountIndex === 0}
                      onClick={() => moveAccount(a.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn reorder-btn"
                      aria-label={`Move ${a.label} down within ${a.provider}`}
                      disabled={accountIndex === group.accounts.length - 1}
                      onClick={() => moveAccount(a.id, 1)}
                    >
                      ↓
                    </button>
                    {editingId === a.id ? (
                      <>
                        <button
                          type="button"
                          className="btn primary compact"
                          disabled={editingBusy}
                          onClick={() => saveLabel(a.id)}
                        >
                          {editingBusy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="btn compact"
                          disabled={editingBusy}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn compact"
                        onClick={() => startEdit(a)}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn danger compact"
                      onClick={() => remove(a.id, a.label)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {editingError && group.accounts.some((a) => a.id === editingId) && (
                <div className="banner error compact-banner">{editingError}</div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
