"""
EcoGuard LLM Service (DeepSeek via OpenAI-compatible API).

Default endpoint: https://tokenharbor.ai/v1
Models:
  - Primary:  deepseek-v4.1-flash-1017
  - Fallback: deepseek-v4.1-flash:free
"""

import json
import logging
import os
import re

logger = logging.getLogger("ecoguard.llm")

DEFAULT_LLM_BASE_URL = "https://tokenharbor.ai/v1"
DEFAULT_PRIMARY_MODEL = "deepseek-v4.1-flash-1017"
DEFAULT_FALLBACK_MODEL = "deepseek-v4.1-flash:free"

ALLOWED_MODELS = (
    DEFAULT_PRIMARY_MODEL,
    DEFAULT_FALLBACK_MODEL,
)

# Guard against occasional CJK character leakage in multilingual outputs
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")


def _sanitize_output(text, lang="en"):
    if not text:
        return ""
    cleaned = _CJK_RE.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def get_llm_config():
    base_url = (os.getenv("LLM_BASE_URL") or DEFAULT_LLM_BASE_URL).strip()
    api_key = (
        os.getenv("LLM_API_KEY")
        or os.getenv("DEEPSEEK_API_KEY")
        or os.getenv("TOKENHARBOR_API_KEY")
        or ""
    ).strip()
    primary_model = (os.getenv("LLM_PRIMARY_MODEL") or DEFAULT_PRIMARY_MODEL).strip()
    fallback_model = (os.getenv("LLM_FALLBACK_MODEL") or DEFAULT_FALLBACK_MODEL).strip()
    timeout_seconds = float(os.getenv("LLM_TIMEOUT_SECONDS", "30"))

    models = []
    for m in (primary_model, fallback_model, *ALLOWED_MODELS):
        if m and m not in models:
            models.append(m)

    return {
        "base_url": base_url,
        "api_key": api_key,
        "configured": bool(api_key),
        "primary_model": primary_model,
        "fallback_model": fallback_model,
        "available_models": models,
        "timeout_seconds": timeout_seconds,
    }


def get_llm_status():
    cfg = get_llm_config()
    return {
        "configured": cfg["configured"],
        "base_url": cfg["base_url"],
        "primary_model": cfg["primary_model"],
        "fallback_model": cfg["fallback_model"],
        "available_models": cfg["available_models"],
    }


def _resolve_model_chain(requested_model=None):
    cfg = get_llm_config()
    chain = []
    if requested_model and requested_model.strip():
        chain.append(requested_model.strip())
    if cfg["primary_model"] not in chain:
        chain.append(cfg["primary_model"])
    if cfg["fallback_model"] and cfg["fallback_model"] not in chain:
        chain.append(cfg["fallback_model"])
    return chain


def _call_openai_compatible(messages, requested_model=None, temperature=0.2, max_tokens=850):
    """
    Call the OpenAI-compatible DeepSeek endpoint with automatic failover
    from primary model to fallback (:free) model.
    """
    cfg = get_llm_config()
    if not cfg["configured"]:
        return None, None, "API key not configured"

    try:
        from openai import OpenAI
    except ImportError as err:
        logger.warning("openai package is not installed: %s", err)
        return None, None, "openai SDK not installed"

    client = OpenAI(
        base_url=cfg["base_url"],
        api_key=cfg["api_key"],
        timeout=cfg["timeout_seconds"],
    )

    last_error = None
    for model_name in _resolve_model_chain(requested_model):
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            content = (response.choices[0].message.content or "").strip()
            if content:
                return content, model_name, None
        except Exception as err:
            last_error = str(err)
            logger.warning(
                "LLM call failed for model '%s' at %s: %s",
                model_name,
                cfg["base_url"],
                err,
            )

    return None, None, last_error or "All configured LLM models failed"


