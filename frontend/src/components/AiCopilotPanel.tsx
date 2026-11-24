"use client";

import React, { useState } from "react";
import {
  ArrowClockwise,
  Cpu,
  PaperPlaneRight,
  Translate,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { AnalyzeResponse, ChatTurn } from "@/lib/types";

interface AiCopilotPanelProps {
  report: AnalyzeResponse;
  availableModels?: string[];
}

const DEFAULT_MODELS = [
  "deepseek-v4.1-flash-1017",
  "deepseek-v4.1-flash:free",
];

const SUGGESTED_QUESTIONS: Record<"en" | "bn", string[]> = {
  en: [
    "Is this NDVI change seasonal or abnormal compared to last year?",
    "Which zones here need field verification first?",
    "Draft a concise ranger inspection checklist for this area.",
  ],
  bn: [
    "গত বছরের তুলনায় এই NDVI পরিবর্তন কি মৌসুমি নাকি অস্বাভাবিক?",
    "মাঠ পর্যায়ে যাচাইয়ের জন্য ৩টি জরুরি পদক্ষেপ লিখুন।",
    "স্থানীয় কর্মকর্তাদের জন্য এই রিপোর্টের সংক্ষিপ্ত সারসংক্ষেপ দিন।",
  ],
};

export default function AiCopilotPanel({
  report,
  availableModels = DEFAULT_MODELS,
}: AiCopilotPanelProps) {
  const [selectedModel, setSelectedModel] = useState<string>(
    availableModels[0] || DEFAULT_MODELS[0]
  );
  const [language, setLanguage] = useState<"en" | "bn">(
    report.ai?.language || "en"
  );
  const [briefing, setBriefing] = useState<string>(report.ai?.briefing || "");
  const [briefingModel, setBriefingModel] = useState<string>(
    report.ai?.model_used || "deterministic-fallback"
  );
  const [briefingLoading, setBriefingLoading] = useState(false);

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reportContext = {
    location: report.location.name,
    risk_assessment: report.risk,
    vegetation_metrics: {
      current_ndvi: report.analysis.current_ndvi,
      previous_ndvi: report.analysis.previous_ndvi,
      yoy_ndvi_change: report.analysis.yoy_ndvi_change,
      current_evi: report.analysis.current_evi,
      dnbr: report.analysis.dnbr,
      vegetation_loss_percent: report.analysis.vegetation_loss,
      current_coverage_percent: report.analysis.current_coverage_percent,
      rainfall_mm: report.analysis.rainfall,
    },
    historical_forest_loss: report.analysis.historical_forest_loss,
    tree_data: report.tree_data,
  };

  const regenerateBriefing = async (
    nextLang: "en" | "bn" = language,
    nextModel: string = selectedModel
  ) => {
    setBriefingLoading(true);
    setError(null);
    try {
      const res = await api.aiBriefing({
        location: report.location.name,
        analysis: report.analysis,
        risk: report.risk,
        tree_data: report.tree_data,
        language: nextLang,
        model: nextModel,
      });
      setBriefing(res.briefing);
      setBriefingModel(res.model_used);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate briefing");
    } finally {
      setBriefingLoading(false);
    }
  };

  const sendQuestion = async (textOverride?: string) => {
    const q = (textOverride ?? question).trim();
    if (!q || chatLoading) return;

    const userTurn: ChatTurn = { role: "user", content: q };
    const nextHistory = [...messages, userTurn];
    setMessages(nextHistory);
    setQuestion("");
    setChatLoading(true);
    setError(null);

    try {
      const res = await api.aiChat({
        question: q,
        context: reportContext,
        history: messages,
        language,
        model: selectedModel,
      });
      setMessages([
        ...nextHistory,
        {
          role: "assistant",
          content: res.reply,
          model_used: res.model_used,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat request failed");
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.1] bg-[#111714] flex flex-col overflow-hidden">
      {/* Header Controls */}
      <div className="px-5 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Cpu size={18} weight="duotone" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              DeepSeek Forest Copilot
            </h3>
            <p className="text-[11px] font-mono text-zinc-400">
              tokenharbor.ai/v1 · Grounded in GEE telemetry
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            aria-label="Select DeepSeek model"
            className="bg-[#0a0e0c] border border-white/[0.12] rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-emerald-500/60"
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-lg border border-white/[0.1] bg-[#0a0e0c] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setLanguage("en");
                regenerateBriefing("en", selectedModel);
              }}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${
                language === "en"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Translate size={13} />
              <span>EN</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLanguage("bn");
                regenerateBriefing("bn", selectedModel);
              }}
              className={`px-2.5 py-1 rounded-md ${
                language === "bn"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              বাংলা
            </button>
          </div>
        </div>
      </div>

      {/* Executive Briefing Section */}
      <div className="p-5 border-b border-white/[0.08] space-y-3 bg-[#0e1411]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
            Executive Briefing · {briefingModel}
          </span>
          <button
            type="button"
            disabled={briefingLoading}
            onClick={() => regenerateBriefing(language, selectedModel)}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] transition-colors active:scale-[0.98] disabled:opacity-50"
          >
            <ArrowClockwise
              size={13}
              className={briefingLoading ? "animate-spin" : ""}
            />
            <span>Regenerate</span>
          </button>
        </div>

        {briefingLoading ? (
          <div className="space-y-2 py-2">
            <div className="h-3.5 w-3/4 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-3.5 w-full rounded bg-white/[0.06] animate-pulse" />
            <div className="h-3.5 w-5/6 rounded bg-white/[0.06] animate-pulse" />
          </div>
        ) : (
          <div className="text-xs sm:text-sm leading-relaxed text-zinc-200 whitespace-pre-line">
            {briefing || "Run an analysis to generate a grounded environmental briefing."}
          </div>
        )}
      </div>

      {/* Interactive Report Q&A */}
      <div className="p-5 flex-1 flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS[language].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendQuestion(prompt)}
              className="text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {messages.length > 0 && (
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`rounded-xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed whitespace-pre-line ${
                  m.role === "user"
                    ? "bg-emerald-500/12 border border-emerald-500/25 text-emerald-100 ml-8"
                    : "bg-white/[0.04] border border-white/[0.07] text-zinc-200 mr-4"
                }`}
              >
                {m.content}
                {m.model_used && (
                  <div className="mt-1.5 text-[10px] font-mono text-zinc-500">
                    via {m.model_used}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendQuestion();
          }}
          className="flex items-center gap-2 mt-auto"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              language === "bn"
                ? "এই রিপোর্ট সম্পর্কে প্রশ্ন করুন..."
                : "Ask about NDVI trend, rainfall, or field priorities..."
            }
            className="flex-1 bg-[#0a0e0c] border border-white/[0.12] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
          />
          <button
            type="submit"
            disabled={chatLoading || !question.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 text-zinc-950 font-medium text-sm hover:bg-emerald-400 transition-colors active:scale-[0.98] disabled:opacity-40"
          >
            <PaperPlaneRight size={16} weight="bold" />
            <span>{chatLoading ? "Thinking..." : "Ask"}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
