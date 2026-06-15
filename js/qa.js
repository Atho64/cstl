// @module qa.js — Quality Control validation (Kana residue, Similarity, Glossary not applied)

import { state, ui, getQaScroller } from './state.js';
import { isTranslated } from './state.js';
import { stringSimilarity, escapeRegex, unescapeStoredNewlines } from './string-utils.js';
import { parseGlossaryToMap } from './glossary.js';
import { openLineEditor } from './line-editor.js';
import { openModal, closeModal } from './project.js';

export function onOpenQa() {
  openModal(ui.qaModal);
  if (state.qaMatches.length === 0) {
    ui.qaStats.textContent = "Status: Siap dijalankan.";
  }
}

export function onResetQa() {
  ui.qaCheckGlossary.checked = true;
  ui.qaCheckKana.checked = true;
  ui.qaCheckSimilarity.checked = true;
  state.qaMatches = [];
  getQaScroller().setItems([]);
  ui.qaStats.textContent = "Status: Siap dijalankan.";
}

export function runQaCheck() {
  ui.qaStats.textContent = "Status: Sedang memeriksa...";
  state.qaMatches = [];
  
  const checkKana = ui.qaCheckKana.checked;
  const checkSim = ui.qaCheckSimilarity.checked;
  const checkGloss = ui.qaCheckGlossary.checked;
  
  const glossaryMap = checkGloss ? parseGlossaryToMap(state.glossaryText) : [];
  const simThreshold = state.similarityThreshold || 0.7;
  
  let kanaCount = 0;
  let simCount = 0;
  let glossCount = 0;

  for (const l of state.lines) {
    if (!isTranslated(l) || !l.trans_message) continue;

    const origRawMsg = unescapeStoredNewlines(l.message || "");
    const transRawMsg = unescapeStoredNewlines(l.trans_message);
    const origRawName = unescapeStoredNewlines(l.name || "");
    const transRawName = unescapeStoredNewlines(l.trans_name || "");
    
    const errors = [];
    const kanaRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    
    if (checkKana) {
      if (kanaRegex.test(transRawMsg) || (transRawName && kanaRegex.test(transRawName))) {
        errors.push("Kana/Kanji Residue");
        kanaCount++;
      }
    }
    
    if (checkSim) {
      let flagged = false;
      if (origRawMsg.length >= 2 || transRawMsg.length >= 2) {
        const simMsg = stringSimilarity(origRawMsg, transRawMsg);
        if (simMsg >= simThreshold) {
          errors.push(`Sim: Teks (${Math.round(simMsg * 100)}%)`);
          flagged = true;
        }
      }
      if (origRawName && transRawName && (origRawName.length >= 2 || transRawName.length >= 2)) {
        const simName = stringSimilarity(origRawName, transRawName);
        if (simName >= simThreshold) {
          errors.push(`Sim: Nama (${Math.round(simName * 100)}%)`);
          flagged = true;
        }
      }
      if (flagged) simCount++;
    }
    
    if (checkGloss) {
      let missingTerms = [];
      const combinedOrig = (origRawName ? origRawName + "\n" : "") + origRawMsg;
      const combinedTrans = (transRawName ? transRawName + "\n" : "") + transRawMsg;
      
      for (const entry of glossaryMap) {
        if (combinedOrig.includes(entry.src)) {
          // Pengecekan berbasis batas kata (word boundary)
          const re = new RegExp("\\b" + escapeRegex(entry.tgt) + "\\b", "i");
          if (!re.test(combinedTrans)) {
            missingTerms.push(entry.src);
          }
        }
      }
      if (missingTerms.length > 0) {
        errors.push(`Glossary (${missingTerms.join(", ")})`);
        glossCount++;
      }
    }
    
    if (errors.length > 0) {
      state.qaMatches.push({
        num: l.line_num,
        file: l.file,
        origName: l.name,
        origMsg: l.message,
        transName: l.trans_name,
        transMsg: l.trans_message,
        errors: errors
      });
    }
  }
  
  const total = kanaCount + simCount + glossCount;
  ui.qaStats.textContent = `Selesai. Ditemukan ${total} pelanggaran pada ${state.qaMatches.length} baris (Kana: ${kanaCount}, Similarity: ${simCount}, Glossary: ${glossCount}).`;
  getQaScroller().setItems(state.qaMatches);
}

export function renderQaRow(r) {
  const row = document.createElement("div");
  row.className = "preview-row";
  const contentWrap = document.createElement("div");
  contentWrap.className = "text-content";
  
  const titleEl = document.createElement("div");
  titleEl.className = "hint m-0 label-bold mb-1 flex-center gap-10";
  titleEl.textContent = r.file + ` (Baris ${r.num})`;
  
  for (const err of r.errors) {
    const badge = document.createElement("span");
    badge.className = "badge";
    if (err.startsWith("Kana")) badge.style.background = "var(--danger)";
    else if (err.startsWith("Sim")) badge.style.background = "#f59e0b"; // orange
    else badge.style.background = "var(--primary)";
    badge.textContent = err;
    titleEl.appendChild(badge);
  }
  
  const buildNodes = (name, msg) => {
    const wrap = document.createDocumentFragment();
    if (name) {
      wrap.appendChild(document.createTextNode(name + ": "));
    }
    const mSpan = document.createElement("span");
    mSpan.className = "text-muted";
    mSpan.textContent = msg || "";
    wrap.appendChild(mSpan);
    const div = document.createElement("div");
    div.appendChild(wrap);
    return div;
  };
  
  contentWrap.appendChild(titleEl);
  contentWrap.appendChild(buildNodes(r.origName, r.origMsg));
  // get updated translation dynamically
  const l = state.lineByNum.get(r.num);
  const tName = l ? l.trans_name : r.transName;
  const tMsg = l ? l.trans_message : r.transMsg;
  contentWrap.appendChild(buildNodes(tName, tMsg));
  
  row.appendChild(contentWrap);
  row.style.cursor = "pointer";
  row.addEventListener("click", () => {
    closeModal(ui.qaModal);
    openLineEditor(r.num);
  });
  return row;
}
