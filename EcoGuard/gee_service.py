
# ============================================================
# ECOGUARD - SATELLITE, GREEN COVERAGE &
# HISTORICAL FOREST MONITORING
#
# Google Earth Engine Service
# Sentinel-2 + CHIRPS + Hansen GFC + ESA WorldCover
# ============================================================

import base64
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import logging
import os
import threading
import time
from datetime import date, timedelta

import ee
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("ecoguard.gee")

GEE_PROJECT = os.getenv(
    "GEE_PROJECT_ID",
    "ecogaurd-507808"
)

VEGETATION_NDVI_THRESHOLD = 0.30

FOREST_CANOPY_THRESHOLD = 30

HANSEN_DATASET_ID = (
    "UMD/hansen/global_forest_change_2025_v1_13"
)

HANSEN_START_YEAR = 2001
HANSEN_END_YEAR = 2025

WORLDCOVER_DATASET_ID = "ESA/WorldCover/v200"

_ee_initialized = False
_ee_init_lock = threading.Lock()
_GEE_CACHE_TTL_SECONDS = int(os.getenv("GEE_CACHE_TTL_SECONDS", "1800"))
_GEE_CACHE_MAX_ENTRIES = int(os.getenv("GEE_CACHE_MAX_ENTRIES", "128"))
_gee_cache = OrderedDict()
_gee_cache_lock = threading.Lock()


def _cache_key(prefix, payload):
    raw = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}:{digest}"


def _cache_get(key):
    with _gee_cache_lock:
        entry = _gee_cache.get(key)
        if not entry:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            _gee_cache.pop(key, None)
            return None
        _gee_cache.move_to_end(key)
        return value


def _cache_set(key, value):
    now = time.monotonic()
    with _gee_cache_lock:
        # Evict expired entries first
        expired = [k for k, (_, exp) in _gee_cache.items() if now > exp]
        for k in expired:
            _gee_cache.pop(k, None)
        _gee_cache[key] = (value, now + _GEE_CACHE_TTL_SECONDS)
        _gee_cache.move_to_end(key)
        while len(_gee_cache) > _GEE_CACHE_MAX_ENTRIES:
            _gee_cache.popitem(last=False)


def clear_gee_cache():
    """Clear in-memory GEE result cache."""
    with _gee_cache_lock:
        _gee_cache.clear()


def _run_with_retry(fn, attempts=3, base_delay=0.75):
    """Execute a GEE RPC with exponential backoff on transient failures."""
    last_error = None
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as err:
            last_error = err
            if attempt == attempts - 1:
                raise
            delay = base_delay * (2 ** attempt)
            logger.warning("GEE call failed (attempt %d/%d): %s; retrying in %.2fs", attempt + 1, attempts, err, delay)
            time.sleep(delay)
    raise last_error


# ============================================================
# 1. INITIALIZE GOOGLE EARTH ENGINE (LAZY + SERVICE ACCOUNT)
# ============================================================

def _load_service_account_credentials():
    """
    Load Google Cloud Service Account credentials for headless cloud deployment.
    Supports:
      - GEE_SERVICE_ACCOUNT_JSON: raw JSON string, base64-encoded JSON, or file path
      - GOOGLE_APPLICATION_CREDENTIALS: path to JSON key file
    """
    raw = (os.getenv("GEE_SERVICE_ACCOUNT_JSON") or "").strip()
    key_path = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()

    key_data = None
    if raw:
        if raw.startswith("{"):
            key_data = raw
        elif os.path.isfile(raw):
            with open(raw, "r", encoding="utf-8") as fh:
                key_data = fh.read()
        else:
            # Try base64-encoded JSON
            try:
                decoded = base64.b64decode(raw).decode("utf-8")
                if decoded.strip().startswith("{"):
                    key_data = decoded
            except Exception:
                pass
    elif key_path and os.path.isfile(key_path):
        with open(key_path, "r", encoding="utf-8") as fh:
            key_data = fh.read()

    if not key_data:
        return None

    parsed = json.loads(key_data)
    client_email = parsed.get("client_email")
    if not client_email:
        raise ValueError("Service account JSON is missing 'client_email'.")
    return ee.ServiceAccountCredentials(client_email, key_data=key_data)


def initialize_earth_engine(allow_interactive_auth=False):
    global _ee_initialized

    if _ee_initialized:
        return True

    with _ee_init_lock:
        if _ee_initialized:
            return True

        project_id = os.getenv("GEE_PROJECT_ID", GEE_PROJECT)

        try:
            sa_credentials = _load_service_account_credentials()
            if sa_credentials is not None:
                ee.Initialize(credentials=sa_credentials, project=project_id)
                _ee_initialized = True
                logger.info("Google Earth Engine initialized with Service Account credentials.")
                return True

            ee.Initialize(project=project_id)
            _ee_initialized = True
            logger.info("Google Earth Engine initialized successfully.")
            return True
        except Exception as init_error:
            if allow_interactive_auth:
                try:
                    ee.Authenticate()
                    ee.Initialize(project=project_id)
                    _ee_initialized = True
                    logger.info("Google Earth Engine authenticated successfully.")
                    return True
                except Exception as auth_error:
                    raise RuntimeError(
                        f"Google Earth Engine initialization failed: {auth_error}"
                    ) from auth_error

            raise RuntimeError(
                f"Google Earth Engine initialization failed: {init_error}. "
                "Set GEE_SERVICE_ACCOUNT_JSON for cloud deployment or run 'earthengine authenticate' locally."
            ) from init_error


def ensure_earth_engine_initialized():
    """Ensure GEE is initialized before executing Earth Engine queries."""
    if not _ee_initialized:
        initialize_earth_engine(allow_interactive_auth=False)


# ============================================================
# 2. BASIC HELPERS
# ============================================================

def safe_number(value, default=None):

    try:

        if value is None:
            return default

        return float(value)

    except (TypeError, ValueError):

        return default


def square_meters_to_hectares(area):

    if area is None:
        return None

    return float(area) / 10000


