"""
EcoGuard REST API v1 Blueprint.

Designed for the Next.js frontend and external integrations:
- Bearer token (itsdangerous signed) + Flask session dual auth
- Per-IP sliding-window rate limiting
- Custom GeoJSON polygon & Bangladesh place analysis
- DeepSeek LLM grounded briefing & interactive Q&A (via TokenHarbor)
- Watchlists, Analysis History, Alert Triage, PDF & CSV exports
"""

import io
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict, deque
from functools import wraps

from flask import Blueprint, Response, current_app, jsonify, request, send_file, session
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import func, or_
from werkzeug.security import check_password_hash, generate_password_hash

from services.llm_service import (
    chat_with_report,
    generate_environmental_briefing,
    get_llm_status,
)
from services.ml_service import assess_risk
from services.report_service import alerts_to_csv, build_pdf_report

logger = logging.getLogger("ecoguard.api_v1")

api_v1 = Blueprint("api_v1", __name__, url_prefix="/api/v1")

AUTH_TOKEN_SALT = "ecoguard-api-auth-v1"
AUTH_TOKEN_MAX_AGE = int(os.getenv("API_TOKEN_MAX_AGE", str(60 * 60 * 24)))  # 24h default

_MAX_RATE_BUCKETS = 5000
_rate_buckets = OrderedDict()
_rate_lock = threading.Lock()


def _get_client_ip():
    trust_proxy = os.getenv("TRUST_PROXY", "false").lower() == "true"
    if trust_proxy:
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            # Take the right-most proxy-appended client IP (prevents client header spoofing)
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if parts:
                return parts[-1]
    return request.remote_addr or "local"


def _check_rate_limit(bucket_name, max_requests=60, window_seconds=60):
    if current_app.config.get("TESTING"):
        return True
    client_ip = _get_client_ip()
    key = f"{bucket_name}:{client_ip}"
    now = time.monotonic()
    with _rate_lock:
        q = _rate_buckets.get(key)
        if q is None:
            q = deque()
            _rate_buckets[key] = q
        else:
            _rate_buckets.move_to_end(key)

        while q and now - q[0] > window_seconds:
            q.popleft()

        if len(q) >= max_requests:
            return False

        q.append(now)
        while len(_rate_buckets) > _MAX_RATE_BUCKETS:
            _rate_buckets.popitem(last=False)
        return True


def _get_api_serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"])


def create_api_token(user_id, token_version=1):
    return _get_api_serializer().dumps(
        {"uid": int(user_id), "tv": int(token_version or 1)},
        salt=AUTH_TOKEN_SALT,
    )


def verify_api_token(token):
    try:
        data = _get_api_serializer().loads(
            token, salt=AUTH_TOKEN_SALT, max_age=AUTH_TOKEN_MAX_AGE
        )
        return int(data["uid"]), int(data.get("tv", 1))
    except (SignatureExpired, BadSignature, KeyError, ValueError, TypeError):
        return None, None


_bound_app_module = None


def bind_app_module(module):
    """Bind the active app module (prevents __main__ vs app dual-import issues)."""
    global _bound_app_module
    _bound_app_module = module


def _get_app_module():
    if _bound_app_module is not None:
        return _bound_app_module
    import sys
    main_mod = sys.modules.get("__main__")
    if main_mod is not None and hasattr(main_mod, "db") and hasattr(main_mod, "User"):
        return main_mod
    import app as main_app
    return main_app


def _user_alerts_query(main_app, user):
    """Scope alerts strictly to the current user (admin also sees legacy unowned alerts)."""
    if user.username == "admin":
        return main_app.Alert.query.filter(
            or_(main_app.Alert.user_id == user.id, main_app.Alert.user_id.is_(None))
        )
    return main_app.Alert.query.filter_by(user_id=user.id)


