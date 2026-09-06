/* ==========================================================================
   dashboard.js — Command Center view. Deliberately concise: grid
   condition, utilization gauge, and the handful of numbers an operator
   needs at a glance. Everything else (fleet detail, grid-event detail,
   dispatch list, rewards, activity) lives in its own view/module now.
   ========================================================================== */
import * as state from './state.js';
import { $, el, fmtKw, fmtPct, fmtMinutes, fmtTime, gridStatus } from './utils.js';
import { badge, statCell } from './components.js';
import { renderGauge } from './charts.js';

export function renderCommandCenter(plan, scenarioMeta) {
  const status = gridStatus(plan.grid_utilization_before);

  const statusRow = $('heroStatusRow');
  statusRow.innerHTML = '';
  statusRow.appendChild(badge(status.label, status.key));
  const zoneSpan = el('span', { class: 'status-pill' });
  zoneSpan.innerHTML = `<span class="status-dot live"></span>${plan.zone_id}`;
  statusRow.appendChild(zoneSpan);
  if (plan.mobility_violations > 0) {
    statusRow.appendChild(badge('Mobility violation', 'critical'));
  }

  renderGauge($('gauge'), { percent: plan.grid_utilization_before, statusKey: status.key });
  $('gaugeAfter').textContent = `→ ${fmtPct(plan.grid_utilization_after)} projected`;

  const facts = $('heroFacts');
  facts.innerHTML = '';
  facts.appendChild(statCell('Flexibility required', fmtKw(scenarioMeta?.targetKw)));
  facts.appendChild(statCell('Flexibility available', fmtKw(state.availableFlexibilityKw(plan))));
  facts.appendChild(statCell('Actual reduction', fmtKw(plan.kw_reduced), 'copper'));
  facts.appendChild(statCell('EVs participating', plan.evs_participating));
  facts.appendChild(statCell('EVs protected', plan.evs_protected, 'sage'));

  $('heroUpdated').textContent = `Last updated ${fmtTime()}`;
}
