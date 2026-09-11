/* ==========================================================================
   dashboard.js — Command Center view. The hero (grid condition,
   utilization gauge, key facts) stays exactly as it was. Below it, this
   file also renders a "Current Response" summary, an action-mix chart,
   and — only once there's real ordered data for it — a response trend
   and a recent-response list.

   Trend data comes from `sessionRuns`, a small array THIS module builds
   itself from the plan/scenarioMeta it already receives on every real
   scenario run. It is intentionally separate from the Activity page's
   own history (owned by app.js) — no new coupling, no new API calls,
   and nothing here is ever invented: it starts empty on page load and
   only grows as the operator actually runs scenarios this session.
   ========================================================================== */
import * as state from './state.js';
import { $, el, fmtKw, fmtPct, fmtMinutes, fmtTime, gridStatus } from './utils.js';
import { badge, statCell, emptyState } from './components.js';
import { renderGauge, renderBarChart, renderLineChart } from './charts.js';

const MAX_SESSION_RUNS = 8;
let sessionRuns = [];

export function renderCommandCenter(plan, scenarioMeta) {
  const status = gridStatus(plan.grid_utilization_before);

  const statusRow = $('heroStatusRow');
  statusRow.innerHTML = '';
  statusRow.appendChild(badge(status.label, status.key));
  const zoneSpan = el('span', { class: 'status-pill' });
  zoneSpan.innerHTML = `<span class="status-dot live"></span>${plan.zone_id}`;
  statusRow.appendChild(zoneSpan);
  if (plan.mobility_violations > 0) {
    statusRow.appendChild(badge('Mobility violation', 'critical'));
  }

  renderGauge($('gauge'), { percent: plan.grid_utilization_before, statusKey: status.key });
  $('gaugeAfter').textContent = `→ ${fmtPct(plan.grid_utilization_after)} projected`;

  const facts = $('heroFacts');
  facts.innerHTML = '';
  facts.appendChild(statCell('Flexibility required', fmtKw(scenarioMeta?.targetKw)));
  facts.appendChild(statCell('Flexibility available', fmtKw(state.availableFlexibilityKw(plan))));
  facts.appendChild(statCell('Actual reduction', fmtKw(plan.kw_reduced), 'copper'));
  facts.appendChild(statCell('EVs participating', plan.evs_participating));
  facts.appendChild(statCell('EVs protected', plan.evs_protected, 'sage'));

  $('heroUpdated').textContent = `Last updated ${fmtTime()}`;

  sessionRuns.push(state.sessionRunFromPlan(plan, scenarioMeta));
  if (sessionRuns.length > MAX_SESSION_RUNS) sessionRuns = sessionRuns.slice(-MAX_SESSION_RUNS);

  renderCurrentResponse(plan, scenarioMeta);
  renderActionMix(plan);
  renderResponseTrend(sessionRuns);
  renderRecentResponse(sessionRuns);
}

/* ---------------------------------------------------------------------- */
/* Current Response — sentence + target/protection/flex-used progress     */
/* ---------------------------------------------------------------------- */

function progressStat(label, valueText, pct, color) {
  const s = el('div', { class: 'stat' });
  const pctText = pct == null ? '—' : `${pct.toFixed(0)}%`;
  const barPct = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  s.innerHTML = `
    <div class="k">${label}</div>
    <div class="v">${valueText}</div>
    <div class="bar-track" style="margin-top:7px;"><span class="bar-fill" style="width:${barPct.toFixed(1)}%;background:${color}"></span></div>
    <div style="font-size:10.5px;color:var(--ink-faint);margin-top:4px;font-family:var(--font-mono);">${pctText}</div>
  `;
  return s;
}

