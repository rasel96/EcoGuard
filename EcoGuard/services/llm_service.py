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

logger = logging.getLogger("ecoguard.llm")

DEFAULT_LLM_BASE_URL = "https://tokenharbor.ai/v1"
DEFAULT_PRIMARY_MODEL = "deepseek-v4.1-flash-1017"
DEFAULT_FALLBACK_MODEL = "deepseek-v4.1-flash:free"

ALLOWED_MODELS = (
    DEFAULT_PRIMARY_MODEL,
    DEFAULT_FALLBACK_MODEL,
)


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


def _call_openai_compatible(messages, requested_model=None, temperature=0.3, max_tokens=700):
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


def _deterministic_briefing(location_name, analysis, risk_result, tree_data, language="en"):
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
    conf_txt = f" ({confidence:.0f}% confidence)" if isinstance(confidence, (int, float)) else ""

    if language == "bn":
        return (
            f"অবস্থান: {location_name}\n"
            f"ঝুঁকির মাত্রা: {risk_level}{conf_txt}\n\n"
            f"সারসংক্ষেপ:\n"
            f"- বর্তমান NDVI সূচক {ndvi_txt} এবং আনুমানিক সবুজ আচ্ছাদন {cov_txt}।\n"
            f"- পূর্ববর্তী ৬০ দিনের তুলনায় উদ্ভিদ এলাকা পরিবর্তনের হার {loss_txt} এবং বৃষ্টিপাত {rain_txt}।\n"
            f"- ২০২১–২০২৫ সময়ে Hansen স্যাটেলাইট ডেটা অনুযায়ী মোট বনক্ষয় {recent_txt}।\n\n"
            f"প্রস্তাবিত পদক্ষেপ:\n"
            f"1. স্যাটেলাইটে কম NDVI যুক্ত অংশে মাঠপর্যায়ের যাচাই পরিচালনা করুন।\n"
            f"2. লক্ষ্য সবুজ আচ্ছাদন পূরণে স্থানীয় প্রজাতির আনুমানিক {trees_txt}টি চারা রোপণের পরিকল্পনা করুন (জলাভূমি ও কৃষি জমি বাদে)।\n"
            f"3. ৩০ দিন পর পুনরায় Sentinel-2 পর্যবেক্ষণ চালিয়ে পরিবর্তন নিশ্চিত করুন।"
        )

    yoy_note = ""
    if isinstance(yoy_delta, (int, float)):
        direction = "above" if yoy_delta >= 0 else "below"
        yoy_note = f" Year-over-year NDVI is {abs(yoy_delta):.3f} {direction} the same seasonal window last year."

    return (
        f"Executive Briefing — {location_name}\n"
        f"Risk Classification: {risk_level}{conf_txt}\n\n"
        f"Key Findings:\n"
        f"- Current Sentinel-2 mean NDVI is {ndvi_txt} with estimated green coverage of {cov_txt}.{yoy_note}\n"
        f"- Short-term 60-day vegetation loss is estimated at {loss_txt} alongside {rain_txt} recorded rainfall.\n"
        f"- Historical Hansen GFC data shows {recent_txt} of gross forest-cover loss during 2021–2025.\n\n"
        f"Recommended Actions:\n"
        f"1. Prioritize ground verification in low-NDVI and recent-loss sub-zones before declaring permanent clearing.\n"
        f"2. Plan phased native-species restoration (indicative gap estimate: {trees_txt} trees) strictly on non-wetland, non-agricultural suitable land.\n"
        f"3. Add {location_name} to the EcoGuard Watchlist for recurring seasonal monitoring."
    )


def generate_environmental_briefing(
    location_name,
    analysis,
    risk_result=None,
    tree_data=None,
    language="en",
    model=None,
):
    """
    Generate a grounded environmental analyst briefing using DeepSeek,
    with automatic primary->fallback failover and deterministic fallback.
    """
    lang = "bn" if str(language).lower().startswith("bn") else "en"
    context = _compact_context(location_name, analysis, risk_result, tree_data)

    lang_instruction = (
        "Respond strictly in clear, professional Bangla (বাংলা)."
        if lang == "bn"
        else "Respond in clear, concise, technical English."
    )

    system_prompt = (
        "You are EcoGuard's Senior Remote Sensing & Forestry Analyst specializing in Bangladesh ecosystems. "
        "ONLY cite numbers present in the provided JSON telemetry. Never invent statistics, coordinates, or dates. "
        "Distinguish seasonal rainfall/phenology effects from potential deforestation, and note when field verification is needed. "
        f"{lang_instruction} "
        "Structure your response into three short sections: 1) Situation Summary, 2) Key Drivers & Signals, 3) Recommended Field Actions. "
        "Do not use emojis."
    )

    user_prompt = (
        "Analyze the following grounded satellite and ML telemetry and write an actionable briefing:\n"
        f"{json.dumps(context, indent=2, default=str)}"
    )

    text, model_used, error = _call_openai_compatible(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        requested_model=model,
        temperature=0.25,
        max_tokens=750,
    )

    if text:
        return {
            "briefing": text,
            "model_used": model_used,
            "language": lang,
            "fallback_used": False,
            "error": None,
        }

    return {
        "briefing": _deterministic_briefing(
            location_name, analysis, risk_result, tree_data, language=lang
        ),
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
        "Answer in clear Bangla (বাংলা)."
        if lang == "bn"
        else "Answer in clear, concise English."
    )

    system_prompt = (
        "You are EcoGuard AI Copilot, a geospatial and forest-monitoring assistant for Bangladesh. "
        "Ground every answer strictly in the provided satellite report context. "
        "If a metric is missing or null in the context, state that explicitly rather than guessing. "
        f"{lang_instruction} Keep answers concise, practical, and free of emojis.\n\n"
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
        temperature=0.3,
        max_tokens=650,
    )

    if text:
        return {
            "reply": text,
            "model_used": model_used,
            "language": lang,
            "fallback_used": False,
            "error": None,
        }

    # Helpful deterministic fallback when LLM key is not set yet
    location = (report_context or {}).get("location") or "the selected area"
    risk = ((report_context or {}).get("risk_assessment") or {}).get("risk_level") or "UNKNOWN"
    veg = (report_context or {}).get("vegetation_metrics") or {}
    ndvi = veg.get("current_ndvi")
    loss = veg.get("vegetation_loss_percent")

    if lang == "bn":
        fallback_reply = (
            f"DeepSeek API key এখনো সেট করা হয়নি ({error})। "
            f"বর্তমান সংরক্ষিত ডেটা অনুযায়ী {location}-এর ঝুঁকির মাত্রা {risk}, "
            f"NDVI {ndvi if ndvi is not None else 'N/A'}, এবং ৬০-দিনের উদ্ভিদ হ্রাস {loss if loss is not None else 'N/A'}%। "
            "সম্পূর্ণ AI বিশ্লেষণের জন্য `.env` ফাইলে `LLM_API_KEY` যোগ করুন।"
        )
    else:
        fallback_reply = (
            f"DeepSeek AI is currently running in offline fallback mode ({error}). "
            f"Based on the grounded telemetry for {location}, risk is {risk}, "
            f"current NDVI is {ndvi if ndvi is not None else 'N/A'}, and 60-day vegetation loss is "
            f"{loss if loss is not None else 'N/A'}%. Add your LLM_API_KEY to .env to enable live DeepSeek responses."
        )

    return {
        "reply": fallback_reply,
        "model_used": "deterministic-fallback",
        "language": lang,
        "fallback_used": True,
        "error": error,
    }
