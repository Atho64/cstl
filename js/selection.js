// @module selection.js — Line selection management, batch select, and history

import { state, ui, getMainScroller, incrementHintToken, getHintToken } from './state.js';
import { isTranslated } from './state.js';
import { eventMatchesShortcut } from './shortcuts.js';
import { DEFAULT_GLOSSARY_BATCH_SIZE, DEFAULT_AI_CHECK_BATCH_SIZE, DEFAULT_SELECTION_BATCH_SIZE } from './constants.js';

// ─── Utility: normalizeSelectionBatchSize ─────────────────────────────────────
// Kept here to avoid circular deps with project.js or render.js
export function normalizeSelectionBatchSize(value, fallback = DEFAULT_SELECTION_BATCH_SIZE) {
  const n = parseInt(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── Utility: flashHint (standalone, no circular import) ────────────────────
// Light re-implementation to break selection.js → render.js cycle
function flashHint(msg, keepAlive = false) {
  // Will delegate to render.js flashHint if available, otherwise basic implementation
  import('./render.js').then(m => m.flashHint(msg, keepAlive)).catch(() => console.log('[hint]', msg));
}

// ─── Utility: syncCheckboxUI and updateButtonStates ──────────────────────────
// Lazily imported to break circular dependency with render.js
function syncCheckboxUI() {
  import('./render.js').then(m => m.syncCheckboxUI());
}


export function isSelectableForActiveTab(line) {
  if (!line || line._hidden) return false;
  if (state.activeWorkspaceTab === "aiCheck" || state.activeWorkspaceTab === "delete") return isTranslated(line);
  if (state.activeWorkspaceTab === "translate") return !isTranslated(line);
  return true;
}

export function pruneSelectionForActiveTab() {
  for (const num of Array.from(state.selectedLines)) {
    const line = state.lineByNum.get(num);
    if (!isSelectableForActiveTab(line)) state.selectedLines.delete(num);
  }
}

export function getSelectionHistorySnapshot() {
  return Array.from(state.selectedLines)
    .map(Number)
    .filter(num => Number.isFinite(num) && isSelectableForActiveTab(state.lineByNum.get(num)))
    .sort((a, b) => a - b);
}

export function selectionSnapshotsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((num, index) => num === b[index]);
}

export function resetSelectionHistory() {
  state.selectionHistory = [];
  state.selectionHistoryIndex = -1;
  recordSelectionHistory();
}

export function recordSelectionHistory() {
  const snapshot = getSelectionHistorySnapshot();
  const currentSnapshot = state.selectionHistory[state.selectionHistoryIndex];
  if (selectionSnapshotsEqual(snapshot, currentSnapshot)) return;
  if (state.selectionHistoryIndex < state.selectionHistory.length - 1) {
    state.selectionHistory.splice(state.selectionHistoryIndex + 1);
  }
  state.selectionHistory.push(snapshot);
  state.selectionHistoryIndex = state.selectionHistory.length - 1;
}

export function restoreSelectionHistory(direction) {
  if (!state.currentProjectId || !state.lines.length) return false;
  const nextIndex = state.selectionHistoryIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.selectionHistory.length) return false;

  state.selectionHistoryIndex = nextIndex;
  state.selectedLines.clear();
  for (const num of state.selectionHistory[nextIndex]) {
    const line = state.lineByNum.get(num);
    if (isSelectableForActiveTab(line)) state.selectedLines.add(num);
  }
  syncCheckboxUI();

  let firstSelected = null;
  for (const num of state.selectedLines) {
    if (firstSelected === null || num < firstSelected) firstSelected = num;
  }
  if (firstSelected !== null) scrollPreviewToLine(firstSelected);
  return true;
}

