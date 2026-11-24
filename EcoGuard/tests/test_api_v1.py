from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import app as ecoguard_app
import gee_service
from services import llm_service, ml_service


def _auth_headers(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "tester", "password": "StrongPass123"},
    )
    assert resp.status_code == 200
    token = resp.get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _sample_extended_analysis():
    return {
        "current_ndvi": 0.22,
        "previous_ndvi": 0.56,
        "current_evi": 0.19,
        "previous_evi": 0.48,
        "current_nbr": 0.10,
        "previous_nbr": 0.35,
        "dnbr": 0.25,
        "yoy_ndvi": 0.58,
        "yoy_ndvi_change": -0.36,
        "monthly_ndvi": [
            {"month": "2026-09", "ndvi": 0.52, "image_count": 4},
            {"month": "2026-10", "ndvi": 0.38, "image_count": 5},
            {"month": "2026-11", "ndvi": 0.22, "image_count": 6},
        ],
        "ndvi_tile_url": "https://example.com/ndvi/{z}/{x}/{y}",
        "landcover_tile_url": "https://example.com/lc/{z}/{x}/{y}",
        "hansen_loss_tile_url": "https://example.com/hansen/{z}/{x}/{y}",
        "landcover_classes": [
            {"code": 10, "name": "Tree Cover", "area_m2": 600000.0, "area_hectares": 60.0, "percentage": 60.0},
            {"code": 50, "name": "Built-up", "area_m2": 400000.0, "area_hectares": 40.0, "percentage": 40.0},
        ],
        "vegetation_area_current": 300_000.0,
        "vegetation_area_previous": 650_000.0,
        "vegetation_loss": 53.85,
        "rainfall": 24.5,
        "ndvi_change": -0.34,
        "current_image_count": 6,
        "previous_image_count": 5,
        "total_area_m2": 1_000_000.0,
        "current_coverage_percent": 30.0,
        "analysis_start": "2026-09-25",
        "analysis_end": "2026-11-24",
        "previous_start": "2026-07-27",
        "previous_end": "2026-09-25",
        "bounding_box": None,
        "geometry_type": "custom_polygon",
        "historical_forest_loss": {
            "dataset": "UMD/hansen/global_forest_change_2025_v1_13",
            "dataset_start_year": 2001,
            "dataset_end_year": 2025,
            "canopy_threshold_percent": 30,
            "baseline_forest_area_m2": 700_000.0,
            "baseline_forest_area_hectares": 70.0,
            "total_forest_loss_m2": 80_000.0,
            "total_forest_loss_hectares": 8.0,
            "historical_loss_percent": 11.43,
            "recent_5_year_loss_m2": 25_000.0,
            "recent_5_year_loss_hectares": 2.5,
            "recent_period": "2021-2025",
            "annual_loss": [{"year": 2025, "loss_area_m2": 5000.0, "loss_area_hectares": 0.5}],
            "interpretation": "Gross loss",
        },
        "baseline_forest_area_hectares": 70.0,
        "historical_forest_loss_hectares": 8.0,
        "historical_forest_loss_percent": 11.43,
        "recent_5_year_forest_loss_hectares": 2.5,
        "annual_forest_loss": [{"year": 2025, "loss_area_m2": 5000.0, "loss_area_hectares": 0.5}],
        "forest_loss_dataset": "UMD/hansen/global_forest_change_2025_v1_13",
    }


