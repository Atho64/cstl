// @module shortcuts.js — Keyboard shortcut parsing, formatting, and binding

import { ui } from './state.js';

export function normalizeShortcutKeyName(key) {
  const raw = String(key || "").trim();
  const lower = raw.toLowerCase();
  const aliases = {
    " ": "Space",
    space: "Space",
    esc: "Escape",
    escape: "Escape",
    up: "ArrowUp",
    arrowup: "ArrowUp",
    down: "ArrowDown",
    arrowdown: "ArrowDown",
    left: "ArrowLeft",
    arrowleft: "ArrowLeft",
    right: "ArrowRight",
    arrowright: "ArrowRight",
  };
  if (aliases[lower]) return aliases[lower];
  if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
  if (raw.length === 1) return raw.toUpperCase();
  return raw;
}

export function normalizeShortcutEventKey(event) {
  const code = String(event.code || "");
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return normalizeShortcutKeyName(event.key);
}

export function parseShortcutString(value) {
  const parts = String(value || "").split("+").map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const parsed = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") parsed.ctrl = true;
    else if (lower === "alt" || lower === "option") parsed.alt = true;
    else if (lower === "shift") parsed.shift = true;
    else if (["meta", "cmd", "command", "win", "windows"].includes(lower)) parsed.meta = true;
    else if (!parsed.key) parsed.key = normalizeShortcutKeyName(part);
    else return null;
  }
  if (!parsed.key || !(parsed.ctrl || parsed.alt || parsed.shift || parsed.meta)) return null;
  return parsed;
}

export function formatShortcut(shortcut) {
  if (!shortcut) return "";
  const parts = [];
  if (shortcut.ctrl) parts.push("Ctrl");
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.meta) parts.push("Meta");
  parts.push(normalizeShortcutKeyName(shortcut.key));
  return parts.join("+");
}

export function normalizeShortcutString(value, fallback) {
  return formatShortcut(parseShortcutString(value)) || fallback;
}

export function isReservedShortcut(shortcutString) {
  return ["Ctrl+ArrowUp", "Ctrl+ArrowDown"].includes(normalizeShortcutString(shortcutString, ""));
}

export function shortcutFromEvent(event) {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  if (!(event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)) return null;
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key: normalizeShortcutEventKey(event),
  };
}

export function eventMatchesShortcut(event, shortcutString) {
  const expected = parseShortcutString(shortcutString);
  const actual = shortcutFromEvent(event);
  return !!expected && !!actual &&
    expected.ctrl === actual.ctrl &&
    expected.alt === actual.alt &&
    expected.shift === actual.shift &&
    expected.meta === actual.meta &&
    expected.key === actual.key;
}

export function bindShortcutCaptureInput(input) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      input.value = "";
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) {
      flashHint("Shortcut harus memakai Ctrl, Alt, Shift, atau Meta.", false);
      return;
    }
    input.value = formatShortcut(shortcut);
  });
}
