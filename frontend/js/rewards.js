/* ==========================================================================
   rewards.js — "Rewards & Incentives" view: this event's payout, fleet
   lifetime total (from the ledger), participants, average reward, and a
   recent-payouts list. This file was not part of the last upload batch —
   reconstructed to the exact contract app.js already imports against
   (`renderRewards(plan)`, async, best-effort on the ledger calls) and the
   #rewardGrid / #recentActivity containers already in index.html.
   ========================================================================== */
import * as api from './api.js';
import * as state from './state.js';
import { $, el, fmtInr } from './utils.js';
import { emptyState, statCell } from './components.js';
import { renderBarChart } from './charts.js';

export async function renderRewards(plan) {
  let totals = {};
  let entries = [];
  try {
    [totals, entries] = await Promise.all([api.ledgerTotals(), api.ledgerEntries()]);
  } catch (e) {
    /* ledger is best-effort — the rest of the view still renders from `plan` */
  }

  const r = state.rewardsSummary(plan, totals);
  const grid = $('rewardGrid');
  if (grid) {
    grid.innerHTML = '';
    grid.appendChild(statCell('This event', fmtInr(r.eventPayout), 'sage'));
    grid.appendChild(statCell('Fleet lifetime total', fmtInr(r.fleetTotal)));
    grid.appendChild(statCell('Owners paid, this event', r.eventParticipants));
    grid.appendChild(statCell('Average reward', fmtInr(r.avgReward)));
  }

  renderRewardByAction(plan);
  renderParticipationByAction(plan);

  const recent = $('recentActivity');
  if (!recent) return;
  if (!entries.length) {
    emptyState(recent, '—', 'No payouts recorded yet.');
    return;
  }
  recent.innerHTML = '';
  entries.slice(-8).reverse().forEach(e => {
    const meta = state.ACTION_META[e.action] || state.ACTION_META.no_action;
    const row = el('div', { class: 'timeline-row' });
    row.innerHTML = `
      <span class="t">${e.ev_id}</span>
      <span class="desc">${meta.label} <b>·</b> ${e.zone_id}</span>
      <span class="result sage">${fmtInr(e.payout_inr)}</span>
    `;
    recent.appendChild(row);
  });
}

/** "Reward by action" — total payout this event, grouped by dispatch
    action. Values come straight from state.rewardsByAction(plan); bar
    width uses the raw INR total, the label shows it formatted. */
function renderRewardByAction(plan) {
  const container = $('rewardByActionChart');
  if (!container) return;
  const rows = state.rewardsByAction(plan).map(({ action, total }) => {
    const meta = state.ACTION_META[action] || state.ACTION_META.no_action;
    return { label: meta.label, value: total, color: meta.color, display: fmtInr(total) };
  });
  if (!rows.length) {
    emptyState(container, '—', 'No incentive-earning actions in the current event yet.');
    return;
  }
  renderBarChart(container, rows);
}

/** "Participation by action" — how many EVs earned a reward through each
    action this event. Same payout_inr > 0 scope as the chart above, so
    both describe the same set of actions. */
function renderParticipationByAction(plan) {
  const container = $('participationByActionChart');
  if (!container) return;
  const rows = state.participationByAction(plan).map(({ action, count }) => {
    const meta = state.ACTION_META[action] || state.ACTION_META.no_action;
    return { label: meta.label, value: count, color: meta.color, display: `${count} EV${count === 1 ? '' : 's'}` };
  });
  if (!rows.length) {
    emptyState(container, '—', 'No EVs earned a reward in the current event yet.');
    return;
  }
  renderBarChart(container, rows);
}