def test_api_health_exposes_tokenharbor_and_deepseek_models(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ok"
    assert data["llm"]["base_url"] == "https://tokenharbor.ai/v1"
    assert "deepseek-v4.1-flash-1017" in data["llm"]["available_models"]
    assert "deepseek-v4.1-flash:free" in data["llm"]["available_models"]


def test_api_auth_required_and_login_flow(client):
    assert client.get("/api/v1/dashboard").status_code == 401
    headers = _auth_headers(client)
    me_resp = client.get("/api/v1/auth/me", headers=headers)
    assert me_resp.status_code == 200
    assert me_resp.get_json()["user"]["username"] == "tester"


def test_api_analyze_custom_polygon_persists_run_and_alert(client, app_instance):
    headers = _auth_headers(client)
    polygon = {
        "type": "Polygon",
        "coordinates": [[[89.1, 22.1], [89.3, 22.1], [89.3, 22.3], [89.1, 22.3], [89.1, 22.1]]],
    }

    with (
        patch.object(ecoguard_app, "analyze_area", return_value=_sample_extended_analysis()),
        patch.object(ecoguard_app, "send_email_alert", return_value="Sent"),
    ):
        resp = client.post(
            "/api/v1/analyze",
            headers=headers,
            json={
                "location": "Sundarbans Sector A",
                "geojson": polygon,
                "include_extended": True,
                "include_ai": True,
                "language": "en",
            },
        )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["risk"]["risk_level"] == "HIGH"
    assert data["risk"]["confidence"] is not None
    assert len(data["risk"]["factors"]) >= 2
    assert data["ai"]["briefing"]
    assert data["alert"]["status"] == "open"

    # Verify history endpoint returns persisted analysis
    hist_resp = client.get("/api/v1/analyses", headers=headers)
    assert hist_resp.status_code == 200
    assert len(hist_resp.get_json()["analyses"]) == 1


def test_api_watchlists_and_alert_triage_and_exports(client):
    headers = _auth_headers(client)

    # Create watchlist with explicit coords (no network call needed)
    wl_resp = client.post(
        "/api/v1/watchlists",
        headers=headers,
        json={"name": "Lawachara National Park", "latitude": 24.33, "longitude": 91.78, "target_coverage": 70},
    )
    assert wl_resp.status_code == 201
    wl_id = wl_resp.get_json()["watchlist"]["id"]

    list_resp = client.get("/api/v1/watchlists", headers=headers)
    assert len(list_resp.get_json()["watchlists"]) == 1

    del_resp = client.delete(f"/api/v1/watchlists/{wl_id}", headers=headers)
    assert del_resp.status_code == 200

    # Seed an alert via custom polygon analyze and triage it
    polygon = {
        "type": "Polygon",
        "coordinates": [[[91.7, 24.3], [91.8, 24.3], [91.8, 24.4], [91.7, 24.4], [91.7, 24.3]]],
    }
    with (
        patch.object(ecoguard_app, "analyze_area", return_value=_sample_extended_analysis()),
        patch.object(ecoguard_app, "send_email_alert", return_value="Not configured"),
    ):
        a_resp = client.post("/api/v1/analyze", headers=headers, json={"location": "Lawachara", "geojson": polygon})
    alert_id = a_resp.get_json()["alert"]["id"]

    patch_resp = client.patch(
        f"/api/v1/alerts/{alert_id}",
        headers=headers,
        json={"status": "investigating", "notes": "Field team dispatched."},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.get_json()["alert"]["status"] == "investigating"
    assert patch_resp.get_json()["alert"]["notes"] == "Field team dispatched."

    csv_resp = client.get("/api/v1/alerts/export.csv", headers=headers)
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.content_type
    assert b"Lawachara" in csv_resp.data

    pdf_resp = client.post(
        "/api/v1/reports/pdf",
        headers=headers,
        json={
            "location": "Lawachara National Park",
            "analysis": _sample_extended_analysis(),
            "risk": {"risk_level": "HIGH", "confidence": 94.0, "factors": ["Severe NDVI drop"]},
            "tree_data": {"target": 60, "minimum_trees": 12000},
            "ai_briefing": "Situation Summary: High deforestation signal detected.",
        },
    )
    assert pdf_resp.status_code == 200
    assert pdf_resp.mimetype == "application/pdf"
    assert pdf_resp.data.startswith(b"%PDF-1.4")


def test_llm_service_primary_to_free_failover(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key-123")
    monkeypatch.setenv("LLM_BASE_URL", "https://tokenharbor.ai/v1")

    called_models = []

    class FakeCompletions:
        def create(self, model, messages, temperature, max_tokens):
            called_models.append(model)
            if model == "deepseek-v4.1-flash-1017":
                raise RuntimeError("429 quota exceeded")
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="Grounded DeepSeek analysis."))]
            )

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))

    with patch("openai.OpenAI", return_value=fake_client):
        result = llm_service.generate_environmental_briefing(
            "Sundarbans",
            _sample_extended_analysis(),
            risk_result={"risk_level": "HIGH", "confidence": 95.0, "factors": []},
            tree_data={"target": 60, "minimum_trees": 12000},
            language="en",
        )

    assert called_models == ["deepseek-v4.1-flash-1017", "deepseek-v4.1-flash:free"]
    assert result["fallback_used"] is False
    assert result["model_used"] == "deepseek-v4.1-flash:free"
    assert "Grounded DeepSeek analysis." in result["briefing"]


