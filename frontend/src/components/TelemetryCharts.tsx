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
        <div className="xl:col-span-7 rounded-2xl forest-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#0b2419]">
                12-Month Sentinel-2 Canopy NDVI Trajectory
              </h3>
              <p className="text-xs text-[#557464] mt-0.5">
                Monthly cloud-masked greenness profile separating monsoon cycles from deforestation
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#5c7a6b]">
              NDVI (-0.2 to 0.9)
            </span>
          </div>

          {validMonthly.length > 0 ? (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={validMonthly}>
                  <defs>
                    <linearGradient id="ndviGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(15,92,62,0.09)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#466355", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={{ fill: "#466355", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid rgba(15,92,62,0.16)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "#0b2419",
                      boxShadow: "0 10px 25px -10px rgba(11,36,25,0.18)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="ndvi"
                    stroke="#0f5c3e"
                    strokeWidth={2.4}
                    fill="url(#ndviGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-60 flex items-center justify-center text-xs text-[#5c7a6b] border border-dashed border-emerald-950/15 rounded-xl bg-[#f7fbf8]">
              Monthly NDVI series will populate when extended Sentinel-2 telemetry is available.
            </div>
          )}
        </div>

        <div className="xl:col-span-5 rounded-2xl forest-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#0b2419]">
                Hansen Annual Deforestation Loss
              </h3>
              <p className="text-xs text-[#557464] mt-0.5">
                Gross tree-cover loss (hectares, 2001-2025)
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#5c7a6b]">HECTARES</span>
          </div>

          {annualLoss && annualLoss.length > 0 ? (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={annualLoss}>
                  <CartesianGrid stroke="rgba(15,92,62,0.09)" vertical={false} />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: "#466355", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fill: "#466355", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid rgba(15,92,62,0.16)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "#0b2419",
                      boxShadow: "0 10px 25px -10px rgba(11,36,25,0.18)",
                    }}
                  />
                  <Bar
                    dataKey="loss_area_hectares"
                    name="Forest Loss (ha)"
                    fill="#d97706"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-60 flex items-center justify-center text-xs text-[#5c7a6b] border border-dashed border-emerald-950/15 rounded-xl bg-[#f7fbf8]">
              No Hansen annual forest-loss series recorded for this AOI.
            </div>
          )}
        </div>
      </div>

      {/* ESA WorldCover Land-Cover Breakdown */}
      {topLandcover.length > 0 && (
        <div className="rounded-2xl forest-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#0b2419]">
                ESA WorldCover Land-Cover Distribution (10m)
              </h3>
              <p className="text-xs text-[#557464] mt-0.5">
                Distinguishes tree cover, cropland, wetlands, and built-up land before reforestation planning
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#5c7a6b]">
              WORLDCOVER v200
            </span>
          </div>

          <div className="space-y-3">
            {topLandcover.map((cls) => (
              <div key={cls.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#0b2419] font-medium">{cls.name}</span>
                  <span className="font-mono tabular-nums text-[#466355]">
                    {cls.area_hectares.toLocaleString()} ha ({cls.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-[#edf5ef] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#0f5c3e] to-[#10b981] transition-all duration-500"
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
