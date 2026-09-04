/* ==========================================================================
   main.js — entry point loaded by index.html. Imports every view module
   so each calls registerView() as a side effect, then boots navigation,
   settings, health checks, and the scenario control bar.
   ========================================================================== */
import { initSettings, checkHealth, initScenarioControls } from './app.js';
import { initNavigation } from './navigation.js';
import { initEvProfile } from './ev-profile.js';

import './dashboard.js';
import './grid.js';
import './fleet.js';
import './dispatch.js';
import './rewards.js';
import './activity.js';

initSettings();
initEvProfile();
initNavigation();
initScenarioControls();
checkHealth();
setInterval(checkHealth, 8000);