def test_llm_service_offline_fallback_bangla_and_chat(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("TOKENHARBOR_API_KEY", raising=False)

    briefing = llm_service.generate_environmental_briefing(
        "Sundarbans",
        _sample_extended_analysis(),
        risk_result={"risk_level": "HIGH", "confidence": 92.0},
        tree_data={"target": 60, "minimum_trees": 12000},
        language="bn",
    )
    assert briefing["fallback_used"] is True
    assert "Sundarbans" in briefing["briefing"]

    chat = llm_service.chat_with_report(
        "What is the NDVI?",
        {"location": "Sundarbans", "risk_assessment": {"risk_level": "HIGH"}, "vegetation_metrics": {"current_ndvi": 0.22}},
        language="en",
    )
    assert chat["fallback_used"] is True
    assert "0.22" in chat["reply"]


def test_geojson_polygon_validation_and_retry():
    with pytest.raises(ValueError):
        gee_service.get_geometry_from_geojson({"type": "Point", "coordinates": [90, 23]})

    with pytest.raises(ValueError):
        gee_service.get_geometry_from_geojson({"type": "Polygon", "coordinates": [[[90, 23], [91, 23]]]})

    valid_poly = {
        "type": "Polygon",
        "coordinates": [[[89.0, 22.0], [89.5, 22.0], [89.5, 22.5], [89.0, 22.5], [89.0, 22.0]]],
    }
    with patch.object(gee_service.ee.Geometry, "Polygon", return_value="mock-poly") as mock_poly:
        assert gee_service.get_geometry_from_geojson(valid_poly) == "mock-poly"
        mock_poly.assert_called_once()

    attempts = {"n": 0}
    def flaky():
        attempts["n"] += 1
        if attempts["n"] < 2:
            raise RuntimeError("transient")
        return "ok"

    assert gee_service._run_with_retry(flaky, attempts=3, base_delay=0.01) == "ok"
    assert attempts["n"] == 2


def test_ml_service_assess_risk_probabilities():
    res = ml_service.assess_risk(
        0.15,
        55.0,
        previous_ndvi=0.60,
        rainfall=30.0,
        yoy_ndvi_change=-0.20,
        recent_5yr_loss_ha=12.5,
        dnbr=0.22,
        model_override=ecoguard_app.model,
        encoder_override=ecoguard_app.encoder,
    )
    assert res["risk_level"] == "HIGH"
    assert res["source"] == "random_forest"
    assert res["confidence"] > 50
    assert any("Year-over-year" in f for f in res["factors"])
    assert any("dNBR" in f for f in res["factors"])


def test_alert_privacy_between_users_and_token_revocation(client, app_instance):
    from werkzeug.security import generate_password_hash

    with app_instance.app_context():
        other = ecoguard_app.User(
            full_name="Second Analyst",
            username="analyst2",
            email="analyst2@example.com",
            password=generate_password_hash("StrongPass456"),
            is_verified=True,
        )
        ecoguard_app.db.session.add(other)
        ecoguard_app.db.session.commit()

    headers_a = _auth_headers(client)
    login_b = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "analyst2", "password": "StrongPass456"},
    )
    assert login_b.status_code == 200
    headers_b = {"Authorization": f"Bearer {login_b.get_json()['token']}"}

    # User A creates an alert via custom polygon analyze
    polygon = {
        "type": "Polygon",
        "coordinates": [[[89.1, 22.1], [89.2, 22.1], [89.2, 22.2], [89.1, 22.2], [89.1, 22.1]]],
    }
    with (
        patch.object(ecoguard_app, "analyze_area", return_value=_sample_extended_analysis()),
        patch.object(ecoguard_app, "send_email_alert", return_value="Not configured"),
    ):
        a_resp = client.post(
            "/api/v1/analyze",
            headers=headers_a,
            json={"location": "Private Zone A", "geojson": polygon, "include_ai": False},
        )
    alert_id = a_resp.get_json()["alert"]["id"]

    # User B cannot see or mutate User A's alert
    assert client.get("/api/v1/alerts", headers=headers_b).get_json()["alerts"] == []
    assert (
        client.patch(
            f"/api/v1/alerts/{alert_id}",
            headers=headers_b,
            json={"status": "resolved"},
        ).status_code
        == 404
    )
    assert b"Private Zone A" not in client.get("/api/v1/alerts/export.csv", headers=headers_b).data

    # Watchlist rejects invalid target_coverage with 400 (never 500)
    bad_wl = client.post(
        "/api/v1/watchlists",
        headers=headers_a,
        json={"name": "Bad Target", "latitude": 23.0, "longitude": 90.0, "target_coverage": "abc"},
    )
    assert bad_wl.status_code == 400

    # Logout revokes Bearer token immediately
    assert client.post("/api/v1/auth/logout", headers=headers_b).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers_b).status_code == 401


