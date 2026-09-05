// @module settings.ts — Settings modal: open, save, and reset all project settings

import { state, ui } from './state';
import {
  DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
  DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL, DEFAULT_PROMPT_HEADER_JSON_ARRAY,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_SELECTION_BATCH_SIZE, DEFAULT_GLOSSARY_BATCH_SIZE, DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_AGENT_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
} from './constants';
import { getDefaultPromptHeaderForFormat, normalizeAiTranslationFormat } from './ai-format';
import { normalizeSelectionBatchSize } from './selection';
import { refreshAll, compileRegexFilter } from './render';
import { renderGlossaryPreview } from './glossary';
import { queueAutoSave, openModal, closeModal, DS_STORAGE_KEY } from './project';
import { applyHtlMode } from './htl-mode';
import { prefillIncrement } from './increment';

export function onOpenSettings(): void {
  (ui.settingsSourceLangSelect as HTMLSelectElement).value = state.sourceLang || 'Japanese';
  (ui.settingsTargetLangSelect as HTMLSelectElement).value = state.targetLang || 'Indonesian';
  if (ui.settingsTranslationModeSelect) {
    (ui.settingsTranslationModeSelect as HTMLSelectElement).value = state.translationMode || 'ai';
  }
  (ui.settingsRegexFilterInput as HTMLInputElement).value = state.regexFilter || '';
  if (ui.settingsRegexFilterCaseCheck) {
    (ui.settingsRegexFilterCaseCheck as HTMLInputElement).checked = !!state.regexFilterCase;
  }
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
  if (ui.settingsCheckLengthRatio) {
    (ui.settingsCheckLengthRatio as HTMLInputElement).checked = !!state.checkLengthRatio;
    (ui.settingsLengthRatioThreshold as HTMLInputElement).value = String(state.lengthRatioThreshold || 2.5);
    (document.getElementById('settingsLengthRatioWrap') as HTMLElement).style.display = state.checkLengthRatio ? 'flex' : 'none';
  }
  if (ui.settingsCheckLinebreak) (ui.settingsCheckLinebreak as HTMLInputElement).checked = state.checkLinebreak !== false;
  if (ui.settingsCheckLanguage) (ui.settingsCheckLanguage as HTMLInputElement).checked = state.checkLanguage !== false;
  if (ui.settingsCheckPunctuation) (ui.settingsCheckPunctuation as HTMLInputElement).checked = state.checkPunctuation !== false;
  if (ui.settingsCheckUntransName) (ui.settingsCheckUntransName as HTMLInputElement).checked = !!state.checkUntransName;
  if (ui.settingsEnableUncertainMarking) (ui.settingsEnableUncertainMarking as HTMLInputElement).checked = !!state.enableUncertainMarking;
  if (ui.settingsSafeTagsForChatgpt) (ui.settingsSafeTagsForChatgpt as HTMLInputElement).checked = !!state.safeTagsForChatgpt;
  if (ui.settingsAgentMaxTurns) (ui.settingsAgentMaxTurns as HTMLInputElement).value = String(state.agentMaxTurns || 10);
  if (ui.settingsAiTranslationFormatSelect) {
    (ui.settingsAiTranslationFormatSelect as HTMLSelectElement).value = normalizeAiTranslationFormat(state.aiTranslationFormat);
  }
  (ui.settingsPromptInput as HTMLTextAreaElement).value = state.aiInstructionHeader;
  (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = state.glossaryPrompt;
  (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = state.aiCheckPrompt;
  (ui.settingsEpubTagsInput as HTMLInputElement).value = state.epubTags || 'p';
  const showEpubCheckbox = (document.getElementById('settingsShowEpubImages') || ui.settingsShowEpubImages) as HTMLInputElement | null;
  if (showEpubCheckbox) showEpubCheckbox.checked = state.showEpubImages !== false;
  (ui.settingsGlossaryInput as HTMLTextAreaElement).value = state.glossaryText || '';
  (ui.settingsContextLinesInput as HTMLInputElement).value = String(state.contextLines);
  if (ui.settingsContextTypeSelect) {
    (ui.settingsContextTypeSelect as HTMLSelectElement).value = state.contextType || 'raw';
  }
  (ui.settingsSelectionBatchSizeInput as HTMLInputElement).value = String(state.selectionBatchSize);
  (ui.settingsGlossaryBatchSizeInput as HTMLInputElement).value = String(state.glossaryBatchSize);
  (ui.settingsAiCheckBatchSizeInput as HTMLInputElement).value = String(state.aiCheckBatchSize);
  if (ui.settingsParallelBatchSizeInput) (ui.settingsParallelBatchSizeInput as HTMLInputElement).value = String(state.parallelBatchSize ?? 1);
  if (ui.settingsSubagentWorkersInput) (ui.settingsSubagentWorkersInput as HTMLInputElement).value = String(state.subagentWorkers ?? 3);

  const incCheck = document.getElementById('settingsIncrementCheck') as HTMLInputElement | null;
  if (incCheck) incCheck.checked = !!state.incrementEnabled;

  // Pengaturan LucaSystem sudah pindah ke modal Parser Custom (custom-parser-modal.ts)
  openModal(ui.settingsModal as HTMLElement);
}

export function onOpenPromptsSettings(): void {
  (ui.settingsEnableBackgroundChaining as HTMLInputElement).checked = state.enableBackgroundChaining;
  (ui.settingsBackgroundInput as HTMLTextAreaElement).value = state.currentBackground;
  if (ui.settingsSummaryPromptInput) {
    (ui.settingsSummaryPromptInput as HTMLTextAreaElement).value = state.summaryPrompt !== undefined && state.summaryPrompt !== ''
      ? state.summaryPrompt
      : DEFAULT_SUMMARY_PROMPT;
  }

  if (state.projectName) {
    (ui.settingsPromptInput as HTMLTextAreaElement).value = state.aiInstructionHeader;
    (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = state.glossaryPrompt;
    (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = state.aiCheckPrompt;
    (ui.settingsAgentPromptInput as HTMLTextAreaElement).value = state.agentPrompt;
  } else {
    const format = (ui.settingsAiTranslationFormatSelect as HTMLSelectElement)?.value || DEFAULT_AI_TRANSLATION_FORMAT;
    (ui.settingsPromptInput as HTMLTextAreaElement).value = getDefaultPromptHeaderForFormat(format);
    (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = DEFAULT_GLOSSARY_PROMPT;
    (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = DEFAULT_AI_CHECK_PROMPT;
    (ui.settingsAgentPromptInput as HTMLTextAreaElement).value = DEFAULT_AGENT_PROMPT;
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
  const regexFilterCase = !!((ui.settingsRegexFilterCaseCheck as HTMLInputElement)?.checked);
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
      compileRegexFilter(regexFilter, regexFilterCase);
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
  const parallelBatchSize = Math.max(1, Math.min(10, parseInt((ui.settingsParallelBatchSizeInput as HTMLInputElement)?.value) || 1));

  const oldShowEpubImages = state.showEpubImages;
  const showEpubCheckbox = (document.getElementById('settingsShowEpubImages') || ui.settingsShowEpubImages) as HTMLInputElement | null;
  if (showEpubCheckbox) {
    state.showEpubImages = showEpubCheckbox.checked;
  }

  state.sourceLang = sourceLang;
  state.targetLang = targetLang;
  state.translationMode = translationMode as any;
  state.regexFilter = regexFilter;
  state.regexFilterCase = regexFilterCase;
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
  state.checkLengthRatio = !!((ui.settingsCheckLengthRatio as HTMLInputElement)?.checked);
  const lrRaw = parseFloat((ui.settingsLengthRatioThreshold as HTMLInputElement)?.value);
  state.lengthRatioThreshold = (!isNaN(lrRaw) && lrRaw >= 1 && lrRaw <= 10) ? lrRaw : 2.5;
  state.checkLinebreak = (ui.settingsCheckLinebreak as HTMLInputElement)?.checked !== false;
  state.checkLanguage = (ui.settingsCheckLanguage as HTMLInputElement)?.checked !== false;
  state.checkPunctuation = (ui.settingsCheckPunctuation as HTMLInputElement)?.checked !== false;
  state.checkUntransName = !!((ui.settingsCheckUntransName as HTMLInputElement)?.checked);
  state.enableUncertainMarking = !!((ui.settingsEnableUncertainMarking as HTMLInputElement)?.checked);
  state.safeTagsForChatgpt = !!((ui.settingsSafeTagsForChatgpt as HTMLInputElement)?.checked);
  const amtRaw = parseInt((ui.settingsAgentMaxTurns as HTMLInputElement)?.value);
  state.agentMaxTurns = (!isNaN(amtRaw) && amtRaw >= 3 && amtRaw <= 30) ? amtRaw : 10;
  state.aiTranslationFormat = aiTranslationFormat;
  state.contextLines = contextLines;
  state.contextType = contextType as any;
  state.selectionBatchSize = selectionBatchSize;
  state.glossaryBatchSize = glossaryBatchSize;
  state.aiCheckBatchSize = aiCheckBatchSize;
  state.parallelBatchSize = parallelBatchSize;
  state.subagentWorkers = Math.max(1, Math.min(10, parseInt((ui.settingsSubagentWorkersInput as HTMLInputElement)?.value) || 3));

  const prevInc = state.incrementEnabled;
  const incCheck = document.getElementById('settingsIncrementCheck') as HTMLInputElement | null;
  if (incCheck) state.incrementEnabled = incCheck.checked;
  // Luca settings (export lang, MC name, profile) disimpan oleh modal Parser Custom — bukan di sini lagi.

  (ui.settingsSelectionBatchSizeInput as HTMLInputElement).value = String(selectionBatchSize);
  (ui.settingsGlossaryBatchSizeInput as HTMLInputElement).value = String(glossaryBatchSize);
  (ui.settingsAiCheckBatchSizeInput as HTMLInputElement).value = String(aiCheckBatchSize);
  closeModal(ui.settingsModal as HTMLElement);
  applyHtlMode();
  if (!oldShowEpubImages && state.showEpubImages && state.projectType === 'epub' && state.epubSourceId) {
    import('./epub-images').then(m => m.preloadEpubImages()).then(() => refreshAll());
  } else {
    refreshAll();
  }
  if (!prevInc && state.incrementEnabled && state.lines.length) {
    prefillIncrement();
  }
  renderGlossaryPreview();
  queueAutoSave();
}

export function onSavePromptsSettings(): void {
  const aiInstructionHeader = (ui.settingsPromptInput as HTMLTextAreaElement).value.trim();
  const glossaryPrompt = (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value.trim();
  const aiCheckPrompt = (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value.trim();
  const agentPrompt = (ui.settingsAgentPromptInput as HTMLTextAreaElement).value.trim();
  const epubTags = (ui.settingsEpubTagsInput as HTMLInputElement)?.value.trim() || 'p';
  const enableBackgroundChaining = (ui.settingsEnableBackgroundChaining as HTMLInputElement).checked;
  const currentBackground = (ui.settingsBackgroundInput as HTMLTextAreaElement).value.trim();
  const summaryPrompt = (ui.settingsSummaryPromptInput as HTMLTextAreaElement)?.value.trim() || '';
  
  state.aiInstructionHeader = aiInstructionHeader;
  state.glossaryPrompt = glossaryPrompt;
  state.aiCheckPrompt = aiCheckPrompt;
  state.agentPrompt = agentPrompt;
  state.epubTags = epubTags;
  state.enableBackgroundChaining = enableBackgroundChaining;
  state.currentBackground = currentBackground;
  state.summaryPrompt = summaryPrompt;
  
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
