"use client";

import React, { useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  Cpu,
  Info,
  PaperPlaneRight,
  Pulse,
  Translate,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { AnalyzeResponse, ChatTurn, StructuredBriefing } from "@/lib/types";

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

function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function FormattedMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed text-zinc-200">
      {lines.map((raw, idx) => {
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-1" />;

        if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
          const clean = line.replace(/^#{1,3}\s+/, "").replace(/\*\*/g, "");
          return (
            <div key={idx} className="text-xs font-semibold uppercase tracking-wide text-emerald-300 pt-1">
              {clean}
            </div>
          );
        }

        if (/^[-•*]\s+/.test(line)) {
          const item = line.replace(/^[-•*]\s+/, "");
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span>{renderInlineBold(item)}</span>
            </div>
          );
        }

        const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
        if (numbered) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="font-mono text-[11px] text-emerald-400 mt-0.5 shrink-0">
                {numbered[1]}.
              </span>
              <span>{renderInlineBold(numbered[2])}</span>
            </div>
          );
        }

        return <p key={idx}>{renderInlineBold(line)}</p>;
      })}
    </div>
  );
}

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
  const [structured, setStructured] = useState<StructuredBriefing | null>(
    report.ai?.structured || null
  );
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
      setStructured(res.structured || null);
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

      {/* Structured Executive Briefing */}
      <div className="p-5 border-b border-white/[0.08] space-y-4 bg-[#0e1411]">
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
          <div className="space-y-2.5 py-2">
            <div className="h-4 w-2/3 rounded bg-white/[0.07] animate-pulse" />
            <div className="h-3.5 w-full rounded bg-white/[0.05] animate-pulse" />
            <div className="h-3.5 w-5/6 rounded bg-white/[0.05] animate-pulse" />
            <div className="h-16 w-full rounded-xl bg-white/[0.04] animate-pulse" />
          </div>
        ) : structured ? (
          <div className="space-y-4">
            {structured.headline && (
              <h4 className="text-sm sm:text-base font-semibold text-white leading-snug">
                {structured.headline}
              </h4>
            )}

            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              {structured.summary}
            </p>

            {structured.key_signals.length > 0 && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                  <Pulse size={14} />
                  <span>{language === "bn" ? "মূল সংকেতসমূহ" : "Key Signals"}</span>
                </div>
                <ul className="space-y-1.5 text-xs text-zinc-200 leading-relaxed">
                  {structured.key_signals.map((sig, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span>{sig}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {structured.recommended_actions.length > 0 && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                  <CheckCircle size={14} />
                  <span>
                    {language === "bn" ? "প্রস্তাবিত পদক্ষেপ" : "Recommended Field Actions"}
                  </span>
                </div>
                <ol className="space-y-1.5 text-xs text-zinc-200 leading-relaxed">
                  {structured.recommended_actions.map((act, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="font-mono text-[11px] text-emerald-400 font-semibold shrink-0">
                        0{idx + 1}
                      </span>
                      <span>{act}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {structured.data_caveat && (
              <div className="flex items-start gap-2 text-[11px] text-zinc-400 leading-relaxed pt-1 border-t border-white/[0.06]">
                <Info size={14} className="text-zinc-500 shrink-0 mt-0.5" />
                <span>{structured.data_caveat}</span>
              </div>
            )}
          </div>
        ) : (
          <FormattedMarkdown
            text={
              briefing ||
              "Run an analysis to generate a grounded environmental briefing."
            }
          />
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
                className={`rounded-xl px-3.5 py-2.5 ${
                  m.role === "user"
                    ? "bg-emerald-500/12 border border-emerald-500/25 text-emerald-100 text-xs sm:text-sm ml-8"
                    : "bg-white/[0.04] border border-white/[0.07] mr-4"
                }`}
              >
                {m.role === "user" ? (
                  <span>{m.content}</span>
                ) : (
                  <FormattedMarkdown text={m.content} />
                )}
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
