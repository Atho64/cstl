// @module proofread.js — Find & Replace / Proofread modal

import { state, ui, getProofreadScroller } from './state.js';
import { isTranslated } from './state.js';
import { escapeRegex, unescapeStoredNewlines, escapeStoredNewlines, containsJapanese } from './string-utils.js';
import { rebuildDisplayState, renderPreviewRows, syncCheckboxUI, flashHint, updateButtonStates, pushUndoSnapshot, openLineEditor, refreshAll } from './render.js';
import { queueAutoSave, openModal, closeModal } from './project.js';
import { MAX_UNDO_STEPS } from './constants.js';


export function onOpenProofread() { openModal(ui.proofreadModal); renderProofreadResults(); }
export function onResetProofread() {
  ui.proofreadSearchInput.value = ""; ui.proofreadReplaceInput.value = "";
  ui.proofreadScope.value = "all"; ui.proofreadRegexCheck.checked = false;
  ui.proofreadCaseCheck.checked = false; ui.proofreadExactCheck.checked = false;
  ui.proofreadTranslatedOnlyCheck.checked = true;
  renderProofreadResults();
}

export function buildSearchRegex(query, isRegex, isCase, isExact, capture = false) {
  let regexStr = isRegex ? query : escapeRegex(query);
  if (isExact && !containsJapanese(query)) regexStr = `\\b(?:${regexStr})\\b`;
  if (capture) regexStr = `(${regexStr})`;
  return new RegExp(regexStr, isCase ? "gu" : "giu");
}

export function createHighlightedNodes(text, query, isRegex, isCase, isExact) {
  if (!query) return document.createTextNode(text);
  let regex;
  try {
    regex = buildSearchRegex(query, isRegex, isCase, isExact, false);
  } catch(e) { return document.createTextNode(text); }
  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match[0].length === 0) continue;
    if (match.index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const mark = document.createElement("mark");
    mark.className = "highlight";
    mark.textContent = match[0];
    frag.appendChild(mark);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return frag;
}

export function renderProofreadResults() {
  if (!ui.proofreadModal.classList.contains("open")) return;
  const query = ui.proofreadSearchInput.value;
  const isRegex = ui.proofreadRegexCheck.checked;
  const isCase = ui.proofreadCaseCheck.checked;
  const isExact = ui.proofreadExactCheck.checked;
  const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
  const scope = ui.proofreadScope.value;
  let regex = null;
  if (query) {
    try {
      regex = buildSearchRegex(query, isRegex, isCase, isExact);
    }
    catch (e) { return; }
  }
  state.proofreadMatches = [];
  for (const line of state.lines) {
    if (onlyTrans && !isTranslated(line)) continue;
    const dName = line.name || "";
    let fName = null;
    if (isTranslated(line)) fName = (line.trans_name || "").trim() || line.name;
    if (query && regex) {
      let isMatch = false;

      // onlyTrans=true  -> search ONLY translated fields
      // onlyTrans=false -> search ONLY original fields
      const searchOrigMsg   = !onlyTrans && (scope === 'all' || scope === 'message');
      const searchTransMsg  =  onlyTrans && (scope === 'all' || scope === 'message');
      const searchOrigName  = !onlyTrans && (scope === 'all' || scope === 'name');
      const searchTransName =  onlyTrans && (scope === 'all' || scope === 'name');

      if (!isMatch && searchOrigMsg  && line.message)       { regex.lastIndex = 0; if (regex.test(line.message))       isMatch = true; }
      if (!isMatch && searchTransMsg && line.trans_message)  { regex.lastIndex = 0; if (regex.test(line.trans_message)) isMatch = true; }
      if (!isMatch && searchOrigName && dName)               { regex.lastIndex = 0; if (regex.test(dName))              isMatch = true; }
      if (!isMatch && searchTransName && fName)              { regex.lastIndex = 0; if (regex.test(fName))              isMatch = true; }

      if (!isMatch) continue;
    }
    state.proofreadMatches.push({
      num: line.line_num, file: line.file, origName: dName, origMsg: line.message,
      transName: fName, transMsg: line.trans_message, isTrans: isTranslated(line)
    });
  }
  ui.proofreadStatus.textContent = `Ditemukan ${state.proofreadMatches.length} baris.`;
  getProofreadScroller().setItems(state.proofreadMatches);
}

