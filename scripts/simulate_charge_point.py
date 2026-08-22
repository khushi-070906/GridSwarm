"""
Stands in for a real OCPP 1.6 charger so app/ocpp_listener.py can be
tested and demoed without physical hardware — same role the synthetic
fleet generator (app/simulator.py) plays for the rest of the API.

Connects to the GridSwarm OCPP central system and sends a realistic
message sequence: BootNotification -> StatusNotification(Charging) ->
StartTransaction -> a few MeterValues reports with a rising SoC ->
optionally StopTransaction.

Usage:
    python -m app.ocpp_listener --port 9000          # in one terminal
    python scripts/simulate_charge_point.py CP_001 --soc-start 55 --soc-end 80
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone

import websockets
from ocpp.v16 import ChargePoint as BaseChargePoint
from ocpp.v16 import call
from ocpp.v16.enums import ChargePointErrorCode, ChargePointStatus


class SimulatedChargePoint(BaseChargePoint):
    async def send_boot_notification(self):
        return await self.call(call.BootNotification(
            charge_point_vendor="GridSwarm-Sim",
            charge_point_model="VirtualCharger-1",
        ))

    async def send_status(self, status: str):
        return await self.call(call.StatusNotification(
            connector_id=1,
            error_code=ChargePointErrorCode.no_error,
            status=status,
        ))

    async def send_start_transaction(self, id_tag: str, meter_start_wh: int):
        return await self.call(call.StartTransaction(
            connector_id=1,
            id_tag=id_tag,
            meter_start=meter_start_wh,
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))

    async def send_meter_values(self, soc_percent: float, power_kw: float):
        return await self.call(call.MeterValues(
            connector_id=1,
            meter_value=[{
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "sampled_value": [
                    {"value": str(soc_percent), "measurand": "SoC", "unit": "Percent"},
                    {"value": str(power_kw * 1000), "measurand": "Power.Active.Import", "unit": "W"},
                ],
            }],
        ))

    async def send_stop_transaction(self, transaction_id: int, meter_stop_wh: int):
        return await self.call(call.StopTransaction(
            meter_stop=meter_stop_wh,
            timestamp=datetime.now(timezone.utc).isoformat(),
            transaction_id=transaction_id,
        ))


async def run(charge_point_id: str, host: str, port: int, soc_start: float,
              soc_end: float, steps: int, power_kw: float, stop_at_end: bool):
    uri = f"ws://{host}:{port}/{charge_point_id}"
    async with websockets.connect(uri, subprotocols=["ocpp1.6"]) as ws:
        cp = SimulatedChargePoint(charge_point_id, ws)
        run_task = asyncio.create_task(cp.start())

        await cp.send_boot_notification()
        await cp.send_status(ChargePointStatus.charging)
        start_resp = await cp.send_start_transaction(id_tag=f"driver-{charge_point_id}", meter_start_wh=0)
        transaction_id = start_resp.transaction_id
        print(f"[{charge_point_id}] transaction started: {transaction_id}")

        for i in range(steps):
            soc = soc_start + (soc_end - soc_start) * (i + 1) / steps
            await cp.send_meter_values(soc_percent=round(soc, 1), power_kw=power_kw)
            print(f"[{charge_point_id}] meter values: SoC={soc:.1f}% power={power_kw}kW")
            await asyncio.sleep(0.2)

        if stop_at_end:
            await cp.send_status(ChargePointStatus.finishing)
            await cp.send_stop_transaction(transaction_id=transaction_id, meter_stop_wh=int(power_kw * 1000))
            print(f"[{charge_point_id}] transaction stopped")

        run_task.cancel()


def main():
    parser = argparse.ArgumentParser(description="Simulate an OCPP 1.6 charge point")
    parser.add_argument("charge_point_id")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--soc-start", type=float, default=50.0)
    parser.add_argument("--soc-end", type=float, default=80.0)
    parser.add_argument("--steps", type=int, default=5)
    parser.add_argument("--power-kw", type=float, default=7.4)
    parser.add_argument("--stop-at-end", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(
        args.charge_point_id, args.host, args.port,
        args.soc_start, args.soc_end, args.steps, args.power_kw, args.stop_at_end,
    ))


if __name__ == "__main__":
    main()
