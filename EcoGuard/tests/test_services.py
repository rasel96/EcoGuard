from types import SimpleNamespace
from unittest.mock import patch

import pytest

import gee_service
import location_service


def test_gee_service_lazy_initialization():
    # Importing gee_service must not eagerly initialize Earth Engine
    assert gee_service._ee_initialized is False


def test_gee_helpers():
    assert gee_service.safe_number("42.5") == 42.5
    assert gee_service.safe_number(None, default=0) == 0
    assert gee_service.safe_number("not-a-number", default=-1) == -1
    assert gee_service.square_meters_to_hectares(25000) == 2.5
    assert gee_service.square_meters_to_hectares(None) is None


@pytest.mark.parametrize(
    "bad_bbox",
    [
        None,
        [22.0, 23.0],
        ["a", "b", "c", "d"],
        [25.0, 22.0, 89.0, 90.0],   # south >= north
        [22.0, 23.0, 91.0, 90.0],   # west >= east
        [-95.0, 23.0, 89.0, 90.0],  # out of range lat
    ],
)
def test_get_geometry_rejects_invalid_bboxes(bad_bbox):
    with pytest.raises(ValueError):
        gee_service.get_geometry(bad_bbox)


def test_get_geometry_valid_bbox():
    with patch.object(gee_service.ee.Geometry, "Rectangle", return_value="mock-rect") as mock_rect:
        result = gee_service.get_geometry([22.0, 22.5, 89.0, 89.5])
        assert result == "mock-rect"
        mock_rect.assert_called_once_with([89.0, 22.0, 89.5, 22.5])


def test_location_service_geocoding_and_cache():
    location_service.clear_location_cache()

    fake_result = SimpleNamespace(
        address="Sylhet, Bangladesh",
        latitude=24.8949,
        longitude=91.8687,
        raw={"boundingbox": ["24.8", "25.0", "91.8", "92.0"]},
    )

    with patch.object(location_service.geolocator, "geocode", return_value=fake_result) as mock_geo:
        first = location_service.get_location("Sylhet")
        second = location_service.get_location("Sylhet")

        assert first is not None
        assert first["name"] == "Sylhet, Bangladesh"
        assert first["boundingbox"] == [24.8, 25.0, 91.8, 92.0]
        assert second == first
        # Second call should hit cache instead of Nominatim
        assert mock_geo.call_count == 1
        assert mock_geo.call_args[0][0] == "Sylhet, Bangladesh"


def test_location_service_suggest_and_error_handling():
    location_service.clear_location_cache()
    assert location_service.suggest_locations("a") == []
    assert location_service.get_location("   ") is None

    with patch.object(location_service.geolocator, "geocode", side_effect=RuntimeError("timeout")):
        assert location_service.get_location("Dhaka") is None
        assert location_service.suggest_locations("UnknownTownXYZ") == []
