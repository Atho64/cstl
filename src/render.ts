// @module render.ts — Main rendering, virtual scroller callbacks, status bar, undo, flashHint

import { state, ui, getMainScroller, incrementHintToken, getHintToken } from './state';
import { isTranslated } from './state';
import { APP_VERSION, MAX_UNDO_STEPS } from './constants';
import { containsJapanese } from './string-utils';
import { formatLineLabel, getLineDisplayName, getActiveLucaProfile } from './luca-engine';
import { isSelectableForActiveTab, recordSelectionHistory } from './selection';
import { openModal, closeModal } from './project';
import { getTranslationPastePlaceholder } from './ai-format';
import { getActiveLineEditorLineNum, setActiveLineEditorLineNum } from './state';
import { isClannadProtagonistToken, parseLucaTxtText, resolveLucaDisplayName } from './luca-engine';
import type { DisplayRow, Line } from './types';

// ─── Lazy helpers (break circular deps) ──────────────────────────────────────
function queueAutoSave() { import('./project').then(m => m.queueAutoSave()); }
function renderGlossaryPreview() { import('./glossary').then(m => m.renderGlossaryPreview()); }

// ─── Display State ────────────────────────────────────────────────────────────

export function rebuildDisplayState(): void {
  state.lineByNum.clear();
  const grouped = new Map<string, Line[]>(state.importedFiles.map(f => [f, []]));
  let cachedRegex: RegExp | null = null;
  if (state.regexFilter) {
    try {
      cachedRegex = new RegExp(state.regexFilter, 'ui');
    } catch (_) {}
  }

  for (const line of state.lines) {
    state.lineByNum.set(line.line_num, line);
    if (!grouped.has(line.file)) grouped.set(line.file, []);

    let shouldHide = false;
    if (state.sourceLang === 'English') {
      if (containsJapanese(line.name || '') || containsJapanese(line.message || '')) {
        shouldHide = true;
      }
    }
    if (!shouldHide && cachedRegex) {
      if (cachedRegex.test(line.name || '') || cachedRegex.test(line.message || '')) shouldHide = true;
    }
    line._hidden = shouldHide;
    if (!shouldHide) grouped.get(line.file)!.push(line);
  }
  state.displayRows = [];
  for (const [fileName, rows] of grouped.entries()) {
    if (!rows.length) continue;
    state.displayRows.push({ type: 'separator', file: fileName });
    for (const line of rows) state.displayRows.push({ type: 'line', line });
  }
}

export function renderPreviewRows(): void {
  const mainScroller = getMainScroller();
  if (mainScroller.items && mainScroller.items.length === state.displayRows.length && mainScroller.items.length > 0) {
    mainScroller.items = state.displayRows;
    mainScroller.render(true);
  } else {
    mainScroller.setItems(state.displayRows);
  }
  updateButtonStates();
}

// ─── Row Renderer (VirtualScroller callback) ──────────────────────────────────

export function renderMainRow(rowData: DisplayRow): HTMLElement {
  const row = document.createElement('div');
  row.className = 'preview-row';
  if (rowData.type === 'separator') {
    row.classList.add('separator');
    const fileLines = state.lines.filter(l => l.file === rowData.file && isSelectableForActiveTab(l));
    const isAllSelected = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    (cb as any).dataset.file = rowData.file;
    cb.checked = isAllSelected;
    cb.addEventListener('change', (e) => {
      const isChecked = (e.target as HTMLInputElement).checked;
      fileLines.forEach(l => {
        if (isChecked) state.selectedLines.add(l.line_num);
        else state.selectedLines.delete(l.line_num);
      });
      recordSelectionHistory();
      syncCheckboxUI();
    });
    const label = document.createElement('div');
    label.className = 'mono grow';
    label.style.fontWeight = '700';
    label.style.color = 'var(--primary)';
    label.textContent = `File: ${rowData.file}`;
    row.append(cb, label);
  } else {
    const line = rowData.line!;
    if (isTranslated(line)) row.classList.add('row-translated');
    const isChecked = state.selectedLines.has(line.line_num);
    if (isChecked) row.classList.add('row-selected');
    const cbWrap = document.createElement('div');
    cbWrap.className = 'checkbox-cell';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    (cb as any).dataset.num = line.line_num;
    cb.checked = isChecked;
    cb.disabled = !isSelectableForActiveTab(line);
    cb.addEventListener('change', (e) => {
      if ((e.target as HTMLInputElement).checked) state.selectedLines.add(line.line_num);
      else state.selectedLines.delete(line.line_num);
      recordSelectionHistory();
      syncCheckboxUI();
    });
    const contentWrap = document.createElement('div');
    contentWrap.className = 'text-content';
    if (line.luca_command === 'SELECT') {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'file-meta';
      metaDiv.textContent = `SELECT choice ${(line.luca_choice_index || 0) + 1}`;
      contentWrap.appendChild(metaDiv);
    }
    const origDiv = document.createElement('div');
    origDiv.className = 'original';
    origDiv.textContent = formatLineLabel(line);
    const transDiv = document.createElement('div');
    transDiv.className = 'translated';
    let tTxt = '——';
    if (isTranslated(line)) {
      tTxt = formatLineLabel(line, { translated: true });
    } else {
      transDiv.classList.add('cell-muted');
    }
    transDiv.textContent = tTxt;
    contentWrap.append(origDiv, transDiv);
    cbWrap.append(cb, contentWrap);
    row.appendChild(cbWrap);
    contentWrap.addEventListener('click', () => openLineEditor(line.line_num));
  }
  return row;
}

