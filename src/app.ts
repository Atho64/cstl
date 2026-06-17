// @module app.ts — Entry point: bootstraps the application on DOMContentLoaded
// All business logic lives in the other modules in this directory.

window.onerror = function(message, source, lineno, colno, error) {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:red;color:white;z-index:9999;padding:10px;font-family:monospace;white-space:pre-wrap;';
  errDiv.textContent = `Error: ${message}\nSource: ${source}\nLine: ${lineno}:${colno}\nStack: ${error?.stack}`;
  document.body.appendChild(errDiv);
};

window.addEventListener('unhandledrejection', function(event) {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:50px;left:0;width:100%;background:darkred;color:white;z-index:9999;padding:10px;font-family:monospace;white-space:pre-wrap;';
  errDiv.textContent = `Unhandled Promise Rejection: ${event.reason?.message || event.reason}\nStack: ${event.reason?.stack}`;
  document.body.appendChild(errDiv);
});

import { init } from './ui-init';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init());
} else {
  init();
}
