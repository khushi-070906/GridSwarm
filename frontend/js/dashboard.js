/* ==========================================================================
   dashboard.js — B2B grid-operator dashboard.
   Flow: API -> api.js -> state.js (transform) -> this file (render) -> DOM.
   ========================================================================== */
import * as api from './api.js';
import * as state from './state.js';
import { $, qsa, el, svgEl, fmtKw, fmtInr, fmtPct, fmtMinutes, fmtTime, gridStatus } from './utils.js';
import { badge, statCell, emptyState, loadingState, errorState, toggleRow } from './components.js';
import { renderGauge, renderBarChart } from './charts.js';

let currentPlan = null;
let currentActions = [];
let selectedId = null;
let activeFilter = 'all';
let timelineHistory = [];
let lastScenarioMeta = null; // { label, targetKw }

/* ---------------------------------------------------------------------- */
/* bootstrap                                                              */
/* ---------------------------------------------------------------------- */

function initApiBase() {
  const input = $('baseUrl');
  input.value = api.getApiBase();
  input.addEventListener('change', () => { api.setApiBase(input.value); checkHealth(); });
}

async function checkHealth() {
  try {
    await api.health();
    $('statusDot').className = 'status-dot live';
    $('statusText').textContent = 'Backend live';
    hideError();
    return true;
  } catch (e) {
    $('statusDot').className = 'status-dot down';
    $('statusText').textContent = 'Backend unreachable';
    showError(`Can't reach ${api.getApiBase()} — start it with "uvicorn app.main:app --port 8000". This page retries automatically.`);
    return false;
  }
}

function showError(msg) {
  const b = $('errorBanner');
  b.textContent = msg;
  b.classList.add('show');
}
function hideError() { $('errorBanner').classList.remove('show'); }

const SCENARIOS = {
  demo:           { label: 'Demo — 7PM / 96%',        run: (kw) => api.demoScenario(kw) },
  depot_delivery: { label: 'Depot — Delivery fleet',   run: (kw) => api.depotScenario('delivery', kw) },
  depot_bus:      { label: 'Depot — School bus',       run: (kw) => api.depotScenario('school_bus', kw) },
  emergency:      { label: 'Emergency / brownout',     run: (kw) => api.emergencyScenario(kw) },
};

async function runScenario(key) {
  qsa('.scenario-btn').forEach(b => { b.classList.remove('active'); b.disabled = true; });
  const btn = document.querySelector(`[data-scn="${key}"]`);
  if (btn) btn.classList.add('active');

  const kw = parseFloat($('targetKw').value) || 30;
  const scn = SCENARIOS[key];
  try {
    const plan = await scn.run(kw);
    hideError();
    lastScenarioMeta = { label: scn.label, targetKw: kw };
    timelineHistory.unshift(state.timelineEntryFromPlan(scn.label, plan));
    timelineHistory = timelineHistory.slice(0, 12);
    await applyPlan(plan);
    $('lastRun').textContent = `Last run — ${scn.label} — ${fmtTime()}`;
  } catch (e) {
    showError(`Scenario failed: ${e.message}. Is the backend running on ${api.getApiBase()}?`);
  } finally {
    qsa('.scenario-btn').forEach(b => b.disabled = false);
  }
}

async function applyPlan(plan) {
  currentPlan = plan;
  currentActions = plan.actions;
  selectedId = null;
  closeInspector();

  renderHero(plan);
  renderResponseFlow(plan);
  renderDecisionList();
  renderYard(currentActions);
  renderFleetOverview(plan);
  await renderRewards(plan);
  renderTimeline();
}

/* ---------------------------------------------------------------------- */
/* hero                                                                    */
/* ---------------------------------------------------------------------- */

