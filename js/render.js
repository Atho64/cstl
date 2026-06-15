// @module render.js — Main rendering, virtual scroller callbacks, status bar, undo, flashHint

import { state, ui, getMainScroller, incrementHintToken, getHintToken } from './state.js';
import { isTranslated } from './state.js';
import { APP_VERSION, MAX_UNDO_STEPS } from './constants.js';
import { containsJapanese } from './string-utils.js';
import { formatLineLabel, getLineDisplayName, getActiveLucaProfile } from './luca-engine.js';
import { isSelectableForActiveTab, recordSelectionHistory } from './selection.js';
import { openModal, closeModal } from './project.js';

// ─── Lazy project helpers (breaks render.js ↔ project.js circular dep) ────────
function queueAutoSave() { import('./project.js').then(m => m.queueAutoSave()); }

// ─── Lazy glossary helpers (breaks render.js ↔ glossary.js circular dep) ───────
function renderGlossaryPreview() { import('./glossary.js').then(m => m.renderGlossaryPreview()); }

import { getTranslationPastePlaceholder } from './ai-format.js';

import { getActiveLineEditorLineNum, setActiveLineEditorLineNum } from './state.js';
import {
  isClannadProtagonistToken, parseLucaTxtText, resolveLucaDisplayName,
} from './luca-engine.js';

// ─── Display State ────────────────────────────────────────────────────────────

export function rebuildDisplayState() {
  state.lineByNum.clear();
  const grouped = new Map(state.importedFiles.map(f => [f, []]));
  for (const line of state.lines) {
    state.lineByNum.set(line.line_num, line);
    if (!grouped.has(line.file)) grouped.set(line.file, []);

    let shouldHide = false;
    if (state.sourceLang === "English") {
      if (containsJapanese(line.name || "") || containsJapanese(line.message || "")) {
        shouldHide = true;
      }
    }

    if (!shouldHide && state.regexFilter) {
      try {
        const re = new RegExp(state.regexFilter, "u");
        if (re.test(line.name || "") || re.test(line.message || "")) {
          shouldHide = true;
        }
      } catch (e) {
        // ignore invalid regex
      }
    }

    line._hidden = shouldHide;

    if (!shouldHide) {
      grouped.get(line.file).push(line);
    }
  }
  state.displayRows = [];
  for (const [fileName, rows] of grouped.entries()) {
    if (!rows.length) continue;
    state.displayRows.push({ type: "separator", file: fileName });
    for (const line of rows) {
      state.displayRows.push({ type: "line", line });
    }
  }
}

export function renderPreviewRows() {
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

export function renderMainRow(rowData) {
  const row = document.createElement("div");
  row.className = "preview-row";
  if (rowData.type === "separator") {
    row.classList.add("separator");
    const fileLines = state.lines.filter(l => l.file === rowData.file && isSelectableForActiveTab(l));
    const isAllSelected = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.file = rowData.file;
    cb.checked = isAllSelected;
    cb.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      fileLines.forEach(l => {
        if (isChecked) state.selectedLines.add(l.line_num);
        else state.selectedLines.delete(l.line_num);
      });
      recordSelectionHistory();
      syncCheckboxUI();
    });
    const label = document.createElement("div");
    label.className = "mono grow";
    label.style.fontWeight = "700";
    label.style.color = "var(--primary)";
    label.textContent = `File: ${rowData.file}`;
    row.append(cb, label);
  } else {
    const line = rowData.line;
    if (isTranslated(line)) row.classList.add("row-translated");
    const isChecked = state.selectedLines.has(line.line_num);
    if (isChecked) row.classList.add('row-selected');
    const cbWrap = document.createElement("div");
    cbWrap.className = "checkbox-cell";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.num = line.line_num;
    cb.checked = isChecked;
    cb.disabled = !isSelectableForActiveTab(line);
    cb.addEventListener("change", (e) => {
      if (e.target.checked) state.selectedLines.add(line.line_num);
      else state.selectedLines.delete(line.line_num);
      recordSelectionHistory();
      syncCheckboxUI();
    });
    const contentWrap = document.createElement("div");
    contentWrap.className = "text-content";
    if (line.luca_command === "SELECT") {
      const metaDiv = document.createElement("div");
      metaDiv.className = "file-meta";
      metaDiv.textContent = `SELECT choice ${(line.luca_choice_index || 0) + 1}`;
      contentWrap.appendChild(metaDiv);
    }
    const origDiv = document.createElement("div");
    origDiv.className = "original";
    origDiv.textContent = formatLineLabel(line);
    const transDiv = document.createElement("div");
    transDiv.className = "translated";
    let tTxt = "——";
    if (isTranslated(line)) {
      tTxt = formatLineLabel(line, { translated: true });
    } else {
      transDiv.classList.add("cell-muted");
    }
    transDiv.textContent = tTxt;
    contentWrap.append(origDiv, transDiv);
    cbWrap.append(cb, contentWrap);
    row.appendChild(cbWrap);
    contentWrap.addEventListener("click", () => openLineEditor(line.line_num));
  }
  return row;
}

