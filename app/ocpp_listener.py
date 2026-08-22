"""
Real-charger ingestion: an OCPP 1.6-J central system that listens for
charge-point connections over WebSocket and turns their telemetry into the
same `EV` objects `app/simulator.py` fabricates synthetically. This is
roadmap step 3 ("Real Chargers") from the README: swap the simulator for
an OCPP listener feeding real EV objects into `/grid-event`.

Why this isn't a drop-in replacement for the simulator
--------------------------------------------------------
OCPP tells you charger/session state (status, meter values, transaction
start/stop) but it has no concept of "when does the driver need this
vehicle back" or "what SOC do they need at departure" — that's fleet/trip
scheduling info, not charger telemetry. So this module has two halves:

1. **FleetRegistry** — live state built entirely from OCPP messages
   (SoC from MeterValues if the charger reports the SoC measurand,
   charging/plugged status, max charge rate from the connector).
2. **Session policy** — required_soc_percent / departure_minutes /
   battery_kwh / opted_in_v2g, set per charge point via
   `POST /ocpp/session-policy` (see main.py) or defaulted. A real
   deployment would populate this from a depot's dispatch schedule or a
   driver-facing app instead of a manual API call.

`FleetRegistry.to_evs()` merges the two into `List[EV]`, ready to hand to
`build_dispatch_plan` exactly like the simulator's output.

Run standalone for local testing:
    python -m app.ocpp_listener --port 9000

A charge point (real, or the bundled `scripts/simulate_charge_point.py`
fake one) connects to `ws://<host>:9000/<charge_point_id>` with the
`ocpp1.6` subprotocol.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

from websockets.exceptions import ConnectionClosed

from ocpp.routing import on
from ocpp.v16 import ChargePoint as BaseChargePoint
from ocpp.v16 import call_result
from ocpp.v16.datatypes import IdTagInfo
from ocpp.v16.enums import (
    Action,
    AuthorizationStatus,
    ChargePointStatus,
    Measurand,
    RegistrationStatus,
)

from .models import EV

logger = logging.getLogger("gridswarm.ocpp")

DEFAULT_OCPP_PORT = 9000


# --- Session policy (the part OCPP itself can't tell us) -------------------

@dataclass
class SessionPolicy:
    """Trip/dispatch info an operator sets out-of-band per charge point.
    Defaults are conservative: treat unknown vehicles as needing to leave
    soon and not eligible for V2G, so an unconfigured charger never gets
    treated as more flexible than it actually is."""
    required_soc_percent: float = 80.0
    departure_minutes: float = 60.0
    battery_kwh: float = 60.0
    max_discharge_kw: float = 0.0
    opted_in_v2g: bool = False
    renewable_window: bool = False
    set_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# --- Live per-charge-point state, built from OCPP messages ------------------

@dataclass
class LiveChargePointState:
    charge_point_id: str
    connected: bool = False
    status: str = "Unknown"
    soc_percent: Optional[float] = None
    max_charge_kw: float = 7.4
    currently_charging: bool = False
    transaction_id: Optional[int] = None
    id_tag: Optional[str] = None
    last_seen: Optional[datetime] = None
    policy: SessionPolicy = field(default_factory=SessionPolicy)

    def to_ev(self) -> Optional[EV]:
        """None if we don't yet have a usable SoC reading — an EV entry
        with a fabricated SoC would be worse than omitting it from the
        dispatch pipeline for this cycle."""
        if self.soc_percent is None:
            return None
        return EV(
            id=self.charge_point_id,
            soc_percent=round(self.soc_percent, 1),
            required_soc_percent=self.policy.required_soc_percent,
            departure_minutes=self.policy.departure_minutes,
            battery_kwh=self.policy.battery_kwh,
            currently_charging=self.currently_charging,
            max_charge_kw=self.max_charge_kw,
            max_discharge_kw=self.policy.max_discharge_kw,
            opted_in_v2g=self.policy.opted_in_v2g,
            renewable_window=self.policy.renewable_window,
        )


class FleetRegistry:
    """Shared, in-memory state across all connected charge points. One
    instance backs the OCPP server and is read by the `/fleet/live` and
    `/grid-event/live` endpoints."""

    def __init__(self) -> None:
        self._states: Dict[str, LiveChargePointState] = {}
        self._lock = asyncio.Lock()

    def _get_or_create(self, charge_point_id: str) -> LiveChargePointState:
        if charge_point_id not in self._states:
            self._states[charge_point_id] = LiveChargePointState(charge_point_id=charge_point_id)
        return self._states[charge_point_id]

    async def on_connect(self, charge_point_id: str) -> None:
        async with self._lock:
            state = self._get_or_create(charge_point_id)
            state.connected = True
            state.last_seen = datetime.now(timezone.utc)

    async def on_disconnect(self, charge_point_id: str) -> None:
        async with self._lock:
            if charge_point_id in self._states:
                self._states[charge_point_id].connected = False

    async def apply_status_notification(self, charge_point_id: str, status: str) -> None:
        async with self._lock:
            state = self._get_or_create(charge_point_id)
            state.status = status
            state.currently_charging = status == ChargePointStatus.charging
            state.last_seen = datetime.now(timezone.utc)

    async def apply_start_transaction(self, charge_point_id: str, id_tag: str, transaction_id: int) -> None:
        async with self._lock:
            state = self._get_or_create(charge_point_id)
            state.id_tag = id_tag
            state.transaction_id = transaction_id
            state.currently_charging = True
            state.last_seen = datetime.now(timezone.utc)

    async def apply_stop_transaction(self, charge_point_id: str, transaction_id: int) -> None:
        async with self._lock:
            state = self._get_or_create(charge_point_id)
            if state.transaction_id == transaction_id:
                state.transaction_id = None
            state.currently_charging = False
            state.last_seen = datetime.now(timezone.utc)

    async def apply_meter_values(self, charge_point_id: str, soc_percent: Optional[float],
                                  power_kw: Optional[float]) -> None:
        async with self._lock:
            state = self._get_or_create(charge_point_id)
            if soc_percent is not None:
                state.soc_percent = soc_percent
            if power_kw is not None and power_kw > 0:
                # Observed draw is at least as informative as a static
                # connector rating — use it as a live max_charge_kw floor.
                state.max_charge_kw = max(state.max_charge_kw, power_kw)
            state.last_seen = datetime.now(timezone.utc)

    async def set_policy(self, charge_point_id: str, policy: SessionPolicy) -> None:
        async with self._lock:
            state = self._get_or_create(charge_point_id)
            state.policy = policy

    async def snapshot(self) -> Dict[str, LiveChargePointState]:
        async with self._lock:
            return dict(self._states)

    async def to_evs(self, only_connected: bool = True) -> list[EV]:
        async with self._lock:
            states = list(self._states.values())
        evs = []
        for state in states:
            if only_connected and not state.connected:
                continue
            ev = state.to_ev()
            if ev is not None:
                evs.append(ev)
        return evs


# --- OCPP 1.6 message handlers -----------------------------------------

class GridSwarmChargePoint(BaseChargePoint):
    """One instance per connected charge point. Handlers write into the
    shared FleetRegistry rather than holding any state themselves."""

    def __init__(self, *args, registry: FleetRegistry, **kwargs):
        super().__init__(*args, **kwargs)
        self.registry = registry

    @on(Action.boot_notification)
    async def on_boot_notification(self, charge_point_vendor, charge_point_model, **kwargs):
        logger.info("BootNotification from %s (%s %s)", self.id, charge_point_vendor, charge_point_model)
        return call_result.BootNotification(
            current_time=datetime.now(timezone.utc).isoformat(),
            interval=30,
            status=RegistrationStatus.accepted,
        )

    @on(Action.heartbeat)
    async def on_heartbeat(self, **kwargs):
        return call_result.Heartbeat(current_time=datetime.now(timezone.utc).isoformat())

    @on(Action.authorize)
    async def on_authorize(self, id_tag, **kwargs):
        return call_result.Authorize(id_tag_info=IdTagInfo(status=AuthorizationStatus.accepted))

    @on(Action.status_notification)
    async def on_status_notification(self, connector_id, error_code, status, **kwargs):
        await self.registry.apply_status_notification(self.id, status)
        return call_result.StatusNotification()

    @on(Action.start_transaction)
    async def on_start_transaction(self, connector_id, id_tag, meter_start, timestamp, **kwargs):
        transaction_id = int(datetime.now(timezone.utc).timestamp())
        await self.registry.apply_start_transaction(self.id, id_tag, transaction_id)
        return call_result.StartTransaction(
            transaction_id=transaction_id,
            id_tag_info=IdTagInfo(status=AuthorizationStatus.accepted),
        )

    @on(Action.stop_transaction)
    async def on_stop_transaction(self, meter_stop, timestamp, transaction_id, **kwargs):
        await self.registry.apply_stop_transaction(self.id, transaction_id)
        return call_result.StopTransaction()

    @on(Action.meter_values)
    async def on_meter_values(self, connector_id, meter_value, transaction_id=None, **kwargs):
        soc_percent = None
        power_kw = None
        for entry in meter_value:
            for sampled in entry.get("sampled_value", []):
                measurand = sampled.get("measurand")
                try:
                    value = float(sampled.get("value"))
                except (TypeError, ValueError):
                    continue
                if measurand == Measurand.soc:
                    soc_percent = value
                elif measurand == Measurand.power_active_import:
                    unit = sampled.get("unit", "W")
                    power_kw = value / 1000.0 if unit == "W" else value
        await self.registry.apply_meter_values(self.id, soc_percent, power_kw)
        return call_result.MeterValues()


# --- WebSocket server wiring ------------------------------------------

async def _process_request(connection, request):
    """Stash the charge point id (the URL path, e.g. /CP_001) on the
    connection so the handler can read it before OCPP handshake logic runs."""
    connection.charge_point_id = request.path.strip("/") or "unknown"
    return None


def _make_handler(registry: FleetRegistry):
    async def handler(websocket):
        charge_point_id = getattr(websocket, "charge_point_id", "unknown")
        cp = GridSwarmChargePoint(charge_point_id, websocket, registry=registry)
        await registry.on_connect(charge_point_id)
        logger.info("Charge point connected: %s", charge_point_id)
        try:
            await cp.start()
        except ConnectionClosed:
            pass  # normal disconnect (charger power-cycled, network drop, client closed cleanly)
        finally:
            await registry.on_disconnect(charge_point_id)
            logger.info("Charge point disconnected: %s", charge_point_id)

    return handler


async def run_ocpp_server(registry: FleetRegistry, host: str = "0.0.0.0",
                           port: int = DEFAULT_OCPP_PORT):
    """Starts the OCPP central-system WebSocket server and runs forever
    (until cancelled). Intended to be launched as a background asyncio
    task from FastAPI's startup lifespan — see main.py."""
    from websockets.asyncio.server import serve

    handler = _make_handler(registry)
    async with serve(
        handler, host, port,
        subprotocols=["ocpp1.6"],
        process_request=_process_request,
    ) as server:
        logger.info("OCPP 1.6 central system listening on ws://%s:%d", host, port)
        await asyncio.Future()  # run until cancelled


def main():
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="GridSwarm OCPP 1.6 central system")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_OCPP_PORT)
    args = parser.parse_args()
    registry = FleetRegistry()
    asyncio.run(run_ocpp_server(registry, host=args.host, port=args.port))


if __name__ == "__main__":
    main()