def get_current_api_user():
    main_app = _get_app_module()
    auth_header = request.headers.get("Authorization", "")
    user_id = None
    token_ver = None

    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        user_id, token_ver = verify_api_token(token)
        if user_id is None:
            return None

    if user_id is None:
        user_id = session.get("user_id")

    if not user_id:
        return None

    user = main_app.db.session.get(main_app.User, user_id)
    if not user or not user.is_verified:
        return None

    if token_ver is not None and int(user.token_version or 1) != token_ver:
        return None

    return user


def api_auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_api_user()
        if not user:
            return jsonify({"error": "Authentication required."}), 401
        return fn(user, *args, **kwargs)
    return wrapper


def _serialize_user(user):
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name or user.username,
        "email": user.email,
        "is_verified": bool(user.is_verified),
        "role": "admin" if user.username == "admin" else "analyst",
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def _serialize_alert(alert):
    return {
        "id": alert.id,
        "location": alert.location,
        "latitude": alert.latitude,
        "longitude": alert.longitude,
        "risk_level": alert.risk_level,
        "status": alert.status or "open",
        "notes": alert.notes or "",
        "ndvi": alert.ndvi,
        "vegetation_loss": alert.vegetation_loss,
        "email_status": alert.email_status,
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


def _serialize_analysis_run(run, include_full=False):
    metrics = {}
    if run.metrics_json:
        try:
            metrics = json.loads(run.metrics_json)
        except Exception:
            metrics = {}
    payload = {
        "id": run.id,
        "location": run.location,
        "latitude": run.latitude,
        "longitude": run.longitude,
        "geometry_type": run.geometry_type,
        "risk_level": run.risk_level,
        "confidence": run.confidence,
        "current_ndvi": run.current_ndvi,
        "vegetation_loss": run.vegetation_loss,
        "coverage_percent": run.coverage_percent,
        "rainfall": run.rainfall,
        "ai_model": run.ai_model,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }
    if include_full:
        payload["ai_briefing"] = run.ai_briefing
        payload["metrics"] = metrics
    return payload


def _serialize_watchlist(item):
    bbox = None
    geojson = None
    try:
        if item.boundingbox_json:
            bbox = json.loads(item.boundingbox_json)
    except Exception:
        bbox = None
    try:
        if item.geojson_json:
            geojson = json.loads(item.geojson_json)
    except Exception:
        geojson = None

    return {
        "id": item.id,
        "name": item.name,
        "latitude": item.latitude,
        "longitude": item.longitude,
        "boundingbox": bbox,
        "geojson": geojson,
        "target_coverage": item.target_coverage,
        "last_risk": item.last_risk,
        "last_ndvi": item.last_ndvi,
        "last_checked_at": item.last_checked_at.isoformat() if item.last_checked_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


# ------------------------------------------------------------
# 1. SYSTEM HEALTH & STATUS
# ------------------------------------------------------------

@api_v1.route("/health", methods=["GET"])
def api_health():
    main_app = _get_app_module()
    import gee_service

    return jsonify({
        "status": "ok",
        "service": "EcoGuard API v1",
        "ml_model_loaded": main_app.model is not None,
        "gee_initialized": bool(gee_service._ee_initialized),
        "llm": get_llm_status(),
        "green_target": main_app.GREEN_TARGET,
        "trees_per_hectare": main_app.TREES_PER_HECTARE,
    })


# ------------------------------------------------------------
# 2. AUTHENTICATION
# ------------------------------------------------------------

@api_v1.route("/auth/login", methods=["POST"])
def api_login():
    if not _check_rate_limit("login", max_requests=20, window_seconds=60):
        return jsonify({"error": "Too many login attempts. Please wait a minute."}), 429

    main_app = _get_app_module()
    body = request.get_json(silent=True) or {}
    login_value = (body.get("email_or_username") or body.get("username") or body.get("email") or "").strip()
    password = body.get("password") or ""

    if not login_value or not password:
        return jsonify({"error": "Username/email and password are required."}), 400

    user = main_app.User.query.filter(
        func.lower(main_app.User.username) == login_value.lower()
    ).first()

    if not user and "@" in login_value:
        user = main_app.User.query.filter(
            func.lower(main_app.User.email) == login_value.lower()
        ).first()

    if not user or not check_password_hash(user.password, password):
        return jsonify({"error": "Invalid credentials."}), 401

    if not user.is_verified:
        return jsonify({"error": "Email is not verified yet."}), 403

    token = create_api_token(user.id, user.token_version)
    session["user_id"] = user.id
    session["username"] = user.username
    session["full_name"] = user.full_name or user.username

    return jsonify({
        "token": token,
        "user": _serialize_user(user),
    })


@api_v1.route("/auth/logout", methods=["POST"])
@api_auth_required
def api_logout(user):
    main_app = _get_app_module()
    user.token_version = int(user.token_version or 1) + 1
    main_app.db.session.commit()
    session.clear()
    return jsonify({"logged_out": True})


@api_v1.route("/auth/signup", methods=["POST"])
def api_signup():
    if not _check_rate_limit("signup", max_requests=10, window_seconds=60):
        return jsonify({"error": "Too many registration attempts. Please try later."}), 429

    main_app = _get_app_module()
    body = request.get_json(silent=True) or {}

    full_name = (body.get("full_name") or "").strip()
    username = (body.get("username") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not full_name or not username or not email or not password:
        return jsonify({"error": "All fields are required."}), 400
    if not main_app.validate_username(username):
        return jsonify({"error": "Username must be 3-30 characters (letters, numbers, dots, underscores)."}), 400
    if not main_app.validate_email(email):
        return jsonify({"error": "Invalid email address."}), 400
    if not main_app.validate_password(password):
        return jsonify({"error": "Password must be at least 8 characters and include letters and numbers."}), 400

    if main_app.User.query.filter(func.lower(main_app.User.username) == username.lower()).first():
        return jsonify({"error": "Username is already taken."}), 409
    if main_app.User.query.filter(func.lower(main_app.User.email) == email).first():
        return jsonify({"error": "Email is already registered."}), 409

    smtp_configured = bool(main_app.os.getenv("MAIL_USERNAME") and main_app.os.getenv("MAIL_PASSWORD"))
    allow_dev_unverified = (
        os.getenv("ALLOW_UNVERIFIED_DEV_SIGNUP", "false").lower() == "true"
        or bool(current_app.config.get("TESTING"))
    )

    if not smtp_configured and not allow_dev_unverified:
        return jsonify({
            "error": "Email verification service is not configured. Contact the administrator."
        }), 503

    auto_verify = (not smtp_configured) and allow_dev_unverified
    user = main_app.User(
        full_name=full_name,
        username=username,
        email=email,
        password=generate_password_hash(password),
        is_verified=auto_verify,
        token_version=1,
    )
    main_app.db.session.add(user)
    main_app.db.session.commit()

    email_sent = False
    if smtp_configured:
        email_sent = main_app.send_verification_email(user)

    token = create_api_token(user.id, user.token_version) if user.is_verified else None
    return jsonify({
        "user": _serialize_user(user),
        "token": token,
        "requires_verification": not auto_verify,
        "verification_email_sent": email_sent,
    }), 201


@api_v1.route("/auth/me", methods=["GET"])
@api_auth_required
def api_me(user):
    return jsonify({"user": _serialize_user(user)})


# ------------------------------------------------------------
# 3. DASHBOARD & LOCATIONS
# ------------------------------------------------------------

@api_v1.route("/dashboard", methods=["GET"])
@api_auth_required
def api_dashboard(user):
    main_app = _get_app_module()

    user_alerts_q = _user_alerts_query(main_app, user)
    recent_alerts = user_alerts_q.order_by(main_app.Alert.created_at.desc()).limit(10).all()
    recent_runs = (
        main_app.AnalysisRun.query
        .filter_by(user_id=user.id)
        .order_by(main_app.AnalysisRun.created_at.desc())
        .limit(8)
        .all()
    )
    watchlists = (
        main_app.Watchlist.query
        .filter_by(user_id=user.id)
        .order_by(main_app.Watchlist.created_at.desc())
        .all()
    )

    return jsonify({
        "user": _serialize_user(user),
        "stats": {
            "total_alerts": user_alerts_q.count(),
            "open_alerts": user_alerts_q.filter_by(status="open").count(),
            "high_risk_count": user_alerts_q.filter_by(risk_level="HIGH").count(),
            "medium_risk_count": user_alerts_q.filter_by(risk_level="MEDIUM").count(),
            "low_risk_count": user_alerts_q.filter_by(risk_level="LOW").count(),
            "total_analyses": main_app.AnalysisRun.query.filter_by(user_id=user.id).count(),
            "watchlist_count": len(watchlists),
            "green_target": main_app.GREEN_TARGET,
        },
        "llm": get_llm_status(),
        "recent_alerts": [_serialize_alert(a) for a in recent_alerts],
        "recent_analyses": [_serialize_analysis_run(r) for r in recent_runs],
        "watchlists": [_serialize_watchlist(w) for w in watchlists],
    })


@api_v1.route("/locations/suggest", methods=["GET"])
@api_auth_required
def api_location_suggest(user):
    main_app = _get_app_module()
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify({"suggestions": []})
    results = main_app.suggest_locations(q, limit=7)
    return jsonify({"suggestions": results})


# ------------------------------------------------------------
# 4. SATELLITE ANALYSIS (LOCATION OR CUSTOM GEOJSON POLYGON)
# ------------------------------------------------------------

def _centroid_from_geojson(geojson_geometry):
    geom = geojson_geometry.get("geometry", geojson_geometry)
    coords = geom.get("coordinates", [])
    ring = coords[0] if geom.get("type") == "Polygon" else coords[0][0]
    lons = [float(pt[0]) for pt in ring]
    lats = [float(pt[1]) for pt in ring]
    return sum(lats) / len(lats), sum(lons) / len(lons)


@api_v1.route("/analyze", methods=["POST"])
@api_auth_required
def api_analyze(user):
    if not _check_rate_limit("analyze", max_requests=15, window_seconds=60):
        return jsonify({"error": "Rate limit exceeded for satellite analysis. Please wait."}), 429

    main_app = _get_app_module()
    body = request.get_json(silent=True) or {}

    place_name = (body.get("location") or "").strip()
    geojson_geometry = body.get("geojson")
    include_extended = bool(body.get("include_extended", True))
    include_ai = bool(body.get("include_ai", True))
    language = body.get("language", "en")
    requested_model = body.get("model")

    if not place_name and not geojson_geometry:
        return jsonify({"error": "Provide either a 'location' name or a 'geojson' polygon."}), 400

    location_data = None
    bounding_box = None

    if geojson_geometry is not None:
        try:
            lat, lon = _centroid_from_geojson(geojson_geometry)
        except Exception as err:
            return jsonify({"error": f"Invalid GeoJSON polygon: {err}"}), 400
        label = place_name or f"Custom Polygon ({lat:.4f}, {lon:.4f})"
        location_data = {
            "name": label,
            "latitude": lat,
            "longitude": lon,
            "boundingbox": None,
            "boundary_type": "Custom GeoJSON Polygon",
        }
    else:
        location_data = main_app.get_location(place_name)
        if not location_data or not location_data.get("boundingbox"):
            return jsonify({"error": f"Location '{place_name}' could not be geocoded in Bangladesh."}), 404
        bounding_box = location_data["boundingbox"]

    try:
        analysis_data = main_app.analyze_area(
            bounding_box=bounding_box,
            geojson_geometry=geojson_geometry,
            include_extended=include_extended,
        )
    except Exception as err:
        logger.error("API /analyze GEE error: %s", err)
        return jsonify({"error": f"Satellite analysis failed: {err}"}), 502

    hist = analysis_data.get("historical_forest_loss") or {}
    risk_result = assess_risk(
        analysis_data.get("current_ndvi"),
        analysis_data.get("vegetation_loss"),
        previous_ndvi=analysis_data.get("previous_ndvi"),
        rainfall=analysis_data.get("rainfall"),
        yoy_ndvi_change=analysis_data.get("yoy_ndvi_change"),
        recent_5yr_loss_ha=hist.get("recent_5_year_loss_hectares"),
        dnbr=analysis_data.get("dnbr"),
        model_override=main_app.model,
        encoder_override=main_app.encoder,
    )

    risk_level = risk_result["risk_level"]
    explanations = main_app.simple_explanations(analysis_data, risk_level)
    tree_data = main_app.calculate_tree_requirement(analysis_data)

    ai_result = None
    if include_ai:
        ai_result = generate_environmental_briefing(
            location_data["name"],
            analysis_data,
            risk_result=risk_result,
            tree_data=tree_data,
            language=language,
            model=requested_model,
        )

    email_status = "Not required"
    alert_record = None
    if risk_level in ("HIGH", "MEDIUM"):
        email_status = main_app.send_email_alert(
            location_data["name"],
            risk_level,
            analysis_data.get("current_ndvi"),
            analysis_data.get("vegetation_loss"),
        )
        alert_record = main_app.Alert(
            location=location_data["name"],
            latitude=location_data.get("latitude"),
            longitude=location_data.get("longitude"),
            risk_level=risk_level,
            status="open",
            ndvi=analysis_data.get("current_ndvi"),
            vegetation_loss=analysis_data.get("vegetation_loss"),
            email_status=email_status,
            sms_status="Not configured",
            user_id=user.id,
        )
        main_app.db.session.add(alert_record)

    run = main_app.AnalysisRun(
        user_id=user.id,
        location=location_data["name"],
        latitude=location_data.get("latitude"),
        longitude=location_data.get("longitude"),
        geometry_type="custom_polygon" if geojson_geometry is not None else "bounding_box",
        risk_level=risk_level,
        confidence=risk_result.get("confidence"),
        current_ndvi=analysis_data.get("current_ndvi"),
        vegetation_loss=analysis_data.get("vegetation_loss"),
        coverage_percent=analysis_data.get("current_coverage_percent"),
        rainfall=analysis_data.get("rainfall"),
        metrics_json=json.dumps(analysis_data, default=str),
        ai_briefing=(ai_result or {}).get("briefing"),
        ai_model=(ai_result or {}).get("model_used"),
    )
    main_app.db.session.add(run)

    # Update matching watchlist entry if present
    matching_wl = main_app.Watchlist.query.filter(
        main_app.Watchlist.user_id == user.id,
        func.lower(main_app.Watchlist.name) == location_data["name"].lower(),
    ).first()
    if matching_wl:
        matching_wl.last_risk = risk_level
        matching_wl.last_ndvi = analysis_data.get("current_ndvi")
        matching_wl.last_checked_at = main_app.utc_now()

    main_app.db.session.commit()

    return jsonify({
        "analysis_id": run.id,
        "location": location_data,
        "analysis": analysis_data,
        "risk": risk_result,
        "explanations": explanations,
        "tree_data": tree_data,
        "ai": ai_result,
        "alert": _serialize_alert(alert_record) if alert_record else None,
        "email_status": email_status,
    })


@api_v1.route("/green-coverage", methods=["POST"])
@api_auth_required
def api_green_coverage(user):
    main_app = _get_app_module()
    body = request.get_json(silent=True) or {}
    place_name = (body.get("location") or "").strip()
    geojson_geometry = body.get("geojson")

    if not place_name and not geojson_geometry:
        return jsonify({"error": "Provide either 'location' or 'geojson'."}), 400

    location_data = None
    bounding_box = None
    if geojson_geometry is not None:
        try:
            lat, lon = _centroid_from_geojson(geojson_geometry)
        except Exception as err:
            return jsonify({"error": f"Invalid GeoJSON polygon: {err}"}), 400
        location_data = {
            "name": place_name or f"Custom Polygon ({lat:.4f}, {lon:.4f})",
            "latitude": lat,
            "longitude": lon,
            "boundingbox": None,
            "boundary_type": "Custom GeoJSON Polygon",
        }
    else:
        location_data = main_app.get_location(place_name)
        if not location_data or not location_data.get("boundingbox"):
            return jsonify({"error": "Location not found."}), 404
        bounding_box = location_data["boundingbox"]

    try:
        gc_data = main_app.analyze_green_coverage(
            bounding_box=bounding_box,
            geojson_geometry=geojson_geometry,
        )
    except Exception as err:
        logger.error("API /green-coverage error: %s", err)
        return jsonify({"error": f"Green coverage analysis failed: {err}"}), 502

    return jsonify({
        "location": location_data,
        "green_coverage": gc_data,
        "green_target": main_app.GREEN_TARGET,
    })


# ------------------------------------------------------------
# 5. DEEPSEEK AI COPILOT ENDPOINTS
# ------------------------------------------------------------

@api_v1.route("/ai/briefing", methods=["POST"])
@api_auth_required
def api_ai_briefing(user):
    body = request.get_json(silent=True) or {}
    location_name = (body.get("location") or "Selected Area").strip()
    analysis = body.get("analysis") or {}
    risk_result = body.get("risk") or {}
    tree_data = body.get("tree_data") or {}
    language = body.get("language", "en")
    requested_model = body.get("model")

    result = generate_environmental_briefing(
        location_name,
        analysis,
        risk_result=risk_result,
        tree_data=tree_data,
        language=language,
        model=requested_model,
    )
    return jsonify(result)


@api_v1.route("/ai/chat", methods=["POST"])
@api_auth_required
def api_ai_chat(user):
    if not _check_rate_limit("ai_chat", max_requests=30, window_seconds=60):
        return jsonify({"error": "Too many AI requests. Please wait a moment."}), 429

    body = request.get_json(silent=True) or {}
    question = (body.get("question") or "").strip()
    if not question:
        return jsonify({"error": "Question is required."}), 400

    report_context = body.get("context") or {}
    history = body.get("history") or []
    language = body.get("language", "en")
    requested_model = body.get("model")

    result = chat_with_report(
        question=question,
        report_context=report_context,
        history=history,
        language=language,
        model=requested_model,
    )
    return jsonify(result)


# ------------------------------------------------------------
# 6. ANALYSIS HISTORY, WATCHLISTS & ALERTS
# ------------------------------------------------------------

@api_v1.route("/analyses", methods=["GET"])
@api_auth_required
def api_list_analyses(user):
    main_app = _get_app_module()
    runs = (
        main_app.AnalysisRun.query
        .filter_by(user_id=user.id)
        .order_by(main_app.AnalysisRun.created_at.desc())
        .limit(50)
        .all()
    )
    return jsonify({"analyses": [_serialize_analysis_run(r) for r in runs]})


@api_v1.route("/analyses/<int:run_id>", methods=["GET"])
@api_auth_required
def api_get_analysis(user, run_id):
    main_app = _get_app_module()
    run = main_app.AnalysisRun.query.filter_by(id=run_id, user_id=user.id).first()
    if not run:
        return jsonify({"error": "Analysis run not found."}), 404
    return jsonify({"analysis": _serialize_analysis_run(run, include_full=True)})


@api_v1.route("/watchlists", methods=["GET", "POST"])
@api_auth_required
def api_watchlists(user):
    main_app = _get_app_module()

    if request.method == "GET":
        items = (
            main_app.Watchlist.query
            .filter_by(user_id=user.id)
            .order_by(main_app.Watchlist.created_at.desc())
            .all()
        )
        return jsonify({"watchlists": [_serialize_watchlist(w) for w in items]})

    body = request.get_json(silent=True) or {}
    name = (body.get("name") or body.get("location") or "").strip()
    geojson = body.get("geojson")

    raw_target = body.get("target_coverage", main_app.GREEN_TARGET)
    try:
        target = float(raw_target)
    except (TypeError, ValueError):
        return jsonify({"error": "target_coverage must be a valid number between 1 and 100."}), 400
    if not (1 <= target <= 100):
        return jsonify({"error": "target_coverage must be between 1 and 100."}), 400

    if not name or len(name) > 255:
        return jsonify({"error": "Watchlist name is required (max 255 characters)."}), 400

    lat = body.get("latitude")
    lon = body.get("longitude")
    bbox = body.get("boundingbox")

    if lat is not None or lon is not None:
        try:
            lat = float(lat) if lat is not None else None
            lon = float(lon) if lon is not None else None
            if (lat is not None and not (-90 <= lat <= 90)) or (lon is not None and not (-180 <= lon <= 180)):
                return jsonify({"error": "latitude/longitude out of valid range."}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "latitude and longitude must be numeric."}), 400

    if lat is None or lon is None:
        if geojson is not None:
            try:
                lat, lon = _centroid_from_geojson(geojson)
            except Exception as err:
                return jsonify({"error": f"Invalid GeoJSON polygon: {err}"}), 400
        else:
            loc = main_app.get_location(name)
            if loc:
                name = loc["name"]
                lat = loc["latitude"]
                lon = loc["longitude"]
                bbox = loc["boundingbox"]

    item = main_app.Watchlist(
        user_id=user.id,
        name=name,
        latitude=lat,
        longitude=lon,
        boundingbox_json=json.dumps(bbox) if bbox else None,
        geojson_json=json.dumps(geojson) if geojson else None,
        target_coverage=target,
    )
    main_app.db.session.add(item)
    main_app.db.session.commit()
    return jsonify({"watchlist": _serialize_watchlist(item)}), 201


@api_v1.route("/watchlists/<int:wl_id>", methods=["DELETE"])
@api_auth_required
def api_delete_watchlist(user, wl_id):
    main_app = _get_app_module()
    item = main_app.Watchlist.query.filter_by(id=wl_id, user_id=user.id).first()
    if not item:
        return jsonify({"error": "Watchlist item not found."}), 404
    main_app.db.session.delete(item)
    main_app.db.session.commit()
    return jsonify({"deleted": True, "id": wl_id})


@api_v1.route("/alerts", methods=["GET"])
@api_auth_required
def api_list_alerts(user):
    main_app = _get_app_module()
    status_filter = request.args.get("status", "").strip().lower()
    risk_filter = request.args.get("risk_level", "").strip().upper()

    query = _user_alerts_query(main_app, user)
    if status_filter in ("open", "investigating", "resolved"):
        query = query.filter_by(status=status_filter)
    if risk_filter in ("HIGH", "MEDIUM", "LOW"):
        query = query.filter_by(risk_level=risk_filter)

    alerts = query.order_by(main_app.Alert.created_at.desc()).limit(100).all()
    return jsonify({"alerts": [_serialize_alert(a) for a in alerts]})


@api_v1.route("/alerts/<int:alert_id>", methods=["PATCH"])
@api_auth_required
def api_update_alert(user, alert_id):
    main_app = _get_app_module()
    alert = _user_alerts_query(main_app, user).filter_by(id=alert_id).first()
    if not alert:
        return jsonify({"error": "Alert not found."}), 404

    body = request.get_json(silent=True) or {}
    if "status" in body:
        new_status = str(body["status"]).strip().lower()
        if new_status not in ("open", "investigating", "resolved"):
            return jsonify({"error": "Status must be open, investigating, or resolved."}), 400
        alert.status = new_status

    if "notes" in body:
        alert.notes = str(body["notes"])[:1000]

    main_app.db.session.commit()
    return jsonify({"alert": _serialize_alert(alert)})


@api_v1.route("/alerts/export.csv", methods=["GET"])
@api_auth_required
def api_export_alerts_csv(user):
    main_app = _get_app_module()
    alerts = _user_alerts_query(main_app, user).order_by(main_app.Alert.created_at.desc()).all()
    csv_data = alerts_to_csv(alerts)
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=ecoguard_alerts.csv"},
    )


# ------------------------------------------------------------
# 7. RICH PDF REPORT EXPORT
# ------------------------------------------------------------

@api_v1.route("/reports/pdf", methods=["POST"])
@api_auth_required
def api_export_pdf(user):
    main_app = _get_app_module()
    body = request.get_json(silent=True) or {}
    location = (body.get("location") or "Selected Region").strip()
    analysis = body.get("analysis") or {}
    risk = body.get("risk") or {}
    tree_data = body.get("tree_data") or {}
    ai_briefing = (body.get("ai_briefing") or "").strip()

    hist = analysis.get("historical_forest_loss") or {}
    sections = [
        (
            "1. Monitoring Overview",
            [
                f"Generated (UTC): {main_app.utc_now().strftime('%Y-%m-%d %H:%M:%S')}",
                f"Analyst: {user.full_name or user.username}",
                f"Location: {location}",
                f"Risk Classification: {risk.get('risk_level', 'UNKNOWN')} (Confidence: {risk.get('confidence', 'N/A')}%)",
                f"Observation Window: {analysis.get('analysis_start', 'N/A')} to {analysis.get('analysis_end', 'N/A')}",
            ],
        ),
        (
            "2. Satellite Telemetry (Sentinel-2 & CHIRPS)",
            [
                f"Current Mean NDVI: {analysis.get('current_ndvi', 'N/A')}",
                f"Previous 60-Day NDVI: {analysis.get('previous_ndvi', 'N/A')}",
                f"Year-over-Year NDVI Change: {analysis.get('yoy_ndvi_change', 'N/A')}",
                f"Current EVI (Dense Canopy): {analysis.get('current_evi', 'N/A')}",
                f"Current NBR / Burn Delta (dNBR): {analysis.get('current_nbr', 'N/A')} / {analysis.get('dnbr', 'N/A')}",
                f"Estimated 60-Day Vegetation Loss: {analysis.get('vegetation_loss', 'N/A')}%",
                f"Current Green Coverage: {analysis.get('current_coverage_percent', 'N/A')}% (Target: {tree_data.get('target', main_app.GREEN_TARGET)}%)",
                f"Estimated Trees to Close Gap: {tree_data.get('minimum_trees', 'N/A')}",
                f"60-Day Rainfall (CHIRPS): {analysis.get('rainfall', 'N/A')} mm",
            ],
        ),
        (
            "3. Historical Forest Loss (Hansen GFC 2001-2025)",
            [
                f"Baseline Forest Area (Year 2000): {hist.get('baseline_forest_area_hectares', 'N/A')} ha",
                f"Total Gross Forest Loss (2001-2025): {hist.get('total_forest_loss_hectares', 'N/A')} ha ({hist.get('historical_loss_percent', 'N/A')}%)",
                f"Recent 5-Year Loss (2021-2025): {hist.get('recent_5_year_loss_hectares', 'N/A')} ha",
            ],
        ),
    ]

    if risk.get("factors"):
        sections.append(("4. Risk Contributing Factors", [f"- {f}" for f in risk["factors"]]))

    if ai_briefing:
        sections.append(("5. DeepSeek AI Environmental Briefing", ai_briefing.splitlines()))

    pdf_bytes = build_pdf_report(f"EcoGuard Satellite Intelligence Report - {location}", sections)
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", location).strip("_") or "report"
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"ecoguard_report_{safe_name[:40]}.pdf",
    )
