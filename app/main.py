"""
GridSwarm flexibility API.

Run:
    uvicorn app.main:app --reload --port 8000

Endpoints map directly onto the n8n event chain from the deck:
  Grid event detected -> fetch EV flexibility -> call optimizer ->
  receive dispatch -> send actions -> monitor acknowledgements -> log/alert

    POST /grid-event        -> triggers detection + full dispatch plan
    GET  /fleet/demo        -> the exact deck demo scenario (8 EVs, 7 PM)
    GET  /fleet/random      -> a randomly generated fleet
    POST /fleet/flexibility -> flexibility scores for a given fleet
"""
from __future__ import annotations
import asyncio
import os
from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models import EV, GridConstraintSignal, DispatchPlan, FlexibilityResult, LedgerEntry
from .flexibility import estimate_fleet
from .optimizer import build_dispatch_plan
from .simulator import demo_scenario_evs, generate_random_fleet, fleet_depot_scenario
from . import ledger
from .discom_auth import require_discom_auth, require_zone_access
from .ocpp_listener import FleetRegistry, SessionPolicy, run_ocpp_server, DEFAULT_OCPP_PORT

# Shared live-fleet registry, populated by the OCPP central system below.
# Exists independent of whether the OCPP server is actually enabled, so
# /fleet/live and friends give a clear "no chargers connected yet" answer
# rather than a 404 when OCPP is off.
ocpp_registry = FleetRegistry()
_ocpp_server_task: Optional[asyncio.Task] = None


def _ocpp_enabled() -> bool:
    # Opt-in: GRIDSWARM_OCPP_ENABLED=1. Off by default so `uvicorn app.main:app`
    # keeps working with zero extra config for the simulator-based demo flow.
    return os.environ.get("GRIDSWARM_OCPP_ENABLED", "0") == "1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ocpp_server_task
    if _ocpp_enabled():
        port = int(os.environ.get("GRIDSWARM_OCPP_PORT", str(DEFAULT_OCPP_PORT)))
        _ocpp_server_task = asyncio.create_task(
            run_ocpp_server(ocpp_registry, host="0.0.0.0", port=port)
        )
    yield
    if _ocpp_server_task:
        _ocpp_server_task.cancel()

app = FastAPI(
    title="GridSwarm Flexibility API",
    description="Localized EV flexibility coordination layer — MVP",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before any real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"service": "gridswarm", "status": "ok"}


@app.get("/fleet/demo", response_model=List[EV])
def fleet_demo():
    return demo_scenario_evs()


@app.get("/fleet/random", response_model=List[EV])
def fleet_random(n: int = 30, seed: Optional[int] = None):
    return generate_random_fleet(n=n, seed=seed)


@app.post("/fleet/flexibility", response_model=List[FlexibilityResult])
def fleet_flexibility(evs: List[EV]):
    return estimate_fleet(evs)


class GridEventRequest(BaseModel):
    signal: GridConstraintSignal
    evs: List[EV]


@app.post("/grid-event", response_model=DispatchPlan)
def grid_event(req: GridEventRequest):
    """
    Full pipeline in one call: Detect -> Identify -> Estimate -> Protect ->
    Optimize -> Dispatch. This is the single endpoint an n8n webhook node
    should call. Also posts payouts to the in-memory ledger.
    """
    plan = build_dispatch_plan(req.evs, req.signal)
    for action in plan.actions:
        if action.payout_inr > 0:
            entry = LedgerEntry(
                ev_id=action.ev_id, zone_id=plan.zone_id,
                action=action.action, payout_inr=action.payout_inr,
            )
            ledger.record(entry)
    return plan


@app.get("/ledger/entries", response_model=List[LedgerEntry])
def ledger_entries():
    """Full payout history, persisted in SQLite — survives a server restart."""
    return ledger.all_entries()


@app.get("/ledger/totals")
def ledger_totals():
    """Running INR total per EV across all dispatch events so far."""
    return ledger.totals()


