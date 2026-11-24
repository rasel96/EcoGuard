"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BellRinging,
  BookmarkSimple,
  Compass,
  Cpu,
  MapPin,
  TreeEvergreen,
  WarningOctagon,
} from "@phosphor-icons/react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import type { DashboardData } from "@/lib/types";

const FEATURED_FORESTS = [
  {
    name: "Sundarbans",
    query: "Sundarbans, Khulna, Bangladesh",
    region: "Khulna · Mangrove",
    image: "/forests/sundarbans.jpg",
  },
  {
    name: "Lawachara Rainforest",
    query: "Lawachara National Park, Moulvibazar, Bangladesh",
    region: "Sylhet · Evergreen",
    image: "/forests/lawachara.jpg",
  },
  {
    name: "Ratargul Swamp",
    query: "Ratargul Swamp Forest, Sylhet, Bangladesh",
    region: "Sylhet · Freshwater Swamp",
    image: "/forests/ratargul.jpg",
  },
  {
    name: "Chittagong Hill Tracts",
    query: "Bandarban, Chittagong, Bangladesh",
    region: "Bandarban · Hill Canopy",
    image: "/forests/hilltracts.jpg",
  },
];

function riskBadgeClass(risk: string | null | undefined) {
  switch ((risk || "").toUpperCase()) {
    case "HIGH":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "MEDIUM":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "LOW":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    default:
      return "bg-[#edf5ef] text-[#466355] border-emerald-950/12";
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
      title="Bangladesh Canopy Overview"
      subtitle="Live satellite deforestation monitoring, protected forest watchlists, and AI-assisted field triage."
      actions={
        <Link
          href="/explorer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0f5c3e] hover:bg-[#0b4730] text-white font-semibold text-xs sm:text-sm shadow-sm shadow-emerald-950/15 transition-all active:scale-[0.98]"
        >
          <Compass size={16} weight="bold" />
          <span>Launch Forest Scan</span>
        </Link>
      }
    >
      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading || !data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-white border border-emerald-950/10 animate-pulse"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 h-72 rounded-2xl bg-white border border-emerald-950/10 animate-pulse" />
            <div className="lg:col-span-5 h-72 rounded-2xl bg-white border border-emerald-950/10 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Telemetry Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 rounded-2xl forest-card divide-y lg:divide-y-0 lg:divide-x divide-emerald-950/10 overflow-hidden">
            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#557464]">
                Open Deforestation Alerts
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono tabular-nums text-[#0b2419]">
                  {data.stats.open_alerts}
                </span>
                <span className="text-xs text-[#5c7a6b] font-mono">
                  / {data.stats.total_alerts} total
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#557464]">
                High-Risk Canopy Signals
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono tabular-nums text-rose-600">
                  {data.stats.high_risk_count}
                </span>
                <span className="text-xs text-amber-700 font-mono">
                  {data.stats.medium_risk_count} medium
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#557464]">
                Satellite Forest Scans
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono tabular-nums text-[#0f5c3e]">
                  {data.stats.total_analyses}
                </span>
                <span className="text-xs text-[#5c7a6b] font-mono">
                  {data.stats.watchlist_count} watchlists
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#557464]">
                DeepSeek Forest AI
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Cpu size={18} weight="duotone" className="text-emerald-700 shrink-0" />
                <span className="text-xs font-mono font-semibold text-[#0b2419] truncate">
                  {data.llm.primary_model}
                </span>
              </div>
              <div className="mt-1 text-[11px] font-mono text-[#5c7a6b]">
                {data.llm.configured
                  ? "Connected · English & বাংলা"
                  : "Standby fallback mode"}
              </div>
            </div>
          </div>

          {/* Priority Bangladesh Forest Quick-Launch Strip */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TreeEvergreen size={17} weight="duotone" className="text-[#0f5c3e]" />
                <h2 className="text-sm font-semibold text-[#0b2419]">
                  Priority Bangladesh Forests — Step Deeper Into Satellite View
                </h2>
              </div>
              <Link
                href="/explorer"
                className="text-xs font-medium text-[#0f5c3e] hover:text-emerald-700 inline-flex items-center gap-1"
              >
                <span>Explore any polygon</span>
                <ArrowRight size={13} />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {FEATURED_FORESTS.map((forest) => (
                <Link
                  key={forest.name}
                  href={`/explorer?location=${encodeURIComponent(forest.query)}`}
                  className="group relative rounded-2xl overflow-hidden forest-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-950/10"
                >
                  <div className="relative h-28 w-full overflow-hidden">
                    <img
                      src={forest.image}
                      alt={forest.name}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#062217]/85 via-[#062217]/20 to-transparent" />
                    <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-white/90 text-[#0f5c3e] text-[10px] font-mono font-semibold inline-flex items-center gap-1">
                      <span>Scan</span>
                      <ArrowRight size={10} weight="bold" />
                    </div>
                    <div className="absolute bottom-2.5 left-3 right-3 text-white">
                      <div className="text-sm font-semibold leading-tight">
                        {forest.name}
                      </div>
                      <div className="text-[10px] font-mono text-emerald-100/90 flex items-center gap-1 mt-0.5">
                        <MapPin size={10} weight="fill" />
                        <span>{forest.region}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Asymmetric 7/5 Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Recent Satellite Scans */}
            <section className="lg:col-span-7 rounded-2xl forest-card overflow-hidden">
              <div className="px-5 py-4 border-b border-emerald-950/10 flex items-center justify-between bg-[#fafdfb]">
                <div>
                  <h2 className="text-sm font-semibold text-[#0b2419]">
                    Recent Forest Canopy Analyses
                  </h2>
                  <p className="text-xs text-[#557464] mt-0.5">
                    Persisted Sentinel-2 NDVI, Hansen forest-loss, and ML risk runs
                  </p>
                </div>
                <Link
                  href="/explorer"
                  className="text-xs font-medium text-[#0f5c3e] hover:text-emerald-700 inline-flex items-center gap-1"
                >
                  <span>Open Explorer</span>
                  <ArrowRight size={13} />
                </Link>
              </div>

              {data.recent_analyses.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <Compass size={30} className="mx-auto text-emerald-700/50" />
                  <div className="text-sm text-[#0b2419] font-semibold">
                    No satellite scans recorded yet
                  </div>
                  <p className="text-xs text-[#557464] max-w-sm mx-auto">
                    Launch the Satellite Explorer to inspect a Bangladesh forest reserve
                    or draw a custom polygon AOI on the map.
                  </p>
                  <Link
                    href="/explorer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0f5c3e] text-white text-xs font-semibold hover:bg-[#0b4730]"
                  >
                    <span>Run First Forest Scan</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-emerald-950/8">
                  {data.recent_analyses.map((run) => (
                    <div
                      key={run.id}
                      className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-[#f5faf6] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#0b2419] truncate max-w-xs sm:max-w-sm">
                          {run.location}
                        </div>
                        <div className="text-[11px] font-mono text-[#5c7a6b] mt-0.5">
                          NDVI {run.current_ndvi?.toFixed(3) ?? "N/A"} · Loss{" "}
                          {run.vegetation_loss?.toFixed(1) ?? "N/A"}% ·{" "}
                          {run.geometry_type === "custom_polygon"
                            ? "Custom Polygon"
                            : "OSM Boundary"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {run.confidence !== null && (
                          <span className="text-[11px] font-mono text-[#557464]">
                            {run.confidence.toFixed(0)}% conf
                          </span>
                        )}
                        <span
                          className={`px-2.5 py-0.5 rounded-full border text-[11px] font-mono font-semibold ${riskBadgeClass(
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
              <section className="rounded-2xl forest-card overflow-hidden">
                <div className="px-5 py-4 border-b border-emerald-950/10 bg-[#fafdfb] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BellRinging size={16} weight="duotone" className="text-amber-600" />
                    <h2 className="text-sm font-semibold text-[#0b2419]">
                      Latest Deforestation Alerts
                    </h2>
                  </div>
                  <Link
                    href="/alerts"
                    className="text-xs font-medium text-[#0f5c3e] hover:text-emerald-700"
                  >
                    Triage all
                  </Link>
                </div>

                {data.recent_alerts.length === 0 ? (
                  <div className="p-6 text-xs text-[#5c7a6b] text-center">
                    No MEDIUM or HIGH deforestation alerts logged yet.
                  </div>
                ) : (
                  <div className="divide-y divide-emerald-950/8">
                    {data.recent_alerts.slice(0, 5).map((alert) => (
                      <div
                        key={alert.id}
                        className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#f5faf6] transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#0b2419] truncate">
                            {alert.location}
                          </div>
                          <div className="text-[11px] font-mono text-[#5c7a6b] mt-0.5">
                            Status: {alert.status.toUpperCase()} · NDVI{" "}
                            {alert.ndvi?.toFixed(3) ?? "N/A"}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-semibold ${riskBadgeClass(
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

              <section className="rounded-2xl forest-card overflow-hidden">
                <div className="px-5 py-4 border-b border-emerald-950/10 bg-[#fafdfb] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookmarkSimple size={16} weight="duotone" className="text-[#0f5c3e]" />
                    <h2 className="text-sm font-semibold text-[#0b2419]">
                      Protected Forest Watchlists
                    </h2>
                  </div>
                  <Link
                    href="/watchlists"
                    className="text-xs font-medium text-[#0f5c3e] hover:text-emerald-700"
                  >
                    Configure
                  </Link>
                </div>

                {data.watchlists.length === 0 ? (
                  <div className="p-6 text-center space-y-2">
                    <WarningOctagon size={22} className="mx-auto text-emerald-700/45" />
                    <p className="text-xs text-[#5c7a6b]">
                      Save Bangladesh reserves like Sundarbans or Lawachara for one-click re-scans.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-emerald-950/8">
                    {data.watchlists.slice(0, 4).map((wl) => (
                      <Link
                        key={wl.id}
                        href={`/explorer?location=${encodeURIComponent(wl.name)}`}
                        className="px-5 py-3 flex items-center justify-between gap-2 hover:bg-[#f5faf6] transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#0b2419] truncate">
                            {wl.name}
                          </div>
                          <div className="text-[11px] font-mono text-[#5c7a6b]">
                            Target {wl.target_coverage}% · Last NDVI{" "}
                            {wl.last_ndvi?.toFixed(3) ?? "Unchecked"}
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-[#0f5c3e] shrink-0" />
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