def test_api_json_404_security_headers_and_cloud_helpers(client, monkeypatch):
    import base64
    import json

    not_found = client.get("/api/v1/nonexistent-endpoint")
    assert not_found.status_code == 404
    assert not_found.mimetype == "application/json"
    assert not_found.get_json()["error"]
    assert not_found.headers.get("X-Content-Type-Options") == "nosniff"
    assert not_found.headers.get("X-Frame-Options") == "DENY"
    assert not_found.headers.get("Server") == "EcoGuard"

    # Postgres URL normalization
    assert ecoguard_app._normalize_database_url("postgres://u:p@h/db").startswith("postgresql+psycopg://")
    assert ecoguard_app._normalize_database_url("postgresql://u:p@h/db").startswith("postgresql+psycopg://")

    # Service account JSON loader (base64)
    fake_sa = json.dumps({"client_email": "gee@test.iam.gserviceaccount.com", "private_key": "fake"})
    monkeypatch.setenv("GEE_SERVICE_ACCOUNT_JSON", base64.b64encode(fake_sa.encode()).decode())
    with patch.object(gee_service.ee, "ServiceAccountCredentials", return_value="sa-creds") as mock_sa:
        assert gee_service._load_service_account_credentials() == "sa-creds"
        mock_sa.assert_called_once()


def test_llm_structured_briefing_cjk_sanitizer_and_priority_places():
    import location_service

    raw = '```json\n{"headline": "Sundarbans স্থিতিশীল", "summary": "পর্যবেক্ষণকালী中 NDVI 0.45।", "key_signals": ["NDVI 0.45"], "recommended_actions": ["মাঠ যাচাই"], "data_caveat": "যাচাই প্রয়োজন"}\n```'
    parsed = llm_service._parse_structured_briefing(raw, lang="bn")
    assert parsed is not None
    assert "中" not in parsed["summary"]
    assert parsed["key_signals"] == ["NDVI 0.45"]

    location_service.clear_location_cache()
    with patch.object(location_service.geolocator, "geocode", return_value=[]):
        suggestions = location_service.suggest_locations("Sundar")
        assert len(suggestions) >= 1
        assert "Sundarbans" in suggestions[0]["name"]
        assert suggestions[0]["boundingbox"] is not None


