"""
Consent/incentive layer.

The flexibility gate (see flexibility.py) already respects opted_in_v2g —
an opted-out EV is PROTECTED and never touched. This module is the other
half: what a participating EV owner earns for the flexibility they gave up,
converting "we control your car" into "we pay you for your car's slack".

Rates are INR/kWh, deliberately tiered so discharge (V2G export, real
battery wear) pays more than a passive pause or a rate reduction.
"""
from __future__ import annotations
from .models import ActionType

RATE_INR_PER_KWH = {
    ActionType.DISCHARGE: 9.0,      # V2G export — real battery cycling, pays most
    ActionType.PAUSE_CHARGING: 4.0,  # full deferral of a charging session
    ActionType.REDUCE_RATE: 2.5,     # partial deferral
    ActionType.SOLAR_ALIGN: 1.5,     # timing shift only, least owner cost
    ActionType.NO_ACTION: 0.0,
    ActionType.PROTECTED: 0.0,
}


def payout_for_action(action_type: ActionType, magnitude_kw: float | None, duration_minutes: float) -> float:
    """
    magnitude_kw: the kW contribution assigned by the optimizer.
    duration_minutes: how long the dispatch window runs for (grid event duration).
    Returns payout in INR, rounded to 2 decimals.
    """
    if magnitude_kw is None or magnitude_kw <= 0:
        return 0.0
    kwh_delivered = magnitude_kw * (duration_minutes / 60.0)
    rate = RATE_INR_PER_KWH.get(action_type, 0.0)
    return round(kwh_delivered * rate, 2)
