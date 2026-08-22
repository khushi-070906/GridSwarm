"""
Auth / rate-limit / zone-registration layer for the DISCOM/DSO-facing
endpoints (`/emergency-event`, `/emergency-scenario`).

This is intentionally separate from the rest of the API: `/grid-event`,
`/fleet/*`, `/depot-scenario` etc. stay open (they're the n8n-internal /
demo-facing surface). Only the endpoints meant to be called by an external
grid operator get a key, a rate limit, and a check that the caller is
actually registered for the zone it's trying to signal for.

Config is env-var driven so this works the same in a laptop demo and behind
a real deployment, with no code changes:

  GRIDSWARM_API_KEYS
      Comma-separated "key:zone1|zone2|...,key2:zone3" registry. A zone
      list of "*" means the key may call any zone_id. Example:

          GRIDSWARM_API_KEYS="discom-bescom-2f9a:transformer-zone-7|transformer-zone-8,discom-demo-key:*"

      If GRIDSWARM_API_KEYS is unset, a single permissive demo key
      ("gridswarm-demo-key" -> "*") is registered so the endpoints keep
      working out of the box for local/demo use. Set the env var in any
      real deployment to turn that off.

  GRIDSWARM_RATE_LIMIT_PER_MINUTE
      Requests allowed per API key per rolling 60s window on the protected
      endpoints. Defaults to 30.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import Header, HTTPException, status


# --- Zone registry ----------------------------------------------------------

def _load_registry() -> Dict[str, set]:
    raw = os.environ.get("GRIDSWARM_API_KEYS")
    if not raw:
        # Permissive default so the endpoints work out of the box in a
        # demo/local setting. Real deployments should set the env var.
        return {"gridswarm-demo-key": {"*"}}

    registry: Dict[str, set] = {}
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if ":" not in entry:
            # A bare key with no zone list = allow all zones.
            registry[entry] = {"*"}
            continue
        key, zones_raw = entry.split(":", 1)
        key = key.strip()
        zones = {z.strip() for z in zones_raw.split("|") if z.strip()}
        registry[key] = zones or {"*"}
    return registry


_REGISTRY: Dict[str, set] = _load_registry()


def reload_registry() -> None:
    """Re-read GRIDSWARM_API_KEYS from the environment. Mainly for tests."""
    global _REGISTRY
    _REGISTRY = _load_registry()


def is_zone_allowed(api_key: str, zone_id: str) -> bool:
    zones = _REGISTRY.get(api_key)
    if zones is None:
        return False
    return "*" in zones or zone_id in zones


# --- Rate limiting ------------------------------------------------------

_RATE_LIMIT_WINDOW_SECONDS = 60.0


def _rate_limit_per_minute() -> int:
    return int(os.environ.get("GRIDSWARM_RATE_LIMIT_PER_MINUTE", "30"))


# api_key -> deque of request timestamps within the current window
_request_log: Dict[str, Deque[float]] = defaultdict(deque)


def _check_rate_limit(api_key: str) -> None:
    limit = _rate_limit_per_minute()
    now = time.monotonic()
    window_start = now - _RATE_LIMIT_WINDOW_SECONDS
    log = _request_log[api_key]

    while log and log[0] < window_start:
        log.popleft()

    if len(log) >= limit:
        retry_after = max(0.0, log[0] + _RATE_LIMIT_WINDOW_SECONDS - now)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Rate limit exceeded: {limit} requests/minute per API key. "
                f"Retry after {retry_after:.1f}s."
            ),
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

    log.append(now)


def reset_rate_limits() -> None:
    """Clear all rate-limit state. Mainly for tests."""
    _request_log.clear()


# --- FastAPI dependency --------------------------------------------------

async def require_discom_auth(x_api_key: str = Header(..., alias="X-API-Key")) -> str:
    """
    FastAPI dependency for DISCOM-facing endpoints: verifies the API key
    exists, is under its rate limit, and returns the key so the route can
    additionally check zone authorization once it knows the zone_id being
    signalled (zone_id may be in the request body, so that check happens
    in the route itself via `require_zone_access`).
    """
    if x_api_key not in _REGISTRY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key. DISCOM/DSO callers must "
                   "register a key (X-API-Key header) — contact GridSwarm "
                   "to get one provisioned.",
        )
    _check_rate_limit(x_api_key)
    return x_api_key


def require_zone_access(api_key: str, zone_id: str) -> None:
    """Call from inside a route once zone_id is known (e.g. from the
    request body) to enforce zone-registration authorization."""
    if not is_zone_allowed(api_key, zone_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"API key is not registered for zone '{zone_id}'. "
                "Each DISCOM/DSO key is scoped to specific transformer "
                "zones — contact GridSwarm to register additional zones."
            ),
        )
