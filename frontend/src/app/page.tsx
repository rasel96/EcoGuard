"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BellRinging,
  BookmarkSimple,
  Compass,
  Cpu,
  WarningOctagon,
} from "@phosphor-icons/react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import type { DashboardData } from "@/lib/types";

function riskBadgeClass(risk: string | null | undefined) {
  switch ((risk || "").toUpperCase()) {
    case "HIGH":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "MEDIUM":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "LOW":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    default:
      return "bg-white/[0.06] text-zinc-400 border-white/[0.1]";
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboard()
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
        setLoading(false);
      });
  }, []);

  return (
    <AppShell
      title="Command Overview"
      subtitle="Live satellite risk telemetry, saved forest watchlists, and alert triage."
      actions={
        <Link
          href="/explorer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs sm:text-sm transition-colors active:scale-[0.98]"
        >
          <Compass size={16} weight="bold" />
          <span>New Satellite Scan</span>
        </Link>
      }
    >
      {error && (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading || !data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-white/[0.04] animate-pulse"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 h-72 rounded-2xl bg-white/[0.04] animate-pulse" />
            <div className="lg:col-span-5 h-72 rounded-2xl bg-white/[0.04] animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Telemetry Strip (border-divided metrics, crisp monospace numbers) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 rounded-2xl border border-white/[0.08] bg-[#111714] divide-y lg:divide-y-0 lg:divide-x divide-white/[0.08]">
            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                Open Alerts
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono tabular-nums text-white">
                  {data.stats.open_alerts}
                </span>
                <span className="text-xs text-zinc-500 font-mono">
                  / {data.stats.total_alerts} total
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                High-Risk Signals
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono tabular-nums text-rose-400">
                  {data.stats.high_risk_count}
                </span>
                <span className="text-xs text-amber-400 font-mono">
                  {data.stats.medium_risk_count} medium
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                Completed Scans
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono tabular-nums text-emerald-400">
                  {data.stats.total_analyses}
                </span>
                <span className="text-xs text-zinc-500 font-mono">
                  {data.stats.watchlist_count} watchlists
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                DeepSeek Engine
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Cpu size={18} className="text-emerald-400 shrink-0" />
                <span className="text-xs font-mono text-zinc-200 truncate">
                  {data.llm.primary_model}
                </span>
              </div>
              <div className="mt-1 text-[11px] font-mono text-zinc-500">
                {data.llm.configured
                  ? "Connected to tokenharbor.ai/v1"
                  : "Set LLM_API_KEY in .env for live AI"}
              </div>
            </div>
          </div>

          {/* Asymmetric 7/5 Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Recent Satellite Scans */}
            <section className="lg:col-span-7 rounded-2xl border border-white/[0.08] bg-[#111714] overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Recent Satellite Analyses
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Persisted Sentinel-2, Hansen, and ML risk runs
                  </p>
                </div>
                <Link
                  href="/explorer"
                  className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                >
                  <span>Open Explorer</span>
                  <ArrowRight size={13} />
                </Link>
              </div>

              {data.recent_analyses.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <Compass size={28} className="mx-auto text-zinc-600" />
                  <div className="text-sm text-zinc-300 font-medium">
                    No satellite scans recorded yet
                  </div>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                    Launch the Satellite Explorer to search a Bangladesh forest region
                    or draw a custom polygon AOI on the map.
                  </p>
                  <Link
                    href="/explorer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-500/25"
                  >
                    <span>Run First Analysis</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {data.recent_analyses.map((run) => (
                    <div
                      key={run.id}
                      className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-100 truncate max-w-xs sm:max-w-sm">
                          {run.location}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          NDVI {run.current_ndvi?.toFixed(3) ?? "N/A"} · Loss{" "}
                          {run.vegetation_loss?.toFixed(1) ?? "N/A"}% ·{" "}
                          {run.geometry_type === "custom_polygon"
                            ? "Custom Polygon"
                            : "OSM Boundary"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {run.confidence !== null && (
                          <span className="text-[11px] font-mono text-zinc-400">
                            {run.confidence.toFixed(0)}% conf
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-mono font-medium ${riskBadgeClass(
                            run.risk_level
                          )}`}
                        >
                          {run.risk_level}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Right Column: Alerts + Watchlists */}
            <div className="lg:col-span-5 space-y-6">
              <section className="rounded-2xl border border-white/[0.08] bg-[#111714] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BellRinging size={16} className="text-amber-400" />
                    <h2 className="text-sm font-semibold text-white">
                      Latest Risk Alerts
                    </h2>
                  </div>
                  <Link
                    href="/alerts"
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    Manage all
                  </Link>
                </div>

                {data.recent_alerts.length === 0 ? (
                  <div className="p-6 text-xs text-zinc-500 text-center">
                    No MEDIUM or HIGH risk alerts logged yet.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {data.recent_alerts.slice(0, 5).map((alert) => (
                      <div
                        key={alert.id}
                        className="px-5 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-zinc-100 truncate">
                            {alert.location}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                            Status: {alert.status.toUpperCase()} · NDVI{" "}
                            {alert.ndvi?.toFixed(3) ?? "N/A"}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[10px] font-mono ${riskBadgeClass(
                            alert.risk_level
                          )}`}
                        >
                          {alert.risk_level}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-white/[0.08] bg-[#111714] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookmarkSimple size={16} className="text-emerald-400" />
                    <h2 className="text-sm font-semibold text-white">
                      Monitored Watchlists
                    </h2>
                  </div>
                  <Link
                    href="/watchlists"
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    Configure
                  </Link>
                </div>

                {data.watchlists.length === 0 ? (
                  <div className="p-6 text-center space-y-2">
                    <WarningOctagon size={22} className="mx-auto text-zinc-600" />
                    <p className="text-xs text-zinc-500">
                      Save Bangladesh reserves like Sundarbans or Lawachara for one-click re-scans.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {data.watchlists.slice(0, 4).map((wl) => (
                      <Link
                        key={wl.id}
                        href={`/explorer?location=${encodeURIComponent(wl.name)}`}
                        className="px-5 py-3 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-zinc-100 truncate">
                            {wl.name}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500">
                            Target {wl.target_coverage}% · Last NDVI{" "}
                            {wl.last_ndvi?.toFixed(3) ?? "Unchecked"}
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-zinc-500 shrink-0" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