def _compact_context(location_name, analysis, risk_result=None, tree_data=None):
    analysis = analysis or {}
    risk_result = risk_result or {}
    tree_data = tree_data or {}

    hist = analysis.get("historical_forest_loss") or {}

    return {
        "location": location_name,
        "observation_window": {
            "current_start": analysis.get("analysis_start"),
            "current_end": analysis.get("analysis_end"),
            "previous_start": analysis.get("previous_start"),
            "previous_end": analysis.get("previous_end"),
        },
        "vegetation_metrics": {
            "current_ndvi": analysis.get("current_ndvi"),
            "previous_ndvi": analysis.get("previous_ndvi"),
            "ndvi_change": analysis.get("ndvi_change"),
            "yoy_ndvi": analysis.get("yoy_ndvi"),
            "yoy_ndvi_change": analysis.get("yoy_ndvi_change"),
            "current_evi": analysis.get("current_evi"),
            "current_nbr": analysis.get("current_nbr"),
            "dnbr": analysis.get("dnbr"),
            "vegetation_loss_percent": analysis.get("vegetation_loss"),
            "current_coverage_percent": analysis.get("current_coverage_percent"),
            "rainfall_mm": analysis.get("rainfall"),
        },
        "historical_forest_loss": {
            "baseline_forest_area_hectares": hist.get("baseline_forest_area_hectares"),
            "total_forest_loss_hectares": hist.get("total_forest_loss_hectares"),
            "historical_loss_percent": hist.get("historical_loss_percent"),
            "recent_5_year_loss_hectares": hist.get("recent_5_year_loss_hectares"),
            "period": f"{hist.get('dataset_start_year', 2001)}-{hist.get('dataset_end_year', 2025)}",
        },
        "risk_assessment": {
            "risk_level": risk_result.get("risk_level"),
            "confidence_percent": risk_result.get("confidence"),
            "factors": risk_result.get("factors", []),
        },
        "reforestation_estimate": {
            "target_percent": tree_data.get("target"),
            "coverage_gap_percent": tree_data.get("coverage_gap"),
            "minimum_trees": tree_data.get("minimum_trees"),
        },
    }


def _parse_structured_briefing(raw_text, lang="en"):
    """Extract JSON briefing if the LLM returned valid structured JSON."""
    if not raw_text:
        return None
    cleaned = _sanitize_output(raw_text, lang=lang)
    # Strip optional ```json ... ``` fences
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
    candidate = fenced.group(1) if fenced else cleaned
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(candidate[start : end + 1])
    except Exception:
        return None
    if not isinstance(parsed, dict) or not parsed.get("summary"):
        return None

    headline = _sanitize_output(str(parsed.get("headline") or ""), lang)
    summary = _sanitize_output(str(parsed.get("summary") or ""), lang)
    signals = [
        _sanitize_output(str(s), lang)
        for s in (parsed.get("key_signals") or [])
        if str(s).strip()
    ][:5]
    actions = [
        _sanitize_output(str(a), lang)
        for a in (parsed.get("recommended_actions") or [])
        if str(a).strip()
    ][:4]
    caveat = _sanitize_output(str(parsed.get("data_caveat") or ""), lang)

    return {
        "headline": headline,
        "summary": summary,
        "key_signals": signals,
        "recommended_actions": actions,
        "data_caveat": caveat,
    }


def _structured_to_plain_text(structured, lang="en"):
    parts = []
    if structured.get("headline"):
        parts.append(structured["headline"])
        parts.append("")
    if structured.get("summary"):
        parts.append(structured["summary"])
        parts.append("")
    if structured.get("key_signals"):
        parts.append("মূল সংকেতসমূহ:" if lang == "bn" else "Key Signals:")
        for sig in structured["key_signals"]:
            parts.append(f"- {sig}")
        parts.append("")
    if structured.get("recommended_actions"):
        parts.append("প্রস্তাবিত পদক্ষেপ:" if lang == "bn" else "Recommended Actions:")
        for idx, act in enumerate(structured["recommended_actions"], start=1):
            parts.append(f"{idx}. {act}")
        parts.append("")
    if structured.get("data_caveat"):
        prefix = "ডেটা নোট: " if lang == "bn" else "Data Note: "
        parts.append(f"{prefix}{structured['data_caveat']}")
    return "\n".join(parts).strip()


