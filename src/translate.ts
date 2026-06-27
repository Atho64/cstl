// @module translate.ts — Copy for AI, paste and apply translations, undo

import { state, ui, normalizeLineDict } from './state';
import { isTranslated } from './state';
import {
  buildSelectedTranslationExport, detectTranslationPasteFormat,
  parseTranslationBlocks, parseTranslationXml, parseTranslationJsonl, parseTranslationJsonArray,
  parseTranslationNumberedPaste, applyPromptVariables,
} from './ai-format';
import { unescapeStoredNewlines, escapeStoredNewlines, stringSimilarity, applyReplaceRules } from './string-utils';
import { rebuildDisplayState, renderPreviewRows, syncCheckboxUI, flashHint, updateButtonStates, pushUndoSnapshot, refreshAll } from './render';
import { queueAutoSave } from './project';
import { getGlossaryMatches, getGlossaryPrompt } from './glossary';
import {
  AI_TRANSLATION_FORMAT_BLOCK, AI_TRANSLATION_FORMAT_XML,
  AI_TRANSLATION_FORMAT_JSONL, AI_TRANSLATION_FORMAT_JSON_ARRAY, DEFAULT_PROMPT_HEADER,
} from './constants';


export async function onCopyForAi(): Promise<void> {
  const sel = state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l));
  if (!sel.length) return;

  let contextBlock = '';
  if (state.contextLines > 0) {
    const firstSelLineNum = sel[0].line_num;
    const firstSelIdx = state.lines.findIndex(l => l.line_num === firstSelLineNum);
    if (firstSelIdx > 0) {
      const startIdx = Math.max(0, firstSelIdx - state.contextLines);
      const ctxLines = state.lines.slice(startIdx, firstSelIdx);
      const ctxOut: string[] = [];
      for (const l of ctxLines) {
        const origNameStr = l.name ? `${l.name}: ` : '';
        const transNameStr = (l.trans_name || l.name) ? `${(l.trans_name || l.name)!.trim()}: ` : '';
        if (state.contextType === 'raw') {
          ctxOut.push(`${origNameStr}${l.message}`);
        } else if (state.contextType === 'both') {
          ctxOut.push(`[Original] ${origNameStr}${l.message}\n[Translated] ${transNameStr}${l.trans_message || ''}`);
        } else {
          ctxOut.push(`${transNameStr}${l.trans_message || l.message}`);
        }
      }
      if (ctxOut.length > 0) {
        contextBlock = `\n\n<Context>\nThese lines are for context only. Do NOT translate them.\n${ctxOut.join('\n')}\n</Context>`;
      }
    }
  }

  const joinedText = buildSelectedTranslationExport(false);
  const glossaryBlock = getGlossaryPrompt(joinedText);
  const baseHeader = applyPromptVariables((state.aiInstructionHeader || DEFAULT_PROMPT_HEADER).trim());
  const sections: string[] = [baseHeader];
  if (glossaryBlock) sections.push(glossaryBlock.trim());
  if (contextBlock) sections.push(contextBlock.trim());
  if (state.enableBackgroundChaining && state.currentBackground) {
    sections.push(`<background>\n${state.currentBackground.trim()}\n</background>`);
  }
  sections.push(joinedText.trim());
  const p = sections.join('\n\n');
  try {
    await navigator.clipboard.writeText(p);
    flashHint(`Disalin ${sel.length} baris.`);
  } catch (_) {
    (ui.pasteArea as HTMLTextAreaElement).value = p;
  }
}

export class TranslationApplyError extends Error {
  details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'TranslationApplyError';
    this.details = details;
  }
}

type ApplyTranslationOptions = {
  suppressAlerts?: boolean;
};