def get_geometry(bounding_box):
    """
    Nominatim bbox format:
    [south, north, west, east]
    """

    if not bounding_box or len(bounding_box) != 4:
        raise ValueError("Bounding box must contain 4 coordinates: [south, north, west, east].")

    try:
        south, north, west, east = map(float, bounding_box)
    except (TypeError, ValueError) as error:
        raise ValueError("Bounding box coordinates must be numeric.") from error

    if not (-90 <= south < north <= 90) or not (-180 <= west < east <= 180):
        raise ValueError(
            f"Invalid bounding box bounds: south={south}, north={north}, west={west}, east={east}."
        )

    return ee.Geometry.Rectangle([
        west,
        south,
        east,
        north
    ])


def get_geometry_from_geojson(geojson_geometry):
    """
    Validate and convert a GeoJSON Polygon or MultiPolygon (or Feature)
    into an Earth Engine Geometry.
    """
    if not isinstance(geojson_geometry, dict):
        raise ValueError("GeoJSON geometry must be a JSON object.")

    geom = geojson_geometry
    if geom.get("type") == "Feature":
        geom = geom.get("geometry") or {}

    geom_type = geom.get("type")
    coords = geom.get("coordinates")

    if geom_type == "Polygon":
        if not isinstance(coords, list) or not coords or len(coords[0]) < 4:
            raise ValueError("GeoJSON Polygon must have an outer ring with at least 4 coordinate pairs.")
        for ring in coords:
            for pt in ring:
                if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                    raise ValueError("Each polygon coordinate must be [lon, lat].")
                lon, lat = float(pt[0]), float(pt[1])
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    raise ValueError(f"Polygon coordinate out of range: [{lon}, {lat}].")
        return ee.Geometry.Polygon(coords)

    if geom_type == "MultiPolygon":
        if not isinstance(coords, list) or not coords:
            raise ValueError("GeoJSON MultiPolygon must contain at least one polygon.")
        return ee.Geometry.MultiPolygon(coords)

    raise ValueError("Only GeoJSON Polygon or MultiPolygon geometries are supported.")


def resolve_geometry(bounding_box=None, geojson_geometry=None):
    """Build an ee.Geometry from either a GeoJSON polygon or a bounding box."""
    if geojson_geometry is not None:
        return get_geometry_from_geojson(geojson_geometry)
    return get_geometry(bounding_box)


# ============================================================
# 3. SENTINEL-2 CLOUD MASKING
# ============================================================

def mask_sentinel_clouds(image):

    scl = image.select("SCL")

    mask = (
        scl.neq(3)
        .And(scl.neq(8))
        .And(scl.neq(9))
        .And(scl.neq(10))
        .And(scl.neq(11))
    )

    return (
        image
        .updateMask(mask)
        .divide(10000)
    )


# ============================================================
# 4. SENTINEL-2 COLLECTION
# ============================================================

def get_sentinel_collection(
    geometry,
    start_date,
    end_date,
    max_cloud_percent=40
):

    return (
        ee.ImageCollection(
            "COPERNICUS/S2_SR_HARMONIZED"
        )
        .filterBounds(geometry)
        .filterDate(
            start_date,
            end_date
        )
        .filter(
            ee.Filter.lte(
                "CLOUDY_PIXEL_PERCENTAGE",
                max_cloud_percent
            )
        )
        .map(mask_sentinel_clouds)
    )


def get_ndvi_image(collection):

    return collection.map(
        lambda image: image.normalizedDifference(
            ["B8", "B4"]
        ).rename("NDVI")
    )


def get_spectral_indices(collection):
    """Compute Sentinel-2 NDVI, EVI (dense canopy), and NBR (fire/burn)."""
    def _add_indices(image):
        ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")
        nbr = image.normalizedDifference(["B8", "B12"]).rename("NBR")
        evi = image.expression(
            "2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))",
            {
                "NIR": image.select("B8"),
                "RED": image.select("B4"),
                "BLUE": image.select("B2"),
            },
        ).rename("EVI")
        return ndvi.addBands([evi, nbr])

    return collection.map(_add_indices)


def _adaptive_scales(total_area_m2):
    """Choose fast, accurate Earth Engine reduction scales based on AOI size."""
    area_km2 = (total_area_m2 or 0) / 1_000_000.0
    if area_km2 > 1000:
        return {"sentinel": 250, "hansen": 100, "worldcover": 100, "monthly": 500}
    if area_km2 > 50:
        return {"sentinel": 150, "hansen": 60, "worldcover": 60, "monthly": 250}
    return {"sentinel": 100, "hansen": 30, "worldcover": 30, "monthly": 150}


def get_monthly_ndvi_series(geometry, months=12, scale=250):
    """Compute monthly mean Sentinel-2 NDVI over the past N months in parallel."""
    today = date.today()
    windows = []
    for offset in range(months - 1, -1, -1):
        period_end = today - timedelta(days=30 * offset)
        period_start = period_end - timedelta(days=30)
        windows.append((period_end.strftime("%Y-%m"), period_start.isoformat(), period_end.isoformat()))

    def _fetch_month(item):
        label, start_iso, end_iso = item
        try:
            col = get_sentinel_collection(geometry, start_iso, end_iso)
            count = col.size()
            mean_ndvi = ee.Image(
                ee.Algorithms.If(
                    count.gt(0),
                    get_ndvi_image(col).mean().clip(geometry),
                    ee.Image.constant(0).updateMask(ee.Image.constant(0)).rename("NDVI"),
                )
            )
            stats = ee.Dictionary({
                "count": count,
                "ndvi": mean_ndvi.reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=geometry,
                    scale=scale,
                    maxPixels=1e13,
                    bestEffort=True,
                    tileScale=4,
                ).get("NDVI"),
            })
            res = _run_with_retry(lambda: stats.getInfo()) or {}
            img_count = int(res.get("count") or 0)
            num = safe_number(res.get("ndvi")) if img_count > 0 else None
            return {
                "month": label,
                "ndvi": round(num, 4) if num is not None else None,
                "image_count": img_count,
            }
        except Exception as err:
            logger.warning("Monthly NDVI failed for %s: %s", label, err)
            return {"month": label, "ndvi": None, "image_count": 0}

    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(_fetch_month, windows))


def get_hansen_loss_tile_url(geometry):
    """Return an Earth Engine tile URL highlighting Hansen forest loss (2001-2025)."""
    try:
        dataset = ee.Image(HANSEN_DATASET_ID)
        loss_year = dataset.select("lossyear").clip(geometry)
        loss_masked = loss_year.updateMask(loss_year.gt(0))
        vis = {
            "min": 1,
            "max": 25,
            "palette": ["fde047", "fb923c", "f97316", "ef4444", "b91c1c"],
        }
        map_id = _run_with_retry(lambda: loss_masked.getMapId(vis))
        return map_id["tile_fetcher"].url_format
    except Exception as err:
        logger.warning("Failed to build Hansen loss tile URL: %s", err)
        return None


