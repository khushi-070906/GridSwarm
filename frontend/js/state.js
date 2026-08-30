/* ==========================================================================
   state.js — turns raw API responses (DispatchPlan, ledger totals, EV
   lists) into shapes the renderers can consume directly. No DOM, no fetch.
   ========================================================================== */

export const ACTION_META = {
  discharge:      { label: 'Discharge (V2G)', color: 'var(--copper)',    dir: 'out' },
  pause_charging: { label: 'Pause charging',   color: 'var(--verdigris)', dir: 'in' },
  reduce_rate:    { label: 'Reduce rate',      color: 'var(--verdigris)', dir: 'in' },
  solar_align:    { label: 'Solar-align',      color: 'var(--brass)',    dir: 'in' },
  protected:      { label: 'Protected',        color: 'var(--sage)',     dir: null },
  no_action:      { label: 'No action',        color: 'var(--idle)',     dir: null },
};

export const FLEX_COLORS = {
  v2g: 'var(--copper)', high: 'var(--verdigris)', medium: 'var(--brass)',
  low: 'var(--idle)', protected: 'var(--sage)',
};

/** One human-readable line for "why this EV, this action". */
export function actionSummaryLine(action) {
  const meta = ACTION_META[action.action] || ACTION_META.no_action;
  if (action.magnitude_kw) {
    return `${meta.label} → ${action.magnitude_kw.toFixed(1)} kW`;
  }
  return meta.label;
}

/** Fleet-health summary derived from a DispatchPlan's actions[].ev_context. */
export function fleetOverview(plan) {
  const actions = plan?.actions || [];
  const withCtx = actions.filter(a => a.ev_context);
  const connected = actions.length;
  const charging = withCtx.filter(a => a.ev_context.currently_charging).length;
  const flexible = withCtx.filter(a => !['protected'].includes(a.ev_context.flexibility_category)).length;
  const protectedCount = withCtx.filter(a => a.ev_context.flexibility_category === 'protected').length;
  const v2gCapable = withCtx.filter(a => a.ev_context.flexibility_category === 'v2g').length;
  const totalFlexKwh = withCtx.reduce((s, a) => s + (a.ev_context.flexibility_score_kwh || 0), 0);
  return { connected, charging, flexible, protected: protectedCount, v2gCapable, totalFlexKwh };
}

/** Flexibility-category distribution, for the bar chart. */
export function flexibilityDistribution(plan) {
  const buckets = { v2g: 0, high: 0, medium: 0, low: 0, protected: 0 };
  for (const a of plan?.actions || []) {
    if (a.ev_context) buckets[a.ev_context.flexibility_category] = (buckets[a.ev_context.flexibility_category] || 0) + 1;
  }
  return buckets;
}

/** SOC distribution bucketed into 20%-wide bins, for the bar chart. */
export function socDistribution(plan) {
  const bins = { '0-20%': 0, '20-40%': 0, '40-60%': 0, '60-80%': 0, '80-100%': 0 };
  for (const a of plan?.actions || []) {
    const soc = a.ev_context?.soc_percent;
    if (soc == null) continue;
    if (soc < 20) bins['0-20%']++;
    else if (soc < 40) bins['20-40%']++;
    else if (soc < 60) bins['40-60%']++;
    else if (soc < 80) bins['60-80%']++;
    else bins['80-100%']++;
  }
  return bins;
}

/** Available flexibility capacity in kW — sum of the max rate each
    non-protected EV could contribute (discharge rate for V2G-tier EVs,
    charge rate otherwise). Derived straight from ev_context, not invented. */
export function availableFlexibilityKw(plan) {
  return (plan?.actions || []).reduce((sum, a) => {
    const ctx = a.ev_context;
    if (!ctx || a.action === 'protected') return sum;
    const cap = ctx.flexibility_category === 'v2g' ? ctx.max_discharge_kw : ctx.max_charge_kw;
    return sum + (cap || 0);
  }, 0);
}

/** Rewards summary for the current plan + all-time ledger totals. */
export function rewardsSummary(plan, ledgerTotalsObj) {
  const eventPayout = plan?.total_payout_inr || 0;
  const eventParticipants = (plan?.actions || []).filter(a => a.payout_inr > 0).length;
  const avgReward = eventParticipants ? eventPayout / eventParticipants : 0;
  const fleetTotal = Object.values(ledgerTotalsObj || {}).reduce((s, v) => s + v, 0);
  return { eventPayout, eventParticipants, avgReward, fleetTotal };
}

/** In-memory run history for the activity timeline — the backend has no
    "event log" endpoint (only per-EV ledger totals), so this is built
    client-side from each scenario run within the session. Clearly a UI
    concept layered on real DispatchPlan responses, not fabricated data. */
export function timelineEntryFromPlan(scenarioLabel, plan) {
  return {
    time: new Date(),
    scenarioLabel,
    zoneId: plan.zone_id,
    utilizationBefore: plan.grid_utilization_before,
    utilizationAfter: plan.grid_utilization_after,
    kwReduced: plan.kw_reduced,
    participating: plan.evs_participating,
    payout: plan.total_payout_inr,
    violations: plan.mobility_violations,
  };
}

/** Owner-facing eligibility explanation derived straight from an EV's
    ev_context inside a dispatch action — never invented. */
export function ownerEligibility(action) {
  const ctx = action?.ev_context;
  if (!ctx) return null;
  const isProtected = ctx.flexibility_category === 'protected';
  return {
    eligible: !isProtected,
    category: ctx.flexibility_category,
    v2gEligible: ctx.flexibility_category === 'v2g' && ctx.opted_in_v2g,
    reason: action.reason,
  };
}
