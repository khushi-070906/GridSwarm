/* ==========================================================================
   activity.js — Activity / Event History view.
   The backend has no persisted "event log" endpoint (only per-EV ledger
   totals), so this timeline is built client-side from each scenario run
   within the session — clearly a UI concept layered on real DispatchPlan
   responses, not fabricated data.
   ========================================================================== */
import { $, el, fmtKw, fmtInr, fmtPct } from './utils.js';
import { emptyState } from './components.js';
import { registerView } from './navigation.js';

export function render(store) {
  const list = $('activityList');
  if (!store.timeline.length) {
    emptyState(list, '▤', 'Run a scenario to see events appear here.');
    return;
  }
  list.innerHTML = '';
  store.timeline.forEach(h => {
    const row = el('div', { class: 'timeline-row' });
    row.innerHTML = `
      <span class="t">${h.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="desc"><b>${h.scenarioLabel}</b> — ${fmtPct(h.utilizationBefore)} → ${fmtPct(h.utilizationAfter)}, ${h.participating} EVs, ${fmtKw(h.kwReduced)} reduced</span>
      <span class="result ${h.violations > 0 ? 'brick' : 'sage'}">${fmtInr(h.payout)}</span>
    `;
    list.appendChild(row);
  });
}

registerView('activity', render);