// ─── Checkbox Sync ────────────────────────────────────────────────────────────

export function syncCheckboxUI() {
  document.querySelectorAll('.preview-row.separator input[type="checkbox"]').forEach(cb => {
    const fileLines = state.lines.filter(l => l.file === cb.dataset.file && isSelectableForActiveTab(l));
    cb.checked = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
  });
  document.querySelectorAll('.preview-row:not(.separator) input[type="checkbox"]').forEach(cb => {
    const num = Number(cb.dataset.num);
    const isChecked = state.selectedLines.has(num);
    cb.checked = isChecked;
    const row = cb.closest('.preview-row');
    if (isChecked) row.classList.add('row-selected');
    else row.classList.remove('row-selected');
  });
  updateButtonStates();
}

// ─── Name Table ───────────────────────────────────────────────────────────────

export function collectCharacterNameRows() {
  const rows = new Map();
  for (const line of state.lines) {
    const name = String(line.name || "").trim();
    if (!name) continue;
    if (!rows.has(name)) {
      rows.set(name, { name, lines: [], translatedNames: new Set() });
    }
    const row = rows.get(name);
    row.lines.push(line);
    const translatedName = String(line.trans_name || "").trim();
    if (translatedName) row.translatedNames.add(translatedName);
  }
  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function renderNameTable() {
  const autoDetectedNames = collectCharacterNameRows();
  ui.nameTableBody.textContent = "";
  const frag = document.createDocumentFragment();
  for (const nameRow of autoDetectedNames) {
    const n = nameRow.name;
    const matchingLines = nameRow.lines;
    const translatedNames = Array.from(nameRow.translatedNames);
    const tr = document.createElement("tr");
    const sourceTd = document.createElement("td");
    sourceTd.textContent = n;
    sourceTd.className = "mono name-source-cell";
    sourceTd.title = "Klik untuk copy nama ke clipboard";
    sourceTd.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(n);
        flashHint(`Nama "${n}" disalin!`);
      } catch (e) {
        alert("Gagal menyalin teks.");
      }
    });
    const translatedTd = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "name-translation-input mono";
    input.placeholder = n;
    input.value = translatedNames.length === 1 ? translatedNames[0] : "";
    input.title = translatedNames.length > 1
      ? `Ada ${translatedNames.length} variasi terjemah nama. Isi untuk menyamakan semuanya.`
      : "Terjemah nama karakter";
    input.addEventListener("change", () => {
      const nextName = input.value.trim().replace(/\r?\n/g, "\\n");
      const currentNames = Array.from(new Set(matchingLines.map(l => (l.trans_name || "").trim())));
      if (currentNames.length === 1 && currentNames[0] === nextName) return;
      pushUndoSnapshot();
      matchingLines.forEach(line => {
        line.trans_name = nextName || null;
      });
      renderPreviewRows();
      queueAutoSave();
      flashHint(nextName ? `Nama "${n}" diganti menjadi "${nextName}".` : `Terjemah nama "${n}" dikosongkan.`);
    });
    translatedTd.appendChild(input);
    tr.append(sourceTd, translatedTd);
    frag.appendChild(tr);
  }
  ui.nameTableBody.appendChild(frag);
}

