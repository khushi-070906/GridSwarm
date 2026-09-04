/* ==========================================================================
   app.js — root controller. Owns the one shared copy of backend data
   (current DispatchPlan, ledger, session timeline) and the scenario
   runner. Every view module reads from `store` and calls `subscribe()`
   to re-render when new data arrives, instead of each view fetching and
   duplicating API calls on its own.
   ========================================================================== */
import * as api from './api.js';
import * as state from './state.js';
import { $, fmtTime } from './utils.js';

export const store = {
  plan: null,
  lastScenarioMeta: null,   // { label, targetKw }
  ledgerTotals: {},
  ledgerEntries: [],
  timeline: [],
  fleetDemo: [],
  backendLive: false,
};

const listeners = [];
export function subscribe(fn) { listeners.push(fn); }
function publish() { listeners.forEach(fn => fn(store)); }

/* ---------------------------------------------------------------------- */
/* backend base URL — configurable via a settings popover, never shown    */
/* as raw text in the main UI per the "no localhost in the header" rule.  */
/* ---------------------------------------------------------------------- */

export function initSettings() {
  const input = $('apiBaseInput');
  const btn = $('settingsBtn');
  const pop = $('settingsPop');
  if (input) input.value = api.getApiBase();
  if (btn && pop) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!pop.contains(e.target) && e.target !== btn) pop.classList.remove('show');
    });
  }
  if (input) {
    input.addEventListener('change', () => { api.setApiBase(input.value); checkHealth(); });
  }
}

export async function checkHealth() {
  try {
    await api.health();
    store.backendLive = true;
    setStatusIndicators(true);
    return true;
  } catch (e) {
    store.backendLive = false;
    setStatusIndicators(false);
    return false;
  }
}

function setStatusIndicators(live) {
  document.querySelectorAll('[data-status-dot]').forEach(d => { d.className = 'status-dot ' + (live ? 'live' : 'down'); });
  document.querySelectorAll('[data-status-text]').forEach(t => { t.textContent = live ? 'System live' : 'Disconnected'; });
  const banner = $('errorBanner');
  if (banner) {
    if (live) { banner.classList.remove('show'); }
    else {
      banner.textContent = `Backend unreachable at the configured URL. Start it with "uvicorn app.main:app --port 8000" — this reconnects automatically.`;
      banner.classList.add('show');
    }
  }
}

/* ---------------------------------------------------------------------- */
/* scenario runner — the one place a new DispatchPlan is requested        */
/* ---------------------------------------------------------------------- */

export const SCENARIOS = {
  demo:           { label: 'Demo — 7PM / 96%',        run: (kw) => api.demoScenario(kw) },
  depot_delivery: { label: 'Depot — Delivery fleet',   run: (kw) => api.depotScenario('delivery', kw) },
  depot_bus:      { label: 'Depot — School bus',       run: (kw) => api.depotScenario('school_bus', kw) },
  emergency:      { label: 'Emergency / brownout',     run: (kw) => api.emergencyScenario(kw) },
};

export async function runScenario(key, kw) {
  const scn = SCENARIOS[key];
  const plan = await scn.run(kw);
  store.plan = plan;
  store.lastScenarioMeta = { label: scn.label, targetKw: kw };
  store.timeline = [state.timelineEntryFromPlan(scn.label, plan), ...store.timeline].slice(0, 20);
  try {
    const [totals, entries] = await Promise.all([api.ledgerTotals(), api.ledgerEntries()]);
    store.ledgerTotals = totals;
    store.ledgerEntries = entries;
  } catch (e) { /* ledger is best-effort */ }
  publish();
  return plan;
}

export async function loadFleetDemo() {
  try {
    store.fleetDemo = await api.fleetDemo();
    publish();
  } catch (e) { /* best-effort, views handle empty fleetDemo gracefully */ }
}

export async function refreshLedger() {
  try {
    const [totals, entries] = await Promise.all([api.ledgerTotals(), api.ledgerEntries()]);
    store.ledgerTotals = totals;
    store.ledgerEntries = entries;
    publish();
  } catch (e) { /* best-effort */ }
}

/* ---------------------------------------------------------------------- */
/* persistent scenario control bar (footer) — sitewide, since running a   */
/* scenario is the one action that drives data across every view          */
/* ---------------------------------------------------------------------- */

export function initScenarioControls(onRun) {
  document.querySelectorAll('.scenario-btn').forEach(b => {
    b.addEventListener('click', async () => {
      document.querySelectorAll('.scenario-btn').forEach(x => { x.classList.remove('active'); x.disabled = true; });
      b.classList.add('active');
      const kw = parseFloat($('targetKw').value) || 30;
      try {
        await runScenario(b.dataset.scn, kw);
        $('lastRun').textContent = `Last run — ${store.lastScenarioMeta.label} — ${fmtTime()}`;
        if (onRun) onRun(store);
      } catch (e) {
        const banner = $('errorBanner');
        banner.textContent = `Scenario failed: ${e.message}`;
        banner.classList.add('show');
      } finally {
        document.querySelectorAll('.scenario-btn').forEach(x => x.disabled = false);
      }
    });
  });
}
