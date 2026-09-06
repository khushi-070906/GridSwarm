/* ==========================================================================
   grid.js — "Grid Events" (the constraint signal: before/after utilization,
   requested vs. actual reduction, duration) and "Grid Response" (the
   step-by-step response story). This absorbs what used to be the
   Command Center's duplicate "GridSwarm response" panel — it now lives
   here instead of repeating the hero stats on the landing view.
   ========================================================================== */
import { $, el, fmtKw, fmtInr, fmtPct, fmtMinutes, gridStatus } from './utils.js';
import { badge, statCell } from './components.js';

export function renderGridEvents(plan, scenarioMeta) {
  const status = gridStatus(plan.grid_utilization_before);

  const statusRow = $('gridStatusRow');
  statusRow.innerHTML = '';
  statusRow.appendChild(badge(status.label, status.key));
  const zoneSpan = el('span', { class: 'status-pill' });
  zoneSpan.innerHTML = `<span class="status-dot live"></span>${plan.zone_id}`;
  statusRow.appendChild(zoneSpan);
  if (plan.mobility_violations > 0) {
    statusRow.appendChild(badge('Mobility violation', 'critical'));
  }

  const facts = $('gridFacts');
  facts.innerHTML = '';
  facts.appendChild(statCell('Scenario', scenarioMeta?.label || '—'));
  facts.appendChild(statCell('Utilization before', fmtPct(plan.grid_utilization_before)));
  facts.appendChild(statCell('Utilization after', fmtPct(plan.grid_utilization_after), 'sage'));
  facts.appendChild(statCell('Requested reduction', fmtKw(scenarioMeta?.targetKw)));
  facts.appendChild(statCell('Actual reduction', fmtKw(plan.kw_reduced), 'copper'));
  facts.appendChild(statCell('Event duration', fmtMinutes(15)));
}

export function renderGridResponse(plan, scenarioMeta) {
  const flow = $('responseFlow');
  flow.innerHTML = '';
  const steps = [
    { k: 'Grid constraint', v: fmtPct(plan.grid_utilization_before), d: `${plan.zone_id} transformer` },
    { k: 'Fleet evaluated', v: `${plan.actions.length} EVs`, d: `${plan.evs_protected} protected, structurally excluded` },
    { k: 'Requested', v: fmtKw(scenarioMeta?.targetKw), d: 'target reduction' },
    { k: 'EVs selected', v: `${plan.evs_participating}`, d: 'ranked by flexibility, least-intrusive action first' },
    { k: 'Reduction delivered', v: fmtKw(plan.kw_reduced), d: `${fmtInr(plan.total_payout_inr)} paid to owners` },
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
}
