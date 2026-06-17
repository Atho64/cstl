// @module app.ts — Entry point: bootstraps the application on DOMContentLoaded
// All business logic lives in the other modules in this directory.

import { init } from './ui-init';

document.addEventListener('DOMContentLoaded', () => init());
