"use client";

import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AnnualLossPoint,
  LandCoverClass,
  MonthlyNdviPoint,
} from "@/lib/types";

interface TelemetryChartsProps {
  monthlyNdvi: MonthlyNdviPoint[];
  annualLoss: AnnualLossPoint[];
  landcoverClasses: LandCoverClass[];
}

export default function TelemetryCharts({
  monthlyNdvi,
  annualLoss,
  landcoverClasses,
}: TelemetryChartsProps) {
  const validMonthly = (monthlyNdvi || []).filter((d) => d.ndvi !== null);
  const topLandcover = (landcoverClasses || [])
    .filter((c) => c.percentage > 0)
    .slice(0, 7);

  return (
    <div className="space-y-6">
      {/* 12-Month NDVI Trend + Hansen Loss in Asymmetric Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 rounded-2xl border border-white/[0.08] bg-[#111714] p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                12-Month Sentinel-2 NDVI Trajectory
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Monthly cloud-masked greenness profile to separate seasonal cycles from clearing
              </p>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">
              NDVI (-0.2 to 0.9)
            </span>
          </div>

          {validMonthly.length > 0 ? (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={validMonthly}>
                  <defs>
                    <linearGradient id="ndviGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#98a89f", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={{ fill: "#98a89f", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0e1310",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="ndvi"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#ndviGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-60 flex items-center justify-center text-xs text-zinc-500 border border-dashed border-white/[0.08] rounded-xl">
              Monthly NDVI series will populate when extended Sentinel-2 telemetry is available.
            </div>
          )}
        </div>

        <div className="xl:col-span-5 rounded-2xl border border-white/[0.08] bg-[#111714] p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Hansen Annual Forest Loss
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Gross canopy loss (hectares, 2001-2025)
              </p>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">HECTARES</span>
          </div>

          {annualLoss && annualLoss.length > 0 ? (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={annualLoss}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: "#98a89f", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fill: "#98a89f", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0e1310",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="loss_area_hectares"
                    name="Loss (ha)"
                    fill="#f59e0b"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-60 flex items-center justify-center text-xs text-zinc-500 border border-dashed border-white/[0.08] rounded-xl">
              No Hansen annual forest-loss series recorded for this AOI.
            </div>
          )}
        </div>
      </div>

      {/* ESA WorldCover Land-Cover Breakdown */}
      {topLandcover.length > 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-[#111714] p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                ESA WorldCover Land-Cover Distribution (10m)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Distinguishes tree cover, cropland, wetlands, and built-up land before reforestation planning
              </p>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">
              WORLDCOVER v200
            </span>
          </div>

          <div className="space-y-3">
            {topLandcover.map((cls) => (
              <div key={cls.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-200 font-medium">{cls.name}</span>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {cls.area_hectares.toLocaleString()} ha ({cls.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500/80 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(2, cls.percentage))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
