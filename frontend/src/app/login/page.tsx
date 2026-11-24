"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle,
  Cpu,
  GlobeHemisphereEast,
  Leaf,
  MapPin,
  ShieldCheck,
  TreeEvergreen,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";

interface ForestSlide {
  id: string;
  name: string;
  banglaName: string;
  region: string;
  coords: string;
  ecosystem: string;
  image: string;
  highlight: string;
}

const BANGLADESH_FORESTS: ForestSlide[] = [
  {
    id: "sundarbans",
    name: "Sundarbans Mangrove Forest",
    banglaName: "সুন্দরবন ম্যানগ্রোভ বনাঞ্চল",
    region: "Khulna & Satkhira",
    coords: "22.02° N, 89.18° E",
    ecosystem: "World's Largest Tidal Mangrove Carbon Sink",
    image: "/forests/sundarbans.jpg",
    highlight: "Shielding coastal Bangladesh from cyclones and carbon loss.",
  },
  {
    id: "ratargul",
    name: "Ratargul Swamp Forest",
    banglaName: "রাতারগুল জলারবন",
    region: "Gowainghat, Sylhet",
    coords: "25.01° N, 91.92° E",
    ecosystem: "Freshwater Submerged Canopy Reserve",
    image: "/forests/ratargul.jpg",
    highlight: "Tracking monsoon canopy density and wetland forest health.",
  },
  {
    id: "lawachara",
    name: "Sylhet & Satchari Rainforest",
    banglaName: "লাউয়াছড়া ও সাতছড়ি অরণ্য",
    region: "Moulvibazar & Habiganj",
    coords: "24.33° N, 91.79° E",
    ecosystem: "Semi-Evergreen Tropical Biodiversity Corridor",
    image: "/forests/lawachara.jpg",
    highlight: "Detecting illegal logging and canopy fragmentation at 10m scale.",
  },
  {
    id: "hilltracts",
    name: "Chittagong Hill Tracts",
    banglaName: "পার্বত্য চট্টগ্রাম পাহাড়ি বন",
    region: "Bandarban & Rangamati",
    coords: "22.20° N, 92.22° E",
    ecosystem: "Highland Watershed & Hill Forest Ridge",
    image: "/forests/hilltracts.jpg",
    highlight: "Separating seasonal hill clearing from active deforestation.",
  },
  {
    id: "sundarbans-orbit",
    name: "Sundarbans Delta From Orbit",
    banglaName: "মহাকাশ থেকে সুন্দরবন",
    region: "Copernicus Sentinel-2 View",
    coords: "21.95° N, 89.18° E",
    ecosystem: "10m Multispectral Satellite Canopy Feed",
    image: "/forests/sundarbans-orbit.jpg",
    highlight: "Continuous orbital monitoring across Bangladesh's green belt.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSlideIdx((prev) => (prev + 1) % BANGLADESH_FORESTS.length);
    }, 6500);
    return () => clearInterval(interval);
  }, []);

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

  const activeForest = BANGLADESH_FORESTS[activeSlideIdx];
  const filmstripSlides = [...BANGLADESH_FORESTS, ...BANGLADESH_FORESTS];

  return (
    <div className="min-h-[100dvh] grid grid-cols-1 lg:grid-cols-12 bg-white text-[#0b2419]">
      {/* Left 7/12 — Animated Bangladeshi Forest Showcase */}
      <section className="relative lg:col-span-7 min-h-[540px] lg:min-h-[100dvh] overflow-hidden flex flex-col justify-between bg-[#082419] text-white">
        {/* Smooth Crossfading + Ken Burns Zoom Forest Photography */}
        <AnimatePresence mode="sync">
          <motion.div
            key={activeForest.id}
            initial={{ opacity: 0, scale: 1.07 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <img
              src={activeForest.image}
              alt={`${activeForest.name}, Bangladesh`}
              className="w-full h-full object-cover object-center animate-ken-burns"
            />
          </motion.div>
        </AnimatePresence>

        {/* Breathable Deep-Forest Editorial Scrim */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-[#062015]/82 via-[#072619]/52 to-[#051a11]/92"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-[#062015]/75 via-transparent to-transparent"
        />

        {/* Top Brand + Active Forest Pill */}
        <div className="relative z-10 p-6 sm:p-10 lg:px-12 lg:pt-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center text-emerald-200 shadow-lg">
              <TreeEvergreen size={24} weight="duotone" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">
                EcoGuard
              </div>
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-emerald-200/90">
                Bangladesh Forest &amp; Deforestation Defense
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeForest.id}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/14 backdrop-blur-md border border-white/20 text-xs text-white"
            >
              <MapPin size={14} weight="fill" className="text-emerald-300" />
              <span className="font-medium">{activeForest.name}</span>
              <span className="hidden sm:inline font-mono text-[10px] text-emerald-200">
                {activeForest.coords}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Center Editorial Story */}
        <div className="relative z-10 px-6 sm:px-10 lg:px-12 my-6 max-w-2xl space-y-5">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-300/35 text-emerald-100 text-[11px] font-mono tracking-wide">
            <GlobeHemisphereEast size={14} />
            <span>SENTINEL-2 · HANSEN GFC · WORLDCOVER · DEEPSEEK AI</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.08] text-white drop-shadow-sm">
            Safeguarding Bangladesh&apos;s forests from silent deforestation.
          </h1>

          <p className="text-sm sm:text-base text-emerald-50/88 leading-relaxed max-w-[56ch]">
            From the Sundarbans mangroves to Ratargul, Lawachara, and the
            Chittagong Hill Tracts—detect canopy loss with 10m Sentinel-2
            satellite telemetry, custom polygon scans, and grounded English
            &amp; Bangla AI briefings.
          </p>

          <AnimatePresence mode="wait">
            <motion.div
              key={`caption-${activeForest.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45 }}
              className="inline-flex items-center gap-2.5 rounded-2xl bg-black/25 backdrop-blur-md border border-white/15 px-4 py-2.5"
            >
              <Leaf size={16} weight="fill" className="text-emerald-300 shrink-0" />
              <div className="text-xs text-emerald-50/90">
                <span className="font-semibold text-white">
                  {activeForest.banglaName}
                </span>{" "}
                — {activeForest.highlight}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom Infinite Scrolling Bangladesh Forest Filmstrip */}
        <div className="relative z-10 pb-7 pt-3 space-y-4">
          <div className="px-6 sm:px-10 lg:px-12 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.14em] text-emerald-200/85">
            <span>Monitored Forest Biomes of Bangladesh</span>
            <div className="flex items-center gap-1.5">
              {BANGLADESH_FORESTS.map((f, idx) => (
                <button
                  key={f.id}
                  type="button"
                  aria-label={`View ${f.name}`}
                  onClick={() => setActiveSlideIdx(idx)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === activeSlideIdx
                      ? "w-7 bg-emerald-300"
                      : "w-2 bg-white/35 hover:bg-white/60"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Smooth Auto-Scrolling Horizontal Forest Strip */}
          <div className="forest-filmstrip-wrap overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
            <div className="forest-filmstrip-track gap-3.5 px-6">
              {filmstripSlides.map((forest, i) => {
                const realIdx = i % BANGLADESH_FORESTS.length;
                const isSelected = realIdx === activeSlideIdx;
                return (
                  <button
                    key={`${forest.id}-${i}`}
                    type="button"
                    onClick={() => setActiveSlideIdx(realIdx)}
                    className={`group relative w-56 sm:w-64 shrink-0 rounded-2xl overflow-hidden text-left border transition-all duration-300 ${
                      isSelected
                        ? "border-emerald-300 shadow-lg shadow-black/40 scale-[1.02]"
                        : "border-white/20 opacity-85 hover:opacity-100 hover:border-white/50"
                    }`}
                  >
                    <div className="relative h-24 w-full overflow-hidden">
                      <img
                        src={forest.image}
                        alt={forest.name}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#041810]/90 via-[#041810]/25 to-transparent" />
                      <div className="absolute bottom-2 left-3 right-3">
                        <div className="text-xs font-semibold text-white truncate">
                          {forest.name}
                        </div>
                        <div className="text-[10px] font-mono text-emerald-200/90 truncate">
                          {forest.region} · {forest.coords}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live System Status Bar */}
          <div className="px-6 sm:px-10 lg:px-12 flex flex-wrap items-center gap-4 text-[11px] font-mono text-emerald-100/80">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle
                size={14}
                weight="fill"
                className={health ? "text-emerald-300" : "text-amber-300"}
              />
              API: {health ? "ONLINE" : "CONNECTING"}
            </span>
            {health && (
              <>
                <span>ML RISK: {health.ml_model_loaded ? "READY" : "RULE MODE"}</span>
                <span>
                  DEEPSEEK:{" "}
                  {health.llm.configured ? health.llm.primary_model : "FALLBACK"}
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Right 5/12 — Clean Pure White Auth Panel */}
      <section className="lg:col-span-5 bg-white p-8 sm:p-12 lg:p-14 flex flex-col justify-between relative">
        {/* Subtle decorative emerald top line */}
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0f5c3e] via-[#10b981] to-[#6ee7b7] lg:hidden"
        />

        <div className="hidden lg:flex items-center justify-between text-xs text-[#4d6b5c]">
          <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider text-[11px] text-emerald-800">
            <ShieldCheck size={15} weight="duotone" className="text-emerald-700" />
            Protected Forest Console
          </span>
          <span className="font-mono text-[11px] text-[#6d877a]">v2.0</span>
        </div>

        <div className="w-full max-w-sm mx-auto my-auto py-6 space-y-6">
          {/* Segmented Mode Switcher */}
          <div className="flex rounded-2xl border border-emerald-950/10 bg-[#f4f9f5] p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 py-2.5 rounded-xl transition-all duration-200 ${
                mode === "login"
                  ? "bg-white text-[#0f5c3e] shadow-sm border border-emerald-950/8"
                  : "text-[#587566] hover:text-[#0b2419]"
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
              className={`flex-1 py-2.5 rounded-xl transition-all duration-200 ${
                mode === "signup"
                  ? "bg-white text-[#0f5c3e] shadow-sm border border-emerald-950/8"
                  : "text-[#587566] hover:text-[#0b2419]"
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight text-[#0b2419]">
              {mode === "login"
                ? "Enter Forest Monitoring Console"
                : "Register Conservation Analyst"}
            </h2>
            <p className="text-xs sm:text-sm text-[#4f6d5e]">
              {mode === "login"
                ? "Sign in to inspect satellite canopy telemetry and deforestation alerts."
                : "Create your account to track Bangladesh reserves and export AI briefings."}
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              {error}
            </div>
          )}

          {notice && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
              {notice}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#1e3d2f]">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Farhana Rahman"
                    className="rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3.5 py-2.5 text-sm text-[#0b2419] placeholder:text-[#849e90] focus:outline-none focus:bg-white focus:border-[#0f5c3e] focus:ring-2 focus:ring-emerald-600/15 transition-all"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#1e3d2f]">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="farhana_gis"
                    className="rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3.5 py-2.5 text-sm text-[#0b2419] placeholder:text-[#849e90] focus:outline-none focus:bg-white focus:border-[#0f5c3e] focus:ring-2 focus:ring-emerald-600/15 transition-all"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#1e3d2f]">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="analyst@forest-bd.org"
                    className="rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3.5 py-2.5 text-sm text-[#0b2419] placeholder:text-[#849e90] focus:outline-none focus:bg-white focus:border-[#0f5c3e] focus:ring-2 focus:ring-emerald-600/15 transition-all"
                  />
                </div>
              </>
            )}

            {mode === "login" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#1e3d2f]">
                  Username or Email
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin"
                  className="rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3.5 py-2.5 text-sm text-[#0b2419] placeholder:text-[#849e90] focus:outline-none focus:bg-white focus:border-[#0f5c3e] focus:ring-2 focus:ring-emerald-600/15 transition-all"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#1e3d2f]">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="rounded-xl bg-[#f7fbf8] border border-emerald-950/15 px-3.5 py-2.5 text-sm text-[#0b2419] placeholder:text-[#849e90] focus:outline-none focus:bg-white focus:border-[#0f5c3e] focus:ring-2 focus:ring-emerald-600/15 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0f5c3e] hover:bg-[#0b4730] text-white font-semibold text-sm py-3 shadow-md shadow-emerald-950/15 transition-all active:scale-[0.985] disabled:opacity-50"
            >
              <span>
                {loading
                  ? "Entering Forest Console..."
                  : mode === "login"
                  ? "Enter Forest Console"
                  : "Create Analyst Account"}
              </span>
              <ArrowRight size={16} weight="bold" />
            </button>
          </form>

          {/* Compact Capability Strip */}
          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-emerald-950/10">
            <div className="rounded-xl bg-[#f5faf6] border border-emerald-950/8 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0f5c3e]">
                <ShieldCheck size={15} weight="duotone" />
                <span>Seasonal ML</span>
              </div>
              <p className="text-[11px] text-[#527061] mt-1 leading-snug">
                Separates monsoon swings from illegal clearing.
              </p>
            </div>
            <div className="rounded-xl bg-[#f5faf6] border border-emerald-950/8 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0f5c3e]">
                <Cpu size={15} weight="duotone" />
                <span>DeepSeek AI</span>
              </div>
              <p className="text-[11px] text-[#527061] mt-1 leading-snug">
                Grounded English &amp; বাংলা field briefings.
              </p>
            </div>
          </div>
        </div>

        <div className="text-center lg:text-left text-[11px] text-[#6d877a] pt-4 border-t border-emerald-950/8">
          Protecting Sundarbans · Ratargul · Lawachara · Chittagong Hill Tracts
        </div>
      </section>
    </div>
  );
}
