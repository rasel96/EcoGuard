# location_service.py
from collections import OrderedDict
import logging
import threading
import time
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

logger = logging.getLogger("ecoguard.location")

geolocator = Nominatim(
    user_agent="EcoGuard_Forest_Monitoring_System/2.0"
)

_CACHE_TTL_SECONDS = 3600
_CACHE_MAX_ENTRIES = 500
_location_cache = OrderedDict()
_suggest_cache = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(cache, key):
    with _cache_lock:
        entry = cache.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            cache.pop(key, None)
            return None
        cache.move_to_end(key)
        return value


def _cache_set(cache, key, value, ttl=_CACHE_TTL_SECONDS):
    now = time.monotonic()
    with _cache_lock:
        expired = [k for k, (_, exp) in cache.items() if now > exp]
        for k in expired:
            cache.pop(k, None)
        cache[key] = (value, now + ttl)
        cache.move_to_end(key)
        while len(cache) > _CACHE_MAX_ENTRIES:
            cache.popitem(last=False)


def clear_location_cache():
    """Clear in-memory geocoding caches (useful for testing)."""
    with _cache_lock:
        _location_cache.clear()
        _suggest_cache.clear()


def get_location(place_name):
    """Find a place and return its coordinates and bounding box."""
    if not place_name or not place_name.strip():
        return None

    query = place_name.strip()

    # Prefer Bangladesh results
    if "bangladesh" not in query.lower():
        query += ", Bangladesh"

    cache_key = query.lower()
    cached = _cache_get(_location_cache, cache_key)
    if cached is not None:
        return cached

    try:
        result = geolocator.geocode(
            query,
            exactly_one=True,
            addressdetails=True,
            country_codes="bd",
            language="en",
            timeout=20
        )

        if result is None:
            return None

        raw_bbox = result.raw.get("boundingbox")

        if not raw_bbox or len(raw_bbox) != 4:
            return None

        # Nominatim order: south, north, west, east
        bbox = [
            float(raw_bbox[0]),
            float(raw_bbox[1]),
            float(raw_bbox[2]),
            float(raw_bbox[3])
        ]

        location_info = {
            "name": result.address,
            "latitude": float(result.latitude),
            "longitude": float(result.longitude),
            "boundingbox": bbox,
            "boundary_type": "OpenStreetMap boundary"
        }

        _cache_set(_location_cache, cache_key, location_info)
        return location_info

    except (GeocoderTimedOut, GeocoderServiceError, Exception) as error:
        logger.warning("Location service error for '%s': %s", place_name, error)
        return None


def suggest_locations(search_text, limit=7):
    """Return location suggestions for the autocomplete search box."""
    if not search_text or len(search_text.strip()) < 2:
        return []

    query = search_text.strip()
    cache_key = (query.lower(), int(limit))
    cached = _cache_get(_suggest_cache, cache_key)
    if cached is not None:
        return cached

    try:
        results = geolocator.geocode(
            query,
            exactly_one=False,
            addressdetails=True,
            country_codes="bd",
            language="en",
            timeout=15,
            limit=limit
        )

        suggestions = []

        for item in results or []:
            suggestions.append({
                "name": item.address,
                "latitude": float(item.latitude),
                "longitude": float(item.longitude)
            })

        _cache_set(_suggest_cache, cache_key, suggestions)
        return suggestions

    except Exception as error:
        logger.warning("Autocomplete error for '%s': %s", search_text, error)
        return []