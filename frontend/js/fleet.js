/* ==========================================================================
   fleet.js — "Fleet Overview" (fleet health stats + distribution charts)
   and "Vehicles" (the depot yard visualization). Clicking a car opens the
   shared EV profile modal (ev-profile.js).
   ========================================================================== */
import * as state from './state.js';
import { $, qsa, svgEl } from './utils.js';
import { statCell } from './components.js';
import { renderBarChart } from './charts.js';
import { openEvProfile, getSelectedId, onSelectionChange } from './ev-profile.js';

let currentActions = [];

/* ---------------------------------------------------------------------- */
/* Fleet Overview                                                          */
/* ---------------------------------------------------------------------- */

export function renderFleetOverview(plan) {
  const ov = state.fleetOverview(plan);
  const cards = $('fleetCards');
  cards.innerHTML = '';
  cards.appendChild(statCell('Connected', ov.connected));
  cards.appendChild(statCell('Charging', ov.charging));
  cards.appendChild(statCell('Flexible', ov.flexible, 'copper'));
  cards.appendChild(statCell('Protected', ov.protected, 'sage'));
  cards.appendChild(statCell('V2G capable', ov.v2gCapable));
  cards.appendChild(statCell('Total flexibility', `${ov.totalFlexKwh.toFixed(0)} kWh`));

  const flexDist = state.flexibilityDistribution(plan);
  renderBarChart($('flexChart'), [
    { label: 'V2G', value: flexDist.v2g, color: state.FLEX_COLORS.v2g },
    { label: 'High', value: flexDist.high, color: state.FLEX_COLORS.high },
    { label: 'Medium', value: flexDist.medium, color: state.FLEX_COLORS.medium },
    { label: 'Low', value: flexDist.low, color: state.FLEX_COLORS.low },
    { label: 'Protected', value: flexDist.protected, color: state.FLEX_COLORS.protected },
  ]);

  const socDist = state.socDistribution(plan);
  renderBarChart($('socChart'), Object.entries(socDist).map(([label, value]) => ({
    label, value, color: 'var(--verdigris)',
  })));
}

/* ---------------------------------------------------------------------- */
/* Vehicles — depot yard (signature visual, unchanged layout logic)        */
/* ---------------------------------------------------------------------- */

export function renderVehicles(actions) {
  currentActions = actions;
  renderYard(actions);
}

function renderYard(actions) {
  const svg = $('yardSvg');
  svg.innerHTML = '';
  const n = actions.length || 1;
  const cols = Math.max(4, Math.min(10, Math.ceil(Math.sqrt(n * 2.1))));
  const rows = Math.ceil(n / cols);
  const W = 900;
  const carW = 44, carH = 24;
  const busY = 40;
  const railGap = 90;
  const dropLen = 34;
  const firstRailY = busY + 52;
  const H = firstRailY + (rows - 1) * railGap + dropLen + carH + 44;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const bayW = (W - 60) / cols;
  const trunkX = W / 2;

  const laid = actions.map((a, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    return {
      a, col, row,
      cx: 30 + bayW * col + bayW / 2,
      railY: firstRailY + row * railGap,
      cy: firstRailY + row * railGap + dropLen + carH / 2,
    };
  });
  const lastRailY = firstRailY + (rows - 1) * railGap;

  svg.appendChild(svgEl('line', { class: 'busbar', x1: 36, y1: busY, x2: W - 36, y2: busY, 'stroke-linecap': 'round' }));
  svg.appendChild(svgEl('circle', { class: 'busbar-cap', cx: 36, cy: busY, r: 5 }));
  svg.appendChild(svgEl('circle', { class: 'busbar-cap', cx: W - 36, cy: busY, r: 5 }));
  const lbl = svgEl('text', { class: 'busbar-label', x: 36, y: busY - 13 });
  lbl.textContent = 'zone transformer';
  svg.appendChild(lbl);

  svg.appendChild(svgEl('line', {
    class: 'cable idle', x1: trunkX, y1: busY, x2: trunkX, y2: lastRailY,
    stroke: 'var(--copper-dim)', 'stroke-dasharray': 'none',
  }));

  for (let r = 0; r < rows; r++) {
    const inRow = laid.filter(l => l.row === r);
    if (inRow.length === 0) continue;
    const xs = inRow.map(l => l.cx);
    const railY = firstRailY + r * railGap;
    const x1 = Math.min(...xs, trunkX) - carW / 2 - 4;
    const x2 = Math.max(...xs, trunkX) + carW / 2 + 4;
    svg.appendChild(svgEl('line', { x1, y1: railY, x2, y2: railY, stroke: 'var(--copper-dim)', 'stroke-width': 1.6 }));
    svg.appendChild(svgEl('circle', { cx: trunkX, cy: railY, r: 2.6, fill: 'var(--copper-dim)' }));
  }

  laid.forEach(({ a, cx, cy, railY }) => {
    const meta = state.ACTION_META[a.action] || state.ACTION_META.no_action;
    const active = meta.dir !== null;

    svg.appendChild(svgEl('g', { class: 'bay-slot' })).appendChild(
      svgEl('rect', { x: cx - carW / 2 - 4, y: cy - carH / 2 - 4, width: carW + 8, height: carH + 8, rx: 4 })
    );

    const portX = cx, portY = cy - carH / 2 - 4;
    const cableClass = active ? `cable flow${meta.dir === 'in' ? ' flow-rev' : ''}` : 'cable idle';
    svg.appendChild(svgEl('path', {
      class: cableClass, d: `M${portX},${railY} L${portX},${portY}`,
      stroke: active ? meta.color : undefined,
    }));

    const g = svgEl('g', { class: 'car' + (active ? ' active' : '') + (a.ev_id === getSelectedId() ? ' selected' : ''), 'data-id': a.ev_id });
    g.appendChild(svgEl('rect', { class: 'body', x: cx - carW / 2, y: cy - carH / 2, width: carW, height: carH, rx: 6, stroke: meta.color }));
    g.appendChild(svgEl('rect', { class: 'cabin', x: cx - carW / 2 + 11, y: cy - carH / 2 + 5, width: carW - 22, height: carH - 10, rx: 3 }));
    [-1, 1].forEach(sx => [-1, 1].forEach(sy => {
      g.appendChild(svgEl('rect', {
        class: 'wheel', x: cx + sx * (carW / 2 - 2) - 3, y: cy + sy * (carH / 2 - 1) - 1.5, width: 6, height: 3, rx: 1,
      }));
    }));
    g.appendChild(svgEl('circle', { class: 'port', cx: portX, cy: portY, r: 3.4, fill: meta.color }));
    const t = svgEl('text', { class: 'id-label', x: cx, y: cy + carH / 2 + 11 });
    t.textContent = a.ev_id;
    g.appendChild(t);

    g.addEventListener('click', () => openEvProfile(a));
    svg.appendChild(g);
  });

  $('emptyYard').style.display = 'none';
  $('yardCount').textContent = `${actions.length} vehicles`;
}

// Keep the yard's "selected" ring in sync with whichever EV is open in the
// profile modal, regardless of whether it was opened from here or from
// the dispatch decision list.
onSelectionChange((id) => {
  qsa('.car').forEach(g => g.classList.toggle('selected', g.getAttribute('data-id') === id));
});