def _deterministic_structured_briefing(location_name, analysis, risk_result, tree_data, language="en"):
    analysis = analysis or {}
    risk_result = risk_result or {}
    tree_data = tree_data or {}

    risk_level = risk_result.get("risk_level", "UNKNOWN")
    confidence = risk_result.get("confidence")
    ndvi = analysis.get("current_ndvi")
    loss = analysis.get("vegetation_loss")
    coverage = analysis.get("current_coverage_percent")
    rainfall = analysis.get("rainfall")
    yoy_delta = analysis.get("yoy_ndvi_change")
    hist = analysis.get("historical_forest_loss") or {}
    recent_5yr = hist.get("recent_5_year_loss_hectares")
    trees = tree_data.get("minimum_trees")

    ndvi_txt = f"{ndvi:.3f}" if isinstance(ndvi, (int, float)) else "N/A"
    loss_txt = f"{loss:.1f}%" if isinstance(loss, (int, float)) else "N/A"
    cov_txt = f"{coverage:.1f}%" if isinstance(coverage, (int, float)) else "N/A"
    rain_txt = f"{rainfall:.1f} mm" if isinstance(rainfall, (int, float)) else "N/A"
    recent_txt = f"{recent_5yr:,.2f} ha" if isinstance(recent_5yr, (int, float)) else "N/A"
    trees_txt = f"{trees:,}" if isinstance(trees, int) else "N/A"
    conf_txt = f" ({confidence:.0f}%)" if isinstance(confidence, (int, float)) else ""

    if language == "bn":
        return {
            "headline": f"{location_name} — ঝুঁকির মাত্রা: {risk_level}{conf_txt}",
            "summary": (
                f"বর্তমান স্যাটেলাইট পর্যবেক্ষণে গড় NDVI {ndvi_txt} এবং আনুমানিক সবুজ আচ্ছাদন {cov_txt} রেকর্ড হয়েছে। "
                f"স্বল্পমেয়াদি উদ্ভিদ পরিবর্তনের হার {loss_txt} এবং বৃষ্টিপাত {rain_txt}।"
            ),
            "key_signals": [
                f"বর্তমান Sentinel-2 গড় NDVI: {ndvi_txt} (সবুজ আচ্ছাদন {cov_txt})",
                f"৬০-দিনের উদ্ভিদ এলাকা হ্রাস: {loss_txt}",
                f"CHIRPS বৃষ্টিপাত: {rain_txt}",
                f"২০২১-২০২৫ Hansen বনক্ষয়: {recent_txt}",
            ],
            "recommended_actions": [
                "কম NDVI যুক্ত অংশে মাঠপর্যায়ের যাচাই পরিচালনা করুন।",
                f"উপযুক্ত অ-কৃষি ও অ-জলাভূমি এলাকায় স্থানীয় প্রজাতির আনুমানিক {trees_txt}টি চারা রোপণের পরিকল্পনা করুন।",
                "৩০ দিন পর পুনরায় Sentinel-2 পর্যবেক্ষণ চালিয়ে পরিবর্তন নিশ্চিত করুন।",
            ],
            "data_caveat": "স্যাটেলাইট সূচক সিদ্ধান্ত-সহায়ক তথ্য প্রদান করে; চূড়ান্ত নিশ্চিতকরণের জন্য মাঠ যাচাই প্রয়োজন।",
        }

    yoy_signal = (
        f"Year-over-year NDVI delta: {yoy_delta:+.3f}"
        if isinstance(yoy_delta, (int, float))
        else "Year-over-year NDVI baseline unavailable"
    )

    return {
        "headline": f"{location_name} — {risk_level} Risk{conf_txt}",
        "summary": (
            f"Sentinel-2 shows mean NDVI of {ndvi_txt} with {cov_txt} estimated green coverage. "
            f"Short-term 60-day vegetation decline is {loss_txt} alongside {rain_txt} recorded rainfall."
        ),
        "key_signals": [
            f"Mean NDVI {ndvi_txt} with {cov_txt} green coverage",
            f"60-day vegetation area decline: {loss_txt}",
            yoy_signal,
            f"CHIRPS 60-day rainfall: {rain_txt}",
            f"Hansen 2021-2025 gross forest loss: {recent_txt}",
        ],
        "recommended_actions": [
            "Verify low-NDVI and recent-loss sub-zones on the ground before declaring permanent clearing.",
            f"Plan phased native-species restoration (indicative estimate: {trees_txt} trees) on suitable non-wetland land.",
            f"Keep {location_name} on your EcoGuard Watchlist for recurring seasonal monitoring.",
        ],
        "data_caveat": "Satellite risk labels are decision-support indicators and should be paired with field verification.",
    }


