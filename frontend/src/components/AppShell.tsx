"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BellRinging,
  BookmarkSimple,
  Compass,
  Cpu,
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
}

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: SquaresFour },
  { href: "/explorer", label: "Satellite Explorer", icon: Compass },
  { href: "/watchlists", label: "Watchlists", icon: BookmarkSimple },
  { href: "/alerts", label: "Alert Triage", icon: BellRinging },
];

export default function AppShell({
  children,
  title,
  subtitle,
  actions,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
      // Still attempt session cookie check once before redirecting
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
      <div className="min-h-[100dvh] bg-[#0a0e0c] flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="h-5 w-36 rounded bg-white/5 animate-pulse" />
          <div className="h-24 w-full rounded-xl bg-white/5 animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row bg-[#0a0e0c] text-[#f4f7f5]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-white/[0.08] bg-[#0e1310] px-4 py-6 justify-between">
        <div className="space-y-8">
          <Link href="/" className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <TreeEvergreen size={20} weight="duotone" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-white">
                EcoGuard
              </div>
              <div className="text-[11px] font-mono text-zinc-400 tracking-wide">
                FOREST TELEMETRY v2
              </div>
            </div>
          </Link>

          <nav className="space-y-1">
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
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-500/12 text-emerald-300 border border-emerald-500/25"
                      : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  <Icon size={18} weight={isActive ? "fill" : "regular"} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="space-y-4">
          {health && (
            <div className="rounded-xl border border-white/[0.08] bg-[#121915] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Cpu size={14} className="text-emerald-400" />
                  DEEPSEEK AI
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    health.llm.configured
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {health.llm.configured ? "LIVE" : "KEY PENDING"}
                </span>
              </div>
              <div className="text-[11px] font-mono text-zinc-300 truncate">
                {health.llm.primary_model}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 truncate">
                Fallback: {health.llm.fallback_model}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] pt-4 px-1">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-100 truncate">
                {user?.full_name || user?.username}
              </div>
              <div className="text-[11px] font-mono text-zinc-500 truncate">
                @{user?.username} · {user?.role}
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors active:scale-[0.97]"
            >
              <SignOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3.5 border-b border-white/[0.08] bg-[#0e1310]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <TreeEvergreen size={18} weight="duotone" />
          </div>
          <span className="text-sm font-semibold tracking-tight">EcoGuard</span>
        </Link>
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="p-2 rounded-lg border border-white/[0.08] text-zinc-300"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={18} /> : <List size={18} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden border-b border-white/[0.08] bg-[#0e1310] px-4 py-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-100"
          >
            <SignOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <header className="border-b border-white/[0.08] bg-[#0a0e0c]/90 backdrop-blur-md sticky top-0 z-20">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2.5 flex-wrap">{actions}</div>}
          </div>
        </header>

        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
