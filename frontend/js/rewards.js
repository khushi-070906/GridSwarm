/* ==========================================================================
   rewards.js — Rewards & Incentives view.
   ========================================================================== */
import { $, el, fmtInr } from './utils.js';
import { emptyState, statCell } from './components.js';
import * as state from './state.js';
import { registerView } from './navigation.js';

export function render(store) {
  const plan = store.plan;
  const r = state.rewardsSummary(plan || { actions: [], total_payout_inr: 0 }, store.ledgerTotals);

  const grid = $('rewardGrid');
  grid.innerHTML = '';
  grid.appendChild(statCell('This event', fmtInr(r.eventPayout), 'sage'));
  grid.appendChild(statCell('Fleet lifetime total', fmtInr(r.fleetTotal)));
  grid.appendChild(statCell('Owners paid, this event', r.eventParticipants));
  grid.appendChild(statCell('Average reward', fmtInr(r.avgReward)));

  const recent = $('recentActivity');
  if (!store.ledgerEntries.length) {
    emptyState(recent, '—', 'No payouts recorded yet.');
    return;
  }
  recent.innerHTML = '';
  store.ledgerEntries.slice(-10).reverse().forEach(e => {
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

registerView('rewards', render);
