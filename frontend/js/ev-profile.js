/* ==========================================================================
   ev-profile.js — the EV profile modal. Opened from either the depot yard
   (fleet.js) or the dispatch decision list (dispatch.js). Renders the same
   ev_context fields the old inline inspector showed, plus a lightweight
   CSS-3D vehicle (no external 3D library — just perspective/transform-3d,
   consistent with the rest of the project's hand-rolled-SVG approach).
   ========================================================================== */
import { $, fmtKw, fmtInr, fmtMinutes } from './utils.js';
import { badge } from './components.js';
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
  $('pTag').appendChild(badge(meta.label, a.action));

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

/** Lightweight CSS-3D car: two boxes (body + cabin) built from six/five
    div "faces" each, positioned with translateZ/rotateY, slowly spun via
    a CSS animation. No canvas/WebGL/three.js — degrades gracefully to a
    static shape if 3D transforms aren't supported, and never blocks the
    rest of the profile from rendering. */
function renderVehicle3D(container, actionKey) {
  const meta = state.ACTION_META[actionKey] || state.ACTION_META.no_action;
  container.innerHTML = `
    <div class="veh3d">
      <div class="veh3d-stage" style="--veh-color:${meta.color}">
        <div class="veh3d-body">
          <div class="face top"></div><div class="face bottom"></div>
          <div class="face front"></div><div class="face back"></div>
          <div class="face left"></div><div class="face right"></div>
        </div>
        <div class="veh3d-cabin">
          <div class="face top"></div>
          <div class="face front"></div><div class="face back"></div>
          <div class="face left"></div><div class="face right"></div>
        </div>
        <div class="veh3d-wheel fl"></div><div class="veh3d-wheel fr"></div>
        <div class="veh3d-wheel bl"></div><div class="veh3d-wheel br"></div>
      </div>
    </div>
  `;
}
