/* ==========================================================================
   grid.js — Grid Events / Grid Response view. Holds the "story" flow
   (constraint → evaluate → decide → result) that used to sit directly
   under the Command Center hero showing the same numbers twice.
   ========================================================================== */
import { $, el, fmtKw, fmtPct, fmtMinutes } from './utils.js';
import { emptyState, statCell } from './components.js';
import { registerView } from './navigation.js';

export function render(store) {
  const plan = store.plan;
  if (!plan) {
    emptyState($('gridFlow'), '≋', 'Run a scenario to see how GridSwarm responded to the last grid event.');
    $('gridPerf').innerHTML = '';
    return;
  }

  const flow = $('gridFlow');
  flow.innerHTML = '';
  const steps = [
    { k: 'Grid constraint', v: fmtPct(plan.grid_utilization_before), d: `${plan.zone_id} transformer` },
    { k: 'Fleet evaluated', v: `${plan.actions.length} EVs`, d: `${plan.evs_protected} protected, structurally excluded` },
    { k: 'Requested', v: fmtKw(store.lastScenarioMeta?.targetKw), d: 'target reduction' },
    { k: 'EVs selected', v: `${plan.evs_participating}`, d: 'ranked by flexibility, least-intrusive action first' },
    { k: 'Reduction delivered', v: fmtKw(plan.kw_reduced), d: `₹${plan.total_payout_inr.toFixed(2)} paid to owners` },
    { k: 'Projected utilization', v: fmtPct(plan.grid_utilization_after), d: 'after dispatch' },
  ];
  steps.forEach((s, i) => {
    const step = el('div', { class: 'flow-step' });
    step.innerHTML = `<div class="k">${s.k}</div><div class="v">${s.v}</div><div class="d">${s.d}</div>`;
    flow.appendChild(step);
    if (i < steps.length - 1) {
      const arrow = el('div', { class: 'flow-arrow' });
      arrow.textContent = '→';
      flow.appendChild(arrow);
    }
  });

  const target = store.lastScenarioMeta?.targetKw || 0;
  const achievedPct = target > 0 ? Math.min(200, (plan.kw_reduced / target) * 100) : 0;
  const perf = $('gridPerf');
  perf.innerHTML = '';
  perf.appendChild(statCell('Utilization before', fmtPct(plan.grid_utilization_before)));
  perf.appendChild(statCell('Utilization after', fmtPct(plan.grid_utilization_after), 'sage'));
  perf.appendChild(statCell('Utilization change', `−${(plan.grid_utilization_before - plan.grid_utilization_after).toFixed(1)} pts`));
  perf.appendChild(statCell('Event duration', fmtMinutes(15)));
  perf.appendChild(statCell('Target achieved', `${achievedPct.toFixed(0)}%`, achievedPct >= 100 ? 'sage' : 'copper'));
  perf.appendChild(statCell('Mobility violations', plan.mobility_violations, plan.mobility_violations > 0 ? 'brick' : 'sage'));
}

registerView('grid', render);
