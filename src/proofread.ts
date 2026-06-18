// @module proofread.ts — Find & Replace / Proofread modal

import { state, ui, getProofreadScroller, getMainScroller } from './state';
import { isTranslated } from './state';
import { escapeRegex, unescapeStoredNewlines, escapeStoredNewlines, containsJapanese } from './string-utils';
import { rebuildDisplayState, renderPreviewRows, syncCheckboxUI, flashHint, updateButtonStates, pushUndoSnapshot, openLineEditor, refreshAll } from './render';
import { queueAutoSave, openModal, closeModal } from './project';
import { MAX_UNDO_STEPS } from './constants';
import type { ProofreadMatch } from './types';


export function onOpenProofread() { openModal(ui.proofreadModal); renderProofreadResults(); }
export function onResetProofread() {
  ui.proofreadSearchInput.value = ''; ui.proofreadReplaceInput.value = '';
  ui.proofreadScope.value = 'all'; ui.proofreadRegexCheck.checked = false;
  ui.proofreadCaseCheck.checked = false; ui.proofreadExactCheck.checked = false;
  ui.proofreadTranslatedOnlyCheck.checked = true;
  renderProofreadResults();
}

export function buildSearchRegex(query: string, isRegex: boolean, isCase: boolean, isExact: boolean, capture = false): RegExp {
  let regexStr = isRegex ? query : escapeRegex(query);
  if (isExact && !containsJapanese(query)) regexStr = `\\b(?:${regexStr})\\b`;
  if (capture) regexStr = `(${regexStr})`;
  return new RegExp(regexStr, isCase ? 'gu' : 'giu');
}

export function createHighlightedNodes(text: string, query: string, isRegex: boolean, isCase: boolean, isExact: boolean): Node {
  if (!query) return document.createTextNode(text);
  let regex: RegExp;
  try {
    regex = buildSearchRegex(query, isRegex, isCase, isExact, false);
  } catch (e) { return document.createTextNode(text); }
  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match[0].length === 0) continue;
    if (match.index! > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const mark = document.createElement('mark');
    mark.className = 'highlight';
    mark.textContent = match[0];
    frag.appendChild(mark);
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return frag;
}

export function renderProofreadResults(): void {
  if (!ui.proofreadModal.classList.contains('open')) return;
  const query = ui.proofreadSearchInput.value;
  const isRegex = ui.proofreadRegexCheck.checked;
  const isCase = ui.proofreadCaseCheck.checked;
  const isExact = ui.proofreadExactCheck.checked;
  const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
  const scope = ui.proofreadScope.value;
  let regex: RegExp | null = null;
  if (query) {
    try {
      regex = buildSearchRegex(query, isRegex, isCase, isExact);
    }
    catch (e) { return; }
  }
  state.proofreadMatches = [];
  for (const line of state.lines) {
    if (onlyTrans && !isTranslated(line)) continue;
    const dName = line.name || '';
    let fName: string | null = null;
    if (isTranslated(line)) fName = (line.trans_name || '').trim() || line.name;
      if (query && regex) {
        let isMatch = false;
        const isJump = (ui.proofreadJumpCheck as HTMLInputElement).checked;

        // onlyTrans=true  -> search ONLY translated fields
        // onlyTrans=false -> search ONLY original fields
        const searchOrigMsg   = !onlyTrans && (scope === 'all' || scope === 'message');
        const searchTransMsg  =  onlyTrans && (scope === 'all' || scope === 'message');
        const searchOrigName  = !onlyTrans && (scope === 'all' || scope === 'name');
        const searchTransName =  onlyTrans && (scope === 'all' || scope === 'name');

        const origNameForSearch = isJump ? `${line.line_num}. ${dName}` : dName;
        const transNameForSearch = isJump ? `${line.line_num}. ${fName || dName}` : fName;

        if (!isMatch && searchOrigMsg  && line.message)       { regex.lastIndex = 0; if (regex.test(line.message))       isMatch = true; }
        if (!isMatch && searchTransMsg && line.trans_message) { regex.lastIndex = 0; if (regex.test(line.trans_message!)) isMatch = true; }
        if (!isMatch && searchOrigName && origNameForSearch)  { regex.lastIndex = 0; if (regex.test(origNameForSearch))  isMatch = true; }
        if (!isMatch && searchTransName && transNameForSearch){ regex.lastIndex = 0; if (regex.test(transNameForSearch)) isMatch = true; }

        if (!isMatch) continue;
      }
    state.proofreadMatches.push({
      num: line.line_num, file: line.file, origName: dName, origMsg: line.message,
      transName: fName, transMsg: line.trans_message, isTrans: isTranslated(line),
    });
  }
  ui.proofreadStatus.textContent = `Ditemukan ${state.proofreadMatches.length} baris.`;
  getProofreadScroller().setItems(state.proofreadMatches);
}