@app.get("/demo-scenario", response_model=DispatchPlan)
def demo_scenario(target_reduction_kw: float = 30.0, extreme_event: bool = False):
    """Convenience endpoint: runs the deck's 7 PM / 96% capacity scenario end to end."""
    evs = demo_scenario_evs()
    signal = GridConstraintSignal(
        zone_id="transformer-zone-7",
        utilization_percent=96.0,
        target_reduction_kw=target_reduction_kw,
        is_extreme_event=extreme_event,
    )
    return build_dispatch_plan(evs, signal)


# --- Fleet-depot pilot variant -------------------------------------------
# Same optimizer, no new logic needed — the deck review flagged this as an
# easier, more fundable first pilot than consumer apartments: homogeneous
# vehicles, known departure schedules, single owner (no per-driver consent
# friction, so nothing is ever PROTECTED for opt-out reasons here).

@app.get("/fleet/depot", response_model=List[EV])
def fleet_depot(n: int = 25, seed: Optional[int] = None, depot_type: str = "delivery"):
    """depot_type: 'delivery' (Amazon/Zomato/Swiggy vans) or 'school_bus'."""
    return fleet_depot_scenario(n=n, seed=seed, depot_type=depot_type)


@app.get("/depot-scenario", response_model=DispatchPlan)
def depot_scenario(
    n: int = 25,
    seed: Optional[int] = None,
    depot_type: str = "delivery",
    target_reduction_kw: float = 40.0,
):
    """Runs a full grid-event pipeline against a simulated fleet-depot, and
    posts payouts to the ledger just like /grid-event does."""
    evs = fleet_depot_scenario(n=n, seed=seed, depot_type=depot_type)
    signal = GridConstraintSignal(
        zone_id=f"depot-{depot_type}",
        utilization_percent=94.0,
        target_reduction_kw=target_reduction_kw,
    )
    plan = build_dispatch_plan(evs, signal)
    for action in plan.actions:
        if action.payout_inr > 0:
            ledger.record(LedgerEntry(
                ev_id=action.ev_id, zone_id=plan.zone_id,
                action=action.action, payout_inr=action.payout_inr,
            ))
    return plan


# --- Extreme-event / brownout-prevention mode -----------------------------
# Pulled out as its own pitched feature (deck review point 5) rather than a
# buried flag: active emergency load-shedding with utility handoff, distinct
# from routine peak-shaving. Structurally identical dispatch (PROTECTED EVs
# are still never touched — mobility_violations stays 0), but the target is
# padded and the response is framed as a DISCOM-facing emergency signal.
#
# These are the two endpoints an actual DISCOM/DSO would call, so they're
# the ones gated behind API-key auth + per-key rate limiting + zone
# registration (see app/discom_auth.py). Everything else in this file stays
# open — it's the n8n-internal / demo-facing surface.

class EmergencyEventRequest(BaseModel):
    zone_id: str
    utilization_percent: float
    target_reduction_kw: float
    evs: List[EV]
    duration_minutes: float = 15.0


@app.post("/emergency-event", response_model=DispatchPlan)
def emergency_event(
    req: EmergencyEventRequest,
    api_key: str = Depends(require_discom_auth),
):
    """Brownout-prevention mode: same pipeline as /grid-event, forced into
    is_extreme_event=True so the optimizer dips into LOW-flexibility EVs
    sooner rather than stopping exactly at target — this is the
    'Escalate to Grid Operator' branch from the deck's infographic.

    Requires an `X-API-Key` header. The key must be registered for
    `req.zone_id` (see GRIDSWARM_API_KEYS) and is subject to a per-key
    rate limit (GRIDSWARM_RATE_LIMIT_PER_MINUTE, default 30/min)."""
    require_zone_access(api_key, req.zone_id)
    signal = GridConstraintSignal(
        zone_id=req.zone_id,
        utilization_percent=req.utilization_percent,
        target_reduction_kw=req.target_reduction_kw,
        is_extreme_event=True,
        duration_minutes=req.duration_minutes,
    )
    plan = build_dispatch_plan(req.evs, signal)
    for action in plan.actions:
        if action.payout_inr > 0:
            ledger.record(LedgerEntry(
                ev_id=action.ev_id, zone_id=plan.zone_id,
                action=action.action, payout_inr=action.payout_inr,
            ))
    return plan


