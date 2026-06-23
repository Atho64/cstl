// @module settings.ts — Settings modal: open, save, and reset all project settings

import { state, ui } from './state';
import {
  DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
  DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL, DEFAULT_PROMPT_HEADER_JSON_ARRAY,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_SELECTION_BATCH_SIZE, DEFAULT_GLOSSARY_BATCH_SIZE, DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_SELECTION_BATCH_PREV_SHORTCUT, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
  DEFAULT_LUCA_MC_DISPLAY_NAME,
} from './constants';
import { getDefaultPromptHeaderForFormat, normalizeAiTranslationFormat } from './ai-format';
import { normalizeSelectionBatchSize } from './selection';
import { normalizeShortcutString, isReservedShortcut, bindShortcutCaptureInput } from './shortcuts';
import { getLucaExportSlotOptions, populateLucaExportSlotSelect, getActiveLucaProfile, DEFAULT_LUCA_PROFILE } from './luca-engine';
import { refreshAll } from './render';
import { renderGlossaryPreview } from './glossary';
import { queueAutoSave, openModal, closeModal, DS_STORAGE_KEY } from './project';
import { applyHtlMode } from './htl-mode';

export function onOpenSettings(): void {
  (ui.settingsSourceLangSelect as HTMLSelectElement).value = state.sourceLang || 'Japanese';
  (ui.settingsTargetLangSelect as HTMLSelectElement).value = state.targetLang || 'Indonesian';
  if (ui.settingsTranslationModeSelect) {
    (ui.settingsTranslationModeSelect as HTMLSelectElement).value = state.translationMode || 'ai';
  }
  (ui.settingsRegexFilterInput as HTMLInputElement).value = state.regexFilter || '';
  const isJson = state.projectType === 'json';
  if (ui.settingsRefLangWrap) {
    (ui.settingsRefLangWrap as HTMLElement).style.display = isJson ? 'block' : 'none';
  }
  if (isJson) {
    const hasRef1 = state.lines.some(l => l.ref_lang_1 != null);
    const hasRef2 = state.lines.some(l => l.ref_lang_2 != null);
    if (ui.settingsRefLang1Select) {
      (ui.settingsRefLang1Select as HTMLInputElement).value = hasRef1 ? `Ada (${state.lines.filter(l => l.ref_lang_1 != null).length} baris)` : '';
    }
    if (ui.settingsRefLang2Select) {
      (ui.settingsRefLang2Select as HTMLInputElement).value = hasRef2 ? `Ada (${state.lines.filter(l => l.ref_lang_2 != null).length} baris)` : '';
    }
    if (ui.btnImportRefLang1) (ui.btnImportRefLang1 as HTMLButtonElement).disabled = !state.currentProjectId;
    if (ui.btnImportRefLang2) (ui.btnImportRefLang2 as HTMLButtonElement).disabled = !state.currentProjectId;
    if (ui.btnImportRefLang1Folder) (ui.btnImportRefLang1Folder as HTMLButtonElement).disabled = !state.currentProjectId;
    if (ui.btnImportRefLang2Folder) (ui.btnImportRefLang2Folder as HTMLButtonElement).disabled = !state.currentProjectId;
    if (ui.btnClearRefLang1) (ui.btnClearRefLang1 as HTMLButtonElement).disabled = !hasRef1;
    if (ui.btnClearRefLang2) (ui.btnClearRefLang2 as HTMLButtonElement).disabled = !hasRef2;
  }
  (ui.settingsDisableEmptyLineValidation as HTMLInputElement).checked = !!state.disableEmptyLineValidation;
  if (ui.settingsShowFurigana) (ui.settingsShowFurigana as HTMLInputElement).checked = !!state.showFurigana;
  if (ui.settingsFuriganaType) (ui.settingsFuriganaType as HTMLSelectElement).value = state.furiganaType || 'hiragana';
  if (ui.settingsFontSize) (ui.settingsFontSize as HTMLInputElement).value = String(state.fontSize || 14);
  if (ui.settingsEnableDictionary) (ui.settingsEnableDictionary as HTMLInputElement).checked = !!state.enableDictionary;
  if (ui.settingsDictionaryEngine) (ui.settingsDictionaryEngine as HTMLSelectElement).value = state.dictionaryEngine || 'llm';
  if (ui.settingsDictionaryPrompt) (ui.settingsDictionaryPrompt as HTMLTextAreaElement).value = state.dictionaryPrompt || 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.';
  if (ui.settingsCheckKanaResidue) (ui.settingsCheckKanaResidue as HTMLInputElement).checked = !!state.checkKanaResidue;
  if (ui.settingsCheckSimilarity) {
    (ui.settingsCheckSimilarity as HTMLInputElement).checked = !!state.checkSimilarity;
    (ui.settingsSimilarityThreshold as HTMLInputElement).value = String(Math.round((state.similarityThreshold || 0.7) * 100));
    (ui.settingsSimilarityThresholdWrap as HTMLElement).style.display = state.checkSimilarity ? 'flex' : 'none';
  }
  if (ui.settingsAiTranslationFormatSelect) {
    (ui.settingsAiTranslationFormatSelect as HTMLSelectElement).value = normalizeAiTranslationFormat(state.aiTranslationFormat);
  }
  (ui.settingsPromptInput as HTMLTextAreaElement).value = state.aiInstructionHeader;
  (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = state.glossaryPrompt;
  (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = state.aiCheckPrompt;
  (ui.settingsEpubTagsInput as HTMLInputElement).value = state.epubTags || 'p';
  (ui.settingsGlossaryInput as HTMLTextAreaElement).value = state.glossaryText || '';
  (ui.settingsContextLinesInput as HTMLInputElement).value = String(state.contextLines);
  if (ui.settingsContextTypeSelect) {
    (ui.settingsContextTypeSelect as HTMLSelectElement).value = state.contextType || 'raw';
  }
  (ui.settingsSelectionBatchSizeInput as HTMLInputElement).value = String(state.selectionBatchSize);
  (ui.settingsGlossaryBatchSizeInput as HTMLInputElement).value = String(state.glossaryBatchSize);
  (ui.settingsAiCheckBatchSizeInput as HTMLInputElement).value = String(state.aiCheckBatchSize);
  (ui.settingsSelectionPrevShortcutInput as HTMLInputElement).value = state.selectionBatchPrevShortcut;
  (ui.settingsSelectionNextShortcutInput as HTMLInputElement).value = state.selectionBatchNextShortcut;

  const showLucaSettings = state.projectType !== 'epub';
  (ui.settingsLucaWrap as HTMLElement).style.display = showLucaSettings ? 'block' : 'none';
  if (ui.settingsLucaProfileSelect) {
    (ui.settingsLucaProfileSelect as HTMLSelectElement).value = state.lucaProfile || DEFAULT_LUCA_PROFILE;
    (ui.settingsLucaProfileSelect as HTMLSelectElement).disabled = state.lines.length > 0;
  }
  const activeProfile = getActiveLucaProfile();
  if (ui.settingsLucaMcWrap) {
    (ui.settingsLucaMcWrap as HTMLElement).style.display = activeProfile.nameAtFormat ? 'block' : 'none';
  }
  if (ui.settingsLucaMcDisplayNameInput) {
    (ui.settingsLucaMcDisplayNameInput as HTMLInputElement).value = state.lucaMcDisplayName || DEFAULT_LUCA_MC_DISPLAY_NAME;
  }
  if (ui.settingsLucaExportLangWrap) {
    (ui.settingsLucaExportLangWrap as HTMLElement).style.display = showLucaSettings ? 'flex' : 'none';
  }
  if (ui.settingsLucaExportLangSelect && showLucaSettings) {
    const profileId = (ui.settingsLucaProfileSelect as HTMLSelectElement)?.value || state.lucaProfile || DEFAULT_LUCA_PROFILE;
    populateLucaExportSlotSelect(profileId);
    const saved = state.lucaExportLang || 'en';
    const options = getLucaExportSlotOptions(activeProfile);
    (ui.settingsLucaExportLangSelect as HTMLSelectElement).value = options.some(o => o.value === saved)
      ? saved
      : (ui.settingsLucaExportLangSelect as HTMLSelectElement).value;
  }
  openModal(ui.settingsModal as HTMLElement);
}

export function onOpenPromptsSettings(): void {
  if (state.projectName) {
    (ui.settingsPromptInput as HTMLTextAreaElement).value = state.aiInstructionHeader;
    (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = state.glossaryPrompt;
    (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = state.aiCheckPrompt;
  } else {
    const format = (ui.settingsAiTranslationFormatSelect as HTMLSelectElement)?.value || DEFAULT_AI_TRANSLATION_FORMAT;
    (ui.settingsPromptInput as HTMLTextAreaElement).value = getDefaultPromptHeaderForFormat(format);
    (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = DEFAULT_GLOSSARY_PROMPT;
    (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = DEFAULT_AI_CHECK_PROMPT;
  }
  openModal(ui.settingsPromptsModal as HTMLElement);
}

export function onOpenGlossarySettings(): void {
  (ui.settingsGlossaryInput as HTMLTextAreaElement).value = state.glossaryText || '';
  openModal(ui.settingsGlossaryModal as HTMLElement);
}

export function onSavePromptSettings(): void {
  // === General Settings ===
  const sourceLang = (ui.settingsSourceLangSelect as HTMLSelectElement).value || 'Japanese';
  const targetLang = (ui.settingsTargetLangSelect as HTMLSelectElement).value || 'Indonesian';
  const translationMode = (ui.settingsTranslationModeSelect as HTMLSelectElement)?.value === 'htl' ? 'htl' : 'ai';
  const regexFilter = (ui.settingsRegexFilterInput as HTMLInputElement).value;
  const disableEmptyLineValidation = (ui.settingsDisableEmptyLineValidation as HTMLInputElement).checked;
  const showFurigana = !!((ui.settingsShowFurigana as HTMLInputElement)?.checked);
  const fontSize = parseInt((ui.settingsFontSize as HTMLInputElement)?.value) || 14;
  const enableDictionary = !!((ui.settingsEnableDictionary as HTMLInputElement)?.checked);
  const dictionaryEngine = (ui.settingsDictionaryEngine as HTMLSelectElement)?.value === 'jisho' ? 'jisho' : 'llm';
  const dictionaryPrompt = (ui.settingsDictionaryPrompt as HTMLTextAreaElement)?.value || 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.';
  const checkKanaResidue = !!((ui.settingsCheckKanaResidue as HTMLInputElement)?.checked);
  const checkSimilarity = !!((ui.settingsCheckSimilarity as HTMLInputElement)?.checked);
  const simThresholdRaw = parseInt((ui.settingsSimilarityThreshold as HTMLInputElement)?.value);
  const similarityThreshold = (!isNaN(simThresholdRaw) && simThresholdRaw >= 1 && simThresholdRaw <= 99)
    ? simThresholdRaw / 100 : 0.7;

  if (regexFilter) {
    try {
      new RegExp(regexFilter, 'u');
    } catch (err: any) {
      return alert('Regex Filter tidak valid: ' + err.message);
    }
  }

  const aiTranslationFormat = normalizeAiTranslationFormat((ui.settingsAiTranslationFormatSelect as HTMLSelectElement)?.value);
  const contextLines = parseInt((ui.settingsContextLinesInput as HTMLInputElement).value) || 0;
  const contextType = ui.settingsContextTypeSelect ? (ui.settingsContextTypeSelect as HTMLSelectElement).value : 'raw';
  const selectionBatchSize = normalizeSelectionBatchSize((ui.settingsSelectionBatchSizeInput as HTMLInputElement).value);
  const glossaryBatchSize = normalizeSelectionBatchSize((ui.settingsGlossaryBatchSizeInput as HTMLInputElement).value, DEFAULT_GLOSSARY_BATCH_SIZE);
  const aiCheckBatchSize = normalizeSelectionBatchSize((ui.settingsAiCheckBatchSizeInput as HTMLInputElement).value, DEFAULT_AI_CHECK_BATCH_SIZE);
  const prevShortcut = normalizeShortcutString((ui.settingsSelectionPrevShortcutInput as HTMLInputElement).value, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT);
  const nextShortcut = normalizeShortcutString((ui.settingsSelectionNextShortcutInput as HTMLInputElement).value, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT);
  if (prevShortcut === nextShortcut) return alert('Shortcut batch sebelumnya dan berikutnya tidak boleh sama.');
  if (isReservedShortcut(prevShortcut) || isReservedShortcut(nextShortcut)) {
    return alert('Ctrl+ArrowUp dan Ctrl+ArrowDown sudah dipakai untuk riwayat pilihan.');
  }

  state.sourceLang = sourceLang;
  state.targetLang = targetLang;
  state.translationMode = translationMode as any;
  state.regexFilter = regexFilter;
  state.disableEmptyLineValidation = disableEmptyLineValidation;
  const oldShowFurigana = state.showFurigana;
  state.showFurigana = showFurigana;
  state.furiganaType = ((ui.settingsFuriganaType as HTMLSelectElement)?.value as any) || 'furigana';
  state.fontSize = fontSize;
  document.documentElement.style.setProperty('--content-font-size', state.fontSize + 'px');
  state.enableDictionary = enableDictionary;
  state.dictionaryEngine = dictionaryEngine;
  state.dictionaryPrompt = dictionaryPrompt;
  state.checkKanaResidue = checkKanaResidue;
  state.checkSimilarity = checkSimilarity;
  state.similarityThreshold = similarityThreshold;
  state.aiTranslationFormat = aiTranslationFormat;
  state.contextLines = contextLines;
  state.contextType = contextType as any;
  state.selectionBatchSize = selectionBatchSize;
  state.glossaryBatchSize = glossaryBatchSize;
  state.aiCheckBatchSize = aiCheckBatchSize;
  state.selectionBatchPrevShortcut = prevShortcut;
  state.selectionBatchNextShortcut = nextShortcut;
  state.lucaExportLang = (ui.settingsLucaExportLangSelect as HTMLSelectElement)?.value || state.lucaExportLang || 'en';
  if (ui.settingsLucaMcDisplayNameInput) {
    state.lucaMcDisplayName = (ui.settingsLucaMcDisplayNameInput as HTMLInputElement).value.trim() || DEFAULT_LUCA_MC_DISPLAY_NAME;
  }
  if (ui.settingsLucaProfileSelect && state.lines.length === 0) {
    state.lucaProfile = (ui.settingsLucaProfileSelect as HTMLSelectElement).value || DEFAULT_LUCA_PROFILE;
  }

  (ui.settingsSelectionBatchSizeInput as HTMLInputElement).value = String(selectionBatchSize);
  (ui.settingsGlossaryBatchSizeInput as HTMLInputElement).value = String(glossaryBatchSize);
  (ui.settingsAiCheckBatchSizeInput as HTMLInputElement).value = String(aiCheckBatchSize);
  (ui.settingsSelectionPrevShortcutInput as HTMLInputElement).value = prevShortcut;
  (ui.settingsSelectionNextShortcutInput as HTMLInputElement).value = nextShortcut;
  closeModal(ui.settingsModal as HTMLElement);
  applyHtlMode();
  refreshAll();
  renderGlossaryPreview();
  queueAutoSave();
}

export function onSavePromptsSettings(): void {
  const aiInstructionHeader = (ui.settingsPromptInput as HTMLTextAreaElement).value.trim();
  const glossaryPrompt = (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value.trim();
  const aiCheckPrompt = (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value.trim();
  const epubTags = (ui.settingsEpubTagsInput as HTMLInputElement)?.value.trim() || 'p';
  state.aiInstructionHeader = aiInstructionHeader;
  state.glossaryPrompt = glossaryPrompt;
  state.aiCheckPrompt = aiCheckPrompt;
  state.epubTags = epubTags;
  if (ui.settingsPromptsModal) closeModal(ui.settingsPromptsModal as HTMLElement);
  queueAutoSave();
}

export function onSaveGlossarySettings(): void {
  const glossaryText = (ui.settingsGlossaryInput as HTMLTextAreaElement).value.trim();
  state.glossaryText = glossaryText;
  if (ui.settingsGlossaryModal) closeModal(ui.settingsGlossaryModal as HTMLElement);
  renderGlossaryPreview();
  queueAutoSave();
}