def get_ndvi_tile_url(geometry, start_date, end_date):
    """Return an Earth Engine tile URL for cloud-masked Sentinel-2 NDVI."""
    try:
        col = get_sentinel_collection(geometry, start_date, end_date)
        count = _run_with_retry(lambda: col.size().getInfo())
        if not count:
            return None
        ndvi_img = get_ndvi_image(col).mean().clip(geometry)
        vis = {
            "min": -0.2,
            "max": 0.8,
            "palette": ["8c510a", "d8b365", "f6e8c3", "c7eae5", "5ab4ac", "01665e"],
        }
        map_id = _run_with_retry(lambda: ndvi_img.getMapId(vis))
        return map_id["tile_fetcher"].url_format
    except Exception as err:
        logger.warning("Failed to build NDVI tile URL: %s", err)
        return None


# ============================================================
# 5. SENTINEL PERIOD STATISTICS
# ============================================================

def calculate_period_stats(
    geometry,
    start_date,
    end_date,
    scale=100
):

    # Try strict <=40% cloud scenes first; fall back to <=85% (still SCL pixel-masked)
    # so Bangladesh monsoon windows (Jul-Sep) don't return empty null stats.
    strict_col = get_sentinel_collection(
        geometry, start_date, end_date, max_cloud_percent=40
    )
    relaxed_col = get_sentinel_collection(
        geometry, start_date, end_date, max_cloud_percent=85
    )

    strict_count = strict_col.size()
    collection = ee.ImageCollection(
        ee.Algorithms.If(strict_count.gt(0), strict_col, relaxed_col)
    )
    count = collection.size()
    empty_img = (
        ee.Image.constant([0, 0, 0])
        .updateMask(ee.Image.constant(0))
        .rename(["NDVI", "EVI", "NBR"])
    )
    mean_indices = ee.Image(
        ee.Algorithms.If(
            count.gt(0),
            get_spectral_indices(collection).mean().clip(geometry),
            empty_img,
        )
    )

    means = mean_indices.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geometry,
        scale=scale,
        maxPixels=1e13,
        bestEffort=True,
        tileScale=4,
    )

    veg_area = (
        mean_indices.select("NDVI")
        .gt(VEGETATION_NDVI_THRESHOLD)
        .multiply(ee.Image.pixelArea())
        .reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geometry,
            scale=scale,
            maxPixels=1e13,
            bestEffort=True,
            tileScale=4,
        )
        .get("NDVI")
    )

    payload = _run_with_retry(
        lambda: ee.Dictionary({
            "count": count,
            "means": means,
            "veg_area": veg_area,
        }).getInfo()
    ) or {}

    image_count = int(payload.get("count") or 0)
    if not image_count:
        return {
            "ndvi": None,
            "evi": None,
            "nbr": None,
            "vegetation_area": None,
            "image_count": 0
        }

    stats_result = payload.get("means") or {}
    return {
        "ndvi": safe_number(stats_result.get("NDVI")),
        "evi": safe_number(stats_result.get("EVI")),
        "nbr": safe_number(stats_result.get("NBR")),
        "vegetation_area": safe_number(payload.get("veg_area")),
        "image_count": image_count,
    }


# ============================================================
# 6. RAINFALL ANALYSIS
# ============================================================

def _get_latest_chirps_date():
    """Fetch and cache the latest published CHIRPS daily image date (6h TTL)."""
    cache_id = "chirps:latest_date"
    cached = _cache_get(cache_id)
    if cached is not None:
        return cached
    try:
        latest_str = _run_with_retry(
            lambda: (
                ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
                .sort("system:time_start", False)
                .first()
                .date()
                .format("YYYY-MM-dd")
                .getInfo()
            )
        )
        latest_d = date.fromisoformat(latest_str)
        _cache_set(cache_id, latest_d)
        return latest_d
    except Exception as err:
        logger.warning("Could not fetch latest CHIRPS date: %s", err)
        return None


def get_rainfall(
    geometry,
    start_date,
    end_date
):
    # CHIRPS Daily often lags real time by 3-8 weeks; align the 60-day window
    # to the latest actually published CHIRPS date so we never compute a tiny
    # 5-day slice as "0.0 mm" for the full period.
    try:
        req_start = date.fromisoformat(start_date)
        req_end = date.fromisoformat(end_date)
        window_days = max(1, (req_end - req_start).days)
        latest_chirps = _get_latest_chirps_date()
        if latest_chirps and req_end > latest_chirps:
            eff_end = latest_chirps
            eff_start = eff_end - timedelta(days=window_days)
            start_date = eff_start.isoformat()
            end_date = eff_end.isoformat()
    except Exception:
        pass

    collection = (

        ee.ImageCollection(
            "UCSB-CHG/CHIRPS/DAILY"
        )
        .filterBounds(geometry)
        .filterDate(
            start_date,
            end_date
        )

    )

    count = _run_with_retry(lambda: collection.size().getInfo())

    if not count:
        return None

    rainfall = _run_with_retry(
        lambda: collection.sum().reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geometry,
            scale=5500,
            maxPixels=1e13,
            bestEffort=True,
        ).get("precipitation").getInfo()
    )

    return safe_number(
        rainfall
    )


# ============================================================
# 7. HANSEN HISTORICAL FOREST LOSS ANALYSIS
# ============================================================