export function onApplyTranslation(options: ApplyTranslationOptions = {}): void {
  const { suppressAlerts = false } = options;
  const fail = (message: string, details: string[] = []): never => {
    const suffix = details.length ? '\n\n' + details.join('\n') : '';
    if (suppressAlerts) {
      throw new TranslationApplyError(message, details);
    }
    alert(message + suffix);
    throw new Error(message); // Throw to abort execution of onApplyTranslation
  };

  if (!state.lines.length) return;
  let rawText = (ui.pasteArea as HTMLTextAreaElement).value.trim();
  if (!rawText) fail('Teks di kotak kosong atau tidak valid.');

  if (state.enableBackgroundChaining) {
    const bgMatch = rawText.match(/<background>([\s\S]*?)<\/background>/i);
    if (bgMatch) {
      state.currentBackground = bgMatch[1].trim();
      rawText = rawText.replace(/<background>[\s\S]*?<\/background>/i, '').trim();
      flashHint('Memori latar belakang diperbarui!');
      if (ui.settingsBackgroundInput) {
        (ui.settingsBackgroundInput as HTMLTextAreaElement).value = state.currentBackground;
      }
      queueAutoSave();
    }
  }

  const pasteFormat = detectTranslationPasteFormat(rawText);
  const selectedUntranslated = new Set(state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l)).map(l => l.line_num));
  const expectedCount = selectedUntranslated.size;
  let parsed: any[] = [];
  let errors: string[] = [];

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
  } catch (err: any) {
    fail('Gagal parse terjemahan:', [err.message]);
  }

  const seen = new Set<number>();
  for (const item of parsed) {
    if (seen.has(item.num)) errors.push(`[#${item.num}] Duplikat nomor baris.`);
    seen.add(item.num);
  }

  if (!parsed.length && !errors.length) fail('Teks di kotak kosong atau tidak valid.');
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

  const ignoreNames = (ui.checkIgnorePasteNames as HTMLInputElement).checked;
  const updates: { l: any; it: any }[] = [];
  for (const it of parsed) {
    const l = state.lineByNum.get(it.num);
    if (!l) { errors.push(`[#${it.num}] Tidak ada di JSON asli.`); continue; }
    const oN = !!(l.name || '').trim();
    let tN = !!(it.name || '').trim();
    if (tN) {
      it.name = applyReplaceRules(it.name!, state.postReplaceRules);
    }
    // Replace <br> back to literal \n (for Luca format) and apply postReplaceRules
    it.msg = applyReplaceRules(it.msg.replace(/<br>/gi, '\\n'), state.postReplaceRules);

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
        const origRaw = unescapeStoredNewlines(l.message || '');
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
    const visibleErrors = errors.slice(0, 10);
    if (errors.length > 10) visibleErrors.push(`... (+${errors.length - 10} error lain)`);
    fail('TRANSLASI DITOLAK:', visibleErrors);
  }
  pushUndoSnapshot();
  for (const { l, it } of updates) {
    l.trans_message = it.msg;
    l.is_translated = !!(it.msg || state.disableEmptyLineValidation);
    if (it.name && !ignoreNames) l.trans_name = it.name;
    state.selectedLines.delete(l.line_num);
  }
  (ui.pasteArea as HTMLTextAreaElement).value = '';
  refreshAll();
  queueAutoSave();
  flashHint(`${updates.length} baris sukses diterapkan.`);
}

export function onUndoLastApply(): void {
  if (state.undoStack.length === 0) return;
  
  // Push current state to redoStack
  state.redoStack.push({
    lines: state.lines.map(l => ({
      line_num: l.line_num,
      trans_name: l.trans_name,
      trans_message: l.trans_message,
      is_translated: l.is_translated,
      _hidden: l._hidden,
      _glossary_extracted: l._glossary_extracted,
      _ai_checked: l._ai_checked,
    }))
  });

  const snapshot = state.undoStack.pop();
  if (!snapshot) return;
  for (const saved of snapshot.lines) {
    const l = state.lineByNum.get(saved.line_num);
    if (l) {
      l.trans_name = saved.trans_name;
      l.trans_message = saved.trans_message;
      l.is_translated = saved.is_translated;
      l._hidden = saved._hidden;
      l._glossary_extracted = saved._glossary_extracted;
      l._ai_checked = saved._ai_checked;
    }
  }
  refreshAll();
  queueAutoSave();
  flashHint('Undo berhasil.');
}

export function onRedoLastUndo(): void {
  if (state.redoStack.length === 0) return;
  
  // Push current state to undoStack but WITHOUT clearing redoStack
  pushUndoSnapshot(false);

  const snapshot = state.redoStack.pop();
  if (!snapshot) return;
  for (const saved of snapshot.lines) {
    const l = state.lineByNum.get(saved.line_num);
    if (l) {
      l.trans_name = saved.trans_name;
      l.trans_message = saved.trans_message;
      l.is_translated = saved.is_translated;
      l._hidden = saved._hidden;
      l._glossary_extracted = saved._glossary_extracted;
      l._ai_checked = saved._ai_checked;
    }
  }
  refreshAll();
  queueAutoSave();
  flashHint('Redo berhasil.');
}

export function applyAgentTranslations(updates: {num: number, trans_message: string, trans_name?: string}[]): number {
  if (!updates || !updates.length) return 0;
  pushUndoSnapshot();
  let applied = 0;
  for (const it of updates) {
    const l = state.lineByNum.get(it.num);
    if (!l) continue;
    
    // Process newlines
    let msg = it.trans_message.replace(/<br>/gi, '\\n');
    msg = applyReplaceRules(msg, state.postReplaceRules);
    
    l.trans_message = escapeStoredNewlines(msg);
    l.is_translated = !!l.trans_message || state.disableEmptyLineValidation;
    
    if (it.trans_name) {
      l.trans_name = applyReplaceRules(it.trans_name, state.postReplaceRules);
    }
    
    state.selectedLines.delete(l.line_num);
    applied++;
  }
  
  refreshAll();
  queueAutoSave();
  return applied;
}

export function clearAgentTranslations(line_nums: number[]): number {
  if (!line_nums || !line_nums.length) return 0;
  pushUndoSnapshot();
  let cleared = 0;
  for (const num of line_nums) {
    const l = state.lineByNum.get(num);
    if (!l) continue;
    
    l.trans_message = '';
    l.trans_name = '';
    l.is_translated = false;
    cleared++;
  }
  
  refreshAll();
  queueAutoSave();
  return cleared;
}