export function renderProofreadRow(r: ProofreadMatch): HTMLElement {
  const row = document.createElement('div');
  row.className = 'preview-row';
  const contentWrap = document.createElement('div');
  contentWrap.className = 'text-content';
  const query = ui.proofreadSearchInput.value;
  const isRegex = ui.proofreadRegexCheck.checked;
  const isCase = ui.proofreadCaseCheck.checked;
  const isExact = ui.proofreadExactCheck.checked;
  const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
  const isJump = (ui.proofreadJumpCheck as HTMLInputElement).checked;
  const scope = ui.proofreadScope.value;
  const highlightName = scope === 'all' || scope === 'name';
  const highlightMsg = scope === 'all' || scope === 'message';
  const buildNodes = (name: string | null, msg: string | null, shouldHighlightAll: boolean) => {
    const wrap = document.createDocumentFragment();
    if (isJump) {
      const numSpan = document.createElement('span');
      numSpan.className = 'cell-muted';
      numSpan.textContent = `${r.num}. `;
      wrap.appendChild(numSpan);
    }
    if (name) {
      if (shouldHighlightAll && highlightName) wrap.appendChild(createHighlightedNodes(name, query, isRegex, isCase, isExact));
      else wrap.appendChild(document.createTextNode(name));
      wrap.appendChild(document.createTextNode(': '));
    }
    if (shouldHighlightAll && highlightMsg) wrap.appendChild(createHighlightedNodes(msg || '', query, isRegex, isCase, isExact));
    else wrap.appendChild(document.createTextNode(msg || ''));
    return wrap;
  };
  const fileMeta = document.createElement('div');
  fileMeta.className = 'file-meta';
  fileMeta.textContent = `File: ${r.file} | Baris: ${r.num}`;
  const origDiv = document.createElement('div');
  origDiv.className = 'original';
  const transDiv = document.createElement('div');
  transDiv.className = 'translated';
  if (!r.isTrans) transDiv.classList.add('cell-muted');
  // Original text: highlight only when onlyTrans=false (we searched originals)
  if (!onlyTrans) {
    origDiv.appendChild(buildNodes(r.origName, r.origMsg, true));
  } else {
    origDiv.appendChild(buildNodes(r.origName, r.origMsg, false));
  }
  // Translation text: highlight only when onlyTrans=true (we searched translated)
  if (r.isTrans) {
    if (onlyTrans) transDiv.appendChild(buildNodes(r.transName, r.transMsg, true));
    else transDiv.appendChild(buildNodes(r.transName, r.transMsg, false));
  } else {
    transDiv.textContent = '——';
  }
  contentWrap.append(fileMeta, origDiv, transDiv);
  row.appendChild(contentWrap);
  contentWrap.addEventListener('click', () => {
    if (isJump) {
      closeModal(ui.proofreadModal);
      const items = getMainScroller().items;
      const idx = items.findIndex((l: any) => l.type === 'line' && l.line?.line_num === r.num);
      if (idx !== -1) {
        getMainScroller().scrollToIndex(idx);
        setTimeout(() => {
          const rowDom = document.querySelector(`.preview-row[data-line-num="${r.num}"]`);
          if (rowDom) {
            rowDom.classList.add('flash-highlight');
            setTimeout(() => rowDom.classList.remove('flash-highlight'), 1500);
          }
        }, 50);
      } else {
        alert('Gagal melompat: Baris mungkin disembunyikan oleh filter di menu utama.');
      }
    } else {
      openLineEditor(r.num);
    }
  });
  return row;
}

