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


# Curated major Bangladesh forests & regions ranked first in autocomplete
# so partial queries like "Sundar" surface Sundarbans before small villages.
BANGLADESH_PRIORITY_PLACES = [
    {
        "name": "Sundarbans, Khulna Division, Bangladesh",
        "latitude": 22.0240,
        "longitude": 89.3136,
        "boundingbox": [21.5402, 22.5018, 88.6764, 89.9355],
        "keywords": ["sundarban", "sundarbans", "mangrove", "khulna forest"],
    },
    {
        "name": "Lawachara National Park, Moulvibazar District, Sylhet Division, Bangladesh",
        "latitude": 24.3292,
        "longitude": 91.7879,
        "boundingbox": [24.3053, 24.3531, 91.7699, 91.8253],
        "keywords": ["lawachara", "srimangal", "sreemangal", "moulvibazar"],
    },
    {
        "name": "Madhupur National Park, Tangail District, Dhaka Division, Bangladesh",
        "latitude": 24.6960,
        "longitude": 90.0680,
        "boundingbox": [24.6400, 24.7500, 90.0100, 90.1300],
        "keywords": ["madhupur", "modhupur", "tangail"],
    },
    {
        "name": "Ratargul Swamp Forest, Sylhet District, Sylhet Division, Bangladesh",
        "latitude": 25.0130,
        "longitude": 91.9240,
        "boundingbox": [24.9900, 25.0350, 91.8950, 91.9550],
        "keywords": ["ratargul", "swamp forest", "sylhet forest"],
    },
    {
        "name": "Rema-Kalenga Wildlife Sanctuary, Habiganj District, Sylhet Division, Bangladesh",
        "latitude": 24.1150,
        "longitude": 91.6220,
        "boundingbox": [24.0800, 24.1550, 91.5850, 91.6600],
        "keywords": ["rema", "kalenga", "habiganj"],
    },
    {
        "name": "Satchari National Park, Habiganj District, Sylhet Division, Bangladesh",
        "latitude": 24.1225,
        "longitude": 91.4495,
        "boundingbox": [24.1050, 24.1400, 91.4300, 91.4700],
        "keywords": ["satchari", "chunarughat"],
    },
    {
        "name": "Bhawal National Park, Gazipur District, Dhaka Division, Bangladesh",
        "latitude": 24.0980,
        "longitude": 90.4040,
        "boundingbox": [24.0550, 24.1400, 90.3650, 90.4450],
        "keywords": ["bhawal", "gazipur"],
    },
    {
        "name": "Rangamati Hill District, Chattogram Division, Bangladesh",
        "latitude": 22.6533,
        "longitude": 92.1789,
        "boundingbox": [22.2500, 23.2500, 91.9500, 92.4500],
        "keywords": ["rangamati", "kaptai", "chittagong hill"],
    },
    {
        "name": "Bandarban Hill District, Chattogram Division, Bangladesh",
        "latitude": 22.1953,
        "longitude": 92.2184,
        "boundingbox": [21.6500, 22.3800, 92.0500, 92.6500],
        "keywords": ["bandarban", "sajek", "nilgiri"],
    },
]


def _match_priority_places(query_lower):
    matches = []
    for place in BANGLADESH_PRIORITY_PLACES:
        name_l = place["name"].lower()
        if query_lower in name_l or any(query_lower in kw or kw in query_lower for kw in place["keywords"]):
            matches.append({
                "name": place["name"],
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "boundingbox": place["boundingbox"],
            })
    return matches


def suggest_locations(search_text, limit=7):
    """Return location suggestions for the autocomplete search box."""
    if not search_text or len(search_text.strip()) < 2:
        return []

    query = search_text.strip()
    cache_key = (query.lower(), int(limit))
    cached = _cache_get(_suggest_cache, cache_key)
    if cached is not None:
        return cached

    suggestions = _match_priority_places(query.lower())
    seen_names = {item["name"].lower() for item in suggestions}

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

        for item in results or []:
            if item.address.lower() in seen_names:
                continue
            raw_bbox = item.raw.get("boundingbox")
            bbox = (
                [float(raw_bbox[0]), float(raw_bbox[1]), float(raw_bbox[2]), float(raw_bbox[3])]
                if raw_bbox and len(raw_bbox) == 4
                else None
            )
            suggestions.append({
                "name": item.address,
                "latitude": float(item.latitude),
                "longitude": float(item.longitude),
                "boundingbox": bbox,
            })
            seen_names.add(item.address.lower())
            if len(suggestions) >= limit:
                break

        suggestions = suggestions[:limit]
        _cache_set(_suggest_cache, cache_key, suggestions)
        return suggestions

    except Exception as error:
        logger.warning("Autocomplete error for '%s': %s", search_text, error)
        return suggestions[:limit]