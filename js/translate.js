// @module translate.js — Copy for AI, paste and apply translations, undo

import { state, ui, normalizeLineDict } from './state.js';
import { isTranslated } from './state.js';
import {
  buildSelectedTranslationExport, detectTranslationPasteFormat,
  parseTranslationBlocks, parseTranslationXml, parseTranslationJsonl, parseTranslationJsonArray,
  parseTranslationNumberedPaste, applyPromptVariables,
} from './ai-format.js';
import { unescapeStoredNewlines, escapeStoredNewlines, stringSimilarity } from './string-utils.js';
import { rebuildDisplayState, renderPreviewRows, syncCheckboxUI, flashHint, updateButtonStates, pushUndoSnapshot, refreshAll } from './render.js';
import { queueAutoSave } from './project.js';
import { getGlossaryMatches, getGlossaryPrompt } from './glossary.js';
import { AI_TRANSLATION_FORMAT_BLOCK, AI_TRANSLATION_FORMAT_XML, AI_TRANSLATION_FORMAT_JSONL, AI_TRANSLATION_FORMAT_JSON_ARRAY, DEFAULT_PROMPT_HEADER } from './constants.js';


export async function onCopyForAi() {
  const sel = state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l));
  if (!sel.length) return;

  let contextBlock = "";
  if (state.contextLines > 0) {
    const firstSelLineNum = sel[0].line_num;
    const firstSelIdx = state.lines.findIndex(l => l.line_num === firstSelLineNum);
    if (firstSelIdx > 0) {
      const startIdx = Math.max(0, firstSelIdx - state.contextLines);
      const ctxLines = state.lines.slice(startIdx, firstSelIdx);
      const ctxOut = [];
      for (const l of ctxLines) {
        const origNameStr = l.name ? `${l.name}: ` : "";
        const transNameStr = (l.trans_name || l.name) ? `${(l.trans_name || l.name).trim()}: ` : "";
        if (state.contextType === "raw") {
          ctxOut.push(`${origNameStr}${l.message}`);
        } else if (state.contextType === "both") {
          ctxOut.push(`[Original] ${origNameStr}${l.message}\n[Translated] ${transNameStr}${l.trans_message || ""}`);
        } else {
          ctxOut.push(`${transNameStr}${l.trans_message || l.message}`);
        }
      }
      if (ctxOut.length > 0) {
        contextBlock = `\n\n<Context>\nThese lines are for context only. Do NOT translate them.\n${ctxOut.join("\n")}\n</Context>`;
      }
    }
  }

  const joinedText = buildSelectedTranslationExport(false);
  const glossaryBlock = getGlossaryPrompt(joinedText);
  const baseHeader = applyPromptVariables((state.aiInstructionHeader || DEFAULT_PROMPT_HEADER).trim());
  const sections = [baseHeader];
  if (glossaryBlock) sections.push(glossaryBlock.trim());
  if (contextBlock) sections.push(contextBlock.trim());
  sections.push(joinedText.trim());
  const p = sections.join("\n\n");
  try {
    await navigator.clipboard.writeText(p);
    flashHint(`Disalin ${sel.length} baris.`);
  } catch (_) {
    ui.pasteArea.value = p;
  }
}

