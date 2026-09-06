/* ==========================================================================
   rewards.js — "Rewards & Incentives" view. Same ledger calls as before.
   ========================================================================== */
import * as api from './api.js';
import * as state from './state.js';
import { $, el, fmtInr } from './utils.js';
import { statCell, emptyState } from './components.js';

export async function renderRewards(plan) {
  let totals = {};
  let entries = [];
  try {
    [totals, entries] = await Promise.all([api.ledgerTotals(), api.ledgerEntries()]);
  } catch (e) { /* ledger is best-effort; rest of the app still works */ }

  const r = state.rewardsSummary(plan, totals);
  const grid = $('rewardGrid');
  grid.innerHTML = '';
  grid.appendChild(statCell('This event', fmtInr(r.eventPayout), 'sage'));
  grid.appendChild(statCell('Fleet lifetime total', fmtInr(r.fleetTotal)));
  grid.appendChild(statCell('Owners paid, this event', r.eventParticipants));
  grid.appendChild(statCell('Average reward', fmtInr(r.avgReward)));

  const recent = $('recentActivity');
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
