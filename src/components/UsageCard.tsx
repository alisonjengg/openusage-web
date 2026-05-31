"use client";

import type { UsageSnapshot } from "@/lib/providers/types";
import {
  remainingPercent,
  usageLeftColor,
  usagePace,
} from "@/lib/usage-display";

function relativeReset(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "resetting…";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `resets in ${hrs}h ${rem}m`;
  const days = Math.floor(hrs / 24);
  return `resets in ${days}d ${hrs % 24}h`;
}

function absoluteReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function asOfTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function asOfTitle(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function UsageCard({ snap }: { snap: UsageSnapshot }) {
  return (
    <div className="card usage-card">
      <div className="head">
        <span className="card-title-stack">
          <span className="label">{snap.label}</span>
          <span className="as-of" title={asOfTitle(snap.fetchedAt)}>
            as of {asOfTime(snap.fetchedAt)}
          </span>
        </span>
        <span className={`tag ${snap.provider}`}>
          {snap.provider}
          {snap.planType ? ` · ${snap.planType}` : ""}
        </span>
      </div>

      {snap.error && (
        <div className={`banner ${snap.needsReauth ? "warn" : "error"}`}>
          {snap.error}
        </div>
      )}

      {snap.windows.map((w) => {
        const left = remainingPercent(w.usedPercent);
        const pace = usagePace(w);
        return (
          <div className="window" key={w.key}>
            <div className="row">
              <span className="window-meta">
                <span className="name">{w.label}</span>
                {pace && (
                  <span
                    className={`pace-dot ${pace.kind}`}
                    title={pace.label}
                    aria-label={`Usage pace: ${pace.label}`}
                  />
                )}
                <span className="reset" title={absoluteReset(w.resetsAt)}>
                  {relativeReset(w.resetsAt)}
                </span>
              </span>
              <span className="pct">{Math.round(left)}% left</span>
            </div>
            <div className="bar">
              <span
                style={{ width: `${left}%`, background: usageLeftColor(left) }}
              />
            </div>
          </div>
        );
      })}

      {!snap.error && snap.windows.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          No usage windows reported.
        </div>
      )}

      {snap.credits?.hasCredits && (
        <div className="reset" style={{ marginTop: 10 }}>
          Extra credits:{" "}
          {snap.credits.unlimited
            ? "unlimited"
            : snap.credits.balance !== undefined
              ? snap.credits.balance
              : "available"}
        </div>
      )}
    </div>
  );
}