export function onApplyTranslation() {
  if (!state.lines.length) return;
  const rawText = ui.pasteArea.value.trim();
  if (!rawText) return alert("Teks di kotak kosong atau tidak valid.");

  const pasteFormat = detectTranslationPasteFormat(rawText);
  const selectedUntranslated = new Set(state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l)).map(l => l.line_num));
  const expectedCount = selectedUntranslated.size;
  let parsed = [];
  let errors = [];

  try {
    if (pasteFormat === AI_TRANSLATION_FORMAT_BLOCK) {
      parsed = parseTranslationBlocks(rawText);
    } else if (pasteFormat === AI_TRANSLATION_FORMAT_XML) {
      parsed = parseTranslationXml(rawText);
    } else if (pasteFormat === AI_TRANSLATION_FORMAT_JSON_ARRAY) {
      const arrResult = parseTranslationJsonArray(rawText);
      parsed = arrResult.parsed;
      errors = arrResult.errors;
    } else if (pasteFormat === AI_TRANSLATION_FORMAT_JSONL) {
      const jsonlResult = parseTranslationJsonl(rawText);
      parsed = jsonlResult.parsed;
      errors = jsonlResult.errors;
    } else {
      const numbered = parseTranslationNumberedPaste(rawText);
      parsed = numbered.parsed;
      errors = numbered.errors;
    }
  } catch (err) {
    return alert("Gagal parse terjemahan:\n\n" + err.message);
  }

  const seen = new Set();
  for (const item of parsed) {
    if (seen.has(item.num)) errors.push(`[#${item.num}] Duplikat nomor baris.`);
    seen.add(item.num);
  }

  if (!parsed.length && !errors.length) return alert("Teks di kotak kosong atau tidak valid.");
  if (parsed.length > 0) {
    if (parsed.length !== expectedCount) {
      errors.push(`[Validasi Checkbox] Copy ${expectedCount} baris, tapi yang di-paste ${parsed.length} baris.`);
    }
    for (const num of selectedUntranslated) {
      if (!seen.has(num) && state.lineByNum.has(num)) errors.push(`[#${num}] Hilang dari hasil paste.`);
    }
    for (const num of seen) {
      if (!selectedUntranslated.has(num)) errors.push(`[#${num}] Nyasar, baris ini tidak kamu centang sebelumnya.`);
    }
  }
  const ignoreNames = ui.checkIgnorePasteNames.checked;
  const updates = [];
  for (const it of parsed) {
    const l = state.lineByNum.get(it.num);
    if (!l) { errors.push(`[#${it.num}] Tidak ada di JSON asli.`); continue; }
    const oN = !!(l.name || "").trim();
    let tN = !!(it.name || "").trim();
    if (!oN && tN) { it.msg = escapeStoredNewlines(it.rawMsg || it.msg); it.name = null; tN = false; }

    if (!ignoreNames) {
      if (oN && !tN) errors.push(`[#${it.num}] Nama karakter hilang.`);
      else if (!oN && tN) errors.push(`[#${it.num}] Tiba-tiba ada nama karakter.`);
    }

    if (!it.msg && !state.disableEmptyLineValidation) errors.push(`[#${it.num}] Pesannya kosong.`);
    else {
      if (state.checkKanaResidue) {
        const rawForCheck = unescapeStoredNewlines(it.msg);
        if (/[\u3040-\u309F\u30A0-\u30FF]/.test(rawForCheck)) {
          errors.push(`[#${it.num}] Kana residue: masih ada karakter hiragana/katakana di terjemahan.`);
        }
      }
      if (state.checkSimilarity && it.msg) {
        const origRaw = unescapeStoredNewlines(l.message || "");
        const transRaw = unescapeStoredNewlines(it.msg);
        const sim = stringSimilarity(origRaw, transRaw);
        if (sim >= state.similarityThreshold) {
          errors.push(`[#${it.num}] Similarity: terjemahan terlalu mirip dengan teks asli (${Math.round(sim * 100)}% ≥ ${Math.round(state.similarityThreshold * 100)}%).`);
        }
      }
      updates.push({ l, it });
    }
  }
  if (errors.length) {
    return alert("TRANSLASI DITOLAK:\n\n" + errors.slice(0, 10).join("\n") + (errors.length > 10 ? `\n\n... (+${errors.length - 10} error lain)` : ""));
  }
  pushUndoSnapshot();
  for (const { l, it } of updates) {
    l.trans_message = it.msg;
    l.is_translated = !!(it.msg || state.disableEmptyLineValidation);
    if (it.name && !ignoreNames) l.trans_name = it.name;
    state.selectedLines.delete(l.line_num);
  }
  ui.pasteArea.value = "";
  refreshAll();
  queueAutoSave();
  flashHint(`${updates.length} baris sukses diterapkan.`);
}

export function onUndoLastApply() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) return;
  state.lines = snapshot.lines.map(normalizeLineDict);
  refreshAll();
  queueAutoSave();
}
