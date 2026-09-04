/* ==========================================================================
   dispatch.js — Dispatch Decisions view: the full "why was this EV
   chosen" explainable list (the Command Center only shows a top-4 peek).
   ========================================================================== */
import { $, el, fmtKw, fmtInr, fmtMinutes } from './utils.js';
import { emptyState } from './components.js';
import * as state from './state.js';
import { openEvProfile } from './ev-profile.js';
import { registerView } from './navigation.js';

let activeFilter = 'all';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'discharge', label: 'Discharge' },
  { key: 'pause_charging|reduce_rate', label: 'Pause / reduce' },
  { key: 'solar_align', label: 'Solar' },
  { key: 'protected', label: 'Protected' },
  { key: 'no_action', label: 'No action' },
];

function matchesFilter(action) {
  if (activeFilter === 'all') return true;
  return activeFilter.split('|').includes(action);
}

function initFilters(store) {
  const wrap = $('dispatchFilters');
  wrap.innerHTML = '';
  FILTERS.forEach(f => {
    const chip = el('div', { class: 'chip' + (f.key === activeFilter ? ' on' : '') });
    const swatchColor = f.key === 'all' ? 'var(--ink-faint)' : (state.ACTION_META[f.key.split('|')[0]] || {}).color;
    chip.innerHTML = `<span class="dot" style="background:${swatchColor}"></span>${f.label}`;
    chip.onclick = () => { activeFilter = f.key; render(store); };
    wrap.appendChild(chip);
  });
}

export function render(store) {
  initFilters(store);
  const plan = store.plan;
  const list = $('dispatchList');
  if (!plan) {
    $('dispatchCount').textContent = '';
    emptyState(list, '⇄', 'Run a scenario below to see the dispatch decision and why each EV was chosen.');
    return;
  }

  const visible = plan.actions.filter(a => matchesFilter(a.action));
  $('dispatchCount').textContent = ` ${visible.length} of ${plan.actions.length}`;
  if (visible.length === 0) {
    emptyState(list, '—', 'Nothing matches this filter.');
    return;
  }
  const sorted = [...visible].sort((a, b) => (b.payout_inr || 0) - (a.payout_inr || 0));
  list.innerHTML = '';
  sorted.forEach(a => {
    const meta = state.ACTION_META[a.action] || state.ACTION_META.no_action;
    const ctx = a.ev_context;
    const row = el('div', { class: 'decision-row' });
    const metaLine = ctx
      ? `${ctx.soc_percent.toFixed(0)}% SOC <b>·</b> needs ${ctx.required_soc_percent.toFixed(0)}% <b>·</b> departs in ${fmtMinutes(ctx.departure_minutes)}`
      : '';
    row.innerHTML = `
      <div><div class="ev-id">${a.ev_id}</div><span class="badge ${a.action}" style="margin-top:6px;">${meta.label}</span></div>
      <div>
        <div class="meta">${metaLine}</div>
        <div class="reason">${a.reason || ''}</div>
      </div>
      <div class="result">
        <div class="kw">${a.magnitude_kw ? fmtKw(a.magnitude_kw) : '—'}</div>
        <div class="inr">${a.payout_inr > 0 ? '+' + fmtInr(a.payout_inr) : ''}</div>
      </div>
    `;
    row.onclick = () => openEvProfile(a);
    list.appendChild(row);
  });
}

registerView('dispatch', render);
