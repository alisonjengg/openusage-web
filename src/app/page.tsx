"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import UsageCard from "@/components/UsageCard";
import type { UsageSnapshot } from "@/lib/providers/types";
import { refreshCooldownLabel } from "@/lib/usage-cache";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

type UsageResponse = {
  snapshots: UsageSnapshot[];
  refresh?: {
    live: number;
    cached: number;
    nextLiveRefreshAt: string | null;
  };
};

type RefreshNotice = {
  kind: "info" | "warn";
  message: string;
};

function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nextRefreshAt(date: Date): Date {
  return new Date(date.getTime() + AUTO_REFRESH_MS);
}

export default function Dashboard() {
  const [snaps, setSnaps] = useState<UsageSnapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    setRefreshError("");
    setRefreshNotice(null);
    try {
      const res = await fetch("/api/usage", {
        method: force ? "POST" : "GET",
      });
      if (!res.ok) {
        setRefreshError("Could not refresh usage. Try again.");
        return;
      }
      const data = (await res.json()) as UsageResponse;
      setSnaps(data.snapshots);
      setLastUpdated(new Date());
      if (force && data.refresh) {
        if (
          data.refresh.live === 0 &&
          data.refresh.cached > 0 &&
          data.refresh.nextLiveRefreshAt
        ) {
          setRefreshNotice({
            kind: "warn",
            message: `Using cached data. Live refresh ${refreshCooldownLabel(
              data.refresh.nextLiveRefreshAt,
            )}.`,
          });
        } else {
          setRefreshNotice({
            kind: "info",
            message: "Usage refreshed.",
          });
        }
      }
    } catch {
      setRefreshError("Could not refresh usage. Try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const sections = snaps ? groupByProvider(snaps) : [];

  return (
    <>
      <Nav />
      <div className="wrap">
        <div className="row-between page-title-row">
          <h1>Usage</h1>
          <div className="page-title-actions">
            {lastUpdated && (
              <span className="muted title-updated">
                next refresh at {timeLabel(nextRefreshAt(lastUpdated))}
              </span>
            )}
            <button
              className="btn compact"
              onClick={() => load(true)}
              disabled={busy}
            >
              {busy ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {refreshError && (
          <div className="banner error compact-banner">{refreshError}</div>
        )}
        {refreshNotice && (
          <div className={`banner ${refreshNotice.kind} compact-banner`}>
            {refreshNotice.message}
          </div>
        )}

        {snaps === null ? (
          <p className="muted">Loading…</p>
        ) : snaps.length === 0 ? (
          <div className="card">
            <p style={{ marginTop: 0 }}>No accounts yet.</p>
            <Link className="btn primary" href="/accounts">
              Add an account
            </Link>
          </div>
        ) : (
          <>
            {sections.map((section) => (
              <Section
                key={section.provider}
                title={providerTitle(section.provider)}
                items={section.items}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function groupByProvider(snaps: UsageSnapshot[]) {
  const sections: {
    provider: UsageSnapshot["provider"];
    items: UsageSnapshot[];
  }[] = [];
  for (const snap of snaps) {
    let section = sections.find((entry) => entry.provider === snap.provider);
    if (!section) {
      section = { provider: snap.provider, items: [] };
      sections.push(section);
    }
    section.items.push(snap);
  }
  return sections;
}

function providerTitle(provider: UsageSnapshot["provider"]): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  return provider;
}

function Section({ title, items }: { title: string; items: UsageSnapshot[] }) {
  return (
    <section className="usage-section">
      <h2>{title}</h2>
      <div className="grid">
        {items.map((s) => (
          <UsageCard key={s.accountId} snap={s} />
        ))}
      </div>
    </section>
  );
}
