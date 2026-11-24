from unittest.mock import patch

import app as ecoguard_app


def _sample_analysis(current_ndvi=0.18, previous_ndvi=0.58, vegetation_loss=52.0, rainfall=45.0):
    return {
        "current_ndvi": current_ndvi,
        "previous_ndvi": previous_ndvi,
        "vegetation_area_current": 300_000.0,
        "vegetation_area_previous": 625_000.0,
        "vegetation_loss": vegetation_loss,
        "rainfall": rainfall,
        "ndvi_change": current_ndvi - previous_ndvi,
        "current_image_count": 5,
        "previous_image_count": 6,
        "total_area_m2": 1_000_000.0,
        "current_coverage_percent": 30.0,
        "analysis_start": "2026-09-25",
        "analysis_end": "2026-11-24",
        "previous_start": "2026-07-27",
        "previous_end": "2026-09-25",
        "bounding_box": [22.0, 22.5, 89.0, 89.5],
        "historical_forest_loss": {
            "dataset": "UMD/hansen/global_forest_change_2025_v1_13",
            "dataset_start_year": 2001,
            "dataset_end_year": 2025,
            "canopy_threshold_percent": 30,
            "baseline_forest_area_m2": 500_000.0,
            "baseline_forest_area_hectares": 50.0,
            "total_forest_loss_m2": 50_000.0,
            "total_forest_loss_hectares": 5.0,
            "historical_loss_percent": 10.0,
            "recent_5_year_loss_m2": 10_000.0,
            "recent_5_year_loss_hectares": 1.0,
            "recent_period": "2021-2025",
            "annual_loss": [
                {"year": 2024, "loss_area_m2": 5000.0, "loss_area_hectares": 0.5},
                {"year": 2025, "loss_area_m2": 5000.0, "loss_area_hectares": 0.5},
            ],
            "interpretation": "Historical gross forest-cover loss within baseline forest pixels.",
        },
        "baseline_forest_area_hectares": 50.0,
        "historical_forest_loss_hectares": 5.0,
        "historical_forest_loss_percent": 10.0,
        "recent_5_year_forest_loss_hectares": 1.0,
        "annual_forest_loss": [
            {"year": 2024, "loss_area_m2": 5000.0, "loss_area_hectares": 0.5},
            {"year": 2025, "loss_area_m2": 5000.0, "loss_area_hectares": 0.5},
        ],
        "forest_loss_dataset": "UMD/hansen/global_forest_change_2025_v1_13",
    }


def _sample_location():
    return {
        "name": "Sundarbans, Khulna, Bangladesh",
        "latitude": 22.25,
        "longitude": 89.25,
        "boundingbox": [22.0, 22.5, 89.0, 89.5],
        "boundary_type": "OpenStreetMap boundary",
    }


# ------------------------------------------------------------
# Health & Validators
# ------------------------------------------------------------

def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert b"EcoGuard Server is Working!" in response.data


def test_input_validators():
    assert ecoguard_app.validate_email("user@example.com") is True
    assert ecoguard_app.validate_email("bad-email") is False

    assert ecoguard_app.validate_username("eco_user.1") is True
    assert ecoguard_app.validate_username("ab") is False
    assert ecoguard_app.validate_username("invalid user!") is False

    assert ecoguard_app.validate_password("Forest2026") is True
    assert ecoguard_app.validate_password("short1") is False
    assert ecoguard_app.validate_password("onlyletters") is False
    assert ecoguard_app.validate_password("12345678") is False


# ------------------------------------------------------------
# ML Risk Prediction & Calculations
# ------------------------------------------------------------

def test_predict_risk_uses_trained_4_feature_model():
    assert ecoguard_app.model is not None
    assert ecoguard_app.encoder is not None
    assert getattr(ecoguard_app.model, "n_features_in_", None) == 4

    with patch.object(ecoguard_app.logger, "warning") as mock_warn:
        high = ecoguard_app.predict_risk(0.15, 60.0, previous_ndvi=0.60, rainfall=40.0)
        low = ecoguard_app.predict_risk(0.75, 2.0, previous_ndvi=0.74, rainfall=200.0)
        medium = ecoguard_app.predict_risk(0.42, 20.0, previous_ndvi=0.55, rainfall=100.0)

    assert high == "HIGH"
    assert low == "LOW"
    assert medium == "MEDIUM"
    mock_warn.assert_not_called()


