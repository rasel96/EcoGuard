"""
EcoGuard ML & Multi-Factor Risk Assessment Service.
"""

import logging
import os

import joblib

logger = logging.getLogger("ecoguard.ml")

_model = None
_encoder = None
_loaded = False


def load_ml_artifacts(base_dir):
    global _model, _encoder, _loaded
    model_path = os.path.join(base_dir, "model.pkl")
    encoder_path = os.path.join(base_dir, "encoder.pkl")

    _model = None
    _encoder = None

    try:
        if os.path.exists(model_path):
            _model = joblib.load(model_path)
            logger.info("ML model loaded successfully from %s", model_path)
        else:
            logger.warning("model.pkl not found at %s", model_path)

        if os.path.exists(encoder_path):
            _encoder = joblib.load(encoder_path)
            logger.info("Encoder loaded successfully from %s", encoder_path)
        else:
            logger.warning("encoder.pkl not found at %s", encoder_path)
    except Exception as err:
        logger.warning("Failed to load ML artifacts: %s", err)
        _model = None
        _encoder = None

    _loaded = True
    return _model, _encoder


def get_artifacts():
    return _model, _encoder


def assess_risk(
    ndvi,
    vegetation_loss,
    previous_ndvi=None,
    rainfall=None,
    yoy_ndvi_change=None,
    recent_5yr_loss_ha=None,
    dnbr=None,
    model_override=None,
    encoder_override=None,
):
    """
    Compute deforestation risk classification with confidence score and
    transparent contributing factors.
    """
    if ndvi is None or vegetation_loss is None:
        return {
            "risk_level": "UNKNOWN",
            "confidence": None,
            "probabilities": {},
            "factors": ["Required Sentinel-2 NDVI or vegetation loss data is unavailable."],
            "source": "insufficient_data",
        }

    # Baseline rule classification
    risk = "LOW"
    if ndvi <= 0.30 and vegetation_loss >= 40:
        risk = "HIGH"
    elif ndvi <= 0.50 and vegetation_loss >= 25:
        risk = "MEDIUM"

    confidence = None
    probabilities = {}
    source = "rule_fallback"

    active_model = model_override if model_override is not None else _model
    active_encoder = encoder_override if encoder_override is not None else _encoder

    if active_model is not None:
        try:
            import pandas as pd

            expected_features = getattr(active_model, "n_features_in_", 4)
            if expected_features == 4:
                prev_val = previous_ndvi if previous_ndvi is not None else ndvi
                rain_val = rainfall if rainfall is not None else 100.0
                features = pd.DataFrame(
                    [[ndvi, prev_val, vegetation_loss, rain_val]],
                    columns=[
                        "current_ndvi",
                        "previous_ndvi",
                        "vegetation_loss",
                        "rainfall",
                    ],
                )
            else:
                features = [[ndvi, vegetation_loss]]

            pred = active_model.predict(features)[0]
            if active_encoder is not None:
                try:
                    pred = active_encoder.inverse_transform([int(pred)])[0]
                except Exception:
                    pass

            pred_label = str(pred).upper()
            if pred_label in ("HIGH", "MEDIUM", "LOW"):
                risk = pred_label
                source = "random_forest"

            if hasattr(active_model, "predict_proba"):
                proba = active_model.predict_proba(features)[0]
                classes = (
                    list(active_encoder.classes_)
                    if active_encoder is not None
                    else [str(c) for c in getattr(active_model, "classes_", [])]
                )
                for label, p in zip(classes, proba):
                    probabilities[str(label).upper()] = round(float(p) * 100, 1)
                if risk in probabilities:
                    confidence = probabilities[risk]
        except Exception as err:
            logger.warning("ML risk assessment error, falling back to rules: %s", err)

    # Explainable contributing signals
    factors = []
    if ndvi < 0.30:
        factors.append(f"Low vegetation density signal (NDVI {ndvi:.3f} < 0.30).")
    elif ndvi < 0.50:
        factors.append(f"Moderate vegetation index (NDVI {ndvi:.3f}).")
    else:
        factors.append(f"Healthy canopy signal (NDVI {ndvi:.3f}).")

    if vegetation_loss >= 25:
        factors.append(f"Elevated 60-day vegetation area decline ({vegetation_loss:.1f}%).")
    elif vegetation_loss >= 10:
        factors.append(f"Noticeable 60-day vegetation contraction ({vegetation_loss:.1f}%).")
    else:
        factors.append(f"Minimal short-term vegetation area decline ({vegetation_loss:.1f}%).")

    if isinstance(yoy_ndvi_change, (int, float)):
        if yoy_ndvi_change <= -0.08:
            factors.append(
                f"Year-over-year seasonal NDVI dropped by {abs(yoy_ndvi_change):.3f}, pointing beyond normal seasonal cycles."
            )
        elif yoy_ndvi_change >= 0.05:
            factors.append(
                f"Year-over-year seasonal NDVI improved by +{yoy_ndvi_change:.3f}."
            )

    if isinstance(dnbr, (int, float)) and dnbr >= 0.15:
        factors.append(f"Elevated burn-severity index (dNBR {dnbr:.3f}) warrants fire/clearing check.")

    if isinstance(rainfall, (int, float)) and rainfall < 30:
        factors.append(f"Low recent precipitation ({rainfall:.1f} mm) may contribute to vegetation stress.")

    if isinstance(recent_5yr_loss_ha, (int, float)) and recent_5yr_loss_ha > 0:
        factors.append(
            f"Hansen satellite history recorded {recent_5yr_loss_ha:,.2f} ha of gross loss (2021-2025)."
        )

    return {
        "risk_level": risk,
        "confidence": confidence,
        "probabilities": probabilities,
        "factors": factors,
        "source": source,
    }