def analyze_historical_forest_loss(geometry, scale=30):
    """
    Historical forest-loss analysis using Hansen Global
    Forest Change 2025 v1.13.

    Baseline forest:
    Tree canopy cover >= 30% in year 2000.

    Loss year encoding:
    1 = 2001
    2 = 2002
    ...
    25 = 2025.

    This measures gross forest-cover loss events,
    not necessarily permanent deforestation.
    """

    dataset = ee.Image(HANSEN_DATASET_ID)
    tree_cover = dataset.select("treecover2000")
    loss_year = dataset.select("lossyear")
    data_mask = dataset.select("datamask")

    baseline_forest_mask = tree_cover.gte(FOREST_CANOPY_THRESHOLD).And(data_mask.eq(1))
    forest_loss_mask = baseline_forest_mask.And(loss_year.gt(0))

    baseline_area_ee = (
        ee.Image.pixelArea()
        .rename("area")
        .updateMask(baseline_forest_mask)
        .reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geometry,
            scale=scale,
            maxPixels=1e13,
            bestEffort=True,
            tileScale=4,
        )
        .get("area")
    )

    loss_image = (
        ee.Image.pixelArea()
        .rename("area")
        .updateMask(forest_loss_mask)
        .addBands(loss_year.rename("year").updateMask(forest_loss_mask))
    )

    grouped_ee = loss_image.reduceRegion(
        reducer=ee.Reducer.sum().group(groupField=1, groupName="year"),
        geometry=geometry,
        scale=scale,
        maxPixels=1e13,
        bestEffort=True,
        tileScale=4,
    )

    combined = _run_with_retry(
        lambda: ee.Dictionary({
            "baseline_area": baseline_area_ee,
            "grouped": grouped_ee,
        }).getInfo()
    ) or {}

    baseline_forest_area_m2 = safe_number(combined.get("baseline_area"), 0)
    grouped_result = combined.get("grouped") or {}

    # --------------------------------------------------------
    # E. CONVERT RESULTS TO PYTHON DICTIONARY
    # --------------------------------------------------------

    yearly_loss_m2 = {}

    groups = (

        grouped_result.get(
            "groups",
            []
        )
        if grouped_result
        else []

    )

    for item in groups:

        year_code = int(
            item.get("year", 0)
        )

        actual_year = 2000 + year_code

        loss_area = safe_number(
            item.get("sum"),
            0
        )

        yearly_loss_m2[actual_year] = loss_area

    # --------------------------------------------------------
    # F. BUILD COMPLETE YEARLY REPORT
    # --------------------------------------------------------

    annual_loss = []

    for year in range(
        HANSEN_START_YEAR,
        HANSEN_END_YEAR + 1
    ):

        area_m2 = yearly_loss_m2.get(
            year,
            0
        )

        annual_loss.append({

            "year": year,

            "loss_area_m2": round(
                area_m2,
                2
            ),

            "loss_area_hectares": round(
                square_meters_to_hectares(
                    area_m2
                ),
                2
            )

        })

    # --------------------------------------------------------
    # G. TOTAL HISTORICAL LOSS
    # --------------------------------------------------------

    total_loss_m2 = sum(
        yearly_loss_m2.values()
    )

    total_loss_hectares = (
        square_meters_to_hectares(
            total_loss_m2
        )
    )

    baseline_forest_hectares = (
        square_meters_to_hectares(
            baseline_forest_area_m2
        )
    )

    if baseline_forest_area_m2 > 0:

        historical_loss_percent = (

            total_loss_m2 /
            baseline_forest_area_m2

        ) * 100

    else:

        historical_loss_percent = None

    # --------------------------------------------------------
    # H. RECENT FIVE-YEAR LOSS
    # --------------------------------------------------------

    recent_start_year = 2021
    recent_end_year = 2025

    recent_loss_m2 = sum(

        yearly_loss_m2.get(
            year,
            0
        )

        for year in range(
            recent_start_year,
            recent_end_year + 1
        )

    )

    recent_loss_hectares = (
        square_meters_to_hectares(
            recent_loss_m2
        )
    )

    # --------------------------------------------------------
    # I. RETURN HISTORICAL ANALYSIS
    # --------------------------------------------------------

    return {

        "dataset": HANSEN_DATASET_ID,

        "dataset_start_year": HANSEN_START_YEAR,

        "dataset_end_year": HANSEN_END_YEAR,

        "canopy_threshold_percent": (
            FOREST_CANOPY_THRESHOLD
        ),

        "baseline_forest_area_m2": (
            baseline_forest_area_m2
        ),

        "baseline_forest_area_hectares": round(
            baseline_forest_hectares,
            2
        ),

        "total_forest_loss_m2": (
            total_loss_m2
        ),

        "total_forest_loss_hectares": round(
            total_loss_hectares,
            2
        ),

        "historical_loss_percent": (

            round(
                historical_loss_percent,
                2
            )

            if historical_loss_percent is not None

            else None

        ),

        "recent_5_year_loss_m2": (
            recent_loss_m2
        ),

        "recent_5_year_loss_hectares": round(
            recent_loss_hectares,
            2
        ),

        "recent_period": "2021-2025",

        "annual_loss": annual_loss,

        "interpretation": (
            "Historical gross forest-cover loss "
            "within baseline forest pixels."
        )

    }


# ============================================================
# 8. COMPLETE AREA ANALYSIS
# ============================================================

