"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle,
  Cpu,
  GlobeHemisphereEast,
  ShieldCheck,
  TreeEvergreen,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const verified = params.get("verified");
      if (verified === "1") {
        setNotice("Email verified successfully. You can now sign in.");
      } else if (verified === "already") {
        setNotice("Your email is already verified. Please sign in.");
      } else if (verified === "invalid") {
        setError("Verification link is invalid or expired.");
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "login") {
        await api.login(identifier, password);
        router.replace("/");
      } else {
        const res = await api.signup({
          full_name: fullName,
          username,
          email,
          password,
        });
        if (res.requires_verification) {
          setNotice(
            "Account created. Check your inbox for the verification link before signing in."
          );
          setMode("login");
        } else {
          router.replace("/");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] grid grid-cols-1 lg:grid-cols-12 bg-[#0a0e0c] text-[#f4f7f5]">
      {/* Left Narrative Column (Asymmetric 7/12) */}
      <section className="lg:col-span-7 p-8 sm:p-12 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-white/[0.08] bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.12),transparent_60%)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <TreeEvergreen size={22} weight="duotone" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight text-white">
              EcoGuard
            </div>
            <div className="text-[11px] font-mono text-zinc-400">
              BANGLADESH GEOSPATIAL FOREST INTELLIGENCE
            </div>
          </div>
        </div>

        <div className="my-12 max-w-xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-mono">
            <GlobeHemisphereEast size={14} />
            <span>SENTINEL-2 · HANSEN GFC · WORLDCOVER · DEEPSEEK</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.08] text-white">
            Monitor canopy loss with polygon precision and grounded AI briefings.
          </h1>

          <p className="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-[58ch]">
            Inspect 12-month NDVI trends, dense-canopy EVI, burn-severity NBR,
            and 25-year Hansen loss across Bangladesh forests—paired with
            English and Bangla DeepSeek analysis.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.08]">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-zinc-100">
                  Seasonal-Aware ML Risk
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Year-over-year NDVI delta separates monsoon swings from active clearing.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Cpu size={20} className="text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-zinc-100">
                  DeepSeek Dual-Model Failover
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Routes to deepseek-v4.1-flash-1017 with automatic :free fallback.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle
              size={14}
              className={health ? "text-emerald-400" : "text-amber-400"}
            />
            API: {health ? "ONLINE" : "CONNECTING"}
          </span>
          {health && (
            <>
              <span>ML: {health.ml_model_loaded ? "READY" : "RULE MODE"}</span>
              <span>
                LLM: {health.llm.configured ? health.llm.primary_model : "FALLBACK MODE"}
              </span>
            </>
          )}
        </div>
      </section>

      {/* Right Auth Column (5/12) */}
      <section className="lg:col-span-5 p-8 sm:p-12 flex items-center justify-center">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex rounded-xl border border-white/[0.08] bg-[#111714] p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === "login"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === "signup"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Create Account
            </button>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white">
              {mode === "login" ? "Access Monitoring Console" : "Register Analyst Account"}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {mode === "login"
                ? "Sign in with your EcoGuard credentials to launch satellite scans."
                : "Create an account to save watchlists, alerts, and AI reports."}
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          {notice && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
              {notice}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Farhana Rahman"
                    className="rounded-xl bg-[#111714] border border-white/[0.12] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="farhana_gis"
                    className="rounded-xl bg-[#111714] border border-white/[0.12] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="analyst@forest-bd.org"
                    className="rounded-xl bg-[#111714] border border-white/[0.12] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
              </>
            )}

            {mode === "login" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Username or Email
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin"
                  className="rounded-xl bg-[#111714] border border-white/[0.12] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="rounded-xl bg-[#111714] border border-white/[0.12] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm py-2.5 transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              <span>
                {loading
                  ? "Authenticating..."
                  : mode === "login"
                  ? "Enter Console"
                  : "Create Analyst Account"}
              </span>
              <ArrowRight size={16} weight="bold" />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
