"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookmarkSimple,
  Plus,
  Trash,
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
      title="Forest Watchlists"
      subtitle="Save critical Bangladesh reserves and districts for rapid recurring satellite checks."
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Saved List */}
        <section className="lg:col-span-7 rounded-2xl border border-white/[0.08] bg-[#111714] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.08]">
            <h2 className="text-sm font-semibold text-white">
              Active Monitored Zones ({items.length})
            </h2>
          </div>

          {error && (
            <div className="m-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <BookmarkSimple size={28} className="mx-auto text-zinc-600" />
              <div className="text-sm font-medium text-zinc-300">
                Your watchlist is empty
              </div>
              <p className="text-xs text-zinc-500">
                Add one of the Bangladesh reserve presets or enter a custom location on the right.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {items.map((wl) => (
                <div
                  key={wl.id}
                  className="px-5 py-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-100">
                      {wl.name}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                      Target {wl.target_coverage}% · Last Risk:{" "}
                      {wl.last_risk || "Not scanned"} · NDVI{" "}
                      {wl.last_ndvi?.toFixed(3) ?? "N/A"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/explorer?location=${encodeURIComponent(wl.name)}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-500/25"
                    >
                      <span>Scan</span>
                      <ArrowRight size={13} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeItem(wl.id)}
                      aria-label="Delete watchlist item"
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
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
            className="rounded-2xl border border-white/[0.08] bg-[#111714] p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-white">
              Add Custom Region
            </h3>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400">Location Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Bandarban, Bangladesh"
                className="rounded-xl bg-[#0a0e0c] border border-white/[0.12] px-3.5 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400">
                Green Coverage Target (%)
              </label>
              <input
                type="number"
                min={10}
                max={95}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                className="rounded-xl bg-[#0a0e0c] border border-white/[0.12] px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm py-2.5 transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              <Plus size={15} weight="bold" />
              <span>{submitting ? "Saving..." : "Add to Watchlist"}</span>
            </button>
          </form>

          <section className="rounded-2xl border border-white/[0.08] bg-[#111714] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Priority Bangladesh Forest Presets
            </h3>
            <div className="space-y-2">
              {BANGLADESH_PRESETS.map((preset) => (
                <div
                  key={preset.name}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#0d120f] px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-200 truncate">
                      {preset.name}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500">
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
                    className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-emerald-500/20 hover:text-emerald-300 text-xs text-zinc-300 transition-colors"
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
