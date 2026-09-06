/* ==========================================================================
   charts.js — small hand-rolled SVG charts. No external chart library.
   Reconstructed to the exact contract dashboard.js (renderGauge) and
   fleet.js (renderBarChart) already import against; renderSocRing is
   kept for owner.js, which imports it the same way.
   ========================================================================== */
import { svgEl, el } from './utils.js';

const STATUS_COLOR = {
  normal: 'var(--sage)', watch: 'var(--brass)', constrained: 'var(--copper)', critical: 'var(--brick)',
};

/** Circular utilization gauge (arc), scaled 0–150% so over-100% events are still legible. */
export function renderGauge(container, { percent, statusKey, size = 176 }) {
  container.innerHTML = '';
  container.classList.add('gauge');
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(150, percent)) / 150;
  const cx = size / 2, cy = size / 2;
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'var(--line-soft)', 'stroke-width': 12 }));
  const colorVar = STATUS_COLOR[statusKey] || 'var(--sage)';
  svg.appendChild(svgEl('circle', {
    cx, cy, r, fill: 'none', stroke: colorVar, 'stroke-width': 12, 'stroke-linecap': 'round',
    'stroke-dasharray': `${c}`, 'stroke-dashoffset': `${c * (1 - pct)}`,
    transform: `rotate(-90 ${cx} ${cy})`,
  }));
  container.appendChild(svg);
  const valueBox = el('div', { class: 'gauge-value' });
  valueBox.innerHTML = `<div class="n num" style="color:${colorVar}">${percent.toFixed(0)}%</div><div class="u">utilization</div>`;
  container.appendChild(valueBox);
}

/** Small SOC ring used on the owner home card. */
export function renderSocRing(container, socPercent) {
  container.innerHTML = '';
  const size = 104, r = 44, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, socPercent)) / 100;
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  svg.appendChild(svgEl('circle', { class: 'track', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': 9 }));
  svg.appendChild(svgEl('circle', {
    class: 'fill', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': 9, 'stroke-linecap': 'round',
    'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - pct),
  }));
  container.appendChild(svg);
  const label = el('div', { class: 'label' });
  label.innerHTML = `<div class="n num">${Math.round(socPercent)}%</div><div class="u">battery</div>`;
  container.appendChild(label);
}

/** Horizontal bar chart. `rows` = [{label, value, color}]. Width is
    value/max of the current row set — no hardcoded scale — and a true
    zero still renders as a thin sliver so it reads differently from
    "no data" rather than disappearing. */
export function renderBarChart(container, rows, unit = '') {
  container.innerHTML = '';
  if (!rows.length) return;
  const wrap = el('div', { class: 'bar-chart' });
  const max = Math.max(1, ...rows.map(r => r.value || 0));
  rows.forEach(r => {
    const v = r.value || 0;
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    const row = el('div', { class: 'bar-row' });
    row.innerHTML = `
      <span class="bar-label">${r.label}</span>
      <span class="bar-track"><span class="bar-fill${v === 0 ? ' zero' : ''}" style="width:${pct.toFixed(1)}%;background:${r.color || 'var(--copper)'}"></span></span>
      <span class="bar-amt">${v}${unit}</span>
    `;
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
}
