// @module settings.js — Settings modal: open, save, and reset all project settings

import { state, ui } from './state.js';
import {
  DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
  DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL, DEFAULT_PROMPT_HEADER_JSON_ARRAY,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_SELECTION_BATCH_SIZE, DEFAULT_GLOSSARY_BATCH_SIZE, DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_SELECTION_BATCH_PREV_SHORTCUT, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
  DEFAULT_LUCA_MC_DISPLAY_NAME,
} from './constants.js';
import { getDefaultPromptHeaderForFormat, normalizeAiTranslationFormat } from './ai-format.js';
import { normalizeSelectionBatchSize } from './selection.js';
import { normalizeShortcutString, isReservedShortcut, bindShortcutCaptureInput } from './shortcuts.js';
import { getLucaExportSlotOptions, populateLucaExportSlotSelect, getActiveLucaProfile, DEFAULT_LUCA_PROFILE } from './luca-engine.js';
import { refreshAll } from './render.js';
import { renderGlossaryPreview } from './glossary.js';
import { queueAutoSave, openModal, closeModal, DS_STORAGE_KEY } from './project.js';
import { applyHtlMode } from './htl-mode.js';


export function onOpenSettings() {
  ui.settingsSourceLangSelect.value = state.sourceLang || "Japanese";
  ui.settingsTargetLangSelect.value = state.targetLang || "Indonesian";
  if (ui.settingsTranslationModeSelect) {
    ui.settingsTranslationModeSelect.value = state.translationMode || "ai";
  }
  ui.settingsRegexFilterInput.value = state.regexFilter || "";
  // Reference language section only for JSON projects
  const isJson = state.projectType === "json";
  if (ui.settingsRefLangWrap) {
    ui.settingsRefLangWrap.style.display = isJson ? "block" : "none";
  }
  if (isJson) {
    const hasRef1 = state.lines.some(l => l.ref_lang_1 != null);
    const hasRef2 = state.lines.some(l => l.ref_lang_2 != null);
    if (ui.settingsRefLang1Select) {
      ui.settingsRefLang1Select.value = hasRef1 ? `Ada (${state.lines.filter(l => l.ref_lang_1 != null).length} baris)` : "";
    }
    if (ui.settingsRefLang2Select) {
      ui.settingsRefLang2Select.value = hasRef2 ? `Ada (${state.lines.filter(l => l.ref_lang_2 != null).length} baris)` : "";
    }
    if (ui.btnImportRefLang1) ui.btnImportRefLang1.disabled = !state.currentProjectId;
    if (ui.btnImportRefLang2) ui.btnImportRefLang2.disabled = !state.currentProjectId;
    if (ui.btnImportRefLang1Folder) ui.btnImportRefLang1Folder.disabled = !state.currentProjectId;
    if (ui.btnImportRefLang2Folder) ui.btnImportRefLang2Folder.disabled = !state.currentProjectId;
    if (ui.btnClearRefLang1) ui.btnClearRefLang1.disabled = !hasRef1;
    if (ui.btnClearRefLang2) ui.btnClearRefLang2.disabled = !hasRef2;
  }
  ui.settingsDisableEmptyLineValidation.checked = !!state.disableEmptyLineValidation;
  if (ui.settingsCheckKanaResidue) ui.settingsCheckKanaResidue.checked = !!state.checkKanaResidue;
  if (ui.settingsCheckSimilarity) {
    ui.settingsCheckSimilarity.checked = !!state.checkSimilarity;
    ui.settingsSimilarityThreshold.value = Math.round((state.similarityThreshold || 0.7) * 100);
    ui.settingsSimilarityThresholdWrap.style.display = state.checkSimilarity ? "flex" : "none";
  }
  if (ui.settingsAiTranslationFormatSelect) {
    ui.settingsAiTranslationFormatSelect.value = normalizeAiTranslationFormat(state.aiTranslationFormat);
  }
  ui.settingsPromptInput.value = state.aiInstructionHeader;
  ui.settingsGlossaryPromptInput.value = state.glossaryPrompt;
  ui.settingsAiCheckPromptInput.value = state.aiCheckPrompt;
  ui.settingsEpubTagsInput.value = state.epubTags || "p";
  ui.settingsGlossaryInput.value = state.glossaryText || "";
  ui.settingsContextLinesInput.value = state.contextLines;
  if (ui.settingsContextTypeSelect) {
    ui.settingsContextTypeSelect.value = state.contextType || "raw";
  }
  ui.settingsSelectionBatchSizeInput.value = state.selectionBatchSize;
  ui.settingsGlossaryBatchSizeInput.value = state.glossaryBatchSize;
  ui.settingsAiCheckBatchSizeInput.value = state.aiCheckBatchSize;
  ui.settingsSelectionPrevShortcutInput.value = state.selectionBatchPrevShortcut;
  ui.settingsSelectionNextShortcutInput.value = state.selectionBatchNextShortcut;
  // LucaSystem settings visibility
  const showLucaSettings = state.projectType !== "epub";
  ui.settingsLucaWrap.style.display = showLucaSettings ? "block" : "none";
  if (ui.settingsLucaProfileSelect) {
    ui.settingsLucaProfileSelect.value = state.lucaProfile || DEFAULT_LUCA_PROFILE;
    ui.settingsLucaProfileSelect.disabled = state.lines.length > 0;
  }
  const activeProfile = getActiveLucaProfile();
  if (ui.settingsLucaMcWrap) {
    ui.settingsLucaMcWrap.style.display = activeProfile.nameAtFormat ? "block" : "none";
  }
  if (ui.settingsLucaMcDisplayNameInput) {
    ui.settingsLucaMcDisplayNameInput.value = state.lucaMcDisplayName || DEFAULT_LUCA_MC_DISPLAY_NAME;
  }
  if (ui.settingsLucaExportLangWrap) {
    ui.settingsLucaExportLangWrap.style.display = showLucaSettings ? "flex" : "none";
  }
  if (ui.settingsLucaExportLangSelect && showLucaSettings) {
    const profileId = ui.settingsLucaProfileSelect?.value || state.lucaProfile || DEFAULT_LUCA_PROFILE;
    populateLucaExportSlotSelect(profileId);
    const saved = state.lucaExportLang || "en";
    const options = getLucaExportSlotOptions(activeProfile);
    ui.settingsLucaExportLangSelect.value = options.some((o) => o.value === saved)
      ? saved
      : ui.settingsLucaExportLangSelect.value;
  }
  openModal(ui.settingsModal);
}