def analyze_area(bounding_box=None, geojson_geometry=None, include_extended=False):
    """
    Complete EcoGuard area analysis supporting bounding boxes or custom GeoJSON polygons.

    1. Sentinel-2 current vegetation (NDVI, EVI, NBR)
    2. Sentinel-2 previous 60-day vegetation
    3. CHIRPS rainfall
    4. Hansen historical forest loss (2001-2025)
    5. Optional extended telemetry: Seasonal YoY NDVI, 12-month trend, live map tiles

    Existing output keys are preserved.
    """

    ensure_earth_engine_initialized()

    cache_id = _cache_key(
        "analyze_area",
        {
            "bbox": bounding_box,
            "geojson": geojson_geometry,
            "extended": bool(include_extended),
            "day": date.today().isoformat(),
        },
    )
    cached = _cache_get(cache_id)
    if cached is not None:
        return cached

    geometry = resolve_geometry(
        bounding_box=bounding_box,
        geojson_geometry=geojson_geometry,
    )

    today = date.today()

    current_end = today

    current_start = (
        today - timedelta(days=60)
    )

    previous_end = current_start

    previous_start = (
        previous_end - timedelta(days=60)
    )

    # --------------------------------------------------------
    # A. AREA & ADAPTIVE SCALES
    # --------------------------------------------------------

    total_area = safe_number(
        _run_with_retry(lambda: geometry.area(maxError=10).getInfo())
    )
    scales = _adaptive_scales(total_area)

    # --------------------------------------------------------
    # B. PARALLEL EARTH ENGINE COMPUTATION
    # --------------------------------------------------------

    def _fetch_worldcover_bundle():
        try:
            worldcover = get_worldcover_image(geometry)
            lc_stats = calculate_landcover_statistics(
                worldcover, geometry, scale=scales["worldcover"]
            )
            wc_remapped = worldcover.remap(
                [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            )
            wc_map = _run_with_retry(
                lambda: wc_remapped.getMapId({
                    "min": 1,
                    "max": 11,
                    "palette": [
                        "006400", "ffbb22", "ffff4c", "f096ff", "fa0000",
                        "b4b4b4", "f0f0f0", "0064c8", "0096a0", "00cf75", "fae6a0",
                    ],
                })
            )
            return lc_stats["classes"], wc_map["tile_fetcher"].url_format
        except Exception as err:
            logger.warning("Extended WorldCover enrichment failed: %s", err)
            return [], None

    with ThreadPoolExecutor(max_workers=8) as pool:
        f_current = pool.submit(
            calculate_period_stats,
            geometry,
            current_start.isoformat(),
            current_end.isoformat(),
            scales["sentinel"],
        )
        f_previous = pool.submit(
            calculate_period_stats,
            geometry,
            previous_start.isoformat(),
            previous_end.isoformat(),
            scales["sentinel"],
        )
        f_rainfall = pool.submit(
            get_rainfall,
            geometry,
            current_start.isoformat(),
            current_end.isoformat(),
        )
        f_hansen = pool.submit(
            analyze_historical_forest_loss,
            geometry,
            scales["hansen"],
        )

        f_yoy = None
        f_monthly = None
        f_ndvi_tile = None
        f_hansen_tile = None
        f_worldcover = None

        if include_extended:
            yoy_end = current_end - timedelta(days=365)
            yoy_start = current_start - timedelta(days=365)
            f_yoy = pool.submit(
                calculate_period_stats,
                geometry,
                yoy_start.isoformat(),
                yoy_end.isoformat(),
                scales["sentinel"],
            )
            f_monthly = pool.submit(
                get_monthly_ndvi_series, geometry, 12, scales["monthly"]
            )
            f_ndvi_tile = pool.submit(
                get_ndvi_tile_url,
                geometry,
                current_start.isoformat(),
                current_end.isoformat(),
            )
            f_hansen_tile = pool.submit(get_hansen_loss_tile_url, geometry)
            f_worldcover = pool.submit(_fetch_worldcover_bundle)

        current = f_current.result()
        previous = f_previous.result()
        rainfall = f_rainfall.result()
        historical_forest_loss = f_hansen.result()

        yoy_stats = f_yoy.result() if f_yoy else None
        monthly_ndvi = f_monthly.result() if f_monthly else []
        ndvi_tile_url = f_ndvi_tile.result() if f_ndvi_tile else None
        hansen_loss_tile_url = f_hansen_tile.result() if f_hansen_tile else None
        landcover_classes, landcover_tile_url = (
            f_worldcover.result() if f_worldcover else ([], None)
        )

    current_area = current["vegetation_area"]
    previous_area = previous["vegetation_area"]

    if current_area is not None and total_area and total_area > 0:
        coverage = (current_area / total_area) * 100
    else:
        coverage = None

    if current_area is not None and previous_area is not None and previous_area > 0:
        vegetation_loss = max(0, ((previous_area - current_area) / previous_area) * 100)
    else:
        vegetation_loss = None

    if current["ndvi"] is not None and previous["ndvi"] is not None:
        ndvi_change = current["ndvi"] - previous["ndvi"]
    else:
        ndvi_change = None

    yoy_ndvi_change = None
    if yoy_stats and current["ndvi"] is not None and yoy_stats["ndvi"] is not None:
        yoy_ndvi_change = round(current["ndvi"] - yoy_stats["ndvi"], 4)

    dnbr = None
    if current.get("nbr") is not None and previous.get("nbr") is not None:
        dnbr = round(previous["nbr"] - current["nbr"], 4)

    # --------------------------------------------------------
    # J. FINAL RESULT
    # --------------------------------------------------------

    result = {

        "current_ndvi": current["ndvi"],

        "previous_ndvi": previous["ndvi"],

        "current_evi": current.get("evi"),

        "previous_evi": previous.get("evi"),

        "current_nbr": current.get("nbr"),

        "previous_nbr": previous.get("nbr"),

        "dnbr": dnbr,

        "yoy_ndvi": yoy_stats["ndvi"] if yoy_stats else None,

        "yoy_ndvi_change": yoy_ndvi_change,

        "monthly_ndvi": monthly_ndvi,

        "ndvi_tile_url": ndvi_tile_url,

        "landcover_tile_url": landcover_tile_url,

        "hansen_loss_tile_url": hansen_loss_tile_url,

        "landcover_classes": landcover_classes,

        "vegetation_area_current": current_area,

        "vegetation_area_previous": previous_area,

        "vegetation_loss": vegetation_loss,

        "rainfall": rainfall,

        "ndvi_change": ndvi_change,

        "current_image_count": current["image_count"],

        "previous_image_count": previous["image_count"],

        "total_area_m2": total_area,

        "current_coverage_percent": coverage,

        "analysis_start": current_start.isoformat(),

        "analysis_end": current_end.isoformat(),

        "previous_start": previous_start.isoformat(),

        "previous_end": previous_end.isoformat(),

        "bounding_box": bounding_box,

        "geometry_type": "custom_polygon" if geojson_geometry is not None else "bounding_box",

        "historical_forest_loss": (
            historical_forest_loss
        ),

        "baseline_forest_area_hectares": (
            historical_forest_loss[
                "baseline_forest_area_hectares"
            ]
        ),

        "historical_forest_loss_hectares": (
            historical_forest_loss[
                "total_forest_loss_hectares"
            ]
        ),

        "historical_forest_loss_percent": (
            historical_forest_loss[
                "historical_loss_percent"
            ]
        ),

        "recent_5_year_forest_loss_hectares": (
            historical_forest_loss[
                "recent_5_year_loss_hectares"
            ]
        ),

        "annual_forest_loss": (
            historical_forest_loss[
                "annual_loss"
            ]
        ),

        "forest_loss_dataset": (
            historical_forest_loss[
                "dataset"
            ]
        )

    }

    _cache_set(cache_id, result)
    return result


# ============================================================
# 9. GREEN COVERAGE - ESA WORLDCOVER
# ============================================================

def get_worldcover_image(geometry):
    """
    Loads ESA WorldCover 2021 v200.

    The dataset is a land-cover classification product,
    not a current-year Sentinel-2 classification.
    """

    collection = (

        ee.ImageCollection(
            WORLDCOVER_DATASET_ID
        )
        .filterBounds(geometry)

    )

    image = collection.mosaic()

    return (
        image
        .select("Map")
        .clip(geometry)
    )


# ============================================================
# 10. GREEN COVERAGE - LAND COVER STATISTICS
# ============================================================

def calculate_landcover_statistics(
    worldcover,
    geometry,
    scale=30
):
    """
    Calculates land-cover area using pixel area,
    grouped by WorldCover class.

    WorldCover class codes:

    10 Tree cover
    20 Shrubland
    30 Grassland
    40 Cropland
    50 Built-up
    60 Bare / sparse vegetation
    70 Snow and ice
    80 Water
    90 Herbaceous wetland
    95 Mangroves
    100 Moss and lichen
    """

    landcover_names = {

        10: "Tree Cover",

        20: "Shrubland",

        30: "Grassland",

        40: "Cropland",

        50: "Built-up",

        60: "Bare / Sparse Vegetation",

        70: "Snow and Ice",

        80: "Water",

        90: "Herbaceous Wetland",

        95: "Mangroves",

        100: "Moss and Lichen"

    }

    # --------------------------------------------------------
    # A. AREA BAND
    # --------------------------------------------------------

    area_image = (
        ee.Image.pixelArea()
        .rename("area")
        .addBands(
            worldcover.rename("class")
        )
    )

    # --------------------------------------------------------
    # B. GROUP AREA BY LAND-COVER CLASS
    # --------------------------------------------------------

    result = _run_with_retry(
        lambda: area_image.reduceRegion(
            reducer=ee.Reducer.sum().group(
                groupField=1,
                groupName="class"
            ),
            geometry=geometry,
            scale=scale,
            maxPixels=1e13,
            bestEffort=True,
            tileScale=4
        ).getInfo()
    )

    groups = (

        result.get("groups", [])

        if result

        else []

    )

    class_area_m2 = {}

    for item in groups:

        class_code = int(
            item.get("class", 0)
        )

        area_m2 = safe_number(
            item.get("sum"),
            0
        )

        class_area_m2[class_code] = area_m2

    total_classified_area = sum(
        class_area_m2.values()
    )

    # --------------------------------------------------------
    # C. BUILD STATISTICS
    # --------------------------------------------------------

    landcover_classes = []

    for class_code, class_name in landcover_names.items():

        area_m2 = class_area_m2.get(
            class_code,
            0
        )

        area_hectares = (
            area_m2 / 10000
        )

        percentage = (

            (
                area_m2 /
                total_classified_area
            ) * 100

            if total_classified_area > 0

            else 0

        )

        landcover_classes.append({

            "code": class_code,

            "name": class_name,

            "area_m2": round(
                area_m2,
                2
            ),

            "area_hectares": round(
                area_hectares,
                2
            ),

            "percentage": round(
                percentage,
                2
            )

        })

    landcover_classes.sort(

        key=lambda item: item["percentage"],

        reverse=True

    )

    return {

        "classes": landcover_classes,

        "total_classified_area_m2": round(
            total_classified_area,
            2
        ),

        "total_classified_area_hectares": round(
            total_classified_area / 10000,
            2
        )

    }


# ============================================================
# 11. GREEN COVERAGE - MAP LAYERS
# ============================================================

def create_green_coverage_map_layers(
    geometry,
    start_date,
    end_date
):
    """
    Creates Earth Engine tile URLs for:

    1. NDVI map
    2. ESA WorldCover land-cover map

    These URLs are used by Leaflet in the frontend.
    """

    # --------------------------------------------------------
    # A. SENTINEL-2 NDVI
    # --------------------------------------------------------

    collection = get_sentinel_collection(

        geometry,

        start_date,

        end_date

    )

    image_count = collection.size().getInfo()

    if not image_count:

        raise RuntimeError(
            "No cloud-filtered Sentinel-2 images "
            "are available for this location."
        )

    ndvi_image = (

        get_ndvi_image(collection)
        .mean()
        .clip(geometry)

    )

    ndvi_visualization = {

        "min": -0.2,

        "max": 0.8,

        "palette": [

            "8c510a",

            "d8b365",

            "f6e8c3",

            "c7eae5",

            "5ab4ac",

            "01665e"

        ]

    }

    ndvi_map = ndvi_image.getMapId(
        ndvi_visualization
    )

    ndvi_tile_url = (
        ndvi_map["tile_fetcher"].url_format
    )

    # --------------------------------------------------------
    # B. ESA WORLDCOVER
    # --------------------------------------------------------

    worldcover = get_worldcover_image(
        geometry
    )

    # Remap original class values into 1-11.
    # This makes the palette discrete and consistent.

    original_classes = [
        10, 20, 30, 40, 50, 60,
        70, 80, 90, 95, 100
    ]

    display_classes = [
        1, 2, 3, 4, 5, 6,
        7, 8, 9, 10, 11
    ]

    worldcover_display = worldcover.remap(
        original_classes,
        display_classes
    )

    worldcover_visualization = {

        "min": 1,

        "max": 11,

        "palette": [

            "006400",  # Tree cover

            "ffbb22",  # Shrubland

            "ffff4c",  # Grassland

            "f096ff",  # Cropland

            "fa0000",  # Built-up

            "b4b4b4",  # Bare land

            "f0f0f0",  # Snow / ice

            "0064c8",  # Water

            "0096a0",  # Wetland

            "00cf75",  # Mangroves

            "fae6a0"   # Moss / lichen

        ]

    }

    worldcover_map = worldcover_display.getMapId(
        worldcover_visualization
    )

    landcover_tile_url = (
        worldcover_map["tile_fetcher"].url_format
    )

    return {

        "ndvi_tile_url": ndvi_tile_url,

        "landcover_tile_url": landcover_tile_url,

        "worldcover_image": worldcover,

        "image_count": int(image_count)

    }


# ============================================================
# 12. COMPLETE GREEN COVERAGE ANALYSIS
# ============================================================

def build_green_coverage_analysis(bounding_box):
    """
    Complete Green Coverage Analysis.

    Reuses the existing analyze_area() function.

    Adds:
    1. Sentinel-2 NDVI map tile
    2. ESA WorldCover map tile
    3. Land-cover area statistics
    4. Dataset metadata

    Does not modify the existing database or
    existing satellite analysis functions.
    """

    ensure_earth_engine_initialized()

    # --------------------------------------------------------
    # A. EXISTING ECOGUARD ANALYSIS
    # --------------------------------------------------------

    analysis = analyze_area(
        bounding_box
    )

    # --------------------------------------------------------
    # B. CREATE GEOMETRY
    # --------------------------------------------------------

    geometry = get_geometry(
        bounding_box
    )

    today = date.today()

    current_start = (
        today - timedelta(days=60)
    )

    current_end = today

    # --------------------------------------------------------
    # C. CREATE MAP LAYERS
    # --------------------------------------------------------

    map_data = create_green_coverage_map_layers(

        geometry,

        current_start.isoformat(),

        current_end.isoformat()

    )

    # --------------------------------------------------------
    # D. LAND COVER STATISTICS
    # --------------------------------------------------------

    landcover_statistics = (
        calculate_landcover_statistics(

            map_data["worldcover_image"],

            geometry

        )
    )

    # --------------------------------------------------------
    # E. ADD NEW DATA TO EXISTING ANALYSIS
    # --------------------------------------------------------

    analysis.update({

        # Interactive map tile URLs

        "ndvi_tile_url": (
            map_data["ndvi_tile_url"]
        ),

        "landcover_tile_url": (
            map_data["landcover_tile_url"]
        ),

        # Land-cover classes

        "landcover_classes": (
            landcover_statistics["classes"]
        ),

        "landcover_total_area_m2": (
            landcover_statistics[
                "total_classified_area_m2"
            ]
        ),

        "landcover_total_area_hectares": (
            landcover_statistics[
                "total_classified_area_hectares"
            ]
        ),

        # Dataset metadata

        "landcover_dataset": (
            "ESA WorldCover 2021 v200"
        ),

        "landcover_pixel_size": "10 m",

        "map_image_count": (
            map_data["image_count"]
        ),

        "ndvi_threshold": (
            VEGETATION_NDVI_THRESHOLD
        )

    })

    return analysis


# ============================================================
# END OF ECOGUARD GOOGLE EARTH ENGINE SERVICE
# ============================================================

# ============================================================
# ECOGUARD - GREEN COVERAGE ANALYSIS
# Sentinel-2 NDVI + ESA WorldCover + Map Layers
# ============================================================

def analyze_green_coverage(bounding_box=None, geojson_geometry=None):

    ensure_earth_engine_initialized()

    cache_id = _cache_key(
        "analyze_green_coverage",
        {
            "bbox": bounding_box,
            "geojson": geojson_geometry,
            "day": date.today().isoformat(),
        },
    )
    cached = _cache_get(cache_id)
    if cached is not None:
        return cached

    geometry = resolve_geometry(
        bounding_box=bounding_box,
        geojson_geometry=geojson_geometry,
    )

    today = date.today()

    # Current and previous 12-month periods
    current_end = today
    current_start = today - timedelta(days=365)

    previous_end = current_start
    previous_start = previous_end - timedelta(days=365)

    # --------------------------------------------------------
    # 1. SENTINEL-2 NDVI COLLECTIONS
    # --------------------------------------------------------

    current_collection = get_sentinel_collection(
        geometry,
        current_start.isoformat(),
        current_end.isoformat()
    )

    previous_collection = get_sentinel_collection(
        geometry,
        previous_start.isoformat(),
        previous_end.isoformat()
    )

    current_count = current_collection.size().getInfo()
    previous_count = previous_collection.size().getInfo()

    if not current_count:
        raise ValueError(
            "No usable Sentinel-2 images found for the current period."
        )

    current_ndvi_collection = get_ndvi_image(current_collection)

    current_ndvi_image = (
        current_ndvi_collection
        .median()
        .clip(geometry)
    )

    previous_ndvi_image = None

    if previous_count:
        previous_ndvi_collection = get_ndvi_image(
            previous_collection
        )

        previous_ndvi_image = (
            previous_ndvi_collection
            .median()
            .clip(geometry)
        )

    # --------------------------------------------------------
    # 2. TOTAL AREA
    # --------------------------------------------------------

    total_area_m2 = geometry.area(maxError=1).getInfo()

    total_area_hectares = total_area_m2 / 10000

    if total_area_m2 <= 0:
        raise ValueError("Invalid analysis area.")

    # --------------------------------------------------------
    # 3. CURRENT NDVI STATISTICS
    # --------------------------------------------------------

    ndvi_mean_result = current_ndvi_image.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geometry,
        scale=10,
        maxPixels=1e13,
        bestEffort=True,
        tileScale=4
    ).getInfo()

    average_ndvi = safe_number(
        (ndvi_mean_result or {}).get("NDVI")
    )

    # Vegetation area where NDVI > 0.30
    current_vegetation_area_result = (
        ee.Image.pixelArea()
        .updateMask(
            current_ndvi_image.gt(VEGETATION_NDVI_THRESHOLD)
        )
        .rename("area")
        .reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geometry,
            scale=10,
            maxPixels=1e13,
            bestEffort=True,
            tileScale=4
        )
        .getInfo()
    )

    ndvi_vegetation_area_m2 = safe_number(
        (current_vegetation_area_result or {}).get("area"),
        0
    )

    ndvi_vegetation_coverage_percent = (
        ndvi_vegetation_area_m2 / total_area_m2
    ) * 100

    # --------------------------------------------------------
    # 4. PREVIOUS PERIOD NDVI COVERAGE
    # --------------------------------------------------------

    previous_average_ndvi = None
    previous_vegetation_area_m2 = None
    previous_coverage_percent = None

    if previous_ndvi_image is not None:

        previous_mean_result = previous_ndvi_image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geometry,
            scale=10,
            maxPixels=1e13,
            bestEffort=True,
            tileScale=4
        ).getInfo()

        previous_average_ndvi = safe_number(
            (previous_mean_result or {}).get("NDVI")
        )

        previous_area_result = (
            ee.Image.pixelArea()
            .updateMask(
                previous_ndvi_image.gt(
                    VEGETATION_NDVI_THRESHOLD
                )
            )
            .rename("area")
            .reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=geometry,
                scale=10,
                maxPixels=1e13,
                bestEffort=True,
                tileScale=4
            )
            .getInfo()
        )

        previous_vegetation_area_m2 = safe_number(
            (previous_area_result or {}).get("area"),
            0
        )

        previous_coverage_percent = (
            previous_vegetation_area_m2 / total_area_m2
        ) * 100

    # --------------------------------------------------------
    # 5. ESA WORLDCOVER LAND-COVER CLASSIFICATION
    # Dataset reference: 2021
    # --------------------------------------------------------

    worldcover = (
        ee.ImageCollection("ESA/WorldCover/v200")
        .mosaic()
        .select("Map")
        .clip(geometry)
    )

    class_names = {
        10: "Tree Cover",
        20: "Shrubland",
        30: "Grassland",
        40: "Cropland",
        50: "Built-up",
        60: "Bare / Sparse Vegetation",
        70: "Snow and Ice",
        80: "Water Bodies",
        90: "Herbaceous Wetland",
        95: "Mangroves",
        100: "Moss and Lichen"
    }

    green_classes = [10, 20, 30, 40, 90, 95, 100]

    area_and_class = (
        ee.Image.pixelArea()
        .rename("area")
        .addBands(worldcover.rename("class"))
    )

    grouped_result = area_and_class.reduceRegion(
        reducer=ee.Reducer.sum().group(
            groupField=1,
            groupName="class"
        ),
        geometry=geometry,
        scale=10,
        maxPixels=1e13,
        bestEffort=True,
        tileScale=4
    ).getInfo()

    groups = (grouped_result or {}).get("groups", [])

    land_cover_classes = []
    green_area_m2 = 0

    for group in groups:

        class_code = int(group.get("class", 0))
        area_m2 = safe_number(group.get("sum"), 0)

        if area_m2 is None:
            area_m2 = 0

        area_hectares = area_m2 / 10000

        percentage = (
            area_m2 / total_area_m2
        ) * 100

        class_name = class_names.get(
            class_code,
            "Other / Unclassified"
        )

        land_cover_classes.append({
            "class_code": class_code,
            "name": class_name,
            "area_m2": round(area_m2, 2),
            "area_hectares": round(area_hectares, 2),
            "percentage": round(percentage, 2)
        })

        if class_code in green_classes:
            green_area_m2 += area_m2

    green_area_hectares = green_area_m2 / 10000

    green_coverage_percent = (
        green_area_m2 / total_area_m2
    ) * 100

    # --------------------------------------------------------
    # 6. COVERAGE CHANGE
    # --------------------------------------------------------

    coverage_change_percent = None
    ndvi_change = None

    if previous_coverage_percent is not None:

        coverage_change_percent = (
            ndvi_vegetation_coverage_percent
            - previous_coverage_percent
        )

    if (
        average_ndvi is not None
        and previous_average_ndvi is not None
    ):

        ndvi_change = (
            average_ndvi - previous_average_ndvi
        )

    # --------------------------------------------------------
    # 7. NDVI MAP TILE
    # --------------------------------------------------------

    ndvi_visualization = {
        "min": -0.2,
        "max": 0.8,
        "palette": [
            "8c510a",
            "d8b365",
            "f6e8c3",
            "c7eae5",
            "5ab4ac",
            "01665e"
        ]
    }

    ndvi_map = current_ndvi_image.getMapId(
        ndvi_visualization
    )

    ndvi_tile_url = (
        ndvi_map["tile_fetcher"].url_format
    )

    # --------------------------------------------------------
    # 8. LAND-COVER MAP TILE
    # --------------------------------------------------------

    original_classes = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]
    display_classes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    worldcover_display = worldcover.remap(original_classes, display_classes)

    landcover_visual = worldcover_display.visualize(
        min=1,
        max=11,
        palette=[
            "006400",
            "ffbb22",
            "ffff4c",
            "f096ff",
            "fa0000",
            "b4b4b4",
            "f0f0f0",
            "0064c8",
            "0096a0",
            "00cf75",
            "fae6a0"
        ]
    )

    landcover_map = landcover_visual.getMapId()

    landcover_tile_url = (
        landcover_map["tile_fetcher"].url_format
    )

    # --------------------------------------------------------
    # 9. RETURN ANALYSIS
    # --------------------------------------------------------

    result = {

        "location_area_m2": round(total_area_m2, 2),

        "total_area_hectares": round(
            total_area_hectares, 2
        ),

        "green_area_m2": round(
            green_area_m2, 2
        ),

        "green_area_hectares": round(
            green_area_hectares, 2
        ),

        "green_coverage_percent": round(
            green_coverage_percent, 2
        ),

        "average_ndvi": (
            round(average_ndvi, 4)
            if average_ndvi is not None else None
        ),

        "previous_average_ndvi": (
            round(previous_average_ndvi, 4)
            if previous_average_ndvi is not None else None
        ),

        "ndvi_vegetation_area_hectares": round(
            ndvi_vegetation_area_m2 / 10000, 2
        ),

        "ndvi_vegetation_coverage_percent": round(
            ndvi_vegetation_coverage_percent, 2
        ),

        "previous_ndvi_coverage_percent": (
            round(previous_coverage_percent, 2)
            if previous_coverage_percent is not None
            else None
        ),

        "coverage_change_percent": (
            round(coverage_change_percent, 2)
            if coverage_change_percent is not None
            else None
        ),

        "ndvi_change": (
            round(ndvi_change, 4)
            if ndvi_change is not None else None
        ),

        "current_image_count": current_count,
        "previous_image_count": previous_count,

        "current_start": current_start.isoformat(),
        "current_end": current_end.isoformat(),

        "previous_start": previous_start.isoformat(),
        "previous_end": previous_end.isoformat(),

        "land_cover_classes": land_cover_classes,

        "land_cover_dataset": "ESA WorldCover v200 (2021)",

        "ndvi_threshold": VEGETATION_NDVI_THRESHOLD,

        "ndvi_tile_url": ndvi_tile_url,

        "landcover_tile_url": landcover_tile_url,

        "analysis_note": (
            "Green coverage is calculated from vegetated "
            "WorldCover classes. NDVI coverage is a separate "
            "Sentinel-2 measurement. These are not tree counts."
        )
    }

    _cache_set(cache_id, result)
    return result
