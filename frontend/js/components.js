/* ==========================================================================
   components.js — small, reusable, generic render helpers used by both
   dashboard.js and owner.js. Chart-specific drawing lives in charts.js.
   ========================================================================== */
import { el } from './utils.js';

export function badge(text, key) {
  const b = el('span', { class: `badge ${key}` });
  b.textContent = text;
  return b;
}

/** Restrained action indicator used in the Dispatch Decisions list and the
    EV profile — a small square dot + uppercase text in the action's
    semantic colour, deliberately NOT a bordered/filled pill. Keeps the
    same colour semantics as the old `badge(label, actionKey)` (discharge
    stays copper, pause/reduce stays verdigris, etc.) without the large
    visual footprint of a status badge. */
export function actionTag(label, colorVar) {
  const t = el('span', { class: 'action-tag', style: `--action-color:${colorVar}` });
  t.innerHTML = `<span class="action-tag-dot"></span>${label}`;
  return t;
}

export function statCell(k, v, extraClass = '') {
  const s = el('div', { class: 'stat' });
  s.innerHTML = `<div class="k">${k}</div><div class="v ${extraClass}">${v}</div>`;
  return s;
}

export function emptyState(container, glyph, text) {
  container.innerHTML = `<div class="empty-state"><div class="glyph">${glyph}</div><p>${text}</p></div>`;
}

export function loadingState(container, text = 'Loading…') {
  container.innerHTML = `<div class="loading-state"><div class="skeleton" style="width:60%;height:14px;"></div><p>${text}</p></div>`;
}

export function errorState(container, text) {
  container.innerHTML = `<div class="empty-state"><div class="glyph" style="color:var(--brick);">!</div><p>${text}</p></div>`;
}

/** Consent-style toggle row. `onChange(checked)` fires on interaction. */
export function toggleRow({ label, sub, checked, disabled, onChange }) {
  const row = el('div', { class: 'toggle-row' });
  const uid = 'tg_' + Math.random().toString(36).slice(2, 9);
  row.innerHTML = `
    <div>
      <div class="toggle-label">${label}</div>
      ${sub ? `<div class="toggle-sub">${sub}</div>` : ''}
    </div>
    <label class="switch">
      <input type="checkbox" id="${uid}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/>
      <span class="track"><span class="thumb"></span></span>
    </label>
  `;
  if (onChange) {
    row.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
  }
  return row;
}

/** One row in the activity/notification/timeline lists. */
export function listRow(cells, opts = {}) {
  const row = el('div', { class: opts.className || 'timeline-row' });
  row.innerHTML = cells;
  if (opts.onClick) row.addEventListener('click', opts.onClick);
  return row;
}
