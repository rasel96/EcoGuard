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
        <strong key={i} className="font-semibold text-[#0b2419]">
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
    <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed text-[#1f3d2f]">
      {lines.map((raw, idx) => {
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-1" />;

        if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
          const clean = line.replace(/^#{1,3}\s+/, "").replace(/\*\*/g, "");
          return (
            <div key={idx} className="text-xs font-semibold uppercase tracking-wide text-[#0f5c3e] pt-1">
              {clean}
            </div>
          );
        }

        if (/^[-•*]\s+/.test(line)) {
          const item = line.replace(/^[-•*]\s+/, "");
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
              <span>{renderInlineBold(item)}</span>
            </div>
          );
        }

        const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
        if (numbered) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="font-mono text-[11px] font-semibold text-[#0f5c3e] mt-0.5 shrink-0">
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
    <div className="rounded-2xl forest-card flex flex-col overflow-hidden">
      {/* Header Controls */}
      <div className="px-5 py-4 border-b border-emerald-950/10 bg-[#fafdfb] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#0f5c3e] flex items-center justify-center text-white shadow-xs">
            <Cpu size={18} weight="duotone" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#0b2419]">
              DeepSeek Forest Copilot
            </h3>
            <p className="text-[11px] font-mono text-[#5c7a6b]">
              tokenharbor.ai/v1 · Grounded in GEE telemetry
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            aria-label="Select DeepSeek model"
            className="bg-white border border-emerald-950/15 rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#0b2419] focus:outline-none focus:border-[#0f5c3e]"
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-lg border border-emerald-950/12 bg-[#edf5ef] p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setLanguage("en");
                regenerateBriefing("en", selectedModel);
              }}
              className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
                language === "en"
                  ? "bg-white text-[#0f5c3e] shadow-xs font-semibold"
                  : "text-[#466355] hover:text-[#0b2419]"
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
              className={`px-2.5 py-1 rounded-md transition-colors ${
                language === "bn"
                  ? "bg-white text-[#0f5c3e] shadow-xs font-semibold"
                  : "text-[#466355] hover:text-[#0b2419]"
              }`}
            >
              বাংলা
            </button>
          </div>
        </div>
      </div>

      {/* Structured Executive Briefing */}
      <div className="p-5 border-b border-emerald-950/10 space-y-4 bg-[#f7fbf8]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider font-semibold text-[#0f5c3e]">
            Executive Briefing · {briefingModel}
          </span>
          <button
            type="button"
            disabled={briefingLoading}
            onClick={() => regenerateBriefing(language, selectedModel)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#234234] hover:text-[#0f5c3e] px-2.5 py-1 rounded-lg bg-white border border-emerald-950/12 hover:bg-[#edf5ef] transition-colors active:scale-[0.98] disabled:opacity-50"
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
            <div className="h-4 w-2/3 rounded bg-emerald-950/10 animate-pulse" />
            <div className="h-3.5 w-full rounded bg-emerald-950/8 animate-pulse" />
            <div className="h-3.5 w-5/6 rounded bg-emerald-950/8 animate-pulse" />
            <div className="h-16 w-full rounded-xl bg-white border border-emerald-950/8 animate-pulse" />
          </div>
        ) : structured ? (
          <div className="space-y-4">
            {structured.headline && (
              <h4 className="text-sm sm:text-base font-semibold text-[#0b2419] leading-snug">
                {structured.headline}
              </h4>
            )}

            <p className="text-xs sm:text-sm text-[#2d4a3c] leading-relaxed">
              {structured.summary}
            </p>

            {structured.key_signals.length > 0 && (
              <div className="rounded-xl border border-emerald-950/10 bg-white p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider font-semibold text-[#0f5c3e]">
                  <Pulse size={14} />
                  <span>{language === "bn" ? "মূল সংকেতসমূহ" : "Key Canopy Signals"}</span>
                </div>
                <ul className="space-y-1.5 text-xs text-[#234234] leading-relaxed">
                  {structured.key_signals.map((sig, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                      <span>{sig}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {structured.recommended_actions.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider font-semibold text-[#0f5c3e]">
                  <CheckCircle size={14} weight="fill" className="text-emerald-600" />
                  <span>
                    {language === "bn" ? "প্রস্তাবিত পদক্ষেপ" : "Recommended Field Actions"}
                  </span>
                </div>
                <ol className="space-y-1.5 text-xs text-[#19382a] leading-relaxed">
                  {structured.recommended_actions.map((act, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="font-mono text-[11px] text-[#0f5c3e] font-semibold shrink-0">
                        0{idx + 1}
                      </span>
                      <span>{act}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {structured.data_caveat && (
              <div className="flex items-start gap-2 text-[11px] text-[#557464] leading-relaxed pt-1 border-t border-emerald-950/8">
                <Info size={14} className="text-[#5c7a6b] shrink-0 mt-0.5" />
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
      <div className="p-5 flex-1 flex flex-col gap-4 bg-white">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS[language].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendQuestion(prompt)}
              className="text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-950/12 bg-[#f5faf6] text-[#234234] hover:border-[#0f5c3e]/40 hover:bg-emerald-50 hover:text-[#0f5c3e] transition-colors"
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
                    ? "bg-[#0f5c3e] text-white text-xs sm:text-sm ml-8"
                    : "bg-[#f5faf6] border border-emerald-950/10 mr-4"
                }`}
              >
                {m.role === "user" ? (
                  <span>{m.content}</span>
                ) : (
                  <FormattedMarkdown text={m.content} />
                )}
                {m.model_used && (
                  <div className="mt-1.5 text-[10px] font-mono text-[#5c7a6b]">
                    via {m.model_used}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
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
                ? "এই বন প্রতিবেদন সম্পর্কে প্রশ্ন করুন..."
                : "Ask about canopy NDVI, rainfall, or deforestation risk..."
            }
            className="flex-1 bg-[#f7fbf8] border border-emerald-950/15 rounded-xl px-3.5 py-2.5 text-sm text-[#0b2419] placeholder:text-[#7c9688] focus:outline-none focus:bg-white focus:border-[#0f5c3e]"
          />
          <button
            type="submit"
            disabled={chatLoading || !question.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0f5c3e] text-white font-semibold text-sm hover:bg-[#0b4730] transition-colors active:scale-[0.98] disabled:opacity-40"
          >
            <PaperPlaneRight size={16} weight="bold" />
            <span>{chatLoading ? "Thinking..." : "Ask"}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