function renderHero(plan) {
  const status = gridStatus(plan.grid_utilization_before);
  const statusRow = $('heroStatusRow');
  statusRow.innerHTML = '';
  const b = badge(status.label, status.key);
  statusRow.appendChild(b);
  const zoneSpan = el('span', { class: 'status-pill' });
  zoneSpan.innerHTML = `<span class="status-dot live"></span>${plan.zone_id}`;
  statusRow.appendChild(zoneSpan);
  if (plan.mobility_violations > 0) {
    const v = badge('Mobility violation', 'critical');
    statusRow.appendChild(v);
  }

  renderGauge($('gauge'), { percent: plan.grid_utilization_before, statusKey: status.key });
  $('gaugeAfter').textContent = `→ ${fmtPct(plan.grid_utilization_after)} projected`;

  const facts = $('heroFacts');
  facts.innerHTML = '';
  facts.appendChild(statCell('Requested reduction', fmtKw(lastScenarioMeta?.targetKw)));
  facts.appendChild(statCell('Available flexibility', fmtKw(state.availableFlexibilityKw(plan))));
  facts.appendChild(statCell('Actual reduction', fmtKw(plan.kw_reduced)));
  facts.appendChild(statCell('EVs participating', plan.evs_participating));
  facts.appendChild(statCell('EVs protected', plan.evs_protected, 'sage'));
  facts.appendChild(statCell('Event duration', fmtMinutes(15)));

  $('heroUpdated').textContent = `Last updated ${fmtTime()}`;
}

/* ---------------------------------------------------------------------- */
/* response story                                                          */
/* ---------------------------------------------------------------------- */

function renderResponseFlow(plan) {
  const flow = $('responseFlow');
  flow.innerHTML = '';
  const steps = [
    { k: 'Grid constraint', v: fmtPct(plan.grid_utilization_before), d: `${plan.zone_id} transformer` },
    { k: 'Fleet evaluated', v: `${plan.actions.length} EVs`, d: `${plan.evs_protected} protected, structurally excluded` },
    { k: 'Requested', v: fmtKw(lastScenarioMeta?.targetKw), d: 'target reduction' },
    { k: 'EVs selected', v: `${plan.evs_participating}`, d: 'ranked by flexibility, least-intrusive action first' },
    { k: 'Reduction delivered', v: fmtKw(plan.kw_reduced), d: `₹${plan.total_payout_inr.toFixed(2)} paid to owners` },
    { k: 'Projected utilization', v: fmtPct(plan.grid_utilization_after), d: 'after dispatch' },
  ];
  steps.forEach((s, i) => {
    const step = el('div', { class: 'flow-step' });
    step.innerHTML = `<div class="k">${s.k}</div><div class="v">${s.v}</div><div class="d">${s.d}</div>`;
    flow.appendChild(step);
    if (i < steps.length - 1) {
      const arrow = el('div', { class: 'flow-arrow' });
      arrow.textContent = '→';
      flow.appendChild(arrow);
    }
  });
}

/* ---------------------------------------------------------------------- */
/* dispatch decision list (explainability)                                 */
/* ---------------------------------------------------------------------- */

function matchesFilter(action) {
  if (activeFilter === 'all') return true;
  return activeFilter.split('|').includes(action);
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'discharge', label: 'Discharge' },
  { key: 'pause_charging|reduce_rate', label: 'Pause / reduce' },
  { key: 'solar_align', label: 'Solar' },
  { key: 'protected', label: 'Protected' },
  { key: 'no_action', label: 'No action' },
];

function initFilters() {
  const wrap = $('filters');
  wrap.innerHTML = '';
  FILTERS.forEach(f => {
    const chip = el('div', { class: 'chip' + (f.key === activeFilter ? ' on' : '') });
    const swatchColor = f.key === 'all' ? 'var(--ink-faint)' : (state.ACTION_META[f.key.split('|')[0]] || {}).color;
    chip.innerHTML = `<span class="dot" style="background:${swatchColor}"></span>${f.label}`;
    chip.onclick = () => { activeFilter = f.key; initFilters(); renderDecisionList(); renderYardHighlight(); };
    wrap.appendChild(chip);
  });
}

function renderDecisionList() {
  const list = $('decisionList');
  const visible = currentActions.filter(a => matchesFilter(a.action));
  $('decisionCount').textContent = ` ${visible.length} of ${currentActions.length}`;
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
    row.onclick = () => selectEv(a);
    list.appendChild(row);
  });
}

