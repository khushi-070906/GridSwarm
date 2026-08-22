"""
Run: pytest test_gridswarm.py -v

These are the tests a judge will ask about implicitly: prove the mobility
guarantee actually holds, not just that the demo numbers look nice.
"""
from app.models import EV, GridConstraintSignal, ActionType
from app.flexibility import estimate_flexibility, FlexibilityCategory
from app.optimizer import build_dispatch_plan
from app.simulator import demo_scenario_evs, generate_random_fleet, fleet_depot_scenario
from app.incentives import payout_for_action


def test_imminent_departure_is_always_protected():
    ev = EV(id="x", soc_percent=95, required_soc_percent=50, departure_minutes=10, battery_kwh=60)
    result = estimate_flexibility(ev)
    assert result.category == FlexibilityCategory.PROTECTED


def test_below_required_soc_is_always_protected():
    ev = EV(id="x", soc_percent=40, required_soc_percent=80, departure_minutes=600, battery_kwh=60)
    result = estimate_flexibility(ev)
    assert result.category == FlexibilityCategory.PROTECTED


def test_opt_out_is_respected():
    ev = EV(id="x", soc_percent=95, required_soc_percent=50, departure_minutes=600,
             battery_kwh=60, opted_in_v2g=False)
    result = estimate_flexibility(ev)
    assert result.category == FlexibilityCategory.PROTECTED


def test_dispatch_plan_never_produces_mobility_violations():
    for seed in range(10):
        evs = generate_random_fleet(n=40, seed=seed)
        signal = GridConstraintSignal(
            zone_id="test", utilization_percent=97, target_reduction_kw=200, is_extreme_event=True
        )
        plan = build_dispatch_plan(evs, signal)
        assert plan.mobility_violations == 0


def test_protected_evs_never_receive_load_actions():
    evs = demo_scenario_evs()
    signal = GridConstraintSignal(
        zone_id="test", utilization_percent=96, target_reduction_kw=30
    )
    plan = build_dispatch_plan(evs, signal)
    protected_ids = {ev.id for ev in evs if estimate_flexibility(ev).category == FlexibilityCategory.PROTECTED}
    for action in plan.actions:
        if action.ev_id in protected_ids:
            assert action.action.value == "protected"


def test_demo_scenario_reduces_utilization():
    evs = demo_scenario_evs()
    signal = GridConstraintSignal(zone_id="test", utilization_percent=96, target_reduction_kw=30)
    plan = build_dispatch_plan(evs, signal)
    assert plan.grid_utilization_after < plan.grid_utilization_before
    assert plan.evs_protected == 2  # EV_02 and EV_11 have imminent departures


def test_protected_and_no_action_evs_earn_nothing():
    evs = demo_scenario_evs()
    signal = GridConstraintSignal(zone_id="test", utilization_percent=96, target_reduction_kw=30)
    plan = build_dispatch_plan(evs, signal)
    for action in plan.actions:
        if action.action in (ActionType.PROTECTED, ActionType.NO_ACTION):
            assert action.payout_inr == 0.0


def test_discharge_pays_more_per_kwh_than_solar_align():
    discharge_payout = payout_for_action(ActionType.DISCHARGE, 2.0, duration_minutes=15)
    solar_payout = payout_for_action(ActionType.SOLAR_ALIGN, 2.0, duration_minutes=15)
    assert discharge_payout > solar_payout


def test_total_payout_matches_sum_of_actions():
    evs = demo_scenario_evs()
    signal = GridConstraintSignal(zone_id="test", utilization_percent=96, target_reduction_kw=30)
    plan = build_dispatch_plan(evs, signal)
    assert round(sum(a.payout_inr for a in plan.actions), 2) == plan.total_payout_inr


def test_depot_fleets_have_no_consent_friction():
    """Single-owner fleet: every vehicle is opted in by construction, so
    nothing is ever protected purely for opting out."""
    for depot_type in ("delivery", "school_bus"):
        evs = fleet_depot_scenario(n=20, seed=1, depot_type=depot_type)
        assert all(ev.opted_in_v2g for ev in evs)


def test_depot_dispatch_never_produces_mobility_violations():
    for depot_type in ("delivery", "school_bus"):
        for seed in range(5):
            evs = fleet_depot_scenario(n=25, seed=seed, depot_type=depot_type)
            signal = GridConstraintSignal(
                zone_id="depot-test", utilization_percent=94, target_reduction_kw=80,
                is_extreme_event=True,
            )
            plan = build_dispatch_plan(evs, signal)
            assert plan.mobility_violations == 0


def test_emergency_mode_still_protects_mobility():
    evs = demo_scenario_evs()
    signal = GridConstraintSignal(
        zone_id="test", utilization_percent=99, target_reduction_kw=100, is_extreme_event=True,
    )
    plan = build_dispatch_plan(evs, signal)
    assert plan.mobility_violations == 0
    assert plan.evs_protected == 2  # EV_02 and EV_11, same as routine mode


def test_ledger_persists_across_process(tmp_path, monkeypatch):
    """Simulates a restart: re-importing the ledger module against the same
    DB file should see previously written entries."""
    import importlib
    import app.ledger as ledger_module

    db_file = tmp_path / "test_ledger.db"
    monkeypatch.setenv("GRIDSWARM_DB_PATH", str(db_file))
    importlib.reload(ledger_module)

    from app.models import LedgerEntry
    ledger_module.record(LedgerEntry(
        ev_id="EV_TEST", zone_id="zone-1", action=ActionType.DISCHARGE, payout_inr=12.5,
    ))

    # Simulate a fresh process by reloading the module against the same DB path.
    importlib.reload(ledger_module)
    assert ledger_module.totals().get("EV_TEST") == 12.5
