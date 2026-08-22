"""
Synthetic EV telemetry generator — stands in for real charger/OCPP feeds
during the hackathon MVP (see roadmap step 3: "Real Chargers").
"""
from __future__ import annotations
import random
from .models import EV


def demo_scenario_evs() -> list[EV]:
    """The exact 7 PM / 96% capacity scenario from the pitch deck."""
    return [
        EV(id="EV_01", soc_percent=82, required_soc_percent=70, departure_minutes=540,
           battery_kwh=60, currently_charging=True),
        EV(id="EV_02", soc_percent=43, required_soc_percent=85, departure_minutes=20,
           battery_kwh=55, currently_charging=True),
        EV(id="EV_03", soc_percent=91, required_soc_percent=60, departure_minutes=480,
           battery_kwh=75, currently_charging=False),
        EV(id="EV_04", soc_percent=88, required_soc_percent=65, departure_minutes=300,
           battery_kwh=60, currently_charging=True),
        EV(id="EV_07", soc_percent=70, required_soc_percent=55, departure_minutes=150,
           battery_kwh=50, currently_charging=True),
        EV(id="EV_11", soc_percent=40, required_soc_percent=80, departure_minutes=25,
           battery_kwh=45, currently_charging=True),
        EV(id="EV_14", soc_percent=95, required_soc_percent=60, departure_minutes=420,
           battery_kwh=70, currently_charging=False, opted_in_v2g=True),
        EV(id="EV_19", soc_percent=60, required_soc_percent=55, departure_minutes=200,
           battery_kwh=55, currently_charging=True, renewable_window=True),
    ]


def fleet_depot_scenario(n: int = 25, seed: int | None = None,
                          depot_type: str = "delivery") -> list[EV]:
    """
    Fleet-depot pilot variant (roadmap step 2 recommendation from the deck
    review): homogeneous vehicles, known departure schedules, single owner
    making the coordination decision — no per-driver consent friction.

    depot_type: "delivery" (Amazon/Zomato/Swiggy dark-store vans, overnight
    charge, early-morning dispatch) or "school_bus" (charges all day at the
    depot, departs for the afternoon run).

    Every vehicle is opted_in_v2g=True by construction: the depot operator
    is the single consenting owner, so there's no per-driver opt-out to
    model — this is exactly what makes it an easier, more fundable first
    pilot than consumer apartments.
    """
    rng = random.Random(seed)
    evs: list[EV] = []

    if depot_type == "school_bus":
        # All buses plugged in overnight/all-day, need to be ready by a
        # shared afternoon departure window — very long, very predictable dwell.
        battery = 90.0
        for i in range(1, n + 1):
            soc = rng.uniform(40, 95)
            required = rng.uniform(55, 75)
            evs.append(EV(
                id=f"BUS_{i:02d}",
                soc_percent=round(soc, 1),
                required_soc_percent=round(required, 1),  # must be well-charged for the route
                departure_minutes=round(rng.uniform(300, 600), 0),  # afternoon run
                battery_kwh=battery,
                currently_charging=True,
                max_charge_kw=11.0,
                max_discharge_kw=7.0,
                opted_in_v2g=True,
                renewable_window=rng.random() > 0.6,
            ))
        return evs

    # Default: delivery-fleet depot. Vans plug in when they return in the
    # evening, all need to roll out again before the same early-morning
    # dispatch wave — homogeneous battery size, tight shared departure.
    battery = 45.0
    shared_departure = rng.uniform(420, 480)  # ~7-8h overnight window, fleet-wide
    for i in range(1, n + 1):
        # Route length varies van to van, so return SOC varies -- some vans
        # ran a short local loop and came back with plenty of headroom,
        # others ran long and need most of the overnight window to refill.
        soc = rng.uniform(25, 90)
        required = rng.uniform(55, 75)  # must be well-charged, not full, for tomorrow's route
        evs.append(EV(
            id=f"VAN_{i:02d}",
            soc_percent=round(soc, 1),
            required_soc_percent=round(required, 1),
            departure_minutes=round(shared_departure + rng.uniform(-20, 20), 0),
            battery_kwh=battery,
            currently_charging=True,
            max_charge_kw=9.6,
            max_discharge_kw=5.0,
            opted_in_v2g=True,
            renewable_window=False,  # overnight charging, no solar window
        ))
    return evs


def generate_random_fleet(n: int = 30, seed: int | None = None) -> list[EV]:
    rng = random.Random(seed)
    evs = []
    for i in range(1, n + 1):
        soc = rng.uniform(20, 95)
        required = rng.uniform(50, 90)
        departure = rng.choice([
            rng.uniform(10, 25),      # imminent
            rng.uniform(60, 180),     # medium dwell
            rng.uniform(240, 600),    # long dwell / overnight
        ])
        evs.append(EV(
            id=f"EV_{i:02d}",
            soc_percent=round(soc, 1),
            required_soc_percent=round(required, 1),
            departure_minutes=round(departure, 0),
            battery_kwh=rng.choice([40, 50, 55, 60, 75]),
            currently_charging=rng.random() > 0.15,
            opted_in_v2g=rng.random() > 0.1,
            renewable_window=rng.random() > 0.7,
        ))
    return evs
