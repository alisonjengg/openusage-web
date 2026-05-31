"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    errors: number;
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
  const busyRef = useRef(false);
  const requestSeq = useRef(0);
  const [snaps, setSnaps] = useState<UsageSnapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nextAutoRefreshAt, setNextAutoRefreshAt] = useState<Date | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force && busyRef.current) return;
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    busyRef.current = true;
    setBusy(true);
    setRefreshError("");
    setRefreshNotice(null);

    const isLatest = () => requestId === requestSeq.current;
    let completedAt: Date | null = null;
    try {
      const res = await fetch("/api/usage", {
        method: force ? "POST" : "GET",
        cache: "no-store",
      });
      if (!isLatest()) return;
      if (!res.ok) {
        completedAt = new Date();
        setRefreshError("Could not refresh usage. Try again.");
        return;
      }
      const data = (await res.json()) as UsageResponse;
      if (!isLatest()) return;
      completedAt = new Date();
      setSnaps(data.snapshots);
      setLastUpdated(completedAt);
      if (force && data.refresh) {
        const cooldown = data.refresh.nextLiveRefreshAt
          ? refreshCooldownLabel(data.refresh.nextLiveRefreshAt)
          : null;
        if (data.refresh.cached > 0) {
          setRefreshNotice({
            kind: "warn",
            message:
              data.refresh.live > 0
                ? `Some accounts used cached data.${
                    cooldown ? ` Live refresh ${cooldown}.` : ""
                  }`
                : `Using cached data.${
                    cooldown ? ` Live refresh ${cooldown}.` : ""
                  }`,
          });
        } else if (data.refresh.errors > 0) {
          setRefreshNotice({
            kind: "warn",
            message:
              data.refresh.live > 0
                ? "Some accounts failed to refresh. Check account cards."
                : "Refresh failed. Check account cards.",
          });
        } else {
          setRefreshNotice({
            kind: "info",
            message: "Usage refreshed.",
          });
        }
      }
    } catch {
      if (isLatest()) {
        completedAt = new Date();
        setRefreshError("Could not refresh usage. Try again.");
      }
    } finally {
      if (isLatest()) {
        setNextAutoRefreshAt(nextRefreshAt(completedAt ?? new Date()));
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!nextAutoRefreshAt) return;
    const delay = Math.max(0, nextAutoRefreshAt.getTime() - Date.now());
    const t = setTimeout(() => load(), delay);
    return () => clearTimeout(t);
  }, [load, nextAutoRefreshAt]);

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
                next refresh at{" "}
                {timeLabel(nextAutoRefreshAt ?? nextRefreshAt(lastUpdated))}
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
          <div className="banner error compact-banner usage-refresh-banner">
            {refreshError}
          </div>
        )}
        {refreshNotice && (
          <div
            className={`banner ${refreshNotice.kind} compact-banner usage-refresh-banner`}
          >
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
                provider={section.provider}
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

function Section({
  provider,
  title,
  items,
}: {
  provider: UsageSnapshot["provider"];
  title: string;
  items: UsageSnapshot[];
}) {
  return (
    <section className="usage-section">
      <h2>
        <ProviderLogo provider={provider} />
        <span>{title}</span>
      </h2>
      <div className="grid">
        {items.map((s) => (
          <UsageCard key={s.accountId} snap={s} />
        ))}
      </div>
    </section>
  );
}

// Brand icon paths are from Font Awesome Free (OpenAI) and Simple Icons (Claude).
// Trademarks belong to their respective owners.
function ProviderLogo({ provider }: { provider: UsageSnapshot["provider"] }) {
  if (provider === "codex") {
    return (
      <svg
        aria-hidden="true"
        className="provider-logo openai-logo"
        focusable="false"
        viewBox="0 0 512 512"
      >
        <path
          fill="currentColor"
          d="M196.4 185.8l0-48.6c0-4.1 1.5-7.2 5.1-9.2l97.8-56.3c13.3-7.7 29.2-11.3 45.6-11.3 61.4 0 100.4 47.6 100.4 98.3 0 3.6 0 7.7-.5 11.8L343.3 111.1c-6.1-3.6-12.3-3.6-18.4 0L196.4 185.8zM424.7 375.2l0-116.2c0-7.2-3.1-12.3-9.2-15.9L287 168.4 329 144.3c3.6-2 6.7-2 10.2 0L437 200.7c28.2 16.4 47.1 51.2 47.1 85 0 38.9-23 74.8-59.4 89.6l0 0zM166.2 272.8l-42-24.6c-3.6-2-5.1-5.1-5.1-9.2l0-112.6c0-54.8 42-96.3 98.8-96.3 21.5 0 41.5 7.2 58.4 20L175.4 108.5c-6.1 3.6-9.2 8.7-9.2 15.9l0 148.5 0 0zm90.4 52.2l-60.2-33.8 0-71.7 60.2-33.8 60.2 33.8 0 71.7-60.2 33.8zm38.7 155.7c-21.5 0-41.5-7.2-58.4-20l100.9-58.4c6.1-3.6 9.2-8.7 9.2-15.9l0-148.5 42.5 24.6c3.6 2 5.1 5.1 5.1 9.2l0 112.6c0 54.8-42.5 96.3-99.3 96.3l0 0zM173.8 366.5L76.1 310.2c-28.2-16.4-47.1-51.2-47.1-85 0-39.4 23.6-74.8 59.9-89.6l0 116.7c0 7.2 3.1 12.3 9.2 15.9l128 74.2-42 24.1c-3.6 2-6.7 2-10.2 0zm-5.6 84c-57.9 0-100.4-43.5-100.4-97.3 0-4.1 .5-8.2 1-12.3l100.9 58.4c6.1 3.6 12.3 3.6 18.4 0l128.5-74.2 0 48.6c0 4.1-1.5 7.2-5.1 9.2l-97.8 56.3c-13.3 7.7-29.2 11.3-45.6 11.3l0 0zm127 60.9c62 0 113.7-44 125.4-102.4 57.3-14.9 94.2-68.6 94.2-123.4 0-35.8-15.4-70.7-43-95.7 2.6-10.8 4.1-21.5 4.1-32.3 0-73.2-59.4-128-128-128-13.8 0-27.1 2-40.4 6.7-23-22.5-54.8-36.9-89.6-36.9-62 0-113.7 44-125.4 102.4-57.3 14.8-94.2 68.6-94.2 123.4 0 35.8 15.4 70.7 43 95.7-2.6 10.8-4.1 21.5-4.1 32.3 0 73.2 59.4 128 128 128 13.8 0 27.1-2 40.4-6.7 23 22.5 54.8 36.9 89.6 36.9z"
        />
      </svg>
    );
  }
  if (provider === "claude") {
    return (
      <svg
        aria-hidden="true"
        className="provider-logo claude-logo"
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path
          fill="currentColor"
          d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
        />
      </svg>
    );
  }
  return null;
}
