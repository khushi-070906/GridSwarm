/* ==========================================================================
   dashboard.js — Command Center view (the landing screen).
   Answers, in order: what's happening, how bad is it, what is GridSwarm
   doing, and a compact peek at the result — full detail lives in the
   Grid / Fleet / Dispatch / Rewards views, not duplicated here.
   ========================================================================== */
import { $, el, fmtKw, fmtInr, fmtPct, gridStatus, fmtTime } from './utils.js';
import { badge, statCell, emptyState } from './components.js';
import { renderGauge } from './charts.js';
import * as state from './state.js';
import { openEvProfile } from './ev-profile.js';
import { registerView } from './navigation.js';

export function render(store) {
  const plan = store.plan;

  if (!plan) {
    // Toggle visibility rather than overwriting ccHero's innerHTML — that
    // container holds #ccGauge/#ccStatusRow/#ccFacts/#ccUpdated, which
    // later renders (after a scenario runs) still need to exist in the DOM.
    $('ccHeroContent').style.display = 'none';
    emptyState($('ccHeroEmpty'), '⌁', 'Run a scenario from the control bar below to see the current grid state and GridSwarm\'s response.');
    $('ccHeroEmpty').style.display = 'flex';
    $('ccDecisionCards').innerHTML = '';
    emptyState($('ccDecisionSummary'), '—', 'No dispatch decision yet.');
    return;
  }

  $('ccHeroEmpty').style.display = 'none';
  $('ccHeroContent').style.display = '';

  const status = gridStatus(plan.grid_utilization_before);

  const statusRow = $('ccStatusRow');
  statusRow.innerHTML = '';
  statusRow.appendChild(badge(status.label, status.key));
  const zoneSpan = el('span', { class: 'status-pill' });
  zoneSpan.innerHTML = `<span class="status-dot live"></span>${plan.zone_id}`;
  statusRow.appendChild(zoneSpan);
  if (plan.mobility_violations > 0) statusRow.appendChild(badge('Mobility violation', 'critical'));

  renderGauge($('ccGauge'), { percent: plan.grid_utilization_before, statusKey: status.key });
  $('ccGaugeAfter').textContent = `→ ${fmtPct(plan.grid_utilization_after)} projected after dispatch`;

  const facts = $('ccFacts');
  facts.innerHTML = '';
  facts.appendChild(statCell('Requested reduction', fmtKw(store.lastScenarioMeta?.targetKw)));
  facts.appendChild(statCell('Available flexibility', fmtKw(state.availableFlexibilityKw(plan))));
  facts.appendChild(statCell('Actual reduction', fmtKw(plan.kw_reduced)));
  facts.appendChild(statCell('EVs participating', plan.evs_participating));
  $('ccUpdated').textContent = `Last updated ${fmtTime()}`;

  // Compact current-decision summary — counts + top few actions by
  // reward, with a link to the full explainable list on Dispatch.
  const summaryCards = $('ccDecisionCards');
  summaryCards.innerHTML = '';
  summaryCards.appendChild(statCell('EVs selected', plan.evs_participating));
  summaryCards.appendChild(statCell('Protected', plan.evs_protected, 'sage'));
  summaryCards.appendChild(statCell('Total payout', fmtInr(plan.total_payout_inr), 'copper'));
  summaryCards.appendChild(statCell('Mobility violations', plan.mobility_violations, plan.mobility_violations > 0 ? 'brick' : 'sage'));

  const list = $('ccDecisionSummary');
  const top = [...plan.actions].filter(a => a.payout_inr > 0).sort((a, b) => b.payout_inr - a.payout_inr).slice(0, 4);
  if (!top.length) {
    emptyState(list, '—', 'No EVs required action for this event.');
  } else {
    list.innerHTML = '';
    top.forEach(a => {
      const meta = state.ACTION_META[a.action] || state.ACTION_META.no_action;
      const row = el('div', { class: 'decision-row' });
      row.innerHTML = `
        <div><div class="ev-id">${a.ev_id}</div><span class="badge ${a.action}" style="margin-top:6px;">${meta.label}</span></div>
        <div class="reason">${a.reason || ''}</div>
        <div class="result"><div class="kw">${fmtKw(a.magnitude_kw)}</div><div class="inr">+${fmtInr(a.payout_inr)}</div></div>
      `;
      row.onclick = () => openEvProfile(a);
      list.appendChild(row);
    });
  }
}

registerView('command-center', render);
