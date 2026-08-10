// @module file-list.ts — File List Manager: add, delete, reorder files with undo/redo
//
// This module provides the File List modal that lets users manage the files
// within a project. It supports:
//   - Adding files (via import)
//   - Deleting files (single or multi-select)
//   - Reordering files via drag-and-drop
//   - Undo/redo for all file operations
//
// Undo/redo for file actions is integrated with the existing line-level
// undo/redo system. File action snapshots are stored alongside line snapshots
// in the same undo/redo stacks, but with a `fileAction` field that signals
// they are file-level operations.

import { state, ui } from './state';
import { openModal, closeModal, queueAutoSave } from './project';
import { onImportFileChange } from './import-source';
import { rebuildDisplayState, renderPreviewRows, refreshAll } from './render';
import type { FileActionSnapshot, Line } from './types';
import { windowsFileOrderCompare } from './string-utils';

// ─── Module state ──────────────────────────────────────────────────────────────

let _draggingIndex = -1;

// ─── Public API ────────────────────────────────────────────────────────────────

/** Open the File List modal and render the current file list. */
export function openFileListModal(): void {
  const modal = ui.fileListModal as HTMLElement | undefined;
  if (!modal) return;
  renderFileList();
  openModal(modal);
}

/** Close the File List modal. */
export function closeFileListModal(): void {
  const modal = ui.fileListModal as HTMLElement | undefined;
  if (!modal) return;
  closeModal(modal);
}

/** Render the file list into the container. */
export function renderFileList(): void {
  const container = ui.fileListContainer as HTMLElement | undefined;
  if (!container) return;

  // Determine display order: use fileOrder if populated, otherwise sort
  const orderedFiles = getFileDisplayOrder();

  // Build a map of file -> line count for display
  const lineCounts = new Map<string, number>();
  for (const line of state.lines) {
    const f = line.file;
    lineCounts.set(f, (lineCounts.get(f) || 0) + 1);
  }

  container.innerHTML = '';

  if (orderedFiles.length === 0) {
    container.innerHTML = '<div class="hint p-3">Belum ada file di proyek ini.</div>';
    return;
  }

  for (let i = 0; i < orderedFiles.length; i++) {
    const fileName = orderedFiles[i];
    const count = lineCounts.get(fileName) || 0;
    const item = createFileListItem(fileName, count, i);
    container.appendChild(item);
  }

  // Update delete button state
  updateDeleteButtonState();
}

/** Get the current file display order, using fileOrder if populated. */
export function getFileDisplayOrder(): string[] {
  if (state.fileOrder && state.fileOrder.length > 0) {
    // Ensure all imported files are in fileOrder (sync)
    const orderSet = new Set(state.fileOrder);
    const missing = state.importedFiles.filter(f => !orderSet.has(f));
    if (missing.length > 0) {
      // Append missing files to the order
      state.fileOrder = [...state.fileOrder, ...missing];
    }
    // Filter out any files in fileOrder that are no longer in importedFiles
    state.fileOrder = state.fileOrder.filter(f => state.importedFiles.includes(f));
    return [...state.fileOrder];
  }
  // Fallback: sort using windowsFileOrderCompare
  return [...state.importedFiles].sort(windowsFileOrderCompare);
}