// ─── Status Bar & Refresh ─────────────────────────────────────────────────────

export function updateStatusBar() {
  const total = state.lines.length;
  const trans = state.lines.filter(isTranslated).length;
  const perc = total ? Math.floor((trans / total) * 100) : 0;

  let modeText = "-";
  if (state.importedFiles.length > 0) {
    if (state.projectType === "epub") modeText = "EPUB";
    else if (state.projectType === "luca") modeText = `TXT LUCA (${getActiveLucaProfile().shortLabel})`;
    else modeText = "JSON VNTP";
  }

  ui.statusBar.textContent = `${APP_VERSION} | Mode: ${modeText} | File: ${state.importedFiles.length > 1 ? state.importedFiles.length + ' file' : (state.importedFiles[0] || '-')} | Baris: ${total} | TL: ${trans}/${total} (${perc}%)`;
  ui.progressFill.style.width = `${perc}%`;
  ui.progressText.textContent = `${trans}/${total}`;
}

export function refreshAll() {
  rebuildDisplayState();
  renderPreviewRows();
  renderNameTable();
  updateStatusBar();
  ui.btnUndo.disabled = state.undoStack.length === 0;
}

// ─── Undo ─────────────────────────────────────────────────────────────────────

export function pushUndoSnapshot() {
  state.undoStack.push({ lines: JSON.parse(JSON.stringify(state.lines)) });
  if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
  ui.btnUndo.disabled = false;
}

// ─── Flash Hint ───────────────────────────────────────────────────────────────

export function flashHint(msg, keepAlive = false) {
  ui.copyStatus.textContent = msg;
  ui.copyStatus.classList.remove("empty");
  const currentToken = incrementHintToken();
  if (!keepAlive) {
    setTimeout(() => {
      if (getHintToken() === currentToken) {
        ui.copyStatus.classList.add("empty");
      }
    }, 4000);
  }
}

// ─── Button States ────────────────────────────────────────────────────────────

export function updateButtonStates() {
  const hasData = state.lines.length > 0;
  const hasSelection = state.selectedLines.size > 0;
  const nameCount = collectCharacterNameRows().length;
  const translatedNameCount = state.lines.filter(l => (l.name || "").trim() && (l.trans_name || "").trim()).length;
  const untranslatedSelectionCount = state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l)).length;
  const translatedSelectionCount = state.lines.filter(l => state.selectedLines.has(l.line_num) && isTranslated(l)).length;
  ui.btnExport.disabled = !hasData;
  ui.btnProofread.disabled = !hasData;
  ui.btnQaCheck.disabled = !hasData;
  ui.btnImportTranslatedFile.disabled = !hasData;
  ui.btnImportTranslatedFolder.disabled = !hasData;
  ui.btnSelectAll.disabled = !hasData;
  ui.btnClearSelection.disabled = !hasSelection;
  ui.btnCopyForAi.disabled = untranslatedSelectionCount === 0;
  ui.btnCopyNamesForAi.disabled = nameCount === 0;
  ui.btnResetNameTranslations.disabled = translatedNameCount === 0;
  ui.btnCopyForGlossaryAi.disabled = !hasSelection;
  ui.btnCopyForAiCheck.disabled = translatedSelectionCount === 0;
  ui.btnExtractEpubRubyNames.disabled = !(state.projectType === "epub" && state.epubSourceId);
  ui.pasteArea.disabled = !hasData;
  ui.pasteNameArea.disabled = nameCount === 0;
  ui.pasteGlossaryArea.disabled = !hasData;
  ui.btnApply.disabled = !hasData;
  ui.btnApplyNameTranslations.disabled = nameCount === 0 || !ui.pasteNameArea.value.trim();
  ui.btnSaveGlossary.disabled = !hasData;
  ui.btnParseAiCheck.disabled = !hasData;
  ui.pasteAiCheckArea.disabled = !hasData;
  ui.btnApplyAiCheck.disabled = state.aiCheckCorrections.filter(c => c.checked).length === 0;
  ui.btnClearAiCheck.disabled = !ui.pasteAiCheckArea.value.trim() && state.aiCheckCorrections.length === 0;
  ui.btnImportGlossaryFile.disabled = !state.currentProjectId;
  ui.btnExportGlossaryFile.disabled = !state.glossaryText.trim();
  ui.btnDeleteTranslation.disabled = translatedSelectionCount === 0;
  ui.rangeFromInput.disabled = !hasData;
  ui.rangeToInput.disabled = !hasData;
  ui.btnSelectRange.disabled = !hasData;
  ui.copyCount.textContent = untranslatedSelectionCount;
  ui.copyNameCount.textContent = nameCount;
  ui.copyGlossaryCount.textContent = state.selectedLines.size;
  ui.deleteTranslationCount.textContent = translatedSelectionCount;
  ui.copyAiCheckCount.textContent = translatedSelectionCount;
  renderGlossaryPreview();
  if (ui.pasteArea) ui.pasteArea.placeholder = getTranslationPastePlaceholder();
}

