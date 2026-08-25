"""
GridSwarm data models.
"""
from __future__ import annotations
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field


class FlexibilityCategory(str, Enum):
    PROTECTED = "protected"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    V2G = "v2g"  # very high flexibility, can discharge back to grid


class ActionType(str, Enum):
    NO_ACTION = "no_action"
    PAUSE_CHARGING = "pause_charging"
    REDUCE_RATE = "reduce_rate"
    DISCHARGE = "discharge"          # V2G export
    SOLAR_ALIGN = "solar_align"      # shift charging into renewable window
    PROTECTED = "protected"          # explicitly excluded from any action


class EV(BaseModel):
    id: str
    soc_percent: float = Field(..., ge=0, le=100, description="Current state of charge, %")
    required_soc_percent: float = Field(..., ge=0, le=100, description="Min SOC needed at departure")
    departure_minutes: float = Field(..., ge=0, description="Minutes until the driver needs the vehicle")
    battery_kwh: float = Field(60.0, gt=0, description="Usable battery capacity, kWh")
    currently_charging: bool = True
    max_charge_kw: float = 7.4
    max_discharge_kw: float = 5.0
    opted_in_v2g: bool = True        # consent layer — owner has opted into discharge/participation
    renewable_window: bool = False   # True if a solar/renewable generation window is currently active


class FlexibilityResult(BaseModel):
    ev_id: str
    category: FlexibilityCategory
    flexibility_score_kwh: float
    reason: str


class EVContext(BaseModel):
    """
    Snapshot of the EV state used to make the dispatch decision.
    Sent to the dashboard so the decision is explainable.
    """
    soc_percent: float
    required_soc_percent: float
    departure_minutes: float
    battery_kwh: float
    max_charge_kw: float
    max_discharge_kw: float
    currently_charging: bool
    opted_in_v2g: bool

    flexibility_category: FlexibilityCategory
    flexibility_score_kwh: float


class DispatchAction(BaseModel):
    ev_id: str
    action: ActionType
    magnitude_kw: Optional[float] = None
    payout_inr: float = 0.0
    reason: str

    # NEW
    ev_context: Optional[EVContext] = None


class GridConstraintSignal(BaseModel):
    zone_id: str
    utilization_percent: float = Field(..., ge=0, le=200)
    target_reduction_kw: float = Field(..., ge=0)
    is_extreme_event: bool = False   # brownout-prevention / emergency load-shed mode
    duration_minutes: float = Field(15.0, gt=0, description="Length of this dispatch window")


class DispatchPlan(BaseModel):
    zone_id: str
    grid_utilization_before: float
    grid_utilization_after: float
    kw_reduced: float
    actions: List[DispatchAction]
    evs_participating: int
    evs_protected: int
    mobility_violations: int = 0  # should always be 0 — protected EVs are never touched
    total_payout_inr: float = 0.0


class LedgerEntry(BaseModel):
    ev_id: str
    zone_id: str
    action: ActionType
    payout_inr: float