/** Add a file — triggers the import file dialog. */
export function onAddFile(): void {
  const input = ui.importFileInput as HTMLInputElement | undefined;
  if (input) {
    // Use a separate picker so the permanent toolbar change listener does not
    // process the same selection alongside this undo-aware handler.
    const picker = input.cloneNode(false) as HTMLInputElement;
    picker.removeAttribute('id');
    picker.onchange = async (e) => {
      // Capture state BEFORE import for undo
      const prevImportedFiles = [...state.importedFiles];
      const prevFileOrder = [...state.fileOrder];

      await onImportFileChange(e);

      // Determine which files were added
      const addedFiles = state.importedFiles.filter(f => !prevImportedFiles.includes(f));
      const addedLines = state.lines.filter(l => addedFiles.includes(l.file));

      if (addedFiles.length > 0) {
        // Push undo snapshot for add action
        const snapshot: FileActionSnapshot = {
          type: 'add',
          files: addedFiles,
          addedLines: addedLines,
          prevImportedFiles: prevImportedFiles,
          newImportedFiles: [...state.importedFiles],
          prevFileOrder: prevFileOrder,
          newFileOrder: [...state.fileOrder],
        };
        state.undoStack.push({
          lines: [],
          fileAction: snapshot,
        });
        state.redoStack = [];
        if (ui.btnRedo) (ui.btnRedo as HTMLButtonElement).disabled = true;
        if (ui.btnUndo) (ui.btnUndo as HTMLButtonElement).disabled = false;
        if (state.undoStack.length > 100) state.undoStack.shift();

        syncFileOrder();
        refreshAll();
        queueAutoSave();
      }

      // Re-render the list
      renderFileList();
    };
    picker.click();
  }
}

/** Delete selected files. */
export function onDeleteSelectedFiles(): void {
  const checkboxes = (ui.fileListContainer as HTMLElement).querySelectorAll<HTMLInputElement>(
    '.file-list-item .file-checkbox:checked'
  );
  if (checkboxes.length === 0) return;

  const filesToDelete = Array.from(checkboxes).map(cb => {
    const item = cb.closest('.file-list-item') as HTMLElement;
    return item.dataset.file as string;
  });

  if (!confirm(`Hapus ${filesToDelete.length} file dari proyek ini? Semua baris terkait akan dihapus.`)) {
    return;
  }

  // Capture state for undo BEFORE making changes
  const prevImportedFiles = [...state.importedFiles];
  const prevFileOrder = [...state.fileOrder];
  const removedLines = state.lines.filter(l => filesToDelete.includes(l.file));
  const prevLines = [...state.lines];

  // Remove lines belonging to deleted files
  state.lines = state.lines.filter(l => !filesToDelete.includes(l.file));

  // Remove files from importedFiles and fileOrder
  state.importedFiles = state.importedFiles.filter(f => !filesToDelete.includes(f));
  state.fileOrder = state.fileOrder.filter(f => !filesToDelete.includes(f));

  // Clear selection
  state.selectedLines.clear();

  // Push undo snapshot with file action
  const snapshot: FileActionSnapshot = {
    type: 'remove',
    files: filesToDelete,
    removedLines: removedLines,
    prevImportedFiles: prevImportedFiles,
    newImportedFiles: [...state.importedFiles],
    prevFileOrder: prevFileOrder,
    newFileOrder: [...state.fileOrder],
  };
  state.undoStack.push({
    lines: [],
    fileAction: snapshot,
  });
  state.redoStack = [];
  if (ui.btnRedo) (ui.btnRedo as HTMLButtonElement).disabled = true;
  if (ui.btnUndo) (ui.btnUndo as HTMLButtonElement).disabled = false;
  if (state.undoStack.length > 100) state.undoStack.shift();

  // Refresh UI
  refreshAll();
  queueAutoSave();
  renderFileList();
  updateDeleteButtonState();
}

/** Sync fileOrder with importedFiles — add any missing files. */
export function syncFileOrder(): void {
  if (state.importedFiles.length === 0) {
    state.fileOrder = [];
    return;
  }
  const orderSet = new Set(state.fileOrder);
  const missing = state.importedFiles.filter(f => !orderSet.has(f));
  if (missing.length > 0) {
    state.fileOrder = [...state.fileOrder, ...missing];
  }
  // Remove files no longer in importedFiles
  state.fileOrder = state.fileOrder.filter(f => state.importedFiles.includes(f));
}

/** Apply the current fileOrder to the display state. */
export function applyFileOrder(): void {
  rebuildDisplayState();
  renderPreviewRows();
  queueAutoSave();
}

// ─── Drag & Drop (multi-item) ──────────────────────────────────────────────────

let _draggingItems: HTMLElement[] = [];

