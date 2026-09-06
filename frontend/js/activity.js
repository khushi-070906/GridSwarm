/* ==========================================================================
   activity.js — "Activity" view: the in-session scenario-run timeline.
   ========================================================================== */
import { $, el, fmtKw, fmtInr, fmtPct } from './utils.js';
import { emptyState } from './components.js';

export function renderTimeline(timelineHistory) {
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
