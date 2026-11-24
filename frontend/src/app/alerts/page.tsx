"use client";

import React, { useEffect, useState } from "react";
import {
  BellRinging,
  Check,
  DownloadSimple,
} from "@phosphor-icons/react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import type { AlertItem } from "@/lib/types";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const res = await api.listAlerts({
        status: statusFilter || undefined,
        risk_level: riskFilter || undefined,
      });
      setAlerts(res.alerts);
      const draft: Record<number, string> = {};
      res.alerts.forEach((a) => {
        draft[a.id] = a.notes || "";
      });
      setNotesDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [statusFilter, riskFilter]);

  const updateAlert = async (
    id: number,
    updates: { status?: string; notes?: string }
  ) => {
    setSavingId(id);
    setError(null);
    try {
      const res = await api.updateAlert(id, updates);
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? res.alert : a))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <AppShell
      title="Alert Triage Console"
      subtitle="Track MEDIUM and HIGH deforestation alerts from detection through field resolution."
      actions={
        <button
          type="button"
          onClick={() => api.downloadAlertsCsv().catch((e) => setError(e.message))}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/[0.12] bg-[#111714] hover:bg-white/[0.06] text-xs font-medium text-zinc-200 transition-colors active:scale-[0.98]"
        >
          <DownloadSimple size={15} />
          <span>Export CSV</span>
        </button>
      }
    >
      <div className="space-y-5">
        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded-xl bg-[#111714] border border-white/[0.12] px-3 py-2 text-xs text-zinc-200"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>

          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            aria-label="Filter by risk level"
            className="rounded-xl bg-[#111714] border border-white/[0.12] px-3 py-2 text-xs text-zinc-200"
          >
            <option value="">All Risk Levels</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
          </select>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-white/[0.08] bg-[#111714] overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <BellRinging size={28} className="mx-auto text-zinc-600" />
              <div className="text-sm font-medium text-zinc-300">
                No matching alerts
              </div>
              <p className="text-xs text-zinc-500">
                Alerts are automatically created whenever a satellite scan returns MEDIUM or HIGH risk.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center"
                >
                  <div className="lg:col-span-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                          alert.risk_level === "HIGH"
                            ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                            : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                        }`}
                      >
                        {alert.risk_level}
                      </span>
                      <span className="text-xs font-mono text-zinc-500">
                        #{alert.id}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-white">
                      {alert.location}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400">
                      NDVI {alert.ndvi?.toFixed(3) ?? "N/A"} · Loss{" "}
                      {alert.vegetation_loss?.toFixed(1) ?? "N/A"}% · Email:{" "}
                      {alert.email_status || "N/A"}
                    </div>
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                      Triage Status
                    </label>
                    <select
                      value={alert.status}
                      disabled={savingId === alert.id}
                      onChange={(e) =>
                        updateAlert(alert.id, { status: e.target.value })
                      }
                      className="w-full rounded-xl bg-[#0a0e0c] border border-white/[0.12] px-3 py-2 text-xs font-mono text-zinc-200"
                    >
                      <option value="open">OPEN</option>
                      <option value="investigating">INVESTIGATING</option>
                      <option value="resolved">RESOLVED</option>
                    </select>
                  </div>

                  <div className="lg:col-span-5">
                    <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                      Field Verification Notes
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={notesDraft[alert.id] ?? ""}
                        onChange={(e) =>
                          setNotesDraft((prev) => ({
                            ...prev,
                            [alert.id]: e.target.value,
                          }))
                        }
                        placeholder="Add ranger report or verification outcome..."
                        className="flex-1 rounded-xl bg-[#0a0e0c] border border-white/[0.12] px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
                      />
                      <button
                        type="button"
                        disabled={savingId === alert.id}
                        onClick={() =>
                          updateAlert(alert.id, { notes: notesDraft[alert.id] || "" })
                        }
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-500/25 active:scale-[0.98]"
                      >
                        <Check size={14} />
                        <span>Save</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
