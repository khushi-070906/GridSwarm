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

/** How the CURRENT event's reduction was actually achieved — total kW
    contributed and EV count per active dispatch action (discharge, pause,
    reduce, solar-align). Protected/no-action EVs are deliberately excluded
    here: they contributed no reduction, and "how many were protected" is
    already its own metric in responseSummary() — including them would
    just duplicate that number as the dominant bar in this chart. */
export function actionMix(plan) {
  const kwByAction = {};
  const countByAction = {};
  for (const a of plan?.actions || []) {
    if (!(a.magnitude_kw > 0)) continue;
    kwByAction[a.action] = (kwByAction[a.action] || 0) + a.magnitude_kw;
    countByAction[a.action] = (countByAction[a.action] || 0) + 1;
  }
  return Object.keys(kwByAction)
    .map(action => ({ action, kw: kwByAction[action], count: countByAction[action] }))
    .sort((a, b) => b.kw - a.kw);
}

/** Consolidated "how did the response go" numbers for the Command
    Center's Current Response section — all derived straight from the
    current plan plus the target kW the operator actually requested for
    this run (scenarioMeta.targetKw). Percentages are null (not 0) when
    the denominator is unknown/zero, so callers can render "—" instead of
    a misleading 0%. */
export function responseSummary(plan, scenarioMeta) {
  const targetKw = scenarioMeta?.targetKw ?? null;
  const achievedKw = plan?.kw_reduced ?? 0;
  const achievementPct = targetKw ? Math.min(999, (achievedKw / targetKw) * 100) : null;

  const totalEvaluated = plan?.actions?.length || 0;
  const protectedCount = plan?.evs_protected ?? 0;
  const protectionPct = totalEvaluated ? (protectedCount / totalEvaluated) * 100 : null;

  const availableKw = availableFlexibilityKw(plan);
  const utilizedPct = availableKw > 0 ? Math.min(100, (achievedKw / availableKw) * 100) : null;

  return {
    targetKw, achievedKw, achievementPct,
    totalEvaluated, protectedCount, protectionPct,
    availableKw, utilizedPct,
    participating: plan?.evs_participating ?? 0,
  };
}

/** One dynamically generated operator sentence — never a template with
    blanks, always built from the real numbers in `summary`
    (state.responseSummary output). */
export function responseSentence(summary) {
  if (!summary.achievedKw && !summary.participating) {
    return `GridSwarm evaluated ${summary.totalEvaluated} EV${summary.totalEvaluated === 1 ? '' : 's'} and found no flexibility action necessary this run.`;
  }
  return `GridSwarm delivered ${summary.achievedKw.toFixed(1)} kW of reduction through `
    + `${summary.participating} EV${summary.participating === 1 ? '' : 's'} while protecting `
    + `${summary.protectedCount} vehicle${summary.protectedCount === 1 ? '' : 's'}.`;
}

/** One real, ordered record of an actual scenario run, for Command
    Center's own session-local run history (kept separate from the
    Activity page's timeline — dashboard.js accumulates this itself from
    the plan/scenarioMeta it already receives on every real run, so no
    new coupling to app.js or new API calls is introduced). */
export function sessionRunFromPlan(plan, scenarioMeta) {
  return {
    time: new Date(),
    label: scenarioMeta?.label || plan.zone_id,
    targetKw: scenarioMeta?.targetKw ?? null,
    utilizationBefore: plan.grid_utilization_before,
    utilizationAfter: plan.grid_utilization_after,
    kwReduced: plan.kw_reduced,
    participating: plan.evs_participating,
    protectedCount: plan.evs_protected,
  };
}

/** Total payout for the CURRENT event, grouped by dispatch action. Only
    actions that actually paid out appear (mirrors the `payout_inr > 0`
    filter rewardsSummary already uses for eventParticipants) — sorted
    highest total first. Nothing here is historical/ledger data, only
    the current plan's own actions. */
export function rewardsByAction(plan) {
  const totals = {};
  for (const a of plan?.actions || []) {
    if (a.payout_inr > 0) totals[a.action] = (totals[a.action] || 0) + a.payout_inr;
  }
  return Object.entries(totals)
    .map(([action, total]) => ({ action, total }))
    .sort((a, b) => b.total - a.total);
}

/** EV count for the CURRENT event, grouped by dispatch action. Same
    payout_inr > 0 scope as rewardsByAction, so the two charts describe
    the same set of actions (the ones that drew on the incentive budget). */
export function participationByAction(plan) {
  const counts = {};
  for (const a of plan?.actions || []) {
    if (a.payout_inr > 0) counts[a.action] = (counts[a.action] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count);
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