// ─── Checkbox Sync ────────────────────────────────────────────────────────────

export function syncCheckboxUI(): void {
  document.querySelectorAll<HTMLInputElement>('.preview-row.separator input[type="checkbox"]').forEach(cb => {
    const fileLines = state.lines.filter(l => l.file === (cb as any).dataset.file && isSelectableForActiveTab(l));
    cb.checked = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
  });
  document.querySelectorAll<HTMLInputElement>('.preview-row:not(.separator) input[type="checkbox"]').forEach(cb => {
    const num = Number((cb as any).dataset.num);
    const isChecked = state.selectedLines.has(num);
    cb.checked = isChecked;
    const row = cb.closest('.preview-row');
    if (isChecked) row?.classList.add('row-selected');
    else row?.classList.remove('row-selected');
  });
  updateButtonStates();
}

// ─── Name Table ────────────────────────────────────────────────────────────────

export function collectCharacterNameRows() {
  const rows = new Map<string, { name: string; lines: Line[]; translatedNames: Set<string> }>();
  for (const line of state.lines) {
    const name = String(line.name || '').trim();
    if (!name) continue;
    if (!rows.has(name)) rows.set(name, { name, lines: [], translatedNames: new Set() });
    const row = rows.get(name)!;
    row.lines.push(line);
    const translatedName = String(line.trans_name || '').trim();
    if (translatedName) row.translatedNames.add(translatedName);
  }
  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function renderNameTable(): void {
  const autoDetectedNames = collectCharacterNameRows();
  (ui.nameTableBody as HTMLElement).textContent = '';
  const frag = document.createDocumentFragment();
  for (const nameRow of autoDetectedNames) {
    const n = nameRow.name;
    const matchingLines = nameRow.lines;
    const translatedNames = Array.from(nameRow.translatedNames);
    const tr = document.createElement('tr');
    const sourceTd = document.createElement('td');
    sourceTd.textContent = n;
    sourceTd.className = 'mono name-source-cell';
    sourceTd.title = 'Klik untuk copy nama ke clipboard';
    sourceTd.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(n);
        flashHint(`Nama "${n}" disalin!`);
      } catch (e) {
        alert('Gagal menyalin teks.');
      }
    });
    const translatedTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-translation-input mono';
    input.placeholder = n;
    input.value = translatedNames.length === 1 ? translatedNames[0] : '';
    input.title = translatedNames.length > 1
      ? `Ada ${translatedNames.length} variasi terjemah nama. Isi untuk menyamakan semuanya.`
      : 'Terjemah nama karakter';
    input.addEventListener('change', () => {
      const nextName = input.value.trim().replace(/\r?\n/g, '\\n');
      const currentNames = Array.from(new Set(matchingLines.map(l => (l.trans_name || '').trim())));
      if (currentNames.length === 1 && currentNames[0] === nextName) return;
      pushUndoSnapshot();
      matchingLines.forEach(line => { line.trans_name = nextName || null; });
      renderPreviewRows();
      queueAutoSave();
      flashHint(nextName ? `Nama "${n}" diganti menjadi "${nextName}".` : `Terjemah nama "${n}" dikosongkan.`);
    });
    translatedTd.appendChild(input);
    tr.append(sourceTd, translatedTd);
    frag.appendChild(tr);
  }
  (ui.nameTableBody as HTMLElement).appendChild(frag);
}