// ─── Line Editor ──────────────────────────────────────────────────────────────

export function openLineEditor(num) {
  const l = state.lineByNum.get(num);
  if (!l) return;
  setActiveLineEditorLineNum(num);
  ui.lineEditorTitle.textContent = l.luca_command === "SELECT"
    ? `Edit Baris ${num} - Select Choice ${(l.luca_choice_index || 0) + 1}`
    : `Edit Baris ${num}`;
  const displayName = getLineDisplayName(l);
  ui.lineOriginalView.value = displayName ? `${displayName}: ${l.message}` : `${l.message}`;
  const hideMcName = isClannadProtagonistToken(l.name) && getActiveLucaProfile().nameAtFormat;
  ui.lineNameWrap.style.display = l.name && !hideMcName ? "block" : "none";
  ui.lineNameInput.value = l.name && !hideMcName ? (l.trans_name || "") : "";
  if (l.name && !hideMcName) ui.lineNameInput.placeholder = l.name;
  ui.lineMessageInput.value = (l.trans_message || "").trim();
  ui.lineTranslatedCheck.checked = isTranslated(l);
  // Show LucaSystem reference languages if available
  if (state.projectType === "luca" && (l.luca_en || l.luca_zh || l.luca_jp)) {
    const profile = getActiveLucaProfile();
    if (profile.hasMultiLangRef) {
      if (l.luca_command === "SELECT") {
        ui.lineRefEnView.value = l.luca_en || "";
        ui.lineRefZhView.value = l.luca_zh || "";
      } else {
        const { name: enName, text: enText } = parseLucaTxtText(l.luca_en || "");
        const { name: zhName, text: zhText } = parseLucaTxtText(l.luca_zh || "");
        ui.lineRefEnView.value = enName ? `${enName}: ${enText}` : enText;
        ui.lineRefZhView.value = zhName ? `${zhName}: ${zhText}` : zhText;
      }
      ui.lucaRefWrap.style.display = "block";
      ui.lineRefEnView.previousElementSibling.textContent = "🇬🇧 English (Referensi)";
      ui.lineRefZhView.previousElementSibling.textContent = "🇨🇳 中文 (Referensi)";
      ui.lineRefZhView.parentElement.style.display = "";
    } else if (l.luca_command === "SELECT") {
      const showEnRef = profile.selectSourceSlot === profile.selectJpSlot;
      if (showEnRef) {
        ui.lineRefEnView.value = l.luca_en || "";
        ui.lineRefZhView.value = "";
        ui.lucaRefWrap.style.display = ui.lineRefEnView.value ? "block" : "none";
        ui.lineRefEnView.previousElementSibling.textContent = "🇬🇧 English (Referensi)";
        ui.lineRefZhView.parentElement.style.display = "none";
      } else {
        ui.lineRefEnView.value = l.luca_jp || "";
        ui.lineRefZhView.value = "";
        ui.lucaRefWrap.style.display = ui.lineRefEnView.value ? "block" : "none";
        ui.lineRefEnView.previousElementSibling.textContent = "🇯🇵 Japanese (Referensi)";
        ui.lineRefZhView.parentElement.style.display = "none";
      }
    } else if (profile.storeEnSlot != null && profile.messageSourceSlot === profile.storeJpSlot) {
      const enRef = parseLucaTxtText(l.luca_en || "");
      const enName = resolveLucaDisplayName(enRef.name, profile.id);
      ui.lineRefEnView.value = enName ? `${enName}: ${enRef.text}` : enRef.text;
      ui.lineRefZhView.value = "";
      ui.lucaRefWrap.style.display = ui.lineRefEnView.value ? "block" : "none";
      ui.lineRefEnView.previousElementSibling.textContent = "🇬🇧 English (Referensi)";
      ui.lineRefZhView.parentElement.style.display = "none";
    } else {
      const jpRef = parseLucaTxtText(l.luca_jp || "");
      const jpName = resolveLucaDisplayName(jpRef.name, profile.id);
      ui.lineRefEnView.value = jpName ? `${jpName}: ${jpRef.text}` : jpRef.text;
      const rawSlot = l.luca_en && l.luca_en !== (l.luca_jp || "") ? l.luca_en : "";
      const slotRef = rawSlot ? parseLucaTxtText(rawSlot) : { name: null, text: "" };
      const slotName = resolveLucaDisplayName(slotRef.name, profile.id);
      ui.lineRefZhView.value = slotRef.text
        ? (slotName ? `${slotName}: ${slotRef.text}` : slotRef.text)
        : "";
      ui.lucaRefWrap.style.display = (ui.lineRefEnView.value || ui.lineRefZhView.value) ? "block" : "none";
      ui.lineRefEnView.previousElementSibling.textContent = "🇯🇵 Japanese (Referensi)";
      ui.lineRefZhView.previousElementSibling.textContent = "📎 Slot asli";
      ui.lineRefZhView.parentElement.style.display = ui.lineRefZhView.value ? "" : "none";
    }
  } else {
    ui.lucaRefWrap.style.display = "none";
  }
  openModal(ui.lineEditorModal);
}

export function onSaveLineEditor() {
  const l = state.lineByNum.get(getActiveLineEditorLineNum());
  if (!l) return;
  const m = ui.lineMessageInput.value.trim().replace(/\r?\n/g, "\\n");
  if (ui.lineTranslatedCheck.checked && !m && !state.disableEmptyLineValidation) return alert("Gagal: Pesan terjemahan kosong.");
  let n = null;
  const hideMcName = isClannadProtagonistToken(l.name) && getActiveLucaProfile().nameAtFormat;
  if (l.name && !hideMcName) n = ui.lineNameInput.value.trim().replace(/\r?\n/g, "\\n");
  pushUndoSnapshot();
  l.trans_message = m || (ui.lineTranslatedCheck.checked && state.disableEmptyLineValidation ? "" : null);
  l.is_translated = !!(ui.lineTranslatedCheck.checked && (m || state.disableEmptyLineValidation));
  if (l.name && !hideMcName) l.trans_name = n || null;
  closeModal(ui.lineEditorModal);
  refreshAll();
  // Re-render proofread if modal is open
  import('./proofread.js').then(m => {
    if (ui.proofreadModal.classList.contains("open")) m.renderProofreadResults();
  });
  queueAutoSave();
}
