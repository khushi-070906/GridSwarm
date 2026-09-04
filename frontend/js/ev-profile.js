/* ==========================================================================
   ev-profile.js — the slide-in EV profile opened by clicking a dispatch
   decision (from the yard, the Dispatch list, or the Vehicles table).
   Renders the vehicle's stats plus a lightweight CSS-3D visualization; if
   the browser can't do 3D transforms the profile still works and falls
   back to a flat schematic.
   ========================================================================== */
import { $, el, fmtKw, fmtInr, fmtMinutes } from './utils.js';
import { ACTION_META } from './state.js';

function supports3d() {
  try {
    return CSS && CSS.supports && CSS.supports('transform-style', 'preserve-3d') && CSS.supports('perspective', '900px');
  } catch (e) { return false; }
}

function render3dVehicle(container, action) {
  const meta = ACTION_META[action.action] || ACTION_META.no_action;
  const active = meta.dir !== null && action.action !== 'protected';
  container.innerHTML = '';

  if (!supports3d()) {
    container.innerHTML = `
      <div class="ev3d-fallback">
        <svg width="72" height="40" viewBox="0 0 72 40" fill="none">
          <rect x="4" y="14" width="64" height="18" rx="4" stroke="${meta.color}" stroke-width="1.5"/>
          <rect x="16" y="6" width="40" height="12" rx="3" stroke="${meta.color}" stroke-width="1.5"/>
          <circle cx="18" cy="34" r="4" fill="#101011"/>
          <circle cx="54" cy="34" r="4" fill="#101011"/>
        </svg>
        <span class="text-meta">3D view unavailable in this browser — schematic shown instead</span>
      </div>
    `;
    return;
  }

  try {
    const car = el('div', { class: 'ev3d-car' + (active ? ' active' : ''), style: `--ev3d-color:${meta.color}` });
    ['top', 'bottom', 'front', 'back', 'left', 'right'].forEach(face => {
      car.appendChild(el('div', { class: `ev3d-face ${face}` }));
    });
    car.appendChild(el('div', { class: 'ev3d-port' }));
    container.appendChild(car);
    const label = el('div', { class: 'ev3d-label' });
    label.textContent = `${action.ev_id} · ${meta.label}`;
    container.appendChild(label);
  } catch (e) {
    // Any unexpected rendering failure — degrade to the same schematic
    // fallback rather than leaving a blank panel.
    container.innerHTML = `<div class="ev3d-fallback"><span class="text-meta">Vehicle visual unavailable.</span></div>`;
  }
}

function field(k, v) {
  const f = el('div', { class: 'ev-profile-field' });
  f.innerHTML = `<div class="k">${k}</div><div class="v num">${v}</div>`;
  return f;
}

export function openEvProfile(action) {
  const ctx = action.ev_context;
  const meta = ACTION_META[action.action] || ACTION_META.no_action;

  $('evProfileId').textContent = action.ev_id;
  $('evProfileBadge').innerHTML = '';
  const b = el('span', { class: `badge ${action.action}` });
  b.textContent = meta.label;
  $('evProfileBadge').appendChild(b);

  render3dVehicle($('ev3dStage'), action);

  const grid = $('evProfileGrid');
  grid.innerHTML = '';
  if (ctx) {
    grid.appendChild(field('SOC', `${ctx.soc_percent.toFixed(0)}%`));
    grid.appendChild(field('Required SOC', `${ctx.required_soc_percent.toFixed(0)}%`));
    grid.appendChild(field('Departure', `in ${fmtMinutes(ctx.departure_minutes)}`));
    grid.appendChild(field('Battery capacity', `${ctx.battery_kwh.toFixed(0)} kWh`));
    grid.appendChild(field('Charging state', ctx.currently_charging ? 'Charging' : 'Idle'));
    grid.appendChild(field('Max charge power', fmtKw(ctx.max_charge_kw)));
    grid.appendChild(field('Max discharge power', fmtKw(ctx.max_discharge_kw)));
    grid.appendChild(field('V2G opted in', ctx.opted_in_v2g ? 'Yes' : 'No'));
    grid.appendChild(field('Flexibility category', ctx.flexibility_category.toUpperCase()));
    grid.appendChild(field('Flexibility score', `${ctx.flexibility_score_kwh.toFixed(1)} kWh`));
  }
  grid.appendChild(field('Dispatch action', meta.label));
  grid.appendChild(field('Power / reduction', action.magnitude_kw != null ? fmtKw(action.magnitude_kw) : '—'));
  grid.appendChild(field('Expected reward', fmtInr(action.payout_inr)));

  $('evProfileReason').textContent = action.reason || '—';

  $('evProfilePanel').classList.add('open');
  $('evProfileScrim').classList.add('show');
}

export function closeEvProfile() {
  $('evProfilePanel')?.classList.remove('open');
  $('evProfileScrim')?.classList.remove('show');
}

export function initEvProfile() {
  $('evProfileClose')?.addEventListener('click', closeEvProfile);
  $('evProfileScrim')?.addEventListener('click', closeEvProfile);
}