// ─── Status Bar & Refresh ──────────────────────────────────────────────────────

export function updateStatusBar(): void {
  const total = state.lines.length;
  const trans = state.lines.filter(isTranslated).length;
  const perc = total ? Math.floor((trans / total) * 100) : 0;

  let modeText = '-';
  if (state.importedFiles.length > 0) {
    if (state.projectType === 'epub') modeText = 'EPUB';
    else if (state.projectType === 'luca') modeText = `TXT LUCA (${getActiveLucaProfile().shortLabel})`;
    else modeText = 'JSON VNTP';
  }

  (ui.statusBar as HTMLElement).textContent = `${APP_VERSION} | Mode: ${modeText} | File: ${state.importedFiles.length > 1 ? state.importedFiles.length + ' file' : (state.importedFiles[0] || '-')} | Baris: ${total} | TL: ${trans}/${total} (${perc}%)`;
  (ui.progressFill as HTMLElement).style.width = `${perc}%`;
  (ui.progressText as HTMLElement).textContent = `${trans}/${total}`;
}

export function refreshAll(): void {
  rebuildDisplayState();
  renderPreviewRows();
  renderNameTable();
  updateStatusBar();
  (ui.btnUndo as HTMLButtonElement).disabled = state.undoStack.length === 0;
  if (state.translationMode === 'htl') {
    import('./htl-mode').then(m => m.refreshHtlPanels()).catch(() => {});
  }
}

// ─── Undo ─────────────────────────────────────────────────────────────────────

export function pushUndoSnapshot(): void {
  state.undoStack.push({ lines: JSON.parse(JSON.stringify(state.lines)) });
  if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
  (ui.btnUndo as HTMLButtonElement).disabled = false;
}

// ─── Flash Hint ────────────────────────────────────────────────────────────────

export function flashHint(msg: string, keepAlive = false): void {
  (ui.copyStatus as HTMLElement).textContent = msg;
  (ui.copyStatus as HTMLElement).classList.remove('empty');
  const currentToken = incrementHintToken();
  if (!keepAlive) {
    setTimeout(() => {
      if (getHintToken() === currentToken) {
        (ui.copyStatus as HTMLElement).classList.add('empty');
      }
    }, 4000);
  }
}

// ─── Button States ────────────────────────────────────────────────────────────

