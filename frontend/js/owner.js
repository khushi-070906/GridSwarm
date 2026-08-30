/* ==========================================================================
   owner.js — EV owner experience. Picks one EV out of the demo fleet and
   shows it exactly as the backend's dispatch pipeline treated it — no
   separate owner-facing API exists yet, so this reuses /fleet/demo and
   /demo-scenario and reads that one EV's action out of the DispatchPlan.
   Consent controls are explicitly marked "Preview" where the backend has
   no per-session-policy endpoint for the demo fleet (only OCPP charge
   points support POST /ocpp/session-policy/{id} today).
   ========================================================================== */
import * as api from './api.js';
import * as state from './state.js';
import { $, qsa, el, fmtKw, fmtInr, fmtMinutes, fmtClock } from './utils.js';
import { badge, emptyState, toggleRow } from './components.js';
import { renderSocRing } from './charts.js';

let fleet = [];
let selectedEvId = null;
let currentPlan = null;
let countdownTimer = null;
let notifications = [];
let seenActionKey = null;

function initApiBase() {
  api.setApiBase(api.getApiBase()); // no-op, keeps localStorage consistent with dashboard page
}

async function loadFleetAndRun() {
  try {
    fleet = await api.fleetDemo();
    populateVehicleSelect();
    selectedEvId = fleet[0]?.id;
    await runForSelectedEv();
    $('statusDot').className = 'status-dot live';
    $('statusText').textContent = 'Connected';
  } catch (e) {
    $('statusDot').className = 'status-dot down';
    $('statusText').textContent = 'Backend unreachable';
    showError(`Can't reach ${api.getApiBase()}. Start the backend with "uvicorn app.main:app --port 8000".`);
  }
}

