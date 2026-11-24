"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  BellRinging,
  BookmarkSimple,
  Compass,
  Cpu,
  Leaf,
  List,
  SignOut,
  SquaresFour,
  TreeEvergreen,
  X,
} from "@phosphor-icons/react";
import { api, getStoredToken, setStoredToken } from "@/lib/api";
import type { HealthResponse, User } from "@/lib/types";

interface AppShellProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  bannerImage?: string;
  bannerRegion?: string;
}

const NAV_ITEMS = [
  {
    href: "/",
    label: "Canopy Overview",
    depth: "01",
    caption: "National summary",
    icon: SquaresFour,
    banner: "/forests/sundarbans.jpg",
    region: "Sundarbans Mangrove Reserve · Khulna",
  },
  {
    href: "/explorer",
    label: "Satellite Explorer",
    depth: "02",
    caption: "Deep polygon scan",
    icon: Compass,
    banner: "/forests/lawachara.jpg",
    region: "Satchari & Lawachara Rainforest · Sylhet",
  },
  {
    href: "/watchlists",
    label: "Protected Reserves",
    depth: "03",
    caption: "Monitored watchlists",
    icon: BookmarkSimple,
    banner: "/forests/ratargul.jpg",
    region: "Ratargul Freshwater Swamp · Sylhet",
  },
  {
    href: "/alerts",
    label: "Deforestation Alerts",
    depth: "04",
    caption: "Field risk triage",
    icon: BellRinging,
    banner: "/forests/hilltracts.jpg",
    region: "Chittagong Hill Tracts · Bandarban",
  },
];

