/* ==========================================================================
   ev-profile.js — the EV profile modal. Opened from either the depot yard
   (fleet.js) or the dispatch decision list (dispatch.js). Renders the same
   ev_context fields the old inline inspector showed, plus a lightweight
   CSS-3D vehicle (no external 3D library — just perspective/transform-3d,
   consistent with the rest of the project's hand-rolled-SVG approach).
   ========================================================================== */
import { $, fmtKw, fmtInr, fmtMinutes } from './utils.js';
import { actionTag } from './components.js';
import * as state from './state.js';

let selectedId = null;
const listeners = [];

export function getSelectedId() { return selectedId; }

/** Register a callback fired with the new selectedId whenever selection changes.
    Used by fleet.js to keep the yard's "selected" highlight in sync. */
export function onSelectionChange(cb) { listeners.push(cb); }

export function openEvProfile(action) {
  selectedId = action.ev_id;
  listeners.forEach(cb => cb(selectedId));
  populate(action);
  $('evModalOverlay').classList.add('open');
}

export function closeEvProfile() {
  $('evModalOverlay')?.classList.remove('open');
  selectedId = null;
  listeners.forEach(cb => cb(selectedId));
}

export function initEvProfileModal() {
  $('pClose')?.addEventListener('click', closeEvProfile);
  $('evModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'evModalOverlay') closeEvProfile();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEvProfile();
  });
}

function populate(a) {
  const meta = state.ACTION_META[a.action] || state.ACTION_META.no_action;
  const ctx = a.ev_context;

  $('pId').textContent = a.ev_id;
  $('pTag').innerHTML = '';
  $('pTag').appendChild(actionTag(meta.label, meta.color));

  $('pSoc').textContent = ctx ? `${ctx.soc_percent.toFixed(0)}% (needs ${ctx.required_soc_percent.toFixed(0)}%)` : '—';
  $('pDeparture').textContent = ctx ? fmtMinutes(ctx.departure_minutes) : '—';
  $('pBattery').textContent = ctx ? `${ctx.battery_kwh} kWh` : '—';
  $('pCharging').textContent = ctx
    ? (ctx.currently_charging ? `Charging (up to ${fmtKw(ctx.max_charge_kw)})` : 'Idle / plugged in')
    : '—';
  $('pMaxCharge').textContent = ctx ? fmtKw(ctx.max_charge_kw) : '—';
  $('pV2g').textContent = ctx
    ? ((ctx.opted_in_v2g && ctx.max_discharge_kw > 0) ? `Eligible (${fmtKw(ctx.max_discharge_kw)} max)` : 'Not eligible')
    : '—';
  $('pCategory').textContent = ctx ? ctx.flexibility_category.toUpperCase() : '—';
  $('pMag').textContent = a.magnitude_kw != null ? fmtKw(a.magnitude_kw) : '—';
  $('pPayout').textContent = fmtInr(a.payout_inr);
  $('pReason').textContent = a.reason || '—';

  const stage = $('pVehicle3d');
  try {
    renderVehicle3D(stage, a.action);
  } catch (err) {
    stage.innerHTML = '<div class="veh3d-fallback">Vehicle view unavailable — profile data above is unaffected.</div>';
  }
}

/** Lightweight CSS-3D car — no canvas/WebGL/three.js, just
    perspective/preserve-3d, consistent with the rest of the project's
    hand-rolled approach. Two stacked boxes (body + cabin), each built
    from named faces (two long sides, a front cap, a rear cap, a
    top/roof, and — body only — a bottom), plus wheels with their own
    front/back tire+hub layers so they read as cylinders rather than
    flat discs, a charging port on the rear cap, a chassis strip, and a
    static (non-rotating) ground shadow so the car doesn't look like it's
    floating. Degrades gracefully to a flat schematic if anything throws. */
function renderVehicle3D(container, actionKey) {
  const meta = state.ACTION_META[actionKey] || state.ACTION_META.no_action;
  const isActive = meta.dir !== null;
  container.innerHTML = `
    <div class="veh3d">
      <div class="veh3d-stage${isActive ? ' active' : ''}" style="--veh-color:${meta.color}">
        <div class="veh3d-body">
          <div class="face top"></div><div class="face bottom"></div>
          <div class="face side-a"></div><div class="face side-b"></div>
          <div class="face cap-front"></div><div class="face cap-rear"></div>
        </div>
        <div class="veh3d-cabin">
          <div class="face roof"></div>
          <div class="face glass side-a"></div><div class="face glass side-b"></div>
          <div class="face glass cap-front"></div><div class="face glass cap-rear"></div>
        </div>
        <div class="veh3d-chassis"></div>
        <div class="veh3d-port"><span class="dot"></span></div>
        <div class="veh3d-wheel fl"><span class="tire"></span><span class="hub"></span></div>
        <div class="veh3d-wheel fr"><span class="tire"></span><span class="hub"></span></div>
        <div class="veh3d-wheel bl"><span class="tire"></span><span class="hub"></span></div>
        <div class="veh3d-wheel br"><span class="tire"></span><span class="hub"></span></div>
      </div>
      <div class="veh3d-ground"></div>
    </div>
  `;
}