/** Handle drag start on a file list item. Supports multi-drag via checkboxes. */
export function onFileDragStart(e: DragEvent, index: number, item: HTMLElement): void {
  const container = ui.fileListContainer as HTMLElement;
  const checkboxes = container.querySelectorAll<HTMLInputElement>('.file-list-item .file-checkbox:checked');

  if (checkboxes.length > 1) {
    // Multi-drag: drag all checked items
    _draggingItems = [];
    for (const cb of Array.from(checkboxes)) {
      const row = cb.closest('.file-list-item') as HTMLElement;
      if (row) _draggingItems.push(row);
    }
  } else {
    // Single drag
    _draggingItems = [item];
  }

  for (const it of _draggingItems) it.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Required for Firefox / some browsers to initiate drag
  try { e.dataTransfer.setData('text/plain', _draggingItems.map(i => i.dataset.file).join(',')); } catch (_) {}

  // Transparent drag image
  const img = new Image();
  img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  e.dataTransfer.setDragImage(img, 0, 0);
}

/** Handle drag over a file list item (for reordering). */
export function onFileDragOver(e: DragEvent, index: number, item: HTMLElement): void {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // Don't process if hovering over one of the dragging items
  if (_draggingItems.includes(item)) return;

  const rect = item.getBoundingClientRect();
  const afterElement = (e.clientY - rect.top) > (rect.height / 2);

  const parent = item.parentNode as HTMLElement;
  if (!parent) return;

  if (afterElement) {
    // Insert all dragging items after this item
    let ref = item.nextSibling;
    for (const it of _draggingItems) {
      parent.insertBefore(it, ref);
      ref = it.nextSibling;
    }
  } else {
    // Insert all dragging items before this item
    let ref = item;
    for (const it of _draggingItems) {
      parent.insertBefore(it, ref);
      ref = it;
    }
  }
}

/** Handle drag end — finalize the reorder. */
export function onFileDragEnd(e: DragEvent): void {
  for (const it of _draggingItems) it.classList.remove('dragging');
  _draggingItems = [];

  // Read the new order from the DOM
  const container = ui.fileListContainer as HTMLElement;
  const items = container.querySelectorAll<HTMLElement>('.file-list-item');
  const newOrder = Array.from(items).map(item => item.dataset.file as string);

  // Only push undo snapshot if order actually changed
  const oldOrder = getFileDisplayOrder();
  if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
    state.fileOrder = newOrder;

    // Push undo snapshot
    const snapshot: FileActionSnapshot = {
      type: 'reorder',
      files: newOrder,
      prevOrder: oldOrder,
      newOrder: newOrder,
      prevImportedFiles: [...state.importedFiles],
      newImportedFiles: [...state.importedFiles],
      prevFileOrder: oldOrder,
      newFileOrder: newOrder,
    };
    state.undoStack.push({
      lines: [],
      fileAction: snapshot,
    });
    state.redoStack = [];
    if (ui.btnRedo) (ui.btnRedo as HTMLButtonElement).disabled = true;
    if (ui.btnUndo) (ui.btnUndo as HTMLButtonElement).disabled = false;
    if (state.undoStack.length > 100) state.undoStack.shift();

    // Apply the new order to the display and persist it.
    applyFileOrder();
    queueAutoSave();
  }
}

// ─── Helper: Create a file list item element ───────────────────────────────────

function createFileListItem(fileName: string, count: number, index: number): HTMLElement {
  const item = document.createElement('div');
  item.className = 'file-list-item';
  item.dataset.file = fileName;
  item.draggable = true;

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.innerHTML = '&#8942;'; // ⋮ (vertical dots drag handle)
  handle.title = 'Seret untuk mengubah urutan';

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'file-checkbox';
  checkbox.addEventListener('change', () => updateDeleteButtonState());

  // File name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-name';
  nameSpan.textContent = fileName;
  nameSpan.title = fileName;

  // Line count
  const countSpan = document.createElement('span');
  countSpan.className = 'file-count';
  countSpan.textContent = `${count} baris`;

  // Drag events
  item.addEventListener('dragstart', (e) => onFileDragStart(e, index, item));
  item.addEventListener('dragenter', (e) => e.preventDefault());
  item.addEventListener('dragover', (e) => onFileDragOver(e, index, item));
  item.addEventListener('dragend', (e) => onFileDragEnd(e));

  item.append(handle, checkbox, nameSpan, countSpan);
  return item;
}