export default function AppShell({
  children,
  title,
  subtitle,
  actions,
  bannerImage,
  bannerRegion,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeNav =
    NAV_ITEMS.find((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
    ) || NAV_ITEMS[0];

  const heroImage = bannerImage || activeNav.banner;
  const heroRegion = bannerRegion || activeNav.region;

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [meRes, healthRes] = await Promise.all([
          api.me(),
          api.health().catch(() => null),
        ]);
        if (!active) return;
        setUser(meRes.user);
        setHealth(healthRes);
        setAuthChecked(true);
      } catch {
        if (!active) return;
        setStoredToken(null);
        router.replace("/login");
      }
    }

    if (!getStoredToken()) {
      bootstrap();
    } else {
      bootstrap();
    }

    return () => {
      active = false;
    };
  }, [router]);

  const handleLogout = async () => {
    await api.logout();
    router.replace("/login");
  };

  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] forest-canvas-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 animate-pulse" />
            <div className="h-4 w-44 rounded-lg bg-emerald-950/10 animate-pulse" />
          </div>
          <div className="h-28 w-full rounded-2xl bg-white border border-emerald-950/10 animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 rounded-2xl bg-white border border-emerald-950/10 animate-pulse" />
            <div className="h-16 rounded-2xl bg-white border border-emerald-950/10 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row forest-canvas-bg text-[#0b2419]">
      {/* Desktop Sidebar — Clean White with Botanical Trail */}
      <aside className="hidden lg:flex lg:flex-col lg:w-72 lg:shrink-0 border-r border-emerald-950/10 bg-white px-5 py-6 justify-between sticky top-0 h-[100dvh]">
        <div className="space-y-7">
          <Link href="/" className="flex items-center gap-3 px-1 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0f5c3e] to-[#059669] shadow-sm shadow-emerald-900/20 flex items-center justify-center text-white transition-transform duration-300 group-hover:scale-105">
              <TreeEvergreen size={21} weight="duotone" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight text-[#0b2419]">
                EcoGuard
              </div>
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-emerald-700 font-medium">
                Forest Defense · BD
              </div>
            </div>
          </Link>

          {/* Forest Depth Trail Navigation */}
          <div className="space-y-2">
            <div className="px-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.16em] text-[#557464]">
              <span>Canopy Trail</span>
              <span>Layer {activeNav.depth}/04</span>
            </div>

            <nav className="relative space-y-1.5">
              {/* Vertical trail line */}
              <div
                aria-hidden="true"
                className="absolute left-[21px] top-5 bottom-5 w-px bg-gradient-to-b from-emerald-600/30 via-emerald-600/15 to-transparent"
              />

              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                      isActive
                        ? "bg-[#0f5c3e] text-white shadow-md shadow-emerald-950/15"
                        : "text-[#355244] hover:text-[#0b2419] hover:bg-[#edf5ef]"
                    }`}
                  >
                    <div
                      className={`relative z-10 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isActive
                          ? "bg-white/18 text-emerald-100"
                          : "bg-[#edf5ef] text-emerald-800"
                      }`}
                    >
                      <Icon size={15} weight={isActive ? "fill" : "duotone"} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-tight truncate">
                        {item.label}
                      </div>
                      <div
                        className={`text-[10px] truncate mt-0.5 ${
                          isActive ? "text-emerald-100/80" : "text-[#638071]"
                        }`}
                      >
                        {item.caption}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono ${
                        isActive ? "text-emerald-200" : "text-[#7a9687]"
                      }`}
                    >
                      {item.depth}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="space-y-4">
          {/* Mission & AI Engine Status Card */}
          <div className="rounded-2xl border border-emerald-950/10 bg-[#f5faf6] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[#466355]">
              <span className="flex items-center gap-1.5 font-semibold text-emerald-800">
                <Leaf size={13} weight="fill" className="text-emerald-600" />
                Anti-Deforestation AI
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-md font-semibold ${
                  health?.llm.configured
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {health?.llm.configured ? "LIVE" : "STANDBY"}
              </span>
            </div>

            {health && (
              <div className="space-y-1 pt-1 border-t border-emerald-950/8">
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#0b2419] truncate">
                  <Cpu size={13} className="text-emerald-700 shrink-0" />
                  <span className="truncate">{health.llm.primary_model}</span>
                </div>
                <div className="text-[10px] font-mono text-[#5c7a6b] truncate">
                  Failover: {health.llm.fallback_model}
                </div>
              </div>
            )}
          </div>

          {/* User Profile & Sign Out */}
          <div className="flex items-center justify-between gap-2 border-t border-emerald-950/10 pt-4 px-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-900 font-semibold text-xs flex items-center justify-center shrink-0">
                {(user?.full_name || user?.username || "A")
                  .slice(0, 1)
                  .toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#0b2419] truncate">
                  {user?.full_name || user?.username}
                </div>
                <div className="text-[11px] font-mono text-[#5c7a6b] truncate">
                  @{user?.username} · {user?.role}
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="p-2 rounded-lg text-[#557464] hover:text-rose-700 hover:bg-rose-50 transition-colors active:scale-[0.96]"
            >
              <SignOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3.5 border-b border-emerald-950/10 bg-white sticky top-0 z-30">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0f5c3e] to-[#059669] flex items-center justify-center text-white">
            <TreeEvergreen size={18} weight="duotone" />
          </div>
          <div>
            <span className="text-sm font-semibold tracking-tight text-[#0b2419] block leading-none">
              EcoGuard
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-700">
              Forest Defense
            </span>
          </div>
        </Link>
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="p-2 rounded-lg border border-emerald-950/12 text-[#0b2419] bg-[#f5faf6]"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={18} /> : <List size={18} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden border-b border-emerald-950/10 bg-white px-4 py-3 space-y-1 shadow-lg">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium ${
                  isActive
                    ? "bg-[#0f5c3e] text-white"
                    : "text-[#355244] hover:bg-[#edf5ef]"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon size={18} weight={isActive ? "fill" : "duotone"} />
                  <span>{item.label}</span>
                </span>
                <span className="text-[10px] font-mono opacity-75">
                  {item.depth}
                </span>
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-rose-700 hover:bg-rose-50"
          >
            <SignOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
        {/* Forest-Anchored Header Strip */}
        <header className="relative border-b border-emerald-950/10 bg-white overflow-hidden">
          {/* Subtle Bangladeshi forest photograph backdrop on right side fading into pure white */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            <img
              src={heroImage}
              alt=""
              className="w-full h-full object-cover object-center opacity-[0.18]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-white via-white/94 to-white/60" />
          </div>

          <div className="relative max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-emerald-800">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 font-semibold">
                  <TreeEvergreen size={12} weight="fill" className="text-emerald-600" />
                  <span>Layer {activeNav.depth} · Bangladesh Deforestation Watch</span>
                </span>
                <span className="hidden sm:inline text-[#5b7869]">
                  {heroRegion}
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#0b2419]">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs sm:text-sm text-[#466355] max-w-2xl">
                  {subtitle}
                </p>
              )}
            </div>

            {actions && (
              <div className="flex items-center gap-2.5 flex-wrap shrink-0">
                {actions}
              </div>
            )}
          </div>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