function renderCurrentResponse(plan, scenarioMeta) {
  const sentenceEl = $('responseSentence');
  if (!sentenceEl) return; // section not present in this HTML — nothing to do

  const summary = state.responseSummary(plan, scenarioMeta);
  sentenceEl.textContent = state.responseSentence(summary);

  const stats = $('responseStats');
  stats.innerHTML = '';
  stats.appendChild(progressStat(
    'Target achievement',
    summary.targetKw ? `${summary.achievedKw.toFixed(1)} / ${summary.targetKw.toFixed(1)} kW` : fmtKw(summary.achievedKw),
    summary.achievementPct, 'var(--copper)',
  ));
  stats.appendChild(progressStat(
    'Protection',
    `${summary.protectedCount} of ${summary.totalEvaluated}`,
    summary.protectionPct, 'var(--sage)',
  ));
  stats.appendChild(progressStat(
    'Flexibility used',
    summary.availableKw > 0 ? `${summary.achievedKw.toFixed(1)} / ${summary.availableKw.toFixed(1)} kW` : fmtKw(summary.achievedKw),
    summary.utilizedPct, 'var(--verdigris)',
  ));
}

/* ---------------------------------------------------------------------- */
/* Response Action Mix — how the reduction was actually achieved          */
/* ---------------------------------------------------------------------- */

function renderActionMix(plan) {
  const container = $('actionMixChart');
  if (!container) return;

  const rows = state.actionMix(plan).map(({ action, kw, count }) => {
    const meta = state.ACTION_META[action] || state.ACTION_META.no_action;
    return { label: meta.label, value: kw, color: meta.color, display: `${kw.toFixed(1)} kW · ${count} EV${count === 1 ? '' : 's'}` };
  });
  if (!rows.length) {
    emptyState(container, '—', 'No flexibility actions were dispatched this run.');
    return;
  }
  renderBarChart(container, rows);
}

/* ---------------------------------------------------------------------- */
/* Response Trend — only rendered once there are ≥2 real session runs     */
/* ---------------------------------------------------------------------- */

function renderResponseTrend(runs) {
  const utilContainer = $('utilTrendChart');
  const reductionContainer = $('reductionTrendChart');
  if (!utilContainer || !reductionContainer) return;

  if (runs.length < 2) {
    emptyState(utilContainer, '—', 'A trend appears here after a second scenario run this session.');
    reductionContainer.innerHTML = '';
    return;
  }

  const labels = runs.map((_, i) => `R${i + 1}`);

  renderLineChart(utilContainer, labels, [
    { name: 'Before', color: 'var(--copper)', values: runs.map(r => r.utilizationBefore) },
    { name: 'After', color: 'var(--sage)', values: runs.map(r => r.utilizationAfter) },
  ]);

  const haveTargets = runs.some(r => r.targetKw != null);
  if (haveTargets) {
    renderLineChart(reductionContainer, labels, [
      { name: 'Requested', color: 'var(--ink-faint)', values: runs.map(r => r.targetKw) },
      { name: 'Delivered', color: 'var(--copper)', values: runs.map(r => r.kwReduced) },
    ]);
  } else {
    emptyState(reductionContainer, '—', 'Requested-kW isn\u2019t available for these runs.');
  }
}

/* ---------------------------------------------------------------------- */
/* Recent Response — a snapshot of the latest real runs, newest first     */
/* ---------------------------------------------------------------------- */

function renderRecentResponse(runs) {
  const list = $('recentResponseList');
  if (!list) return;

  if (!runs.length) {
    emptyState(list, '—', 'Run a scenario below to see it here.');
    return;
  }
  list.innerHTML = '';
  [...runs].reverse().slice(0, 4).forEach(r => {
    const row = el('div', { class: 'timeline-row' });
    const reqText = r.targetKw != null ? `${r.targetKw.toFixed(0)} → ${r.kwReduced.toFixed(1)} kW` : `${r.kwReduced.toFixed(1)} kW delivered`;
    row.innerHTML = `
      <span class="t">${r.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="desc"><b>${r.label}</b> — ${fmtPct(r.utilizationBefore)} → ${fmtPct(r.utilizationAfter)} <b>·</b> ${reqText} <b>·</b> ${r.participating} EVs</span>
      <span class="result">${r.protectedCount} protected</span>
    `;
    list.appendChild(row);
  });
}
