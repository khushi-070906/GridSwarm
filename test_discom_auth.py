"""
Run: pytest test_discom_auth.py -v

Covers the auth layer guarding the DISCOM/DSO-facing endpoints
(/emergency-event, /emergency-scenario): missing/invalid keys, zone
registration, rate limiting, and that the rest of the API stays open.
"""
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    """Fresh app + auth registry + rate-limit state per test, with a
    known, deterministic key registry."""
    monkeypatch.setenv(
        "GRIDSWARM_API_KEYS",
        "zone7-key:transformer-zone-7-emergency,wildcard-key:*,low-limit-key:*",
    )
    monkeypatch.setenv("GRIDSWARM_RATE_LIMIT_PER_MINUTE", "3")

    import app.discom_auth as discom_auth
    importlib.reload(discom_auth)
    discom_auth.reset_rate_limits()

    import app.main as main
    importlib.reload(main)

    return TestClient(main.app)


def _emergency_event_body(zone_id="transformer-zone-7-emergency"):
    return {
        "zone_id": zone_id,
        "utilization_percent": 99.0,
        "target_reduction_kw": 40.0,
        "duration_minutes": 15.0,
        "evs": [
            {
                "id": "EV_01",
                "soc_percent": 80,
                "required_soc_percent": 40,
                "departure_minutes": 400,
                "battery_kwh": 60,
                "opted_in_v2g": True,
            }
        ],
    }


def test_missing_api_key_is_rejected(client):
    resp = client.post("/emergency-event", json=_emergency_event_body())
    assert resp.status_code == 422  # FastAPI: required header missing


def test_invalid_api_key_is_rejected(client):
    resp = client.post(
        "/emergency-event",
        json=_emergency_event_body(),
        headers={"X-API-Key": "not-a-real-key"},
    )
    assert resp.status_code == 401


def test_valid_key_wrong_zone_is_forbidden(client):
    resp = client.post(
        "/emergency-event",
        json=_emergency_event_body(zone_id="some-other-zone"),
        headers={"X-API-Key": "zone7-key"},
    )
    assert resp.status_code == 403


def test_valid_key_registered_zone_succeeds(client):
    resp = client.post(
        "/emergency-event",
        json=_emergency_event_body(zone_id="transformer-zone-7-emergency"),
        headers={"X-API-Key": "zone7-key"},
    )
    assert resp.status_code == 200
    assert resp.json()["mobility_violations"] == 0


def test_wildcard_key_can_call_any_zone(client):
    resp = client.post(
        "/emergency-event",
        json=_emergency_event_body(zone_id="any-zone-at-all"),
        headers={"X-API-Key": "wildcard-key"},
    )
    assert resp.status_code == 200


def test_emergency_scenario_get_requires_key(client):
    resp = client.get("/emergency-scenario")
    assert resp.status_code == 422

    resp_ok = client.get(
        "/emergency-scenario", headers={"X-API-Key": "zone7-key"}
    )
    assert resp_ok.status_code == 200


def test_rate_limit_enforced_per_key(client):
    headers = {"X-API-Key": "low-limit-key"}
    # limit is 3/min per the fixture's env var
    for _ in range(3):
        resp = client.post(
            "/emergency-event", json=_emergency_event_body("any-zone"), headers=headers
        )
        assert resp.status_code == 200

    resp = client.post(
        "/emergency-event", json=_emergency_event_body("any-zone"), headers=headers
    )
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_rate_limits_are_independent_per_key(client):
    # Exhaust zone7-key's limit...
    for _ in range(3):
        client.post(
            "/emergency-event",
            json=_emergency_event_body(),
            headers={"X-API-Key": "zone7-key"},
        )
    exhausted = client.post(
        "/emergency-event",
        json=_emergency_event_body(),
        headers={"X-API-Key": "zone7-key"},
    )
    assert exhausted.status_code == 429

    # ...wildcard-key should be unaffected.
    fresh = client.post(
        "/emergency-event",
        json=_emergency_event_body("whatever-zone"),
        headers={"X-API-Key": "wildcard-key"},
    )
    assert fresh.status_code == 200


def test_non_discom_endpoints_stay_open(client):
    """/grid-event, /fleet/*, /demo-scenario etc. are the n8n-internal /
    demo surface — they must NOT require an API key."""
    resp = client.get("/demo-scenario")
    assert resp.status_code == 200

    resp2 = client.get("/fleet/demo")
    assert resp2.status_code == 200