def generate_environmental_briefing(
    location_name,
    analysis,
    risk_result=None,
    tree_data=None,
    language="en",
    model=None,
):
    """
    Generate a clean, structured environmental briefing using DeepSeek,
    with strict system prompting, script hygiene, primary->free failover,
    and deterministic fallback.
    """
    lang = "bn" if str(language).lower().startswith("bn") else "en"
    context = _compact_context(location_name, analysis, risk_result, tree_data)

    if lang == "bn":
        language_rules = (
            "Write ALL text values strictly in natural, fluent, standard Bangla (বাংলা). "
            "Technical acronyms like NDVI, EVI, NBR, CHIRPS, and Hansen may remain in English letters. "
            "NEVER output Chinese, Japanese, or Korean characters (zero CJK characters allowed). "
            "Keep sentences short, crisp, and easy for a Bangladeshi forestry officer to scan."
        )
    else:
        language_rules = (
            "Write ALL text values in crisp, executive, technical English. "
            "Keep sentences short, concrete, and scannable."
        )

    system_prompt = (
        "You are EcoGuard's Senior Remote Sensing & Forestry Intelligence Analyst for Bangladesh.\n"
        "STRICT RULES:\n"
        "1. ONLY cite numbers explicitly present in the input JSON. Never invent numbers, dates, or causes.\n"
        "2. If a metric is null, mention it briefly in data_caveat rather than repeating 'null' in every sentence.\n"
        "3. Distinguish seasonal rainfall/phenology shifts from active clearing or fire signals (dNBR).\n"
        "4. NEVER use emojis or markdown asterisks (** or ##) inside JSON strings.\n"
        f"5. {language_rules}\n\n"
        "OUTPUT FORMAT:\n"
        "Return ONLY a valid JSON object matching this exact schema (no extra prose outside the JSON):\n"
        "{\n"
        '  "headline": "Short 1-line executive status headline (max 12 words)",\n'
        '  "summary": "2-3 concise sentences summarizing current canopy health and change.",\n'
        '  "key_signals": ["3 to 5 short bullet strings citing exact telemetry metrics"],\n'
        '  "recommended_actions": ["3 concrete, prioritized field or monitoring actions"],\n'
        '  "data_caveat": "1 concise sentence noting data limitations or field verification need"\n'
        "}"
    )

    user_prompt = (
        "Generate the structured EcoGuard executive briefing JSON for this grounded satellite telemetry:\n"
        f"{json.dumps(context, indent=2, default=str)}"
    )

    raw_text, model_used, error = _call_openai_compatible(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        requested_model=model,
        temperature=0.2,
        max_tokens=850,
    )

    if raw_text:
        structured = _parse_structured_briefing(raw_text, lang=lang)
        if structured:
            plain = _structured_to_plain_text(structured, lang=lang)
            return {
                "briefing": plain,
                "structured": structured,
                "model_used": model_used,
                "language": lang,
                "fallback_used": False,
                "error": None,
            }
        # Clean fallback if model replied in prose instead of strict JSON
        sanitized = _sanitize_output(raw_text, lang=lang)
        return {
            "briefing": sanitized,
            "structured": None,
            "model_used": model_used,
            "language": lang,
            "fallback_used": False,
            "error": None,
        }

    fallback_struct = _deterministic_structured_briefing(
        location_name, analysis, risk_result, tree_data, language=lang
    )
    return {
        "briefing": _structured_to_plain_text(fallback_struct, lang=lang),
        "structured": fallback_struct,
        "model_used": "deterministic-fallback",
        "language": lang,
        "fallback_used": True,
        "error": error,
    }