/* ---------------------------------------------------------------------- */
/* depot yard visualization (signature visual)                             */
/* ---------------------------------------------------------------------- */

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

    const g = svgEl('g', { class: 'car' + (active ? ' active' : '') + (a.ev_id === selectedId ? ' selected' : ''), 'data-id': a.ev_id });
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

    g.addEventListener('click', () => selectEv(a));
    svg.appendChild(g);
  });

  $('emptyYard').style.display = 'none';
  $('yardCount').textContent = `${actions.length} vehicles`;
  renderYardHighlight();
}

function renderYardHighlight() {
  qsa('.car').forEach(g => {
    const id = g.getAttribute('data-id');
    const a = currentActions.find(x => x.ev_id === id);
    const dim = a && !matchesFilter(a.action);
    g.style.opacity = dim ? 0.22 : 1;
    g.classList.toggle('selected', id === selectedId);
  });
}

function selectEv(a) {
  selectedId = a.ev_id;
  renderYardHighlight();
  openInspector(a);
  qsa('.decision-row').forEach(r => r.classList.remove('selected'));
}

function openInspector(a) {
  const meta = state.ACTION_META[a.action] || state.ACTION_META.no_action;
  const ctx = a.ev_context;
  $('iId').textContent = a.ev_id;
  $('iTag').innerHTML = '';
  $('iTag').appendChild(badge(meta.label, a.action));
  $('iSoc').textContent = ctx ? `${ctx.soc_percent.toFixed(0)}% (needs ${ctx.required_soc_percent.toFixed(0)}%)` : '—';
  $('iDeparture').textContent = ctx ? fmtMinutes(ctx.departure_minutes) : '—';
  $('iCategory').textContent = ctx ? ctx.flexibility_category.toUpperCase() : '—';
  $('iMag').textContent = a.magnitude_kw != null ? fmtKw(a.magnitude_kw) : '—';
  $('iPayout').textContent = fmtInr(a.payout_inr);
  $('iReason').textContent = a.reason || '—';
  $('inspector').classList.add('open');
}
function closeInspector() {
  $('inspector')?.classList.remove('open');
  selectedId = null;
  renderYardHighlight();
}
window.closeInspector = closeInspector;

/* ---------------------------------------------------------------------- */
/* fleet overview                                                          */
/* ---------------------------------------------------------------------- */

function renderFleetOverview(plan) {
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
  renderBarChart($('socChart'), Object.entries(socDist).map(([label, value]) => ({ label, value, color: 'var(--verdigris)' })));
}

/* ---------------------------------------------------------------------- */
/* rewards                                                                 */
/* ---------------------------------------------------------------------- */

async function renderRewards(plan) {
  let totals = {};
  let entries = [];
  try {
    [totals, entries] = await Promise.all([api.ledgerTotals(), api.ledgerEntries()]);
  } catch (e) { /* ledger is best-effort; hero/decision list still work */ }

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

/* ---------------------------------------------------------------------- */
/* timeline                                                                 */
/* ---------------------------------------------------------------------- */

function renderTimeline() {
  const list = $('timelineList');
  if (!timelineHistory.length) {
    emptyState(list, '—', 'Run a scenario to see events appear here.');
    return;
  }
  list.innerHTML = '';
  timelineHistory.forEach(h => {
    const row = el('div', { class: 'timeline-row' });
    row.innerHTML = `
      <span class="t">${h.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="desc"><b>${h.scenarioLabel}</b> — ${fmtPct(h.utilizationBefore)} → ${fmtPct(h.utilizationAfter)}, ${h.participating} EVs, ${fmtKw(h.kwReduced)} reduced</span>
      <span class="result ${h.violations > 0 ? 'brick' : 'sage'}">${fmtInr(h.payout)}</span>
    `;
    list.appendChild(row);
  });
}

/* ---------------------------------------------------------------------- */
/* init                                                                     */
/* ---------------------------------------------------------------------- */

qsa('.scenario-btn').forEach(b => b.addEventListener('click', () => runScenario(b.dataset.scn)));
initApiBase();
initFilters();
(async function init() {
  const ok = await checkHealth();
  if (ok) {
    emptyState($('decisionList'), '⌁', 'Run a scenario below to see the dispatch decision and why each EV was chosen.');
    try { await renderRewards({ actions: [], total_payout_inr: 0 }); } catch (_) {}
  }
  setInterval(checkHealth, 8000);
})();
