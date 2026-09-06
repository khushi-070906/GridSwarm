/* ==========================================================================
   navigation.js — sidebar view switching + mobile drawer. No API calls,
   no rendering of business data — just which <section class="view"> shows.
   ========================================================================== */
import { $, qsa } from './utils.js';

const VIEW_TITLES = {
  'command': 'Command Center',
  'fleet-overview': 'Fleet Overview',
  'fleet-vehicles': 'Vehicles',
  'grid-events': 'Grid Events',
  'grid-response': 'Grid Response',
  'dispatch': 'Dispatch Decisions',
  'activity': 'Activity',
  'rewards': 'Rewards & Incentives',
};

export function initNavigation() {
  qsa('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showView(link.dataset.view);
      closeDrawer();
    });
  });

  $('drawerToggle')?.addEventListener('click', toggleDrawer);
  $('sidebarBackdrop')?.addEventListener('click', closeDrawer);

  const requested = (location.hash || '').replace('#', '');
  showView(VIEW_TITLES[requested] ? requested : 'command');
}

export function showView(view) {
  if (!VIEW_TITLES[view]) view = 'command';
  qsa('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  qsa('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view === view));
  const title = $('topbarTitle');
  if (title) title.textContent = VIEW_TITLES[view];
  history.replaceState(null, '', `#${view}`);
}

function toggleDrawer() {
  $('sidebar')?.classList.toggle('open');
  $('sidebarBackdrop')?.classList.toggle('show');
}
function closeDrawer() {
  $('sidebar')?.classList.remove('open');
  $('sidebarBackdrop')?.classList.remove('show');
}