// ─── Helper: Update delete button state ────────────────────────────────────────

function updateDeleteButtonState(): void {
  const btn = ui.btnFileListDelete as HTMLButtonElement | undefined;
  if (!btn) return;
  const container = ui.fileListContainer as HTMLElement;
  const checked = container.querySelectorAll('.file-checkbox:checked');
  btn.disabled = checked.length === 0;
}

// ─── Undo/Redo support for file actions ────────────────────────────────────────

/**
 * Check if the top of the undo stack is a file action.
 * Returns the file action snapshot if so, null otherwise.
 */
export function peekFileUndoAction(): FileActionSnapshot | null {
  if (state.undoStack.length === 0) return null;
  const top = state.undoStack[state.undoStack.length - 1];
  return top.fileAction || null;
}

/**
 * Check if the top of the redo stack is a file action.
 */
export function peekFileRedoAction(): FileActionSnapshot | null {
  if (state.redoStack.length === 0) return null;
  const top = state.redoStack[state.redoStack.length - 1];
  return top.fileAction || null;
}

/**
 * Apply a file action snapshot (used by undo/redo).
 * This restores importedFiles, fileOrder, and lines to their previous state.
 */
export function applyFileAction(action: FileActionSnapshot): void {
  if (action.type === 'remove') {
    // Undo: restore removed files and lines
    if (action.prevImportedFiles) state.importedFiles = [...action.prevImportedFiles];
    if (action.prevFileOrder) state.fileOrder = [...action.prevFileOrder];
    if (action.removedLines) {
      // Restore removed lines — insert them back
      state.lines = [...state.lines, ...action.removedLines];
      // Re-sort lines by line_num to maintain order
      state.lines.sort((a, b) => a.line_num - b.line_num);
    }
  } else if (action.type === 'reorder') {
    // Undo: restore previous order
    if (action.prevOrder) state.fileOrder = [...action.prevOrder];
    if (action.prevImportedFiles) state.importedFiles = [...action.prevImportedFiles];
  } else if (action.type === 'add') {
    // Undo: remove added files and their lines
    if (action.prevImportedFiles) state.importedFiles = [...action.prevImportedFiles];
    if (action.prevFileOrder) state.fileOrder = [...action.prevFileOrder];
    if (action.addedLines && action.addedLines.length > 0) {
      const addedLineNums = new Set(action.addedLines.map(l => l.line_num));
      state.lines = state.lines.filter(l => !addedLineNums.has(l.line_num));
    }
  }
}

/**
 * Redo a file action (used by redo).
 */
export function redoFileAction(action: FileActionSnapshot): void {
  if (action.type === 'remove') {
    // Redo: remove files again
    if (action.newImportedFiles) state.importedFiles = [...action.newImportedFiles];
    if (action.newFileOrder) state.fileOrder = [...action.newFileOrder];
    // Remove the lines that were deleted
    if (action.removedLines && action.removedLines.length > 0) {
      const removedLineNums = new Set(action.removedLines.map(l => l.line_num));
      state.lines = state.lines.filter(l => !removedLineNums.has(l.line_num));
    }
  } else if (action.type === 'reorder') {
    // Redo: apply new order
    if (action.newOrder) state.fileOrder = [...action.newOrder];
    if (action.newImportedFiles) state.importedFiles = [...action.newImportedFiles];
  } else if (action.type === 'add') {
    // Redo: re-add files and their lines
    if (action.newImportedFiles) state.importedFiles = [...action.newImportedFiles];
    if (action.newFileOrder) state.fileOrder = [...action.newFileOrder];
    if (action.addedLines && action.addedLines.length > 0) {
      state.lines = [...state.lines, ...action.addedLines];
      state.lines.sort((a, b) => a.line_num - b.line_num);
    }
  }
}