export function renderProofreadRow(r) {
  const row = document.createElement("div");
  row.className = "preview-row";
  const contentWrap = document.createElement("div");
  contentWrap.className = "text-content";
  const query = ui.proofreadSearchInput.value;
  const isRegex = ui.proofreadRegexCheck.checked;
  const isCase = ui.proofreadCaseCheck.checked;
  const isExact = ui.proofreadExactCheck.checked;
  const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
  const scope = ui.proofreadScope.value;
  const highlightName = scope === 'all' || scope === 'name';
  const highlightMsg = scope === 'all' || scope === 'message';
  const buildNodes = (name, msg, shouldHighlightAll) => {
    const wrap = document.createDocumentFragment();
    if (name) {
      if (shouldHighlightAll && highlightName) wrap.appendChild(createHighlightedNodes(name, query, isRegex, isCase, isExact));
      else wrap.appendChild(document.createTextNode(name));
      wrap.appendChild(document.createTextNode(": "));
    }
    if (shouldHighlightAll && highlightMsg) wrap.appendChild(createHighlightedNodes(msg, query, isRegex, isCase, isExact));
    else wrap.appendChild(document.createTextNode(msg));
    return wrap;
  };
  const fileMeta = document.createElement("div");
  fileMeta.className = "file-meta";
  fileMeta.textContent = `File: ${r.file} | Baris: ${r.num}`;
  const origDiv = document.createElement("div");
  origDiv.className = "original";
  const transDiv = document.createElement("div");
  transDiv.className = "translated";
  if (!r.isTrans) transDiv.classList.add("cell-muted");
  // Original text: highlight only when onlyTrans=false (we searched originals)
  if (!onlyTrans) {
    origDiv.appendChild(buildNodes(r.origName, r.origMsg, true));
  } else {
    origDiv.textContent = r.origName ? `${r.origName}: ${r.origMsg}` : r.origMsg;
  }
  // Translation text: highlight only when onlyTrans=true (we searched translated)
  if (r.isTrans) {
    if (onlyTrans) transDiv.appendChild(buildNodes(r.transName, r.transMsg, true));
    else transDiv.textContent = r.transName ? `${r.transName}: ${r.transMsg}` : (r.transMsg || "——");
  } else {
    transDiv.textContent = "——";
  }
  contentWrap.append(fileMeta, origDiv, transDiv);
  row.appendChild(contentWrap);
  contentWrap.addEventListener("click", () => openLineEditor(r.num));
  return row;
}

export function onProofreadReplaceAll() {
  const query = ui.proofreadSearchInput.value;
  if (!query) return alert("Pencarian masih kosong!");
  const rep = ui.proofreadReplaceInput.value;
  const isRegex = ui.proofreadRegexCheck.checked;
  const isCase = ui.proofreadCaseCheck.checked;
  const isExact = ui.proofreadExactCheck.checked;
  const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
  const scope = ui.proofreadScope.value;
  let regex;
  try {
    regex = buildSearchRegex(query, isRegex, isCase, isExact);
  } catch(e) { return alert("Format Regex tidak valid."); }
  let count = 0;
  const undoSnapshot = { lines: JSON.parse(JSON.stringify(state.lines)) };
  for (const line of state.lines) {
    if (onlyTrans) {
      if (!isTranslated(line)) continue;
      let replaced = false;
      if ((scope === 'all' || scope === 'message') && line.trans_message) {
          regex.lastIndex = 0;
          if (regex.test(line.trans_message)) { line.trans_message = line.trans_message.replace(regex, rep); replaced = true; }
      }
      if ((scope === 'all' || scope === 'name') && line.trans_name) {
          regex.lastIndex = 0;
          if (regex.test(line.trans_name)) { line.trans_name = line.trans_name.replace(regex, rep); replaced = true; }
      }
      if (replaced) count++;
    } else {
      let replaced = false;
      if ((scope === 'all' || scope === 'message') && line.message) {
          regex.lastIndex = 0;
          if (regex.test(line.message)) { line.message = line.message.replace(regex, rep); replaced = true; }
      }
      if ((scope === 'all' || scope === 'name') && line.name) {
          regex.lastIndex = 0;
          if (regex.test(line.name)) { line.name = line.name.replace(regex, rep); replaced = true; }
      }
      if (replaced) count++;
    }
  }
  if (count > 0) {
    state.undoStack.push(undoSnapshot);
    if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
    refreshAll(); renderProofreadResults(); queueAutoSave();
    alert(`Berhasil melakukan Replace All pada ${count} baris teks.`);
  } else alert(`Tidak ada kata yang cocok dengan pencarian.`);
}

