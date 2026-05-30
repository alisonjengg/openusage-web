"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginErrorMessage } from "@/lib/login-errors";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        message?: unknown;
      } | null;
      setError(loginErrorMessage(res.status, body));
    }
  }

  return (
    <div className="center">
      <div className="brand" style={{ fontSize: 22, fontWeight: 700 }}>
        openusage
      </div>
      <form className="login-box" onSubmit={submit}>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="banner error">{error}</div>}
        <button className="btn primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
