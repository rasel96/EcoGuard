"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookmarkSimple,
  Plus,
  Trash,
  TreeEvergreen,
} from "@phosphor-icons/react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import type { WatchlistItem } from "@/lib/types";

const BANGLADESH_PRESETS = [
  { name: "Sundarbans, Khulna, Bangladesh", lat: 22.0167, lon: 89.1833, target: 75 },
  { name: "Lawachara National Park, Moulvibazar, Bangladesh", lat: 24.331, lon: 91.787, target: 70 },
  { name: "Madhupur National Park, Tangail, Bangladesh", lat: 24.696, lon: 90.068, target: 65 },
  { name: "Ratargul Swamp Forest, Sylhet, Bangladesh", lat: 25.013, lon: 91.924, target: 70 },
  { name: "Rangamati, Chittagong, Bangladesh", lat: 22.653, lon: 92.178, target: 65 },
];

export default function WatchlistsPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(60);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWatchlists = async () => {
    try {
      const res = await api.listWatchlists();
      setItems(res.watchlists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watchlists");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlists();
  }, []);

  const addRegion = async (payload: {
    name: string;
    latitude?: number;
    longitude?: number;
    target_coverage?: number;
  }) => {
    setSubmitting(true);
    setError(null);
    try {
      await api.addWatchlist(payload);
      setName("");
      await loadWatchlists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add watchlist");
    } finally {
      setSubmitting(false);
    }
  };

  const removeItem = async (id: number) => {
    try {
      await api.deleteWatchlist(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <AppShell
      title="Protected Forest Watchlists"
      subtitle="Save critical Bangladesh reserves, mangroves, and hill districts for recurring deforestation scans."
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Saved List */}
        <section className="lg:col-span-7 rounded-2xl forest-card overflow-hidden">
          <div className="px-5 py-4 border-b border-emerald-950/10 bg-[#fafdfb] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#0b2419]">
              Active Monitored Forest Zones ({items.length})
            </h2>
            <span className="text-[11px] font-mono text-[#5c7a6b]">
              ONE-CLICK RESCAN
            </span>
          </div>

          {error && (
            <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              {error}
            </div>
          )}

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-[#edf5ef] animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <BookmarkSimple size={28} className="mx-auto text-emerald-700/45" />
              <div className="text-sm font-semibold text-[#0b2419]">
                Your forest watchlist is empty
              </div>
              <p className="text-xs text-[#557464]">
                Add one of the Bangladesh reserve presets or enter a custom forest region on the right.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-emerald-950/8">
              {items.map((wl) => (
                <div
                  key={wl.id}
                  className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#f5faf6] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#0b2419]">
                      {wl.name}
                    </div>
                    <div className="text-[11px] font-mono text-[#5c7a6b] mt-0.5">
                      Target {wl.target_coverage}% · Last Risk:{" "}
                      {wl.last_risk || "Not scanned"} · NDVI{" "}
                      {wl.last_ndvi?.toFixed(3) ?? "N/A"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/explorer?location=${encodeURIComponent(wl.name)}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#edf5ef] border border-emerald-200 text-[#0f5c3e] text-xs font-semibold hover:bg-[#0f5c3e] hover:text-white transition-colors"
                    >
                      <span>Scan</span>
                      <ArrowRight size={13} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeItem(wl.id)}
                      aria-label="Delete watchlist item"
                      className="p-1.5 rounded-lg text-[#5c7a6b] hover:text-rose-700 hover:bg-rose-50 transition-colors"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Add Custom + Presets */}
        <div className="lg:col-span-5 space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              addRegion({ name: name.trim(), target_coverage: target });
            }}
            className="rounded-2xl forest-card p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-[#0b2419]">
              Add Custom Forest Region
            </h3>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#1e3d2f]">
                Location Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Bandarban, Bangladesh"
                className="rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3.5 py-2.5 text-sm text-[#0b2419] placeholder:text-[#7c9688] focus:outline-none focus:bg-white focus:border-[#0f5c3e]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#1e3d2f]">
                Canopy Coverage Target (%)
              </label>
              <input
                type="number"
                min={10}
                max={95}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                className="rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3.5 py-2.5 text-sm font-mono text-[#0b2419] focus:outline-none focus:bg-white focus:border-[#0f5c3e]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0f5c3e] hover:bg-[#0b4730] text-white font-semibold text-sm py-2.5 shadow-sm transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              <Plus size={15} weight="bold" />
              <span>{submitting ? "Saving..." : "Add to Watchlist"}</span>
            </button>
          </form>

          <section className="rounded-2xl forest-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <TreeEvergreen size={16} weight="duotone" className="text-[#0f5c3e]" />
              <h3 className="text-sm font-semibold text-[#0b2419]">
                Priority Bangladesh Forest Presets
              </h3>
            </div>
            <div className="space-y-2">
              {BANGLADESH_PRESETS.map((preset) => (
                <div
                  key={preset.name}
                  className="flex items-center justify-between gap-2 rounded-xl border border-emerald-950/10 bg-[#f7fbf8] px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#0b2419] truncate">
                      {preset.name}
                    </div>
                    <div className="text-[10px] font-mono text-[#5c7a6b]">
                      {preset.lat.toFixed(3)}, {preset.lon.toFixed(3)} · Target{" "}
                      {preset.target}%
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      addRegion({
                        name: preset.name,
                        latitude: preset.lat,
                        longitude: preset.lon,
                        target_coverage: preset.target,
                      })
                    }
                    className="px-3 py-1 rounded-lg bg-white border border-emerald-950/12 hover:bg-[#0f5c3e] hover:text-white hover:border-[#0f5c3e] text-xs font-semibold text-[#0f5c3e] transition-colors"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