# --- Real chargers (OCPP 1.6) ---------------------------------------------
# Roadmap step 3: swap app/simulator.py for real telemetry. Off by default
# (GRIDSWARM_OCPP_ENABLED=1 to turn the listener on) so the existing
# simulator-based demo flow needs zero extra config. See app/ocpp_listener.py
# for why this needs a "session policy" alongside raw OCPP messages.

def _require_ocpp_enabled():
    if not _ocpp_enabled():
        raise HTTPException(
            status_code=503,
            detail="OCPP listener is not enabled. Set GRIDSWARM_OCPP_ENABLED=1 "
                   "and restart the server to accept real charger connections.",
        )


@app.get("/fleet/live", response_model=List[EV])
async def fleet_live(only_connected: bool = True):
    """The current live fleet built from connected chargers' OCPP telemetry
    merged with each charge point's session policy. Vehicles with no SoC
    reading yet are omitted rather than guessed at."""
    _require_ocpp_enabled()
    return await ocpp_registry.to_evs(only_connected=only_connected)


class SessionPolicyRequest(BaseModel):
    required_soc_percent: float = 80.0
    departure_minutes: float = 60.0
    battery_kwh: float = 60.0
    max_discharge_kw: float = 0.0
    opted_in_v2g: bool = False
    renewable_window: bool = False


@app.post("/ocpp/session-policy/{charge_point_id}")
async def set_session_policy(charge_point_id: str, req: SessionPolicyRequest):
    """OCPP carries charger/session telemetry, not trip planning — a real
    deployment would populate this from the depot's dispatch schedule or a
    driver app. This endpoint is the manual stand-in for that integration."""
    _require_ocpp_enabled()
    await ocpp_registry.set_policy(charge_point_id, SessionPolicy(
        required_soc_percent=req.required_soc_percent,
        departure_minutes=req.departure_minutes,
        battery_kwh=req.battery_kwh,
        max_discharge_kw=req.max_discharge_kw,
        opted_in_v2g=req.opted_in_v2g,
        renewable_window=req.renewable_window,
    ))
    return {"charge_point_id": charge_point_id, "status": "policy_set"}


class LiveGridEventRequest(BaseModel):
    signal: GridConstraintSignal
    only_connected: bool = True


@app.post("/grid-event/live", response_model=DispatchPlan)
async def grid_event_live(req: LiveGridEventRequest):
    """Same pipeline as /grid-event, but pulls the fleet from live OCPP
    telemetry instead of a fleet you POST yourself."""
    _require_ocpp_enabled()
    evs = await ocpp_registry.to_evs(only_connected=req.only_connected)
    if not evs:
        raise HTTPException(
            status_code=409,
            detail="No live EVs with a usable SoC reading yet — no chargers "
                   "connected, or none have reported MeterValues.",
        )
    plan = build_dispatch_plan(evs, req.signal)
    for action in plan.actions:
        if action.payout_inr > 0:
            ledger.record(LedgerEntry(
                ev_id=action.ev_id, zone_id=plan.zone_id,
                action=action.action, payout_inr=action.payout_inr,
            ))
    return plan


@app.get("/emergency-scenario", response_model=DispatchPlan)
def emergency_scenario(
    target_reduction_kw: float = 45.0,
    api_key: str = Depends(require_discom_auth),
):
    """Convenience GET: the deck's demo fleet under a forced brownout-
    prevention emergency — a sharper, higher-stakes version of /demo-scenario.

    Requires an `X-API-Key` header, same as /emergency-event."""
    zone_id = "transformer-zone-7-emergency"
    require_zone_access(api_key, zone_id)
    evs = demo_scenario_evs()
    signal = GridConstraintSignal(
        zone_id=zone_id,
        utilization_percent=99.0,
        target_reduction_kw=target_reduction_kw,
        is_extreme_event=True,
    )
    plan = build_dispatch_plan(evs, signal)
    for action in plan.actions:
        if action.payout_inr > 0:
            ledger.record(LedgerEntry(
                ev_id=action.ev_id, zone_id=plan.zone_id,
                action=action.action, payout_inr=action.payout_inr,
            ))
    return plan
