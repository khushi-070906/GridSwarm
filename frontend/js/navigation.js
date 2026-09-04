/* ==========================================================================
   navigation.js — sidebar nav + view switching. Pure UI routing: knows
   nothing about backend data, just which view is active and calls that
   view's render(store) function on mount and whenever the store updates.
   ========================================================================== */
import { $, qsa, el } from './utils.js';
import { store, subscribe } from './app.js';

const NAV = [
  { group: 'Overview', items: [
    { id: 'command-center', label: 'Command Center', ic: '◈' },
  ]},
  { group: 'Fleet', items: [
    { id: 'fleet', label: 'Fleet Overview', ic: '▤' },
    { id: 'vehicles', label: 'Vehicles', ic: '▭' },
  ]},
  { group: 'Grid', items: [
    { id: 'grid', label: 'Grid Response', ic: '≋' },
  ]},
  { group: 'Operations', items: [
    { id: 'dispatch', label: 'Dispatch', ic: '⇄' },
    { id: 'activity', label: 'Activity', ic: '▤' },
  ]},
  { group: 'Finance', items: [
    { id: 'rewards', label: 'Rewards', ic: '₹' },
  ]},
];

const renderers = {}; // id -> render(store) fn, registered by view modules
let activeId = 'command-center';

export function registerView(id, renderFn) {
  renderers[id] = renderFn;
}

function buildSidebarNav() {
  const nav = $('sidebarNav');
  nav.innerHTML = '';
  NAV.forEach(group => {
    const g = el('div', { class: 'nav-group' });
    const title = el('div', { class: 'nav-group-title' });
    title.textContent = group.group;
    g.appendChild(title);
    group.items.forEach(item => {
      const link = el('div', { class: 'nav-link' + (item.id === activeId ? ' active' : ''), 'data-view': item.id, role: 'button', tabindex: '0' });
      link.innerHTML = `<span class="ic">${item.ic}</span><span>${item.label}</span>`;
      link.addEventListener('click', () => switchView(item.id));
      g.appendChild(link);
    });
    nav.appendChild(g);
  });
}

function viewLabel(id) {
  for (const group of NAV) {
    const found = group.items.find(i => i.id === id);
    if (found) return found.label;
  }
  return id;
}

export function switchView(id) {
  if (!document.getElementById(`view-${id}`)) return;
  activeId = id;
  qsa('.view').forEach(v => v.classList.remove('active'));
  $(`view-${id}`).classList.add('active');
  qsa('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view === id));
  const mobileTitle = $('mobileViewTitle');
  if (mobileTitle) mobileTitle.textContent = viewLabel(id);
  location.hash = id;
  closeDrawer();
  if (renderers[id]) renderers[id](store);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function openDrawer() { $('sidebar').classList.add('open'); $('drawerScrim').classList.add('show'); }
function closeDrawer() { $('sidebar')?.classList.remove('open'); $('drawerScrim')?.classList.remove('show'); }

export function initNavigation() {
  buildSidebarNav();
  const hamburger = $('hamburgerBtn');
  if (hamburger) hamburger.addEventListener('click', openDrawer);
  const scrim = $('drawerScrim');
  if (scrim) scrim.addEventListener('click', closeDrawer);

  const initial = (location.hash || '').replace('#', '') || 'command-center';
  switchView(document.getElementById(`view-${initial}`) ? initial : 'command-center');

  // Lets plain <a href="#dispatch"> deep links (e.g. the Command Center's
  // "View full dispatch decision" link) drive the same view switch as a
  // sidebar click, instead of just changing the URL.
  window.addEventListener('hashchange', () => {
    const id = (location.hash || '').replace('#', '');
    if (id && id !== activeId) switchView(id);
  });

  // Re-render whichever view is currently visible whenever the shared
  // store changes (e.g. after a scenario run), so every view always
  // reflects the latest DispatchPlan without polling on its own.
  subscribe((s) => { if (renderers[activeId]) renderers[activeId](s); });
}
