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
