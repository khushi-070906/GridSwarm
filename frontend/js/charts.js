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

/** Compact multi-series line chart for real ORDERED data (e.g. session
    scenario runs) — same hand-rolled, no-library SVG approach as the rest
    of this file. Purely additive: existing renderGauge/renderSocRing/
    renderBarChart callers are untouched.
    `labels` — one x-axis tick per point, oldest → newest.
    `series` — [{name, color, values:number[]}], each values[] the same
    length as `labels`; a null in values[] breaks the line at that point
    rather than plotting a fabricated 0. */
export function renderLineChart(container, labels, series, options = {}) {
  container.innerHTML = '';
  if (!labels.length || !series.length) return;

  const w = options.width || 520;
  const h = options.height || 150;
  const padL = 30, padR = 8, padT = 10, padB = 20;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const known = series.flatMap(s => s.values).filter(v => v != null);
  let min = Math.min(0, ...known);
  let max = Math.max(1, ...known);
  const pad = (max - min) * 0.12 || 1;
  min = Math.max(0, min - pad);
  max = max + pad;

  const xFor = (i) => padL + (labels.length === 1 ? plotW / 2 : (plotW * i) / (labels.length - 1));
  const yFor = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'xMidYMid meet' });

  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const v = min + ((max - min) * i) / gridLines;
    const y = yFor(v);
    svg.appendChild(svgEl('line', { x1: padL, y1: y.toFixed(1), x2: w - padR, y2: y.toFixed(1), stroke: 'var(--line-soft)', 'stroke-width': 1 }));
    const t = svgEl('text', { x: padL - 6, y: (y + 3).toFixed(1), 'text-anchor': 'end', class: 'linechart-axis' });
    t.textContent = Math.round(v);
    svg.appendChild(t);
  }

  labels.forEach((lab, i) => {
    const t = svgEl('text', { x: xFor(i).toFixed(1), y: h - 5, 'text-anchor': 'middle', class: 'linechart-axis' });
    t.textContent = lab;
    svg.appendChild(t);
  });

  series.forEach(s => {
    let d = '';
    s.values.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)} `;
    });
    if (d) {
      svg.appendChild(svgEl('path', {
        d: d.trim(), fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    }
    s.values.forEach((v, i) => {
      if (v == null) return;
      svg.appendChild(svgEl('circle', { cx: xFor(i).toFixed(1), cy: yFor(v).toFixed(1), r: 2.6, fill: s.color }));
    });
  });

  container.appendChild(svg);

  if (options.legend !== false) {
    const legend = el('div', { class: 'legend', style: 'border-top:none;padding:6px 2px 0;' });
    series.forEach(s => {
      const item = el('div', { class: 'legend-item' });
      item.innerHTML = `<div class="legend-dot" style="background:${s.color}"></div>${s.name}`;
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }
}

/** Horizontal bar chart. `rows` = [{label, value, color, display}]. Width
    is value/max of the current row set — no hardcoded scale — and a true
    zero still renders as a thin sliver so it reads differently from
    "no data" rather than disappearing. `display`, if given, is shown
    verbatim instead of `${value}${unit}` — lets a caller pass a
    pre-formatted amount (e.g. currency via fmtInr) while `value` still
    drives the bar width. Existing callers that only pass value/unit are
    unaffected. */
export function renderBarChart(container, rows, unit = '') {
  container.innerHTML = '';
  if (!rows.length) return;
  const wrap = el('div', { class: 'bar-chart' });
  const max = Math.max(1, ...rows.map(r => r.value || 0));
  rows.forEach(r => {
    const v = r.value || 0;
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    const amtText = r.display != null ? r.display : `${v}${unit}`;
    const row = el('div', { class: 'bar-row' });
    row.innerHTML = `
      <span class="bar-label">${r.label}</span>
      <span class="bar-track"><span class="bar-fill${v === 0 ? ' zero' : ''}" style="width:${pct.toFixed(1)}%;background:${r.color || 'var(--copper)'}"></span></span>
      <span class="bar-amt">${amtText}</span>
    `;
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
}