export function onSavePromptSettings() {
  const sourceLang = ui.settingsSourceLangSelect.value || "Japanese";
  const targetLang = ui.settingsTargetLangSelect.value || "Indonesian";
  const translationMode = ui.settingsTranslationModeSelect?.value === "htl" ? "htl" : "ai";
  const regexFilter = ui.settingsRegexFilterInput.value;
  const disableEmptyLineValidation = ui.settingsDisableEmptyLineValidation.checked;
  const checkKanaResidue = !!(ui.settingsCheckKanaResidue?.checked);
  const checkSimilarity = !!(ui.settingsCheckSimilarity?.checked);
  const simThresholdRaw = parseInt(ui.settingsSimilarityThreshold?.value);
  const similarityThreshold = (!isNaN(simThresholdRaw) && simThresholdRaw >= 1 && simThresholdRaw <= 99)
    ? simThresholdRaw / 100 : 0.7;
  
  if (regexFilter) {
    try {
      new RegExp(regexFilter, "u");
    } catch (err) {
      return alert("Regex Filter tidak valid: " + err.message);
    }
  }
  
  const aiInstructionHeader = ui.settingsPromptInput.value.trim();
  const aiTranslationFormat = normalizeAiTranslationFormat(ui.settingsAiTranslationFormatSelect?.value);
  const glossaryPrompt = ui.settingsGlossaryPromptInput.value.trim();
  const aiCheckPrompt = ui.settingsAiCheckPromptInput.value.trim();
  const epubTags = ui.settingsEpubTagsInput.value.trim() || "p";
  const glossaryText = ui.settingsGlossaryInput.value.trim();
  const contextLines = parseInt(ui.settingsContextLinesInput.value) || 0;
  const contextType = ui.settingsContextTypeSelect ? ui.settingsContextTypeSelect.value : "raw";
  const selectionBatchSize = normalizeSelectionBatchSize(ui.settingsSelectionBatchSizeInput.value);
  const glossaryBatchSize = normalizeSelectionBatchSize(ui.settingsGlossaryBatchSizeInput.value, DEFAULT_GLOSSARY_BATCH_SIZE);
  const aiCheckBatchSize = normalizeSelectionBatchSize(ui.settingsAiCheckBatchSizeInput.value, DEFAULT_AI_CHECK_BATCH_SIZE);
  const prevShortcut = normalizeShortcutString(ui.settingsSelectionPrevShortcutInput.value, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT);
  const nextShortcut = normalizeShortcutString(ui.settingsSelectionNextShortcutInput.value, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT);
  if (prevShortcut === nextShortcut) return alert("Shortcut batch sebelumnya dan berikutnya tidak boleh sama.");
  if (isReservedShortcut(prevShortcut) || isReservedShortcut(nextShortcut)) {
    return alert("Ctrl+ArrowUp dan Ctrl+ArrowDown sudah dipakai untuk riwayat pilihan.");
  }

  state.sourceLang = sourceLang;
  state.targetLang = targetLang;
  state.translationMode = translationMode;
  state.regexFilter = regexFilter;
  state.disableEmptyLineValidation = disableEmptyLineValidation;
  state.checkKanaResidue = checkKanaResidue;
  state.checkSimilarity = checkSimilarity;
  state.similarityThreshold = similarityThreshold;
  state.aiInstructionHeader = aiInstructionHeader;
  state.aiTranslationFormat = aiTranslationFormat;
  state.glossaryPrompt = glossaryPrompt;
  state.aiCheckPrompt = aiCheckPrompt;
  state.epubTags = epubTags;
  state.glossaryText = glossaryText;
  state.contextLines = contextLines;
  state.contextType = contextType;
  state.selectionBatchSize = selectionBatchSize;
  state.glossaryBatchSize = glossaryBatchSize;
  state.aiCheckBatchSize = aiCheckBatchSize;
  state.selectionBatchPrevShortcut = prevShortcut;
  state.selectionBatchNextShortcut = nextShortcut;
  state.lucaExportLang = ui.settingsLucaExportLangSelect.value || "en";
  if (ui.settingsLucaMcDisplayNameInput) {
    state.lucaMcDisplayName = ui.settingsLucaMcDisplayNameInput.value.trim() || DEFAULT_LUCA_MC_DISPLAY_NAME;
  }
  if (ui.settingsLucaProfileSelect && state.lines.length === 0) {
    state.lucaProfile = ui.settingsLucaProfileSelect.value || DEFAULT_LUCA_PROFILE;
  }

  ui.settingsSelectionBatchSizeInput.value = selectionBatchSize;
  ui.settingsGlossaryBatchSizeInput.value = glossaryBatchSize;
  ui.settingsAiCheckBatchSizeInput.value = aiCheckBatchSize;
  ui.settingsSelectionPrevShortcutInput.value = prevShortcut;
  ui.settingsSelectionNextShortcutInput.value = nextShortcut;
  closeModal(ui.settingsModal);
  applyHtlMode();
  refreshAll();
  renderGlossaryPreview();
  queueAutoSave();
}
