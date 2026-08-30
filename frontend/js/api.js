/* ==========================================================================
   api.js — every call to the GridSwarm FastAPI backend lives here.
   Nothing else in the frontend should call fetch() directly, so the API
   surface stays in one auditable place and mirrors app/main.py exactly.
   ========================================================================== */

const STORAGE_KEY = 'gridswarm.apiBase';

export function getApiBase() {
  return localStorage.getItem(STORAGE_KEY) || 'http://localhost:8000';
}
export function setApiBase(url) {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''));
}

async function request(path, opts = {}) {
  const res = await fetch(getApiBase() + path, opts);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail; } catch (_) { /* ignore */ }
    throw new Error(detail || `${path} → HTTP ${res.status}`);
  }
  return res.json();
}

const get = (path) => request(path);
const post = (path, body) => request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/* ---- health ---- */
export const health = () => get('/');

/* ---- fleet ---- */
export const fleetDemo = () => get('/fleet/demo');
export const fleetRandom = (n, seed) => get(`/fleet/random?n=${n}${seed != null ? `&seed=${seed}` : ''}`);
export const fleetDepot = (depotType, n) => get(`/fleet/depot?depot_type=${depotType}&n=${n}`);
export const fleetFlexibility = (evs) => post('/fleet/flexibility', evs);

/* ---- dispatch pipeline ---- */
export const gridEvent = (signal, evs) => post('/grid-event', { signal, evs });
export const demoScenario = (targetReductionKw, extremeEvent = false) =>
  get(`/demo-scenario?target_reduction_kw=${targetReductionKw}&extreme_event=${extremeEvent}`);
export const depotScenario = (depotType, targetReductionKw, n = 25) =>
  get(`/depot-scenario?depot_type=${depotType}&target_reduction_kw=${targetReductionKw}&n=${n}`);

/* ---- emergency (DISCOM-facing, requires API key — demo key used here) ---- */
export const emergencyScenario = (targetReductionKw, apiKey = 'gridswarm-demo-key') =>
  request(`/emergency-scenario?target_reduction_kw=${targetReductionKw}`, {
    headers: { 'X-API-Key': apiKey },
  });

/* ---- ledger ---- */
export const ledgerEntries = () => get('/ledger/entries');
export const ledgerTotals = () => get('/ledger/totals');

/* ---- live / OCPP (may 503 if GRIDSWARM_OCPP_ENABLED is off — callers
   should treat that as "not connected yet", not a hard error) ---- */
export const fleetLive = (onlyConnected = true) => get(`/fleet/live?only_connected=${onlyConnected}`);
