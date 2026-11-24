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
    <div className="h-[520px] rounded-2xl forest-card animate-pulse" />
  ),
});

function ExplorerContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("location") || "";

  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null);

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
      setError("Enter a Bangladesh forest location or draw a custom polygon on the map.");
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
      setSavedNotice("Added forest zone to Watchlists.");
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
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : report?.risk.risk_level === "MEDIUM"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-emerald-50 text-emerald-800 border-emerald-200";

  return (
    <AppShell
      title="Satellite & Forest Polygon Explorer"
      subtitle="Search any Bangladesh forest or draw a custom canopy polygon for Sentinel-2 NDVI, Hansen deforestation loss, and DeepSeek AI analysis."
      bannerImage="/forests/sundarbans-orbit.jpg"
      bannerRegion="Sentinel-2 Orbital Canopy Intelligence · Bangladesh"
      actions={
        report && (
          <>
            <button
              type="button"
              onClick={handleSaveWatchlist}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-950/15 bg-white hover:bg-[#edf5ef] text-xs font-semibold text-[#0b2419] transition-colors active:scale-[0.98]"
            >
              <BookmarkSimple size={15} className="text-[#0f5c3e]" />
              <span>Save Watchlist</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0f5c3e] hover:bg-[#0b4730] text-white font-semibold text-xs shadow-sm transition-colors active:scale-[0.98]"
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
          className="rounded-2xl forest-card p-4 flex flex-col lg:flex-row gap-3 items-stretch lg:items-center"
        >
          <div className="relative flex-1">
            <MagnifyingGlass
              size={17}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5c7a6b]"
            />
            <input
              type="text"
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="Search Bangladesh forest or district (e.g., Sundarbans, Lawachara, Ratargul, Bandarban)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#f7fbf8] border border-emerald-950/15 text-sm text-[#0b2419] placeholder:text-[#7c9688] focus:outline-none focus:bg-white focus:border-[#0f5c3e] focus:ring-2 focus:ring-emerald-600/15 transition-all"
            />

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-emerald-950/15 bg-white shadow-xl shadow-emerald-950/10 overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={`${s.name}-${s.latitude}`}
                    type="button"
                    onClick={() => {
                      setQuery(s.name);
                      setSelectedLocation(s);
                      setActivePolygon(null);
                      setShowSuggestions(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-[#0b2419] hover:bg-[#edf5ef] border-b border-emerald-950/8 last:border-b-0 transition-colors"
                  >
                    <div className="font-semibold truncate">{s.name}</div>
                    <div className="font-mono text-[10px] text-[#5c7a6b]">
                      {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {activePolygon && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0f5c3e] text-xs font-mono font-medium">
                <Polygon size={14} />
                <span>Custom Polygon Active</span>
              </span>
            )}

            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              aria-label="DeepSeek Model"
              className="bg-[#f7fbf8] border border-emerald-950/15 rounded-xl px-3 py-2.5 text-xs font-mono text-[#0b2419] focus:outline-none focus:border-[#0f5c3e]"
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
              className="bg-[#f7fbf8] border border-emerald-950/15 rounded-xl px-3 py-2.5 text-xs font-medium text-[#0b2419] focus:outline-none focus:border-[#0f5c3e]"
            >
              <option value="en">Briefing: English</option>
              <option value="bn">Briefing: বাংলা</option>
            </select>

            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-[#0f5c3e] hover:bg-[#0b4730] text-white font-semibold text-sm shadow-sm shadow-emerald-950/15 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Scanning Canopy..." : "Analyze Forest"}
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-800">
            {error}
          </div>
        )}

        {savedNotice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs sm:text-sm text-emerald-900">
            {savedNotice}
          </div>
        )}

        {/* Map + DeepSeek Copilot Asymmetric Split */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-7 space-y-6">
            <SatelliteMap
              boundingBox={report?.location.boundingbox ?? selectedLocation?.boundingbox}
              focusLocation={
                report
                  ? {
                      name: report.location.name,
                      latitude: report.location.latitude,
                      longitude: report.location.longitude,
                      boundingbox: report.location.boundingbox,
                    }
                  : selectedLocation
              }
              ndviTileUrl={report?.analysis.ndvi_tile_url}
              landcoverTileUrl={report?.analysis.landcover_tile_url}
              hansenTileUrl={report?.analysis.hansen_loss_tile_url}
              activePolygon={activePolygon}
              onPolygonChange={setActivePolygon}
            />

            {loading && (
              <div className="rounded-2xl forest-card p-6 space-y-3">
                <div className="h-4 w-56 rounded bg-emerald-950/10 animate-pulse" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="h-20 rounded-xl bg-[#edf5ef] animate-pulse"
                    />
                  ))}
                </div>
              </div>
            )}

            {report && !loading && (
              <div className="space-y-6">
                {/* Risk Header & Multi-Index Telemetry */}
                <div className="rounded-2xl forest-card overflow-hidden">
                  <div className="px-5 py-4 border-b border-emerald-950/10 bg-[#fafdfb] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-mono text-[#557464]">
                        {report.location.boundary_type} · {report.analysis.analysis_start} to{" "}
                        {report.analysis.analysis_end}
                      </div>
                      <h2 className="text-base font-semibold text-[#0b2419] mt-0.5">
                        {report.location.name}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2.5">
                      {report.risk.confidence !== null && (
                        <span className="text-xs font-mono text-[#557464]">
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-emerald-950/10">
                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#557464]">
                        <Leaf size={14} weight="fill" className="text-emerald-600" />
                        <span>MEAN NDVI</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-[#0b2419] mt-1.5">
                        {report.analysis.current_ndvi?.toFixed(3) ?? "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-[#5c7a6b] mt-1">
                        YoY:{" "}
                        {report.analysis.yoy_ndvi_change !== null
                          ? `${report.analysis.yoy_ndvi_change >= 0 ? "+" : ""}${report.analysis.yoy_ndvi_change.toFixed(3)}`
                          : "N/A"}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#557464]">
                        <ShieldWarning size={14} weight="fill" className="text-amber-600" />
                        <span>60D LOSS</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-[#0b2419] mt-1.5">
                        {report.analysis.vegetation_loss !== null
                          ? `${report.analysis.vegetation_loss.toFixed(1)}%`
                          : "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-[#5c7a6b] mt-1">
                        EVI: {report.analysis.current_evi?.toFixed(3) ?? "N/A"}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#557464]">
                        <Fire size={14} weight="fill" className="text-rose-600" />
                        <span>BURN dNBR</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-[#0b2419] mt-1.5">
                        {report.analysis.dnbr !== null
                          ? report.analysis.dnbr.toFixed(3)
                          : "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-[#5c7a6b] mt-1">
                        NBR: {report.analysis.current_nbr?.toFixed(3) ?? "N/A"}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#557464]">
                        <CloudRain size={14} weight="fill" className="text-sky-600" />
                        <span>RAINFALL</span>
                      </div>
                      <div className="text-2xl font-mono font-semibold tabular-nums text-[#0b2419] mt-1.5">
                        {report.analysis.rainfall !== null
                          ? `${report.analysis.rainfall.toFixed(0)}mm`
                          : "N/A"}
                      </div>
                      <div className="text-[11px] font-mono text-[#5c7a6b] mt-1">
                        Cover:{" "}
                        {report.analysis.current_coverage_percent !== null
                          ? `${report.analysis.current_coverage_percent.toFixed(1)}%`
                          : "N/A"}
                      </div>
                    </div>
                  </div>

                  {/* Contributing Risk Factors + Reforestation Estimate */}
                  <div className="px-5 py-4 border-t border-emerald-950/10 grid grid-cols-1 md:grid-cols-12 gap-4 bg-[#f7fbf8]">
                    <div className="md:col-span-7 space-y-1.5">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-[#557464]">
                        Deforestation Risk Signals ({report.risk.source})
                      </div>
                      <ul className="space-y-1 text-xs text-[#234234]">
                        {report.risk.factors.map((f, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="md:col-span-5 rounded-xl border border-emerald-200 bg-emerald-50/75 p-3.5 flex items-center gap-3">
                      <TreeEvergreen size={28} weight="duotone" className="text-[#0f5c3e] shrink-0" />
                      <div>
                        <div className="text-[11px] font-mono font-semibold text-[#0f5c3e]">
                          REFORESTATION TARGET ({report.tree_data.target}%)
                        </div>
                        <div className="text-xl font-mono font-semibold tabular-nums text-[#0b2419]">
                          {report.tree_data.minimum_trees !== null
                            ? `${report.tree_data.minimum_trees.toLocaleString()} trees`
                            : "Target met / N/A"}
                        </div>
                        <div className="text-[11px] text-[#466355]">
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
              <div className="rounded-2xl forest-card overflow-hidden">
                <div className="relative h-28 w-full overflow-hidden">
                  <img
                    src="/forests/lawachara.jpg"
                    alt="Bangladesh rainforest canopy"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#082419]/88 via-[#082419]/40 to-transparent" />
                  <div className="absolute bottom-3 left-5 right-5">
                    <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-emerald-200">
                      DeepSeek Forest Copilot
                    </div>
                    <h3 className="text-base font-semibold text-white">
                      Ready for Grounded Canopy Intelligence
                    </h3>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <p className="text-xs sm:text-sm text-[#3d5c4d] leading-relaxed">
                    Select a Bangladesh forest reserve or draw a custom polygon on the
                    satellite map, then click{" "}
                    <strong className="text-[#0b2419]">Analyze Forest</strong>.
                    EcoGuard computes live Sentinel-2 NDVI/EVI/NBR, CHIRPS rainfall,
                    and Hansen deforestation loss, passing grounded telemetry to{" "}
                    <span className="font-mono text-[#0f5c3e] font-medium">
                      deepseek-v4.1-flash-1017
                    </span>{" "}
                    (with automatic{" "}
                    <span className="font-mono text-[#0f5c3e] font-medium">
                      deepseek-v4.1-flash:free
                    </span>{" "}
                    failover).
                  </p>
                  <div className="border-t border-emerald-950/10 pt-3.5 text-xs font-mono text-[#5c7a6b] space-y-1">
                    <div>Endpoint: https://tokenharbor.ai/v1</div>
                    <div>Languages: English &amp; বাংলা</div>
                  </div>
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
        <div className="min-h-[100dvh] forest-canvas-bg p-8 text-xs font-mono text-[#557464]">
          Entering Satellite Forest Explorer...
        </div>
      }
    >
      <ExplorerContent />
    </Suspense>
  );
}
