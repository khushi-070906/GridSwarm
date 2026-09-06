/* ==========================================================================
   app.js — bootstrap + orchestration. Flow is unchanged from before:
   API -> api.js -> state.js (transform) -> view modules (render) -> DOM.
   This file just wires the scenario runner to every view's render
   function and owns the few pieces of state shared across views
   (current plan, run history, last scenario meta).
   ========================================================================== */
import * as api from './api.js';
import * as state from './state.js';
import { $, qsa, fmtTime } from './utils.js';
import { initNavigation } from './navigation.js';
import { initEvProfileModal } from './ev-profile.js';
import { renderCommandCenter } from './dashboard.js';
import { renderFleetOverview, renderVehicles } from './fleet.js';
import { renderGridEvents, renderGridResponse } from './grid.js';
import { initDispatchFilters, renderDispatch } from './dispatch.js';
import { renderRewards } from './rewards.js';
import { renderTimeline } from './activity.js';

let timelineHistory = [];
let lastScenarioMeta = null; // { label, targetKw }

/* ---------------------------------------------------------------------- */
/* health                                                                  */
/* ---------------------------------------------------------------------- */

async function checkHealth() {
  try {
    await api.health();
    $('statusDot').className = 'status-dot live';
    $('statusText').textContent = 'System live';
    hideError();
    return true;
  } catch (e) {
    $('statusDot').className = 'status-dot down';
    $('statusText').textContent = 'Backend unreachable';
    showError('Can\'t reach the GridSwarm backend right now. Start it with "uvicorn app.main:app --port 8000". This page retries automatically.');
    return false;
  }
}

function showError(msg) {
  const b = $('errorBanner');
  b.textContent = msg;
  b.classList.add('show');
}
function hideError() { $('errorBanner').classList.remove('show'); }

/* ---------------------------------------------------------------------- */
/* scenario runner                                                         */
/* ---------------------------------------------------------------------- */

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
    showError(`Scenario failed: ${e.message}. Is the backend running?`);
  } finally {
    qsa('.scenario-btn').forEach(b => b.disabled = false);
  }
}

async function applyPlan(plan) {
  renderCommandCenter(plan, lastScenarioMeta);
  renderFleetOverview(plan);
  renderVehicles(plan.actions);
  renderGridEvents(plan, lastScenarioMeta);
  renderGridResponse(plan, lastScenarioMeta);
  renderDispatch(plan.actions);
  renderTimeline(timelineHistory);
  await renderRewards(plan);
}

/* ---------------------------------------------------------------------- */
/* init                                                                     */
/* ---------------------------------------------------------------------- */

initNavigation();
initEvProfileModal();
initDispatchFilters();
qsa('.scenario-btn').forEach(b => b.addEventListener('click', () => runScenario(b.dataset.scn)));

(async function init() {
  const ok = await checkHealth();
  if (ok) {
    try { await renderRewards({ actions: [], total_payout_inr: 0 }); } catch (_) { /* best-effort */ }
  }
  setInterval(checkHealth, 8000);
})();
