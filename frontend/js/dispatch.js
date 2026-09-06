/* ==========================================================================
   dispatch.js — "Dispatch Decisions" view: the full "why was this EV
   chosen" explainable list. Filters stay pill-styled (kept distinct and
   clickable); each row's action indicator is a small coloured square +
   uppercase text instead of a large bordered/filled badge, so the list
   reads as an operations log rather than a row of status alerts.
   ========================================================================== */
import { $, el, fmtKw, fmtInr, fmtMinutes } from './utils.js';
import { emptyState, actionTag } from './components.js';
import * as state from './state.js';
import { openEvProfile } from './ev-profile.js';

let currentActions = [];
let activeFilter = 'all';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'discharge', label: 'Discharge' },
  { key: 'pause_charging|reduce_rate', label: 'Pause / reduce' },
  { key: 'solar_align', label: 'Solar' },
  { key: 'protected', label: 'Protected' },
  { key: 'no_action', label: 'No action' },
];

function matchesFilter(actionKey) {
  if (activeFilter === 'all') return true;
  return activeFilter.split('|').includes(actionKey);
}

export function initDispatchFilters() {
  const wrap = $('filters');
  if (!wrap) return;
  wrap.innerHTML = '';
  FILTERS.forEach(f => {
    const chip = el('div', { class: 'chip' + (f.key === activeFilter ? ' on' : '') });
    const swatchColor = f.key === 'all' ? 'var(--ink-faint)' : (state.ACTION_META[f.key.split('|')[0]] || {}).color;
    chip.innerHTML = `<span class="dot" style="background:${swatchColor}"></span>${f.label}`;
    chip.addEventListener('click', () => {
      activeFilter = f.key;
      initDispatchFilters();
      renderDispatch(currentActions);
    });
    wrap.appendChild(chip);
  });
}

export function renderDispatch(actions) {
  currentActions = actions;
  const list = $('decisionList');
  if (!list) return;

  const visible = actions.filter(a => matchesFilter(a.action));
  const countEl = $('decisionCount');
  if (countEl) countEl.textContent = ` ${visible.length} of ${actions.length}`;

  if (!visible.length) {
    emptyState(list, '—', actions.length ? 'Nothing matches this filter.' : 'Run a scenario below to see the dispatch decision and why each EV was chosen.');
    return;
  }

  const sorted = [...visible].sort((a, b) => (b.payout_inr || 0) - (a.payout_inr || 0));
  list.innerHTML = '';
  sorted.forEach(a => {
    const meta = state.ACTION_META[a.action] || state.ACTION_META.no_action;
    const ctx = a.ev_context;
    const metaLine = ctx
      ? `${ctx.soc_percent.toFixed(0)}% SOC <b>·</b> needs ${ctx.required_soc_percent.toFixed(0)}% <b>·</b> departs in ${fmtMinutes(ctx.departure_minutes)}`
      : '';

    const row = el('div', { class: 'decision-row', style: `--row-accent:${meta.color}` });

    const idCol = el('div', { class: 'decision-idcol' });
    const idEl = el('div', { class: 'ev-id' });
    idEl.textContent = a.ev_id;
    idCol.appendChild(idEl);
    idCol.appendChild(actionTag(meta.label, meta.color));

    const bodyCol = el('div', { class: 'decision-body' });
    bodyCol.innerHTML = `
      <div class="meta">${metaLine}</div>
      <div class="reason">${a.reason || ''}</div>
    `;

    const resultCol = el('div', { class: 'result' });
    resultCol.innerHTML = `
      <div class="kw">${a.magnitude_kw ? fmtKw(a.magnitude_kw) : '—'}</div>
      <div class="inr">${a.payout_inr > 0 ? '+' + fmtInr(a.payout_inr) : ''}</div>
    `;

    row.appendChild(idCol);
    row.appendChild(bodyCol);
    row.appendChild(resultCol);
    row.addEventListener('click', () => openEvProfile(a));
    list.appendChild(row);
  });
}