export function scrollPreviewToLine(lineNum) {
  const mainScroller = getMainScroller();
  if (!mainScroller) return;
  const targetIndex = state.displayRows.findIndex(row => row.type === "line" && row.line.line_num === lineNum);
  if (targetIndex === -1) return;
  mainScroller.scrollToIndex(targetIndex);
  setTimeout(() => {
    const targetEl = document.querySelector(`input[data-num="${lineNum}"]`);
    const rowEl = targetEl?.closest(".preview-row");
    if (rowEl) rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 50);
}

export function isEditableShortcutTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("textarea, select, [contenteditable]")) return true;
  const input = target.closest("input");
  if (!input) return false;
  const type = (input.type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "submit", "reset"].includes(type);
}

export function getActiveBatchConfig() {
  if (state.activeWorkspaceTab === "glossary") {
    return {
      lines: state.lines.filter(l => !l._hidden),
      batchSize: normalizeSelectionBatchSize(state.glossaryBatchSize, DEFAULT_GLOSSARY_BATCH_SIZE),
      emptyMessage: "Tidak ada baris untuk Glossary Extractor.",
      tabLabel: "Glossary Extractor",
    };
  }
  if (state.activeWorkspaceTab === "aiCheck") {
    return {
      lines: state.lines.filter(l => isTranslated(l) && !l._hidden),
      batchSize: normalizeSelectionBatchSize(state.aiCheckBatchSize, DEFAULT_AI_CHECK_BATCH_SIZE),
      emptyMessage: "Tidak ada baris terjemahan untuk AI Check.",
      tabLabel: "AI Check",
    };
  }
  return {
    lines: state.lines.filter(l => !isTranslated(l) && !l._hidden),
    batchSize: normalizeSelectionBatchSize(state.selectionBatchSize),
    emptyMessage: "Tidak ada baris belum diterjemahkan.",
    tabLabel: "Translate",
  };
}

export function selectActiveWorkspaceBatch(direction) {
  if (!state.currentProjectId || !state.lines.length) return false;
  const config = getActiveBatchConfig();
  const selectableLines = config.lines;
  if (!selectableLines.length) {
    flashHint(config.emptyMessage, false);
    return true;
  }

  const selectedInScope = selectableLines.filter(l => state.selectedLines.has(l.line_num));
  let startIndex = 0;

  if (direction > 0) {
    if (selectedInScope.length) {
      const maxSelected = Math.max(...selectedInScope.map(l => l.line_num));
      startIndex = selectableLines.findIndex(l => l.line_num > maxSelected);
      if (startIndex === -1) {
        flashHint("Sudah di batch terakhir.", false);
        return true;
      }
    }
  } else {
    if (!selectedInScope.length) {
      flashHint("Belum ada batch sebelumnya.", false);
      return true;
    }
    const minSelected = Math.min(...selectedInScope.map(l => l.line_num));
    const currentIndex = selectableLines.findIndex(l => l.line_num >= minSelected);
    if (currentIndex <= 0) {
      flashHint("Sudah di batch pertama.", false);
      return true;
    }
    startIndex = Math.max(0, currentIndex - config.batchSize);
  }

  const batch = selectableLines.slice(startIndex, startIndex + config.batchSize);
  if (!batch.length) return true;

  state.selectedLines.clear();
  for (const line of batch) state.selectedLines.add(line.line_num);
  recordSelectionHistory();
  syncCheckboxUI();
  scrollPreviewToLine(batch[0].line_num);
  flashHint(`Dipilih ${batch.length} baris untuk ${config.tabLabel}.`);
  return true;
}

export function onSelectionHistoryKeydown(event) {
  if (isEditableShortcutTarget(event.target)) return;

  const isPrevBatchShortcut = eventMatchesShortcut(event, state.selectionBatchPrevShortcut);
  const isNextBatchShortcut = eventMatchesShortcut(event, state.selectionBatchNextShortcut);
  if (isPrevBatchShortcut || isNextBatchShortcut) {
    event.preventDefault();
    if (event.repeat) return;
    selectActiveWorkspaceBatch(isNextBatchShortcut ? 1 : -1);
    return;
  }

  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const direction = event.key === "ArrowUp" ? -1 : 1;
  if (restoreSelectionHistory(direction)) event.preventDefault();
}
