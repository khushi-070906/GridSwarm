"""
Per-EV flexibility estimation.

Core rule (from the pitch): mobility requirements are inviolable. An EV is
PROTECTED — zero flexibility, never touched — if it cannot spare any charge
above its required departure SOC, or if its departure is imminent.

Everything else gets a flexibility score = usable energy headroom (kWh)
above the required minimum, discounted by how soon it needs to leave
(less dwell time -> less confidence we can safely act on it).
"""
from __future__ import annotations
from .models import EV, FlexibilityResult, FlexibilityCategory

# An EV with less than this many minutes until departure is always protected,
# regardless of how much headroom it has — too risky to touch.
IMMINENT_DEPARTURE_MINUTES = 30.0

# Dwell-time buckets used to size the "confidence discount" applied to score.
LONG_DWELL_MINUTES = 240.0   # 4h+ -> full confidence, no discount
SHORT_DWELL_MINUTES = 60.0   # <1h -> steep discount


def _dwell_confidence(departure_minutes: float) -> float:
    """Returns a 0..1 multiplier: more dwell time = more confidence to act."""
    if departure_minutes >= LONG_DWELL_MINUTES:
        return 1.0
    if departure_minutes <= SHORT_DWELL_MINUTES:
        return 0.35
    # linear interpolation between short and long dwell
    span = LONG_DWELL_MINUTES - SHORT_DWELL_MINUTES
    return 0.35 + 0.65 * ((departure_minutes - SHORT_DWELL_MINUTES) / span)


def estimate_flexibility(ev: EV) -> FlexibilityResult:
    headroom_percent = ev.soc_percent - ev.required_soc_percent

    # Hard protection rules — mobility always wins, no exceptions.
    if ev.departure_minutes < IMMINENT_DEPARTURE_MINUTES:
        return FlexibilityResult(
            ev_id=ev.id,
            category=FlexibilityCategory.PROTECTED,
            flexibility_score_kwh=0.0,
            reason=f"Departure in {ev.departure_minutes:.0f} min — imminent, protected.",
        )
    if headroom_percent <= 0:
        return FlexibilityResult(
            ev_id=ev.id,
            category=FlexibilityCategory.PROTECTED,
            flexibility_score_kwh=0.0,
            reason="At or below required departure SOC — protected, zero flexibility.",
        )
    if not ev.opted_in_v2g:
        return FlexibilityResult(
            ev_id=ev.id,
            category=FlexibilityCategory.PROTECTED,
            flexibility_score_kwh=0.0,
            reason="Owner has not opted in this session — excluded from dispatch.",
        )

    confidence = _dwell_confidence(ev.departure_minutes)
    raw_score_kwh = (headroom_percent / 100.0) * ev.battery_kwh
    score = raw_score_kwh * confidence

    # V2G tier: very high headroom + long dwell + owner opted in -> can export.
    if headroom_percent >= 25 and ev.departure_minutes >= LONG_DWELL_MINUTES:
        category = FlexibilityCategory.V2G
        reason = (
            f"{headroom_percent:.0f}% headroom above required SOC, "
            f"{ev.departure_minutes/60:.1f}h dwell — eligible to export."
        )
    elif score >= 8:
        category = FlexibilityCategory.HIGH
        reason = f"{headroom_percent:.0f}% headroom, long dwell — safe to pause/reduce."
    elif score >= 3:
        category = FlexibilityCategory.MEDIUM
        reason = f"{headroom_percent:.0f}% headroom, moderate dwell — safe to reduce rate."
    else:
        category = FlexibilityCategory.LOW
        reason = "Some headroom but limited dwell time — minor flexibility only."

    return FlexibilityResult(
        ev_id=ev.id,
        category=category,
        flexibility_score_kwh=round(score, 2),
        reason=reason,
    )


def estimate_fleet(evs: list[EV]) -> list[FlexibilityResult]:
    return [estimate_flexibility(ev) for ev in evs]