def test_predict_risk_unknown_and_rule_fallback():
    assert ecoguard_app.predict_risk(None, 10.0) == "UNKNOWN"
    assert ecoguard_app.predict_risk(0.5, None) == "UNKNOWN"

    with patch.object(ecoguard_app, "model", None):
        assert ecoguard_app.predict_risk(0.25, 45.0) == "HIGH"
        assert ecoguard_app.predict_risk(0.45, 30.0) == "MEDIUM"
        assert ecoguard_app.predict_risk(0.70, 5.0) == "LOW"


def test_calculate_tree_requirement_and_explanations():
    analysis = _sample_analysis()
    tree_data = ecoguard_app.calculate_tree_requirement(analysis)
    # total_area=100ha, coverage=30%, target=60% => gap=30% => 30ha * 400 trees/ha = 12000
    assert tree_data["coverage_gap"] == 30.0
    assert tree_data["minimum_trees"] == 12000

    empty_tree_data = ecoguard_app.calculate_tree_requirement({})
    assert empty_tree_data["minimum_trees"] is None

    explanations = ecoguard_app.simple_explanations(analysis, risk_level="HIGH")
    assert "HIGH" in explanations["risk"]
    assert "30.00%" in explanations["coverage"]
    assert "5.00 hectares" in explanations["historical_loss"]


# ------------------------------------------------------------
# Auth Flows
# ------------------------------------------------------------

def test_protected_route_redirects_anonymous_user(client):
    response = client.get("/dashboard", follow_redirects=False)
    assert response.status_code == 302
    assert "/" in response.headers["Location"]