function populateVehicleSelect() {
  const sel = $('vehicleSelect');
  sel.innerHTML = '';
  fleet.forEach(ev => {
    const opt = el('option', { value: ev.id });
    opt.textContent = ev.id;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { selectedEvId = sel.value; runForSelectedEv(); });
}

async function runForSelectedEv() {
  try {
    const plan = await api.demoScenario(30);
    currentPlan = plan;
    hideError();
    render();
  } catch (e) {
    showError(`Couldn't load your vehicle's status: ${e.message}`);
  }
}

function currentAction() {
  return currentPlan?.actions.find(a => a.ev_id === selectedEvId) || null;
}

function showError(msg) {
  const b = $('errorBanner');
  b.textContent = msg;
  b.classList.add('show');
}
function hideError() { $('errorBanner').classList.remove('show'); }

/* ---------------------------------------------------------------------- */
/* render                                                                    */
/* ---------------------------------------------------------------------- */

function render() {
  const action = currentAction();
  if (!action) { return; }
  const ctx = action.ev_context;

  renderHome(ctx);
  renderFlexibility(action, ctx);
  renderConsent(ctx);
  renderActiveEvent(action, ctx);
  renderRewards(action);
  renderNotifications(action, ctx);
}

function renderHome(ctx) {
  renderSocRing($('socRing'), ctx.soc_percent);
  const facts = $('ownerFacts');
  facts.innerHTML = '';
  const rows = [
    ['Charging status', ctx.currently_charging ? 'Charging' : 'Idle / plugged in'],
    ['Required SOC', `${ctx.required_soc_percent.toFixed(0)}%`],
    ['Departure', `in ${fmtMinutes(ctx.departure_minutes)}`],
  ];
  const headroom = ctx.required_soc_percent - ctx.soc_percent;
  if (headroom > 0 && ctx.max_charge_kw > 0) {
    const etaMin = (headroom / 100 * ctx.battery_kwh) / ctx.max_charge_kw * 60;
    rows.push(['Est. time to required SOC', fmtMinutes(etaMin)]);
  } else {
    rows.push(['Est. time to required SOC', 'Already at target']);
  }
  rows.forEach(([k, v]) => {
    const row = el('div', { class: 'owner-fact' });
    row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
    facts.appendChild(row);
  });
}

function renderFlexibility(action, ctx) {
  const wrap = $('flexBanner');
  const elig = state.ownerEligibility(action);
  const isProtected = ctx.flexibility_category === 'protected';
  wrap.className = `eligibility-banner ${isProtected ? 'protected' : 'eligible'}`;
  wrap.innerHTML = `
    <div class="icon">${isProtected ? '✕' : '✓'}</div>
    <div class="txt">
      <b>${isProtected ? 'Not participating this event' : 'Your vehicle can help balance the grid'}</b><br/>
      ${action.reason}
    </div>
  `;
  $('v2gStatus').textContent = elig.v2gEligible ? 'Eligible for V2G export' : 'Not currently eligible for V2G export';
  $('flexCategory').textContent = ctx.flexibility_category.toUpperCase();
  $('flexScore').textContent = `${ctx.flexibility_score_kwh.toFixed(1)} kWh`;
}

function renderConsent(ctx) {
  const wrap = $('consentList');
  wrap.innerHTML = '';
  wrap.appendChild(toggleRow({
    label: 'Allow GridSwarm flexibility',
    sub: 'Reflects this session\'s opted_in_v2g flag from the backend.',
    checked: ctx.opted_in_v2g,
    disabled: true,
  }));
  wrap.appendChild(toggleRow({
    label: 'Pause participation',
    sub: 'Preview — not yet wired to the backend.',
    checked: false,
  }));
  wrap.appendChild(toggleRow({
    label: 'Only participate above 70% SOC',
    sub: 'Preview — not yet wired to the backend.',
    checked: false,
  }));
  wrap.appendChild(toggleRow({
    label: 'Don\'t participate within 60 min of departure',
    sub: 'Preview — matches the backend\'s built-in 30 min protection rule today.',
    checked: true,
    disabled: true,
  }));
}

function renderActiveEvent(action, ctx) {
  const card = $('activeEventCard');
  const isActive = ['discharge', 'pause_charging', 'reduce_rate', 'solar_align'].includes(action.action);
  if (countdownTimer) clearInterval(countdownTimer);

  if (!isActive) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  const meta = state.ACTION_META[action.action];
  const durationSeconds = 15 * 60; // convenience scenario endpoints use a 15 min dispatch window
  let remaining = durationSeconds;

  const headlineEl = $('eventHeadline');
  const descEl = $('eventDesc');
  const countdownEl = $('eventCountdown');
  const onTrackEl = $('eventOnTrack');

  headlineEl.textContent = 'Grid support active';
  const verb = action.action === 'discharge' ? 'exporting power back to the grid'
    : action.action === 'pause_charging' ? 'temporarily paused'
    : action.action === 'reduce_rate' ? 'temporarily reduced'
    : 'shifted to align with solar generation';
  descEl.textContent = `Your charging is ${verb}.`;
  onTrackEl.textContent = `You're still on track to reach ${ctx.required_soc_percent.toFixed(0)}% by departure.`;

  $('eventPower').textContent = fmtKw(action.magnitude_kw);
  $('eventReward').textContent = fmtInr(action.payout_inr);
  $('eventProtection').textContent = 'Protected';

  function tick() {
    const m = Math.floor(remaining / 60), s = remaining % 60;
    countdownEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (remaining <= 0) { clearInterval(countdownTimer); descEl.textContent = 'Charging has resumed.'; return; }
    remaining -= 1;
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

async function renderRewards(action) {
  let totals = {};
  let entries = [];
  try {
    [totals, entries] = await Promise.all([api.ledgerTotals(), api.ledgerEntries()]);
  } catch (e) { /* best-effort */ }

  const lifetime = totals[selectedEvId] || 0;
  const grid = $('rewardHero');
  grid.innerHTML = '';
  const cellThis = el('div', { class: 'stat' });
  cellThis.innerHTML = `<div class="k">This event</div><div class="v sage">${fmtInr(action.payout_inr)}</div>`;
  const cellLife = el('div', { class: 'stat' });
  cellLife.innerHTML = `<div class="k">Lifetime earnings</div><div class="v">${fmtInr(lifetime)}</div>`;
  grid.appendChild(cellThis);
  grid.appendChild(cellLife);

  const history = entries.filter(e => e.ev_id === selectedEvId).reverse().slice(0, 6);
  const historyEl = $('rewardHistory');
  if (!history.length) {
    emptyState(historyEl, '—', 'No events participated in yet.');
    return;
  }
  historyEl.innerHTML = '';
  history.forEach(e => {
    const meta = state.ACTION_META[e.action] || state.ACTION_META.no_action;
    const row = el('div', { class: 'timeline-row' });
    row.innerHTML = `<span class="t">${meta.label}</span><span class="desc">${e.zone_id}</span><span class="result sage">${fmtInr(e.payout_inr)}</span>`;
    historyEl.appendChild(row);
  });
}

function renderNotifications(action, ctx) {
  const key = `${action.ev_id}:${action.action}`;
  if (key === seenActionKey) return; // avoid re-pushing on every poll
  seenActionKey = key;

  const list = [];
  const now = new Date();
  if (ctx.flexibility_category === 'protected') {
    list.push({ title: 'Vehicle protected', desc: action.reason, color: 'var(--sage)' });
  } else if (action.action === 'no_action') {
    list.push({ title: 'Flexibility opportunity available', desc: 'Your vehicle is eligible but wasn\'t needed for this event.', color: 'var(--brass)' });
  } else {
    list.push({ title: 'Grid support event started', desc: `${state.ACTION_META[action.action].label} for ~15 min.`, color: 'var(--copper)' });
    if (action.payout_inr > 0) {
      list.push({ title: 'Reward credited', desc: `${fmtInr(action.payout_inr)} added to your balance.`, color: 'var(--sage)' });
    }
  }

  notifications = [...list.map(n => ({ ...n, time: now })), ...notifications].slice(0, 10);
  const wrap = $('notifList');
  wrap.innerHTML = '';
  notifications.forEach(n => {
    const row = el('div', { class: 'notif' });
    row.innerHTML = `
      <span class="dot" style="background:${n.color}"></span>
      <div class="body"><div class="title">${n.title}</div><div class="desc">${n.desc}</div></div>
      <span class="time">${fmtClock(n.time)}</span>
    `;
    wrap.appendChild(row);
  });
}

/* ---------------------------------------------------------------------- */
/* init                                                                       */
/* ---------------------------------------------------------------------- */

initApiBase();
loadFleetAndRun();
setInterval(() => { if (fleet.length) loadFleetAndRun(); }, 20000);