function replaceWithPreserveCase(original: string, regex: RegExp, rep: string, preserveCase: boolean): string {
  if (!preserveCase) return original.replace(regex, rep);
  const singleRegex = new RegExp(regex.source, regex.flags.replace('g', ''));
  return original.replace(regex, (match) => {
    let replacedText = match.replace(singleRegex, rep);
    if (replacedText === match && rep !== match) replacedText = rep;
    if (match === match.toUpperCase() && match !== match.toLowerCase()) {
      return replacedText.toUpperCase();
    }
    if (match.charAt(0) === match.charAt(0).toUpperCase() && match.charAt(0) !== match.charAt(0).toLowerCase()) {
      return replacedText.charAt(0).toUpperCase() + replacedText.slice(1).toLowerCase();
    }
    return replacedText.toLowerCase();
  });
}

export function onProofreadReplaceAll(): void {
  const query = ui.proofreadSearchInput.value;
  if (!query) return alert('Pencarian masih kosong!');
  const rep = ui.proofreadReplaceInput.value;
  const isRegex = ui.proofreadRegexCheck.checked;
  const isCase = ui.proofreadCaseCheck.checked;
  const isExact = ui.proofreadExactCheck.checked;
  const preserveCase = (ui.proofreadPreserveCaseCheck as HTMLInputElement).checked;
  const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
  const scope = ui.proofreadScope.value;
  let regex: RegExp;
  try {
    regex = buildSearchRegex(query, isRegex, isCase, isExact);
  } catch (e) { return alert('Format Regex tidak valid.'); }
  let count = 0;
  const undoSnapshot = { lines: JSON.parse(JSON.stringify(state.lines)) };
  for (const line of state.lines) {
    if (onlyTrans) {
      if (!isTranslated(line)) continue;
      let replaced = false;
      if ((scope === 'all' || scope === 'message') && line.trans_message) {
        regex.lastIndex = 0;
        if (regex.test(line.trans_message)) { line.trans_message = replaceWithPreserveCase(line.trans_message, regex, rep, preserveCase); replaced = true; }
      }
      if ((scope === 'all' || scope === 'name') && line.trans_name) {
        regex.lastIndex = 0;
        if (regex.test(line.trans_name)) { line.trans_name = replaceWithPreserveCase(line.trans_name, regex, rep, preserveCase); replaced = true; }
      }
      if (replaced) count++;
      } else {
        let replaced = false;
        if ((scope === 'all' || scope === 'message') && line.message) {
          regex.lastIndex = 0;
          if (regex.test(line.message)) { line.message = replaceWithPreserveCase(line.message, regex, rep, preserveCase); replaced = true; }
        }
        if ((scope === 'all' || scope === 'name') && line.name) {
          regex.lastIndex = 0;
          if (regex.test(line.name)) { line.name = replaceWithPreserveCase(line.name, regex, rep, preserveCase); replaced = true; }
        }
        if (replaced) count++;
      }
  }
  if (count > 0) {
    state.undoStack.push(undoSnapshot);
    if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
    refreshAll(); renderProofreadResults(); queueAutoSave();
    alert(`Berhasil melakukan Replace All pada ${count} baris teks.`);
  } else alert('Tidak ada kata yang cocok dengan pencarian.');
}