def chat_with_report(
    question,
    report_context,
    history=None,
    language="en",
    model=None,
):
    """
    Interactive grounded Q&A about an EcoGuard forest analysis report.
    """
    question = (question or "").strip()
    if not question:
        raise ValueError("Question cannot be empty.")

    lang = "bn" if str(language).lower().startswith("bn") else "en"
    lang_instruction = (
        "Answer strictly in natural, fluent Bangla (বাংলা). Never include Chinese/CJK characters. "
        "Keep acronyms like NDVI/EVI/NBR in English letters."
        if lang == "bn"
        else "Answer in crisp, clear, practical English."
    )

    system_prompt = (
        "You are EcoGuard AI Copilot, a geospatial forest-monitoring specialist for Bangladesh.\n"
        "STRICT RULES:\n"
        "1. Ground every answer strictly in the Active Forest Report Context JSON below.\n"
        "2. Never invent statistics. If a metric is null/missing, state that concisely.\n"
        "3. Structure your answer cleanly: start with a 1-2 sentence direct answer, then up to 4 concise bullet points using '- '.\n"
        "4. Do NOT use emojis. Keep total length under 180 words.\n"
        f"5. {lang_instruction}\n\n"
        f"Active Forest Report Context:\n{json.dumps(report_context or {}, default=str)}"
    )

    messages = [{"role": "system", "content": system_prompt}]
    for turn in (history or [])[-8:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": question})

    text, model_used, error = _call_openai_compatible(
        messages,
        requested_model=model,
        temperature=0.25,
        max_tokens=600,
    )

    if text:
        return {
            "reply": _sanitize_output(text, lang=lang),
            "model_used": model_used,
            "language": lang,
            "fallback_used": False,
            "error": None,
        }

    location = (report_context or {}).get("location") or "the selected area"
    risk = ((report_context or {}).get("risk_assessment") or {}).get("risk_level") or "UNKNOWN"
    veg = (report_context or {}).get("vegetation_metrics") or {}
    ndvi = veg.get("current_ndvi")
    loss = veg.get("vegetation_loss_percent")

    if lang == "bn":
        fallback_reply = (
            f"DeepSeek AI বর্তমানে অফলাইন ফলব্যাক মোডে আছে ({error})।\n"
            f"- অবস্থান: {location}\n"
            f"- ঝুঁকির মাত্রা: {risk}\n"
            f"- বর্তমান NDVI: {ndvi if ndvi is not None else 'N/A'}\n"
            f"- ৬০-দিনের উদ্ভিদ হ্রাস: {loss if loss is not None else 'N/A'}%"
        )
    else:
        fallback_reply = (
            f"DeepSeek AI is currently running in offline fallback mode ({error}).\n"
            f"- Location: {location}\n"
            f"- Risk level: {risk}\n"
            f"- Current NDVI: {ndvi if ndvi is not None else 'N/A'}\n"
            f"- 60-day vegetation loss: {loss if loss is not None else 'N/A'}%"
        )

    return {
        "reply": fallback_reply,
        "model_used": "deterministic-fallback",
        "language": lang,
        "fallback_used": True,
        "error": error,
    }