export function updateButtonStates(): void {
  const hasData = state.lines.length > 0;
  const hasSelection = state.selectedLines.size > 0;
  const nameCount = collectCharacterNameRows().length;
  const translatedNameCount = state.lines.filter(l => (l.name || '').trim() && (l.trans_name || '').trim()).length;
  const untranslatedSelectionCount = state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l)).length;
  const translatedSelectionCount = state.lines.filter(l => state.selectedLines.has(l.line_num) && isTranslated(l)).length;
  const setDisabled = (key: string, val: boolean) => { if (ui[key]) (ui[key] as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement).disabled = val; };
  setDisabled('btnExport', !hasData);
  setDisabled('btnProofread', !hasData);
  setDisabled('btnQaCheck', !hasData);
  setDisabled('btnImportTranslatedFile', !hasData);
  setDisabled('btnImportTranslatedFolder', !hasData);
  setDisabled('btnSelectAll', !hasData);
  setDisabled('btnClearSelection', !hasSelection);
  setDisabled('btnCopyForAi', untranslatedSelectionCount === 0);
  const untranslatedCount = state.lines.filter(l => !isTranslated(l)).length;
  setDisabled('btnAutoTranslate', untranslatedCount === 0);
  setDisabled('btnCopyNamesForAi', nameCount === 0);
  setDisabled('btnResetNameTranslations', translatedNameCount === 0);
  setDisabled('btnCopyForGlossaryAi', !hasSelection);
  const unextractedCount = state.lines.filter(l => !l._glossary_extracted && !l._hidden).length;
  setDisabled('btnAutoGlossaryAi', unextractedCount === 0);
  setDisabled('btnCopyForAiCheck', translatedSelectionCount === 0);
  const uncheckedCount = state.lines.filter(l => isTranslated(l) && !l._ai_checked && !l._hidden).length;
  setDisabled('btnAutoAiCheck', uncheckedCount === 0);
  setDisabled('btnExtractEpubRubyNames', !(state.projectType === 'epub' && state.epubSourceId));
  setDisabled('pasteArea', !hasData);
  setDisabled('pasteNameArea', nameCount === 0);
  setDisabled('pasteGlossaryArea', !hasData);
  setDisabled('btnApply', !hasData);
  setDisabled('btnApplyNameTranslations', nameCount === 0 || !(ui.pasteNameArea as HTMLTextAreaElement)?.value.trim());
  setDisabled('btnSaveGlossary', !hasData);
  setDisabled('btnParseAiCheck', !hasData);
  setDisabled('pasteAiCheckArea', !hasData);
  setDisabled('btnApplyAiCheck', state.aiCheckCorrections.filter(c => c.checked).length === 0);
  setDisabled('btnClearAiCheck', !(ui.pasteAiCheckArea as HTMLTextAreaElement)?.value.trim() && state.aiCheckCorrections.length === 0);
  setDisabled('btnImportGlossaryFile', !state.currentProjectId);
  setDisabled('btnExportGlossaryFile', !state.glossaryText.trim());
  setDisabled('btnDeleteTranslation', translatedSelectionCount === 0);
  setDisabled('rangeFromInput', !hasData);
  setDisabled('rangeToInput', !hasData);
  setDisabled('btnSelectRange', !hasData);
  if (ui.copyCount) (ui.copyCount as HTMLElement).textContent = String(untranslatedSelectionCount);
  if (ui.copyNameCount) (ui.copyNameCount as HTMLElement).textContent = String(nameCount);
  if (ui.copyGlossaryCount) (ui.copyGlossaryCount as HTMLElement).textContent = String(state.selectedLines.size);
  if (ui.deleteTranslationCount) (ui.deleteTranslationCount as HTMLElement).textContent = String(translatedSelectionCount);
  if (ui.copyAiCheckCount) (ui.copyAiCheckCount as HTMLElement).textContent = String(translatedSelectionCount);
  renderGlossaryPreview();
  if (ui.pasteArea) (ui.pasteArea as HTMLTextAreaElement).placeholder = getTranslationPastePlaceholder();
}

// ─── Line Editor ──────────────────────────────────────────────────────────────