def test_signup_verify_login_logout_flow(client, app_instance):
    with patch.object(ecoguard_app, "send_verification_email", return_value=True):
        resp = client.post(
            "/signup",
            data={
                "full_name": "New Ranger",
                "username": "ranger01",
                "email": "ranger01@example.com",
                "password": "Password123",
                "confirm_password": "Password123",
            },
            follow_redirects=False,
        )
        assert resp.status_code == 302

    # Cannot login before verification
    resp = client.post(
        "/",
        data={"email_or_username": "ranger01", "password": "Password123"},
        follow_redirects=True,
    )
    assert b"not verified" in resp.data

    # Verify email via timed token
    token = ecoguard_app.generate_email_token("ranger01@example.com", "email-verification")
    resp = client.get(f"/verify-email/{token}", follow_redirects=True)
    assert b"Email verified successfully" in resp.data

    # Now login succeeds
    resp = client.post(
        "/",
        data={"email_or_username": "ranger01@example.com", "password": "Password123"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert "/dashboard" in resp.headers["Location"]

    # Logout clears session
    resp = client.post("/logout", follow_redirects=False)
    assert resp.status_code == 302
    resp = client.get("/dashboard", follow_redirects=False)
    assert resp.status_code == 302


# ------------------------------------------------------------
# Core App Routes
# ------------------------------------------------------------

def test_dashboard_and_feedback(logged_in_client, app_instance):
    resp = logged_in_client.get("/dashboard")
    assert resp.status_code == 200

    resp = logged_in_client.post(
        "/feedback",
        data={"rating": "5", "category": "Monitoring", "message": "Great satellite insights!"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert "/dashboard" in resp.headers["Location"]

    with app_instance.app_context():
        fb = ecoguard_app.Feedback.query.first()
        assert fb is not None
        assert fb.rating == 5
        assert fb.message == "Great satellite insights!"


def test_green_coverage_pdf_export(logged_in_client):
    resp = logged_in_client.post(
        "/green-coverage/pdf",
        data={
            "location": "Sundarbans, Bangladesh",
            "green_coverage": "70.0",
            "ndvi_coverage": "68.0",
            "average_ndvi": "0.62",
            "total_area": "100.0",
            "green_area": "70.0",
            "target": "60",
            "ndvi_change": "0.02",
            "coverage_change": "2.0",
        },
    )
    assert resp.status_code == 200
    assert resp.mimetype == "application/pdf"
    assert resp.data.startswith(b"%PDF-1.4")


def test_suggest_endpoint(logged_in_client):
    assert logged_in_client.get("/suggest?q=a").get_json() == []

    fake_suggestions = [{"name": "Dhaka, Bangladesh", "latitude": 23.8, "longitude": 90.4}]
    with patch.object(ecoguard_app, "suggest_locations", return_value=fake_suggestions):
        resp = logged_in_client.get("/suggest?q=Dhaka")
        assert resp.status_code == 200
        assert resp.get_json() == fake_suggestions


def test_analyze_high_risk_logs_alert_and_renders_prediction(logged_in_client, app_instance):
    with (
        patch.object(ecoguard_app, "get_location", return_value=_sample_location()),
        patch.object(ecoguard_app, "analyze_area", return_value=_sample_analysis()),
        patch.object(ecoguard_app, "send_email_alert", return_value="Sent"),
    ):
        resp = logged_in_client.post("/analyze", data={"location": "Sundarbans"})
        assert resp.status_code == 200
        assert b"HIGH RISK" in resp.data

    with app_instance.app_context():
        alerts = ecoguard_app.Alert.query.all()
        assert len(alerts) == 1
        assert alerts[0].risk_level == "HIGH"
        assert alerts[0].email_status == "Sent"


def test_analyze_low_risk_does_not_create_alert(logged_in_client, app_instance):
    low_analysis = _sample_analysis(
        current_ndvi=0.75, previous_ndvi=0.74, vegetation_loss=2.0, rainfall=200.0
    )
    with (
        patch.object(ecoguard_app, "get_location", return_value=_sample_location()),
        patch.object(ecoguard_app, "analyze_area", return_value=low_analysis),
    ):
        resp = logged_in_client.post("/analyze", data={"location": "Sundarbans"})
        assert resp.status_code == 200
        assert b"LOW RISK" in resp.data

    with app_instance.app_context():
        assert ecoguard_app.Alert.query.count() == 0


def test_satellite_monitoring_analyze_route(logged_in_client):
    with (
        patch.object(ecoguard_app, "get_location", return_value=_sample_location()),
        patch.object(ecoguard_app, "analyze_area", return_value=_sample_analysis()),
    ):
        resp = logged_in_client.post(
            "/satellite-monitoring/analyze",
            data={"location": "Sundarbans"},
        )
        assert resp.status_code == 200
        assert b"Sundarbans" in resp.data


def test_green_coverage_route(logged_in_client):
    fake_gc = {
        "location_area_m2": 1_000_000.0,
        "total_area_hectares": 100.0,
        "green_area_m2": 700_000.0,
        "green_area_hectares": 70.0,
        "green_coverage_percent": 70.0,
        "average_ndvi": 0.62,
        "previous_average_ndvi": 0.60,
        "ndvi_vegetation_area_hectares": 68.0,
        "ndvi_vegetation_coverage_percent": 68.0,
        "previous_ndvi_coverage_percent": 66.0,
        "coverage_change_percent": 2.0,
        "ndvi_change": 0.02,
        "current_image_count": 12,
        "previous_image_count": 10,
        "current_start": "2025-11-24",
        "current_end": "2026-11-24",
        "previous_start": "2024-11-24",
        "previous_end": "2025-11-24",
        "land_cover_classes": [
            {"class_code": 10, "name": "Tree Cover", "area_m2": 700_000.0, "area_hectares": 70.0, "percentage": 70.0}
        ],
        "land_cover_dataset": "ESA WorldCover v200 (2021)",
        "ndvi_threshold": 0.3,
        "ndvi_tile_url": "https://example.com/ndvi/{z}/{x}/{y}",
        "landcover_tile_url": "https://example.com/lc/{z}/{x}/{y}",
        "analysis_note": "Test note",
    }
    with (
        patch.object(ecoguard_app, "get_location", return_value=_sample_location()),
        patch.object(ecoguard_app, "analyze_green_coverage", return_value=fake_gc),
    ):
        resp = logged_in_client.post("/green-coverage", data={"location": "Sundarbans"})
        assert resp.status_code == 200
        assert b"Tree Cover" in resp.data
