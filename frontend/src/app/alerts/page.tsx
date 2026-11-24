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
      title="Deforestation Alert Triage"
      subtitle="Track MEDIUM and HIGH forest-loss alerts from satellite detection through ranger verification."
      actions={
        <button
          type="button"
          onClick={() => api.downloadAlertsCsv().catch((e) => setError(e.message))}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-950/15 bg-white hover:bg-[#edf5ef] text-xs font-semibold text-[#0b2419] transition-colors active:scale-[0.98]"
        >
          <DownloadSimple size={15} className="text-[#0f5c3e]" />
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
            className="rounded-xl bg-white border border-emerald-950/15 px-3.5 py-2 text-xs font-medium text-[#0b2419] shadow-2xs focus:outline-none focus:border-[#0f5c3e]"
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
            className="rounded-xl bg-white border border-emerald-950/15 px-3.5 py-2 text-xs font-medium text-[#0b2419] shadow-2xs focus:outline-none focus:border-[#0f5c3e]"
          >
            <option value="">All Risk Levels</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
          </select>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
            {error}
          </div>
        )}

        <div className="rounded-2xl forest-card overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-[#edf5ef] animate-pulse" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <BellRinging size={28} className="mx-auto text-emerald-700/45" />
              <div className="text-sm font-semibold text-[#0b2419]">
                No matching deforestation alerts
              </div>
              <p className="text-xs text-[#557464]">
                Alerts are automatically logged whenever a satellite forest scan returns MEDIUM or HIGH risk.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-emerald-950/8">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center hover:bg-[#fafdfb] transition-colors"
                >
                  <div className="lg:col-span-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-[10px] font-mono font-semibold ${
                          alert.risk_level === "HIGH"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }`}
                      >
                        {alert.risk_level}
                      </span>
                      <span className="text-xs font-mono text-[#5c7a6b]">
                        #{alert.id}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-[#0b2419]">
                      {alert.location}
                    </div>
                    <div className="text-[11px] font-mono text-[#557464]">
                      NDVI {alert.ndvi?.toFixed(3) ?? "N/A"} · Loss{" "}
                      {alert.vegetation_loss?.toFixed(1) ?? "N/A"}% · Email:{" "}
                      {alert.email_status || "N/A"}
                    </div>
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block text-[10px] font-mono uppercase text-[#5c7a6b] mb-1">
                      Triage Status
                    </label>
                    <select
                      value={alert.status}
                      disabled={savingId === alert.id}
                      onChange={(e) =>
                        updateAlert(alert.id, { status: e.target.value })
                      }
                      className="w-full rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3 py-2 text-xs font-mono font-medium text-[#0b2419] focus:outline-none focus:border-[#0f5c3e]"
                    >
                      <option value="open">OPEN</option>
                      <option value="investigating">INVESTIGATING</option>
                      <option value="resolved">RESOLVED</option>
                    </select>
                  </div>

                  <div className="lg:col-span-5">
                    <label className="block text-[10px] font-mono uppercase text-[#5c7a6b] mb-1">
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
                        className="flex-1 rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3 py-2 text-xs text-[#0b2419] placeholder:text-[#7c9688] focus:outline-none focus:bg-white focus:border-[#0f5c3e]"
                      />
                      <button
                        type="button"
                        disabled={savingId === alert.id}
                        onClick={() =>
                          updateAlert(alert.id, { notes: notesDraft[alert.id] || "" })
                        }
                        className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-[#0f5c3e] hover:bg-[#0b4730] text-white text-xs font-semibold transition-colors active:scale-[0.98]"
                      >
                        <Check size={14} weight="bold" />
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