export function openLineEditor(num: number): void {
  const l = state.lineByNum.get(num);
  if (!l) return;
  setActiveLineEditorLineNum(num);
  (ui.lineEditorTitle as HTMLElement).textContent = l.luca_command === 'SELECT'
    ? `Edit Baris ${num} - Select Choice ${(l.luca_choice_index || 0) + 1}`
    : `Edit Baris ${num}`;
  const displayName = getLineDisplayName(l);
  (ui.lineOriginalView as HTMLInputElement).value = displayName ? `${displayName}: ${l.message}` : `${l.message}`;
  const hideMcName = isClannadProtagonistToken(l.name) && getActiveLucaProfile().nameAtFormat;
  (ui.lineNameWrap as HTMLElement).style.display = l.name && !hideMcName ? 'block' : 'none';
  (ui.lineNameInput as HTMLInputElement).value = l.name && !hideMcName ? (l.trans_name || '') : '';
  if (l.name && !hideMcName) (ui.lineNameInput as HTMLInputElement).placeholder = l.name;
  (ui.lineMessageInput as HTMLTextAreaElement).value = (l.trans_message || '').trim();
  (ui.lineTranslatedCheck as HTMLInputElement).checked = isTranslated(l);
  // LucaSystem reference languages
  if (state.projectType === 'luca' && (l.luca_en || l.luca_zh || l.luca_jp)) {
    const profile = getActiveLucaProfile();
    if (profile.hasMultiLangRef) {
      if (l.luca_command === 'SELECT') {
        (ui.lineRefEnView as HTMLInputElement).value = l.luca_en || '';
        (ui.lineRefZhView as HTMLInputElement).value = l.luca_zh || '';
      } else {
        const { name: enName, text: enText } = parseLucaTxtText(l.luca_en || '');
        const { name: zhName, text: zhText } = parseLucaTxtText(l.luca_zh || '');
        (ui.lineRefEnView as HTMLInputElement).value = enName ? `${enName}: ${enText}` : enText;
        (ui.lineRefZhView as HTMLInputElement).value = zhName ? `${zhName}: ${zhText}` : zhText;
      }
      (ui.lucaRefWrap as HTMLElement).style.display = 'block';
    } else if (l.luca_command === 'SELECT') {
      const showEnRef = profile.selectSourceSlot === profile.selectJpSlot;
      if (showEnRef) {
        (ui.lineRefEnView as HTMLInputElement).value = l.luca_en || '';
        (ui.lineRefZhView as HTMLInputElement).value = '';
        (ui.lucaRefWrap as HTMLElement).style.display = (ui.lineRefEnView as HTMLInputElement).value ? 'block' : 'none';
        if ((ui.lineRefZhView as HTMLInputElement).parentElement) (ui.lineRefZhView as HTMLInputElement).parentElement!.style.display = 'none';
      } else {
        (ui.lineRefEnView as HTMLInputElement).value = l.luca_jp || '';
        (ui.lineRefZhView as HTMLInputElement).value = '';
        (ui.lucaRefWrap as HTMLElement).style.display = (ui.lineRefEnView as HTMLInputElement).value ? 'block' : 'none';
        if ((ui.lineRefZhView as HTMLInputElement).parentElement) (ui.lineRefZhView as HTMLInputElement).parentElement!.style.display = 'none';
      }
    } else if (profile.storeEnSlot != null && profile.messageSourceSlot === profile.storeJpSlot) {
      const enRef = parseLucaTxtText(l.luca_en || '');
      const enName = resolveLucaDisplayName(enRef.name, profile.id);
      (ui.lineRefEnView as HTMLInputElement).value = enName ? `${enName}: ${enRef.text}` : enRef.text;
      (ui.lineRefZhView as HTMLInputElement).value = '';
      (ui.lucaRefWrap as HTMLElement).style.display = (ui.lineRefEnView as HTMLInputElement).value ? 'block' : 'none';
    } else {
      (ui.lucaRefWrap as HTMLElement).style.display = 'none';
    }
  } else {
    (ui.lucaRefWrap as HTMLElement).style.display = 'none';
  }
  // JSON ref languages
  const hasRef1 = l.ref_lang_1 != null;
  const hasRef2 = l.ref_lang_2 != null;
  if (ui.jsonRefLang1Wrap) {
    if (hasRef1) {
      const nm1 = l.ref_lang_1_name ? `${l.ref_lang_1_name}: ` : '';
      (ui.lineRefLang1View as HTMLInputElement).value = `${nm1}${l.ref_lang_1}`;
      (ui.jsonRefLang1Wrap as HTMLElement).style.display = 'block';
    } else {
      (ui.jsonRefLang1Wrap as HTMLElement).style.display = 'none';
    }
  }
  if (ui.jsonRefLang2Wrap) {
    if (hasRef2) {
      const nm2 = l.ref_lang_2_name ? `${l.ref_lang_2_name}: ` : '';
      (ui.lineRefLang2View as HTMLInputElement).value = `${nm2}${l.ref_lang_2}`;
      (ui.jsonRefLang2Wrap as HTMLElement).style.display = 'block';
    } else {
      (ui.jsonRefLang2Wrap as HTMLElement).style.display = 'none';
    }
  }
  openModal(ui.lineEditorModal as HTMLElement);
}

export function onSaveLineEditor(): void {
  const l = state.lineByNum.get(getActiveLineEditorLineNum()!);
  if (!l) return;
  const m = (ui.lineMessageInput as HTMLTextAreaElement).value.trim().replace(/\r?\n/g, '\\n');
  if ((ui.lineTranslatedCheck as HTMLInputElement).checked && !m && !state.disableEmptyLineValidation) return alert('Gagal: Pesan terjemahan kosong.');
  let n: string | null = null;
  const hideMcName = isClannadProtagonistToken(l.name) && getActiveLucaProfile().nameAtFormat;
  if (l.name && !hideMcName) n = (ui.lineNameInput as HTMLInputElement).value.trim().replace(/\r?\n/g, '\\n');
  pushUndoSnapshot();
  l.trans_message = m || ((ui.lineTranslatedCheck as HTMLInputElement).checked && state.disableEmptyLineValidation ? '' : null);
  l.is_translated = !!((ui.lineTranslatedCheck as HTMLInputElement).checked && (m || state.disableEmptyLineValidation));
  if (l.name && !hideMcName) l.trans_name = n || null;
  closeModal(ui.lineEditorModal as HTMLElement);
  refreshAll();
  import('./proofread').then(m => {
    if ((ui.proofreadModal as HTMLElement).classList.contains('open')) m.renderProofreadResults();
  });
  queueAutoSave();
}
