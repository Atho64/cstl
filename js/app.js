// @module app.js — Entry point: bootstraps the application on DOMContentLoaded
// All business logic lives in the other modules in this directory.

import { init } from './ui-init.js';

document.addEventListener("DOMContentLoaded", () => init());
