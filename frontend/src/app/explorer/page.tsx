"use client";

import React, { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  BookmarkSimple,
  CloudRain,
  DownloadSimple,
  Fire,
  Leaf,
  MagnifyingGlass,
  Polygon,
  ShieldWarning,
  TreeEvergreen,
} from "@phosphor-icons/react";
import AppShell from "@/components/AppShell";
import TelemetryCharts from "@/components/TelemetryCharts";
import AiCopilotPanel from "@/components/AiCopilotPanel";
import { api } from "@/lib/api";
import type {
  AnalyzeResponse,
  GeoJsonPolygon,
  LocationSuggestion,
} from "@/lib/types";

const SatelliteMap = dynamic(() => import("@/components/SatelliteMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[520px] rounded-2xl border border-white/[0.08] bg-[#111714] animate-pulse" />
  ),
});

function ExplorerContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("location") || "";

  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [activePolygon, setActivePolygon] = useState<GeoJsonPolygon | null>(null);
  const [language, setLanguage] = useState<"en" | "bn">("en");
  const [availableModels, setAvailableModels] = useState<string[]>([
    "deepseek-v4.1-flash-1017",
    "deepseek-v4.1-flash:free",
  ]);
  const [selectedModel, setSelectedModel] = useState("deepseek-v4.1-flash-1017");

  const [report, setReport] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        if (h.llm.available_models?.length) {
          setAvailableModels(h.llm.available_models);
          setSelectedModel(h.llm.primary_model || h.llm.available_models[0]);
        }
      })
      .catch(() => null);
  }, []);

  // Debounced autocomplete for Bangladesh locations
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .suggestLocations(trimmed)
        .then((res) => setSuggestions(res.suggestions || []))
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const runAnalysis = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() && !activePolygon) {
      setError("Enter a Bangladesh location or draw a custom polygon on the map.");
      return;
    }
    setLoading(true);
    setError(null);
    setSavedNotice(null);
    setShowSuggestions(false);

    try {
      const res = await api.analyze({
        location: query.trim() || undefined,
        geojson: activePolygon,
        include_extended: true,
        include_ai: true,
        language,
        model: selectedModel,
      });
      setReport(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Satellite analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWatchlist = async () => {
    if (!report) return;
    try {
      await api.addWatchlist({
        name: report.location.name,
        latitude: report.location.latitude,
        longitude: report.location.longitude,
        boundingbox: report.location.boundingbox,
        geojson: activePolygon,
      });
      setSavedNotice("Added to Watchlists.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save watchlist");
    }
  };

  const handleDownloadPdf = async () => {
    if (!report) return;
    try {
      await api.downloadPdfReport({
        location: report.location.name,
        analysis: report.analysis,
        risk: report.risk,
        tree_data: report.tree_data,
        ai_briefing: report.ai?.briefing || "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF export failed");
    }
  };

  const riskStyle =
    report?.risk.risk_level === "HIGH"
      ? "bg-rose-500/15 text-rose-300 border-rose-500/35"
      : report?.risk.risk_level === "MEDIUM"
      ? "bg-amber-500/15 text-amber-300 border-amber-500/35"
      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/35";

  return (
    <AppShell
      title="Satellite & Polygon Explorer"
      subtitle="Search any Bangladesh region or draw a custom forest polygon for Sentinel-2, Hansen, and DeepSeek analysis."
      actions={
        report && (
          <>
            <button
              type="button"
              onClick={handleSaveWatchlist}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.12] bg-[#111714] hover:bg-white/[0.06] text-xs font-medium text-zinc-200 transition-colors active:scale-[0.98]"
            >
              <BookmarkSimple size={15} />
              <span>Save Watchlist</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition-colors active:scale-[0.98]"
            >
              <DownloadSimple size={15} weight="bold" />
              <span>Export PDF</span>
            </button>
          </>
        )
      }
    >
      <div className="space-y-6">
        {/* Search & Run Bar */}
        <form
          onSubmit={runAnalysis}
          className="rounded-2xl border border-white/[0.08] bg-[#111714] p-4 flex flex-col lg:flex-row gap-3 items-stretch lg:items-center"
        >
          <div className="relative flex-1">
            <MagnifyingGlass
              size={17}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="Search Bangladesh forest or district (e.g., Sundarbans, Lawachara, Sylhet)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0a0e0c] border border-white/[0.12] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
            />

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-white/[0.12] bg-[#0e1411] shadow-xl overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={`${s.name}-${s.latitude}`}
                    type="button"
                    onClick={() => {
                      setQuery(s.name);
                      setActivePolygon(null);
                      setShowSuggestions(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-zinc-200 hover:bg-emerald-500/12 border-b border-white/[0.05] last:border-b-0"
                  >
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="font-mono text-[10px] text-zinc-500">
                      {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {activePolygon && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono">
                <Polygon size={14} />
                <span>Custom Polygon Active</span>
              </span>
            )}

            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              aria-label="DeepSeek Model"
              className="bg-[#0a0e0c] border border-white/[0.12] rounded-xl px-3 py-2.5 text-xs font-mono text-zinc-200"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "bn")}
              aria-label="Briefing Language"
              className="bg-[#0a0e0c] border border-white/[0.12] rounded-xl px-3 py-2.5 text-xs text-zinc-200"
            >
              <option value="en">Briefing: English</option>
              <option value="bn">Briefing: বাংলা</option>
            </select>

            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Scanning GEE..." : "Analyze Area"}
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs sm:text-sm text-rose-200">
            {error}
          </div>
        )}

        {savedNotice && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs sm:text-sm text-emerald-200">
            {savedNotice}
          </div>
        )}

        {/* Map + DeepSeek Copilot Asymmetric Split */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-7 space-y-6">
            <SatelliteMap
              boundingBox={report?.location.boundingbox}
              ndviTileUrl={report?.analysis.ndvi_tile_url}
              landcoverTileUrl={report?.analysis.landcover_tile_url}
              hansenTileUrl={report?.analysis.hansen_loss_tile_url}
              activePolygon={activePolygon}
              onPolygonChange={setActivePolygon}
            />

            {loading && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#111714] p-6 space-y-3">
                <div className="h-4 w-52 rounded bg-white/[0.06] animate-pulse" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="h-20 rounded-xl bg-white/[0.04] animate-pulse"
                    />
                  ))}
                </div>
              </div>
            )}

            {report && !loading && (
              <div className="space-y-6">
                {/* Risk Header & Multi-Index Telemetry */}
                <div className="rounded-2xl border border-white/[0.08] bg-[#111714] overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-mono text-zinc-400">
                        {report.location.boundary_type} · {report.analysis.analysis_start} to{" "}
                        {report.analysis.analysis_end}
                      </div>
                      <h2 className="text-base font-semibold text-white mt-0.5">
                        {report.location.name}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2.5">
                      {report.risk.confidence !== null && (
                        <span className="text-xs font-mono text-zinc-400">
                          {report.risk.confidence.toFixed(1)}% confidence
                        </span>
                      )}
                      <span
                        className={`px-3 py-1 rounded-full border text-xs font-mono font-semibold ${riskStyle}`}
                      >
                        {report.risk.risk_level} RISK
                      </span>
                    </div>
                  </div>

                  {/* Telemetry Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08]">
                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                        <Leaf size={14} className="text-emerald-400" />
                        <span>MEAN NDVI</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-white mt-1.5">
                        {report.analysis.current_ndvi?.toFixed(3) ?? "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-1">
                        YoY:{" "}
                        {report.analysis.yoy_ndvi_change !== null
                          ? `${report.analysis.yoy_ndvi_change >= 0 ? "+" : ""}${report.analysis.yoy_ndvi_change.toFixed(3)}`
                          : "N/A"}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                        <ShieldWarning size={14} className="text-amber-400" />
                        <span>60D LOSS</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-white mt-1.5">
                        {report.analysis.vegetation_loss !== null
                          ? `${report.analysis.vegetation_loss.toFixed(1)}%`
                          : "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-1">
                        EVI: {report.analysis.current_evi?.toFixed(3) ?? "N/A"}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                        <Fire size={14} className="text-rose-400" />
                        <span>BURN dNBR</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-white mt-1.5">
                        {report.analysis.dnbr !== null
                          ? report.analysis.dnbr.toFixed(3)
                          : "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-1">
                        NBR: {report.analysis.current_nbr?.toFixed(3) ?? "N/A"}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                        <CloudRain size={14} className="text-sky-400" />
                        <span>RAINFALL</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-white mt-1.5">
                        {report.analysis.rainfall !== null
                          ? `${report.analysis.rainfall.toFixed(0)}mm`
                          : "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-1">
                        Cover:{" "}
                        {report.analysis.current_coverage_percent !== null
                          ? `${report.analysis.current_coverage_percent.toFixed(1)}%`
                          : "N/A"}
                      </div>
                    </div>
                  </div>

                  {/* Contributing Risk Factors + Reforestation Estimate */}
                  <div className="px-5 py-4 border-t border-white/[0.08] grid grid-cols-1 md:grid-cols-12 gap-4 bg-[#0e1411]">
                    <div className="md:col-span-7 space-y-1.5">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                        Risk Contributing Signals ({report.risk.source})
                      </div>
                      <ul className="space-y-1 text-xs text-zinc-300">
                        {report.risk.factors.map((f, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="md:col-span-5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3.5 flex items-center gap-3">
                      <TreeEvergreen size={28} weight="duotone" className="text-emerald-400 shrink-0" />
                      <div>
                        <div className="text-[11px] font-mono text-emerald-300">
                          REFORESTATION TARGET ({report.tree_data.target}%)
                        </div>
                        <div className="text-xl font-mono font-semibold tabular-nums text-white">
                          {report.tree_data.minimum_trees !== null
                            ? `${report.tree_data.minimum_trees.toLocaleString()} trees`
                            : "Target met / N/A"}
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          Gap: {report.tree_data.coverage_gap ?? 0}% · 5yr loss:{" "}
                          {report.analysis.historical_forest_loss.recent_5_year_loss_hectares.toLocaleString()}{" "}
                          ha
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: DeepSeek AI Copilot */}
          <div className="xl:col-span-5">
            {report ? (
              <AiCopilotPanel
                key={report.analysis_id}
                report={report}
                availableModels={availableModels}
              />
            ) : (
              <div className="rounded-2xl border border-white/[0.08] bg-[#111714] p-6 space-y-4">
                <div className="text-xs font-mono uppercase tracking-wider text-emerald-400">
                  DeepSeek Forest Copilot
                </div>
                <h3 className="text-base font-semibold text-white">
                  Ready for Grounded Geospatial Analysis
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  Select a Bangladesh forest area or draw a custom polygon on the
                  map, then click <strong className="text-zinc-200">Analyze Area</strong>.
                  EcoGuard computes real Sentinel-2 NDVI/EVI/NBR, CHIRPS rainfall,
                  and Hansen historical loss, then passes that grounded telemetry to{" "}
                  <span className="font-mono text-zinc-200">
                    deepseek-v4.1-flash-1017
                  </span>{" "}
                  (with automatic{" "}
                  <span className="font-mono text-zinc-200">
                    deepseek-v4.1-flash:free
                  </span>{" "}
                  failover).
                </p>
                <div className="border-t border-white/[0.08] pt-4 text-xs font-mono text-zinc-500 space-y-1">
                  <div>Endpoint: https://tokenharbor.ai/v1</div>
                  <div>Languages: English &amp; বাংলা</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Full-Width Charts when report exists */}
        {report && !loading && (
          <TelemetryCharts
            monthlyNdvi={report.analysis.monthly_ndvi}
            annualLoss={report.analysis.historical_forest_loss.annual_loss}
            landcoverClasses={report.analysis.landcover_classes}
          />
        )}
      </div>
    </AppShell>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] bg-[#0a0e0c] p-8 text-xs font-mono text-zinc-400">
          Loading Satellite Explorer...
        </div>
      }
    >
      <ExplorerContent />
    </Suspense>
  );
}
