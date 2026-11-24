"use client";

import React from "react";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";

const ROUTE_DEPTH_META: Record<string, { depth: number; label: string }> = {
  "/login": { depth: 0, label: "Canopy Gate" },
  "/": { depth: 1, label: "Layer 01 · Canopy Overview" },
  "/explorer": { depth: 2, label: "Layer 02 · Deep Satellite Scan" },
  "/watchlists": { depth: 3, label: "Layer 03 · Protected Reserves" },
  "/alerts": { depth: 4, label: "Layer 04 · Deforestation Triage" },
};

export default function ForestTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const meta =
    ROUTE_DEPTH_META[pathname] ||
    Object.entries(ROUTE_DEPTH_META).find(
      ([route]) => route !== "/" && pathname.startsWith(route)
    )?.[1] ||
    { depth: 1, label: "Bangladesh Forest Intelligence" };

  return (
    <div className="relative min-h-[100dvh] overflow-x-clip">
      {/* Top canopy emerald sunlight progress beam on route entry */}
      <motion.div
        key={`beam-${pathname}`}
        aria-hidden="true"
        initial={{ scaleX: 0, opacity: 0.95 }}
        animate={{ scaleX: 1, opacity: 0 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: "left center" }}
        className="pointer-events-none fixed top-0 left-0 right-0 z-50 h-[3px] bg-gradient-to-r from-[#0f5c3e] via-[#10b981] to-[#6ee7b7]"
      />

      {/* Subtle canopy mist parting effect: evokes stepping deeper into forest layers */}
      <motion.div
        key={`veil-${pathname}`}
        aria-hidden="true"
        initial={{ opacity: 0.34, scale: 1.02 }}
        animate={{ opacity: 0, scale: 1.18 }}
        transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none fixed inset-0 z-40"
        style={{
          background:
            meta.depth === 0
              ? "radial-gradient(circle at 30% 45%, rgba(15, 92, 62, 0.24), transparent 65%)"
              : "radial-gradient(circle at 50% 35%, transparent 25%, rgba(15, 92, 62, 0.18) 100%)",
        }}
      />

      {/* Main page depth-glide: smooth forward zoom into the canopy */}
      <motion.div
        key={pathname}
        initial={{
          opacity: 0,
          scale: 0.972,
          y: 12,
          filter: "blur(4px)",
        }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
          filter: "blur(0px)",
        }}
        transition={{
          duration: 0.52,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="min-h-[100dvh]"
      >
        {children}
      </motion.div>
    </div>
  );
}
