// @module ui-init.ts — DOM element caching, scroller initialization, and event binding

import { state, ui, setMainScroller, setProofreadScroller, setQaScroller } from './state';
import {
  DEFAULT_AI_TRANSLATION_FORMAT, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
  DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL, DEFAULT_PROMPT_HEADER_JSON_ARRAY,
  DEFAULT_PROMPT_HEADER_COMPLEX_ID, DEFAULT_PROMPT_HEADER_COMPLEX_EN,
  DEFAULT_AGENT_PROMPT
} from './constants';
import { VirtualScroller } from './virtual-scroller';
import { renderMainRow, syncCheckboxUI, updateButtonStates, onSaveLineEditor, flashHint, updateCurrentFileBar } from './render';
import { renderProofreadRow } from './proofread';
import { renderQaRow } from './qa';
import { onSelectionHistoryKeydown, isSelectableForActiveTab, recordSelectionHistory, switchWorkspaceTab } from './selection';
import { onSaveGlossary, onImportGlossaryFile, onExportGlossaryFile, onDeleteTranslation, onCopyForGlossaryAi } from './glossary';
import { onCopyForAi, onApplyTranslation, onUndoLastApply, onRedoLastUndo } from './translate';
import { onCopyNamesForAi, onApplyNameTranslations, onResetNameTranslations } from './name-translation';
import { onCopyForAiCheck, onParseAiCheck, onApplyAiCheckCorrections, onClearAiCheck } from './ai-check';
import { onOpenProofread, onResetProofread, onProofreadReplaceAll, renderProofreadResults } from './proofread';
import { onOpenQa, onResetQa, runQaCheck, onRetranslateFlagged } from './qa';
import { onOpenSettings, onSavePromptSettings, onOpenPromptsSettings, onOpenGlossarySettings, onSavePromptsSettings, onSaveGlossarySettings } from './settings';
import { onExport } from './export';
import { onImportVndbNames, onImportAnilistNames } from './vndb-anilist';
import { onExtractEpubRubyNames } from './epub-ruby';
import {
  onImportRefLang1, onImportRefLang2, onImportRefLang1Folder, onImportRefLang2Folder,
  onRefLang1FileChange, onRefLang2FileChange, onRefLang1FolderChange, onRefLang2FolderChange,
  onClearRefLang1, onClearRefLang2, applyHtlMode, refreshHtlPanels,
} from './htl-mode';
import { loadApiSettings, onOpenApiSettings, onSaveApiSettings, onAutoTranslate, updateDelayPreview, onFetchModels, resolveReviewAction } from './auto-translate';
import {
  onImportFileChange, onImportFolderChange, onImportZipChange,
  onImportLucaTxtChange, onImportLucaTxtFolderChange,
} from './import-source';
import { onImportTranslatedFileChange, onImportTranslatedFolderChange } from './import-translated';
import {
  createNewProject, closeProject, onRestoreProject, renderDashboardProjects,
  openDashboardSettings, saveDashboardSettings, resetDashboardSettings,
  queueAutoSave, openModal, closeModal, loadDashboardProjects,
} from './project';
import { getDefaultPromptHeaderForFormat } from './ai-format';
import { getLucaProfile, populateLucaExportSlotSelect, DEFAULT_LUCA_PROFILE } from './luca-engine';
import { bindShortcutCaptureInput } from './shortcuts';
import { getMainScroller } from './state';
import { initDictionary } from './dictionary';

// ─── Debounce Utility ─────────────────────────────────────────────────────────

function debounce(func: Function, wait: number) {
  let timeout: any;
  return function (this: any, ...args: any[]) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ─── Element Caching ──────────────────────────────────────────────────────────

export function cacheElements(): void {
  const ids = [
    'dashboardView', 'workspaceView', 'projectList', 'projectFilterInput', 'btnNewProject', 'btnRestoreProject',
    'btnBackToDashboard', 'projectNameDisplay', 'restoreProjectInput', 'btnDropdownImport', 'dropdownImportMenu', 'btnDropdownImportOther', 'dropdownImportOtherMenu', 'btnImportFile',
    'btnDropdownDashboardSettings', 'dropdownDashboardSettingsMenu', 'btnDashboardSettings', 'dashboardSettingsModal', 'btnDashboardSettingsSave', 'btnDashboardSettingsReset', 'paletteSelect', 'btnDashboardSettingsCancel',     'btnDashboardPrompts', 'dashboardPromptsModal', 'dpPromptInput', 'dpGlossaryPromptInput', 'dpAiCheckPromptInput', 'dpAgentPromptInput', 'btnDashboardPromptsSave', 'btnDashboardPromptsReset', 'btnDashboardPromptsCancel',
    'dsSourceLang', 'dsTargetLang', 'dsTranslationMode', 'dsAiFormat', 'dsContextLines', 'dsSelectionBatch', 'dsGlossaryBatch', 'dsAiCheckBatch', 'dsRegexFilter',
    'btnImportFolder', 'btnImportZip', 'btnImportTranslatedFile', 'btnImportTranslatedFolder', 'btnExport', 'btnProofread', 'btnSettings',
    'previewViewport', 'previewContainer', 'currentFileBar', 'progressFill', 'progressText', 'btnSelectAll',
    'btnClearSelection', 'copyCount', 'btnCopyForAi', 'copyStatus', 'pasteArea', 'btnApply', 'checkIgnorePasteNames',
    'btnUndo', 'btnRedo', 'nameTableBody', 'statusBar', 'importFileInput', 'importFolderInput', 'importTranslatedFileInput', 'importTranslatedFolderInput',
    'btnCopyNamesForAi', 'copyNameCount', 'pasteNameArea', 'btnApplyNameTranslations', 'btnResetNameTranslations',
    'glossaryPreviewWrap', 'glossaryPreviewText',
    'importZipInput', 'importLucaTxtInput', 'importLucaTxtFolderInput', 'btnImportLucaTxt', 'btnImportLucaTxtFolder',
    'glossaryFileInput', 'settingsModal', 'settingsPromptInput', 'settingsGlossaryPromptInput', 'settingsAiCheckPromptInput', 'settingsAgentPromptInput', 'settingsEpubTagsInput',
    'settingsLucaWrap', 'settingsLucaProfileSelect', 'settingsLucaMcWrap', 'settingsLucaMcDisplayNameInput', 'settingsLucaExportLangWrap', 'settingsLucaExportLangSelect', 'settingsSourceLangSelect', 'settingsTargetLangSelect', 'settingsTranslationModeSelect', 'settingsRegexFilterInput', 'settingsRefLangWrap', 'settingsRefLang1Select', 'settingsRefLang2Select', 'btnImportRefLang1', 'btnImportRefLang2', 'btnImportRefLang1Folder', 'btnImportRefLang2Folder', 'btnClearRefLang1', 'btnClearRefLang2', 'refLang1Input', 'refLang2Input', 'refLang1FolderInput', 'refLang2FolderInput',
    'settingsDisableEmptyLineValidation', 'settingsShowFurigana', 'settingsFuriganaType', 'settingsFontSize', 'settingsEnableDictionary', 'settingsDictionaryEngine', 'settingsDictionaryPrompt', 'dictionaryPopup', 'dictPopupWord', 'dictPopupClose', 'dictPopupContent', 'settingsAiTranslationFormatSelect', 'settingsGlossaryInput', 'settingsContextLinesInput', 'settingsSelectionBatchSizeInput', 'settingsGlossaryBatchSizeInput', 'settingsAiCheckBatchSizeInput', 'settingsParallelBatchSizeInput', 'settingsSelectionPrevShortcutInput', 'settingsSelectionNextShortcutInput', 'btnSettingsReset', 'btnSettingsGlossaryReset', 'btnSettingsAiCheckReset', 'btnSettingsAgentPromptReset', 'btnSettingsCancel', 'btnSettingsSave', 'lineEditorModal', 'lineEditorTitle',
    'btnDropdownSettings', 'dropdownSettingsMenu', 'btnSettingsGeneral', 'btnSettingsPrompts', 'btnSettingsGlossary', 'settingsPromptsModal', 'settingsGlossaryModal', 'btnSettingsPromptsCancel', 'btnSettingsPromptsSave', 'btnSettingsGlossaryCancel', 'btnSettingsGlossarySave', 'settingsEnableBackgroundChaining', 'settingsBackgroundInput', 'settingsPromptTemplateSelect', 'btnSettingsClearBackground',
    'tabTranslate', 'tabGlossary', 'viewTranslate', 'viewGlossary', 'btnCopyForGlossaryAi', 'pasteGlossaryArea', 'btnSaveGlossary', 'btnImportGlossaryFile', 'btnExportGlossaryFile', 'copyGlossaryCount', 'btnDeleteTranslation', 'deleteTranslationCount', 'tabDelete', 'viewDelete',
    'tabAiCheck', 'viewAiCheck', 'btnCopyForAiCheck', 'copyAiCheckCount', 'aiCheckStatus', 'pasteAiCheckArea', 'btnParseAiCheck', 'btnApplyAiCheck', 'btnClearAiCheck', 'aiCheckResults',
    'vndbInput', 'btnImportVndbNames', 'vndbStatus',
    'btnExtractEpubRubyNames', 'epubRubyStatus', 'anilistInput', 'btnImportAnilistNames', 'anilistStatus',
    'lineOriginalView', 'lineNameWrap', 'lineNameInput', 'lineMessageInput', 'lineTranslatedCheck',
    'lucaRefWrap', 'lineRefEnView', 'lineRefZhView',
    'jsonRefLang1Wrap', 'lineRefLang1Label', 'lineRefLang1View',
    'jsonRefLang2Wrap', 'lineRefLang2Label', 'lineRefLang2View',
    'btnLineCancel', 'btnLineSave', 'proofreadModal', 'proofreadSearchInput', 'proofreadScope',
    'proofreadRegexCheck', 'proofreadCaseCheck', 'proofreadExactCheck', 'proofreadTranslatedOnlyCheck',
    'btnProofreadReset', 'proofreadStatus', 'proofreadContainer', 'btnProofreadClose',
    'proofreadReplaceInput', 'btnProofreadReplaceAll', 'proofreadPreserveCaseCheck', 'proofreadJumpCheck', 'rangeFromInput', 'rangeToInput', 'btnSelectRange',
    'settingsCheckKanaResidue', 'settingsCheckSimilarity', 'settingsSimilarityThreshold', 'settingsSimilarityThresholdWrap',
    'settingsContextTypeSelect',
    'btnQaCheck', 'qaModal', 'qaCheckGlossary', 'qaCheckKana', 'qaCheckSimilarity', 'qaCheckLinebreak', 'qaCheckLength', 'qaCheckLanguage', 'qaCheckPunctuation', 'btnRunQa', 'btnQaReset', 'qaStats', 'qaResults', 'btnQaClose', 'btnRetranslateFlagged', 'settingsCheckLengthRatio', 'settingsLengthRatioThreshold', 'settingsLengthRatioWrap', 'settingsCheckLinebreak', 'settingsCheckLanguage', 'settingsCheckPunctuation', 'settingsEnableUncertainMarking', 'qaCheckUncertain', 'qaCheckUntransName', 'aiTranslateModeSelect', 'settingsAgentMaxTurns',
    'btnAutoTranslate', 'btnAutoGlossaryAi', 'btnAutoAiCheck', 'btnFloatingApiSettings', 'apiSettingsModal', 'apiTypeSelect', 'apiUrlInput', 'apiKeyInput', 'apiModelInput', 'apiModelSelect', 'btnFetchModels', 'apiModelFetchStatus', 'apiTemperatureInput', 'apiTopPInput', 'apiRpmInput', 'apiDelayPreview', 'apiThinkingSelect', 'apiFilterThinkingCheck', 'apiBackupKeysInput', 'apiKeyStrategySelect', 'btnApiSettingsCancel', 'btnApiSettingsSave', 'tavilyKeyInput',
 'aiCheckReviewActions', 'btnReviewApply', 'btnReviewSkip',
    'btnFloatingAiAgent', 'aiAgentChatPanel', 'btnAgentClose', 'btnAgentClear', 'btnAgentMemory', 'agentChatHistory', 'agentInput', 'btnAgentSend',
    'agentMemoryModal', 'agentMemoryList', 'agentMemoryKey', 'agentMemoryCategory', 'agentMemoryScope', 'agentMemoryValue', 'btnAgentMemoryCancel', 'btnAgentMemorySave',
    'btnTextReplacer', 'textReplacerModal', 'replacerPreInput', 'replacerPostInput', 'btnTextReplacerCancel', 'btnTextReplacerSave'
  ];
  for (const id of ids) {
    ui[id] = document.getElementById(id);
  }
}

// ─── Scroller Initialization ──────────────────────────────────────────────────

export function initScrollers(): void {
  const mainScroller = new VirtualScroller(ui.previewViewport as HTMLElement, ui.previewContainer as HTMLElement, 85, renderMainRow);
  mainScroller.onVisibleRangeChange = (start) => updateCurrentFileBar(start);
  setMainScroller(mainScroller);
  const proofreadViewport = (ui.proofreadContainer as HTMLElement).closest('.proofread-results-wrap') as HTMLElement;
  setProofreadScroller(new VirtualScroller(proofreadViewport, ui.proofreadContainer as HTMLElement, 90, renderProofreadRow));
  const qaViewport = (ui.qaResults as HTMLElement).closest('.proofread-results-wrap') as HTMLElement;
  setQaScroller(new VirtualScroller(qaViewport, ui.qaResults as HTMLElement, 90, renderQaRow));
}

// ─── Event Binding ────────────────────────────────────────────────────────────

export function bindEvents(): void {
  document.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const isImportBtn = target.closest('#btnDropdownImport');
    const isImportOtherBtn = target.closest('#btnDropdownImportOther');
    const isInsideImportMenu = target.closest('#dropdownImportMenu');
    if (isImportBtn) {
      e.preventDefault();
      const rect = isImportBtn.getBoundingClientRect();
      const menu = ui.dropdownImportMenu as HTMLElement;
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.left = rect.left + 'px';
      const willShow = !menu.classList.contains('show');
      menu.classList.toggle('show');
      // Reset nested submenu whenever the main import menu is closed
      if (!willShow && ui.dropdownImportOtherMenu) {
        (ui.dropdownImportOtherMenu as HTMLElement).classList.remove('show');
      }
    } else if (isImportOtherBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (ui.dropdownImportOtherMenu) {
        (ui.dropdownImportOtherMenu as HTMLElement).classList.toggle('show');
      }
    } else if (!isInsideImportMenu) {
      if (ui.dropdownImportMenu) {
        (ui.dropdownImportMenu as HTMLElement).classList.remove('show');
      }
      if (ui.dropdownImportOtherMenu) {
        (ui.dropdownImportOtherMenu as HTMLElement).classList.remove('show');
      }
    } else {
      // Clicked an action item inside the import menu — close everything
      if (ui.dropdownImportMenu) {
        (ui.dropdownImportMenu as HTMLElement).classList.remove('show');
      }
      if (ui.dropdownImportOtherMenu) {
        (ui.dropdownImportOtherMenu as HTMLElement).classList.remove('show');
      }
    }
    const isDashboardSettingsBtn = target.closest('#btnDropdownDashboardSettings');
    if (isDashboardSettingsBtn) {
      e.preventDefault();
      const rect = isDashboardSettingsBtn.getBoundingClientRect();
      const menu = ui.dropdownDashboardSettingsMenu as HTMLElement;
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.left = rect.left + 'px';
      menu.classList.toggle('show');
    } else {
      if (ui.dropdownDashboardSettingsMenu) {
        (ui.dropdownDashboardSettingsMenu as HTMLElement).classList.remove('show');
      }
    }

    const isSettingsBtn = target.closest('#btnDropdownSettings');
    if (isSettingsBtn) {
      e.preventDefault();
      const rect = isSettingsBtn.getBoundingClientRect();
      const menu = ui.dropdownSettingsMenu as HTMLElement;
      menu.style.top = (rect.bottom + 4) + 'px';
      let left = rect.left;
      const maxLeft = window.innerWidth - menu.offsetWidth - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      menu.style.left = left + 'px';
      menu.classList.toggle('show');
    } else {
      if (ui.dropdownSettingsMenu) {
        (ui.dropdownSettingsMenu as HTMLElement).classList.remove('show');
      }
    }
  });

  document.addEventListener('keydown', onSelectionHistoryKeydown);
  ui.btnNewProject?.addEventListener('click', createNewProject);
  ui.projectFilterInput?.addEventListener('input', () => renderDashboardProjects());
  ui.btnBackToDashboard?.addEventListener('click', closeProject);
  ui.btnRestoreProject?.addEventListener('click', () => (ui.restoreProjectInput as HTMLInputElement).click());
  ui.restoreProjectInput?.addEventListener('change', onRestoreProject);

  ui.btnDashboardSettings?.addEventListener('click', openDashboardSettings);
  const paletteSel = document.getElementById('paletteSelect');
  if (paletteSel) {
    paletteSel.addEventListener('change', () => {
      const val = (paletteSel as HTMLSelectElement).value;
      localStorage.setItem('cstl_color_palette', val);
      applyPalette(val);
    });
  }
  ui.btnDashboardPrompts?.addEventListener('click', () => { import('./project').then(m => m.openDashboardPrompts()); });
  ui.btnDashboardPromptsSave?.addEventListener('click', () => { import('./project').then(m => m.saveDashboardPrompts()); });
  ui.btnDashboardPromptsReset?.addEventListener('click', () => { import('./project').then(m => m.resetDashboardPrompts()); });
  ui.btnDashboardPromptsCancel?.addEventListener('click', () => (ui.dashboardPromptsModal as HTMLElement).classList.remove('open'));
  ui.btnDashboardSettingsSave?.addEventListener('click', saveDashboardSettings);
  ui.btnDashboardSettingsReset?.addEventListener('click', resetDashboardSettings);
  ui.btnDashboardSettingsCancel?.addEventListener('click', () => (ui.dashboardSettingsModal as HTMLElement).classList.remove('open'));
  ui.btnImportFile?.addEventListener('click', () => (ui.importFileInput as HTMLInputElement).click());
  ui.btnImportFolder?.addEventListener('click', () => (ui.importFolderInput as HTMLInputElement).click());
  ui.btnImportZip?.addEventListener('click', () => (ui.importZipInput as HTMLInputElement).click());
  ui.btnImportLucaTxt?.addEventListener('click', () => (ui.importLucaTxtInput as HTMLInputElement).click());
  ui.btnImportLucaTxtFolder?.addEventListener('click', () => (ui.importLucaTxtFolderInput as HTMLInputElement).click());
  ui.btnImportTranslatedFile?.addEventListener('click', () => (ui.importTranslatedFileInput as HTMLInputElement).click());
  ui.btnImportTranslatedFolder?.addEventListener('click', () => (ui.importTranslatedFolderInput as HTMLInputElement).click());

  ui.importFileInput?.addEventListener('change', onImportFileChange);
  ui.importFolderInput?.addEventListener('change', onImportFolderChange);
  ui.importZipInput?.addEventListener('change', onImportZipChange);
  ui.importLucaTxtInput?.addEventListener('change', onImportLucaTxtChange);
  ui.importLucaTxtFolderInput?.addEventListener('change', onImportLucaTxtFolderChange);
  ui.importTranslatedFileInput?.addEventListener('change', onImportTranslatedFileChange);
  ui.importTranslatedFolderInput?.addEventListener('change', onImportTranslatedFolderChange);
  ui.glossaryFileInput?.addEventListener('change', onImportGlossaryFile);

  ui.btnExport?.addEventListener('click', onExport);
  ui.btnCopyForAi?.addEventListener('click', onCopyForAi);
  ui.btnCopyNamesForAi?.addEventListener('click', onCopyNamesForAi);
  ui.btnCopyForGlossaryAi?.addEventListener('click', onCopyForGlossaryAi);
  ui.btnApply?.addEventListener('click', () => { try { onApplyTranslation(); } catch (_) {} });
  ui.btnApplyNameTranslations?.addEventListener('click', onApplyNameTranslations);
  ui.btnResetNameTranslations?.addEventListener('click', onResetNameTranslations);
  ui.pasteNameArea?.addEventListener('input', updateButtonStates);
  ui.btnSaveGlossary?.addEventListener('click', onSaveGlossary);
  ui.btnImportGlossaryFile?.addEventListener('click', () => (ui.glossaryFileInput as HTMLInputElement).click());
  ui.btnExportGlossaryFile?.addEventListener('click', onExportGlossaryFile);
  ui.btnDeleteTranslation?.addEventListener('click', onDeleteTranslation);
  ui.btnImportVndbNames?.addEventListener('click', onImportVndbNames);
  ui.btnExtractEpubRubyNames?.addEventListener('click', onExtractEpubRubyNames);
  ui.btnImportAnilistNames?.addEventListener('click', onImportAnilistNames);

  if (ui.btnImportRefLang1) ui.btnImportRefLang1.addEventListener('click', onImportRefLang1);
  if (ui.btnImportRefLang2) ui.btnImportRefLang2.addEventListener('click', onImportRefLang2);
  if (ui.btnImportRefLang1Folder) ui.btnImportRefLang1Folder.addEventListener('click', onImportRefLang1Folder);
  if (ui.btnImportRefLang2Folder) ui.btnImportRefLang2Folder.addEventListener('click', onImportRefLang2Folder);
  if (ui.refLang1Input) ui.refLang1Input.addEventListener('change', onRefLang1FileChange);
  if (ui.refLang2Input) ui.refLang2Input.addEventListener('change', onRefLang2FileChange);
  if (ui.refLang1FolderInput) ui.refLang1FolderInput.addEventListener('change', onRefLang1FolderChange);
  if (ui.refLang2FolderInput) ui.refLang2FolderInput.addEventListener('change', onRefLang2FolderChange);
  if (ui.btnClearRefLang1) ui.btnClearRefLang1.addEventListener('click', onClearRefLang1);
  if (ui.btnClearRefLang2) ui.btnClearRefLang2.addEventListener('click', onClearRefLang2);

  ui.tabTranslate?.addEventListener('click', () => switchWorkspaceTab('translate'));
  ui.tabGlossary?.addEventListener('click', () => switchWorkspaceTab('glossary'));
  ui.tabAiCheck?.addEventListener('click', () => switchWorkspaceTab('aiCheck'));
  ui.tabDelete?.addEventListener('click', () => switchWorkspaceTab('delete'));

  ui.btnCopyForAiCheck?.addEventListener('click', onCopyForAiCheck);
  ui.btnParseAiCheck?.addEventListener('click', onParseAiCheck);
  ui.btnApplyAiCheck?.addEventListener('click', onApplyAiCheckCorrections);
  ui.btnClearAiCheck?.addEventListener('click', onClearAiCheck);
  ui.pasteAiCheckArea?.addEventListener('input', updateButtonStates);
  ui.btnUndo?.addEventListener('click', onUndoLastApply);
  ui.btnRedo?.addEventListener('click', onRedoLastUndo);
  ui.btnProofread?.addEventListener('click', onOpenProofread);

  ui.btnSelectAll?.addEventListener('click', () => {
    state.selectedLines.clear();
    state.lines.forEach(l => { if (isSelectableForActiveTab(l)) state.selectedLines.add(l.line_num); });
    recordSelectionHistory();
    syncCheckboxUI();
  });
  ui.btnClearSelection?.addEventListener('click', () => {
    state.selectedLines.clear();
    recordSelectionHistory();
    syncCheckboxUI();
  });

  ui.btnSelectRange?.addEventListener('click', () => {
    const f = parseInt((ui.rangeFromInput as HTMLInputElement).value);
    const t = parseInt((ui.rangeToInput as HTMLInputElement).value);
    if (isNaN(f) || isNaN(t) || f > t) return alert('Range tidak valid.');
    state.selectedLines.clear();
    for (let i = f; i <= t; i++) {
      const l = state.lineByNum.get(i);
      if (l && isSelectableForActiveTab(l)) state.selectedLines.add(i);
    }
    recordSelectionHistory();
    syncCheckboxUI();
    const mainScroller = getMainScroller();
    const targetIndex = state.displayRows.findIndex(row => row.type === 'line' && row.line?.line_num === f);
    if (targetIndex !== -1) {
      mainScroller.scrollToIndex(targetIndex);
      setTimeout(() => {
        const targetEl = document.querySelector(`input[data-num="${f}"]`);
        if (targetEl) {
          const rowEl = targetEl.closest('.preview-row') as HTMLElement;
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const originalBg = rowEl.style.backgroundColor;
          rowEl.style.transition = 'background-color 0.3s ease';
          rowEl.style.backgroundColor = 'rgba(59, 130, 246, 0.4)';
          setTimeout(() => { rowEl.style.backgroundColor = originalBg; }, 800);
        }
      }, 50);
    }
  });

  ui.btnSettingsGeneral?.addEventListener('click', onOpenSettings);
  ui.btnSettingsPrompts?.addEventListener('click', onOpenPromptsSettings);
  ui.btnSettingsGlossary?.addEventListener('click', onOpenGlossarySettings);
  ui.btnSettingsReset?.addEventListener('click', () => {
    const format = (ui.settingsAiTranslationFormatSelect as HTMLSelectElement)?.value || DEFAULT_AI_TRANSLATION_FORMAT;
    (ui.settingsPromptInput as HTMLTextAreaElement).value = getDefaultPromptHeaderForFormat(format);
    (ui.settingsEpubTagsInput as HTMLInputElement).value = 'p';
  });
  if (ui.settingsAiTranslationFormatSelect) {
    ui.settingsAiTranslationFormatSelect.addEventListener('change', () => {
      const format = (ui.settingsAiTranslationFormatSelect as HTMLSelectElement).value || DEFAULT_AI_TRANSLATION_FORMAT;
      const currentDefault = getDefaultPromptHeaderForFormat(format);
      const allDefaults = [
        DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
        DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL, DEFAULT_PROMPT_HEADER_JSON_ARRAY,
      ];
      if (allDefaults.some(d => (ui.settingsPromptInput as HTMLTextAreaElement).value.trim() === d.trim()) ||
          (ui.settingsPromptInput as HTMLTextAreaElement).value.trim() === DEFAULT_PROMPT_HEADER_COMPLEX_ID.trim() ||
          (ui.settingsPromptInput as HTMLTextAreaElement).value.trim() === DEFAULT_PROMPT_HEADER_COMPLEX_EN.trim()) {
        (ui.settingsPromptInput as HTMLTextAreaElement).value = currentDefault;
      }
    });
  }

  ui.settingsPromptTemplateSelect?.addEventListener('change', () => {
    const val = (ui.settingsPromptTemplateSelect as HTMLSelectElement).value;
    if (val === 'complex-id') {
      (ui.settingsPromptInput as HTMLTextAreaElement).value = DEFAULT_PROMPT_HEADER_COMPLEX_ID;
    } else if (val === 'complex-en') {
      (ui.settingsPromptInput as HTMLTextAreaElement).value = DEFAULT_PROMPT_HEADER_COMPLEX_EN;
    } else {
      const format = (ui.settingsAiTranslationFormatSelect as HTMLSelectElement)?.value || DEFAULT_AI_TRANSLATION_FORMAT;
      (ui.settingsPromptInput as HTMLTextAreaElement).value = getDefaultPromptHeaderForFormat(format);
    }
  });

  ui.btnSettingsClearBackground?.addEventListener('click', () => {
    state.currentBackground = '';
    (ui.settingsBackgroundInput as HTMLTextAreaElement).value = '';
    import('./project').then(m => m.queueAutoSave());
    flashHint('Memori latar belakang dikosongkan.');
  });

  ui.btnSettingsGlossaryReset?.addEventListener('click', () => { (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = DEFAULT_GLOSSARY_PROMPT; });
  ui.btnSettingsAiCheckReset?.addEventListener('click', () => { (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = DEFAULT_AI_CHECK_PROMPT; });
  ui.btnSettingsAgentPromptReset?.addEventListener('click', () => { (ui.settingsAgentPromptInput as HTMLTextAreaElement).value = DEFAULT_AGENT_PROMPT; });
  ui.btnSettingsCancel?.addEventListener('click', () => {
    closeModal(ui.settingsModal as HTMLElement);
    if(ui.settingsPromptsModal) closeModal(ui.settingsPromptsModal as HTMLElement);
    if(ui.settingsGlossaryModal) closeModal(ui.settingsGlossaryModal as HTMLElement);
  });
  ui.btnSettingsPromptsCancel?.addEventListener('click', () => closeModal(ui.settingsPromptsModal as HTMLElement));
  ui.btnSettingsGlossaryCancel?.addEventListener('click', () => closeModal(ui.settingsGlossaryModal as HTMLElement));
  ui.btnSettingsSave?.addEventListener('click', onSavePromptSettings);
  ui.btnSettingsPromptsSave?.addEventListener('click', onSavePromptsSettings);
  ui.btnSettingsGlossarySave?.addEventListener('click', onSaveGlossarySettings);

  if (ui.settingsCheckLengthRatio) {
    ui.settingsCheckLengthRatio.addEventListener('change', () => {
      (document.getElementById('settingsLengthRatioWrap') as HTMLElement).style.display = (ui.settingsCheckLengthRatio as HTMLInputElement).checked ? 'flex' : 'none';
    });
  }
if (ui.settingsCheckSimilarity) {
    ui.settingsCheckSimilarity.addEventListener('change', () => {
      (ui.settingsSimilarityThresholdWrap as HTMLElement).style.display = (ui.settingsCheckSimilarity as HTMLInputElement).checked ? 'flex' : 'none';
    });
  }

  if (ui.settingsLucaProfileSelect) {
    ui.settingsLucaProfileSelect.addEventListener('change', () => {
      if (state.lines.length > 0) return;
      const profileId = (ui.settingsLucaProfileSelect as HTMLSelectElement).value || DEFAULT_LUCA_PROFILE;
      populateLucaExportSlotSelect(profileId);
      const profile = getLucaProfile(profileId);
      if (ui.settingsLucaMcWrap) (ui.settingsLucaMcWrap as HTMLElement).style.display = profile.nameAtFormat ? 'block' : 'none';
    });
  }

  ui.btnLineCancel?.addEventListener('click', () => closeModal(ui.lineEditorModal as HTMLElement));
  ui.btnLineSave?.addEventListener('click', onSaveLineEditor);
  ui.btnProofreadClose?.addEventListener('click', () => closeModal(ui.proofreadModal as HTMLElement));
  ui.btnProofreadReset?.addEventListener('click', onResetProofread);
  ui.btnProofreadReplaceAll?.addEventListener('click', onProofreadReplaceAll);

  const debouncedSearch = debounce(renderProofreadResults, 250);
  ui.proofreadSearchInput?.addEventListener('input', debouncedSearch);
  const onChangeProofreadSetting = () => {
    renderProofreadResults();
    queueAutoSave();
  };
  ui.proofreadScope?.addEventListener('change', onChangeProofreadSetting);
  ui.proofreadRegexCheck?.addEventListener('change', onChangeProofreadSetting);
  ui.proofreadCaseCheck?.addEventListener('change', onChangeProofreadSetting);
  ui.proofreadExactCheck?.addEventListener('change', onChangeProofreadSetting);
  ui.proofreadTranslatedOnlyCheck?.addEventListener('change', onChangeProofreadSetting);
  ui.proofreadJumpCheck?.addEventListener('change', onChangeProofreadSetting);
  ui.proofreadPreserveCaseCheck?.addEventListener('change', () => queueAutoSave());

  ui.btnQaCheck?.addEventListener('click', onOpenQa);
  ui.btnQaClose?.addEventListener('click', () => closeModal(ui.qaModal as HTMLElement));
  ui.btnQaReset?.addEventListener('click', onResetQa);
  ui.btnRunQa?.addEventListener('click', runQaCheck);
  document.getElementById('btnRetranslateFlagged')?.addEventListener('click', onRetranslateFlagged);

  // AI Check review mode buttons
  document.getElementById('btnReviewApply')?.addEventListener('click', () => {
    resolveReviewAction('apply');
    const reviewActions = document.getElementById('aiCheckReviewActions');
    if (reviewActions) reviewActions.style.display = 'none';
  });
  document.getElementById('btnReviewSkip')?.addEventListener('click', () => {
    resolveReviewAction('skip');
    const reviewActions = document.getElementById('aiCheckReviewActions');
    if (reviewActions) reviewActions.style.display = 'none';
  });


  ui.btnAutoTranslate?.addEventListener('click', onAutoTranslate);
  const modeSelect = document.getElementById('aiTranslateModeSelect') as HTMLSelectElement;
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      state.aiTranslateMode = (modeSelect.value as 'auto' | 'agent');
      import('./auto-translate').then(m => m.saveApiSettings());
    });
  }
  ui.btnAutoGlossaryAi?.addEventListener('click', () => import('./auto-translate').then(m => m.onAutoGlossary()));
  ui.btnAutoAiCheck?.addEventListener('click', () => import('./auto-translate').then(m => m.onAutoAiCheck()));

  ui.btnTextReplacer?.addEventListener('click', () => {
    import('./project').then(m => m.openModal(ui.textReplacerModal as HTMLElement));
    (ui.replacerPreInput as HTMLTextAreaElement).value = state.preReplaceRules || '';
    (ui.replacerPostInput as HTMLTextAreaElement).value = state.postReplaceRules || '';
  });
  ui.btnTextReplacerCancel?.addEventListener('click', () => {
    import('./project').then(m => m.closeModal(ui.textReplacerModal as HTMLElement));
  });
  ui.btnTextReplacerSave?.addEventListener('click', () => {
    state.preReplaceRules = (ui.replacerPreInput as HTMLTextAreaElement).value;
    state.postReplaceRules = (ui.replacerPostInput as HTMLTextAreaElement).value;
    import('./project').then(m => {
      m.queueAutoSave();
      m.closeModal(ui.textReplacerModal as HTMLElement);
      import('./render').then(r => r.flashHint('Aturan Replacer berhasil disimpan.'));
    });
  });

  let isDraggingRobot = false;
  let robotStartX = 0, robotStartY = 0;
  let initialLeft = 0, initialTop = 0;

  if (ui.btnFloatingApiSettings) {
    const btn = ui.btnFloatingApiSettings as HTMLElement;
    const onStart = (e: MouseEvent | TouchEvent) => {
      isDraggingRobot = false;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      robotStartX = clientX;
      robotStartY = clientY;
      const rect = btn.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      const onMove = (moveEvent: MouseEvent | TouchEvent) => {
        const moveX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
        const moveY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
        const dx = moveX - robotStartX;
        const dy = moveY - robotStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          isDraggingRobot = true;
          moveEvent.preventDefault();
          let newLeft = initialLeft + dx;
          let newTop = initialTop + dy;
          newLeft = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, newLeft));
          newTop = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, newTop));
          btn.style.left = newLeft + 'px';
          btn.style.top = newTop + 'px';
          btn.style.bottom = 'auto';
          btn.style.right = 'auto';
        }
      };

      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        if (isDraggingRobot) {
          setTimeout(() => { isDraggingRobot = false; }, 50);
        }
      };

      document.addEventListener('mousemove', onMove, { passive: false });
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    };

    btn.addEventListener('mousedown', onStart);
    btn.addEventListener('touchstart', onStart, { passive: false });

    btn.addEventListener('click', (e) => {
      if (isDraggingRobot) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onOpenApiSettings();
    });
  }

  ui.btnApiSettingsCancel?.addEventListener('click', () => closeModal(ui.apiSettingsModal as HTMLElement));
  ui.btnApiSettingsSave?.addEventListener('click', onSaveApiSettings);
  ui.btnFetchModels?.addEventListener('click', onFetchModels);
  ui.apiRpmInput?.addEventListener('input', updateDelayPreview);

  bindShortcutCaptureInput(ui.settingsSelectionPrevShortcutInput as HTMLInputElement);
  bindShortcutCaptureInput(ui.settingsSelectionNextShortcutInput as HTMLInputElement);

  // AI Agent Events
  let isDraggingChat = false;
  let chatStartX = 0, chatStartY = 0;
  let chatInitLeft = 0, chatInitTop = 0;

  if (ui.btnFloatingAiAgent) {
    const btn = ui.btnFloatingAiAgent as HTMLElement;
    const onStart = (e: MouseEvent | TouchEvent) => {
      isDraggingChat = false;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      chatStartX = clientX;
      chatStartY = clientY;
      const rect = btn.getBoundingClientRect();
      chatInitLeft = rect.left;
      chatInitTop = rect.top;

      const onMove = (moveEvent: MouseEvent | TouchEvent) => {
        const moveX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
        const moveY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
        const dx = moveX - chatStartX;
        const dy = moveY - chatStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          isDraggingChat = true;
          moveEvent.preventDefault();
          let newLeft = chatInitLeft + dx;
          let newTop = chatInitTop + dy;
          newLeft = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, newLeft));
          newTop = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, newTop));
          btn.style.left = newLeft + 'px';
          btn.style.top = newTop + 'px';
          btn.style.bottom = 'auto';
          btn.style.right = 'auto';
        }
      };

      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        if (isDraggingChat) {
          setTimeout(() => { isDraggingChat = false; }, 50);
        }
      };

      document.addEventListener('mousemove', onMove, { passive: false });
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    };

    btn.addEventListener('mousedown', onStart);
    btn.addEventListener('touchstart', onStart, { passive: false });

    btn.addEventListener('click', async (e) => {
      if (isDraggingChat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const panel = ui.aiAgentChatPanel as HTMLElement;
      const isHidden = panel.style.display === 'none';
      panel.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) {
        const { loadChatHistory, renderChatHistory } = await import('./ai-agent');
        loadChatHistory();
        renderChatHistory();
      }
    });
  }

  ui.btnAgentClose?.addEventListener('click', () => {
    (ui.aiAgentChatPanel as HTMLElement).style.display = 'none';
  });
  // Make the AI Agent chat panel draggable by its header, mirroring the robot icon.
  if (ui.aiAgentChatPanel) {
    const panel = ui.aiAgentChatPanel as HTMLElement;
    const header = panel.querySelector<HTMLElement>('.agent-header');
    if (header) {
      let isDraggingPanel = false;
      let panelStartX = 0, panelStartY = 0;
      let panelInitLeft = 0, panelInitTop = 0;

      const onPanelStart = (e: MouseEvent | TouchEvent) => {
        // Ignore presses that start on the header buttons (clear/close).
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        isDraggingPanel = false;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        panelStartX = clientX;
        panelStartY = clientY;
        const rect = panel.getBoundingClientRect();
        panelInitLeft = rect.left;
        panelInitTop = rect.top;

        const onPanelMove = (moveEvent: MouseEvent | TouchEvent) => {
          const moveX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
          const moveY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
          const dx = moveX - panelStartX;
          const dy = moveY - panelStartY;
          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            isDraggingPanel = true;
            moveEvent.preventDefault();
            let newLeft = panelInitLeft + dx;
            let newTop = panelInitTop + dy;
            newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, newTop));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            header.style.cursor = 'grabbing';
          }
        };

        const onPanelEnd = () => {
          document.removeEventListener('mousemove', onPanelMove);
          document.removeEventListener('mouseup', onPanelEnd);
          document.removeEventListener('touchmove', onPanelMove);
          document.removeEventListener('touchend', onPanelEnd);
          header.style.cursor = 'grab';
          if (isDraggingPanel) {
            setTimeout(() => { isDraggingPanel = false; }, 50);
          }
        };

        document.addEventListener('mousemove', onPanelMove, { passive: false });
        document.addEventListener('mouseup', onPanelEnd);
        document.addEventListener('touchmove', onPanelMove, { passive: false });
        document.addEventListener('touchend', onPanelEnd);
      };

      header.addEventListener('mousedown', onPanelStart);
      header.addEventListener('touchstart', onPanelStart, { passive: false });
    }
  }
  ui.btnAgentClear?.addEventListener('click', async () => {
    if (!confirm('Hapus semua riwayat chat untuk proyek ini?')) return;
    const { clearChatHistory } = await import('./ai-agent');
    clearChatHistory();
  });

  // ── Agent Memory UI ──
  function renderAgentMemoryList(): void {
    const listEl = ui.agentMemoryList as HTMLElement;
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!state.agentMemories.length) {
      listEl.innerHTML = '<p class="hint">Belum ada memori tersimpan.</p>';
      return;
    }
    for (const m of state.agentMemories) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:8px; align-items:flex-start; padding:8px; border-bottom:1px solid var(--border-base);';
      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML = `<span style="opacity:0.6;font-size:0.85em;">[${m.scope}/${m.category}]</span> <strong>${m.key}</strong><br><span style="font-size:0.9em;">${m.value}</span>`;
      row.appendChild(info);
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = '<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>';
      editBtn.title = 'Edit';
      editBtn.onclick = () => {
        (ui.agentMemoryKey as HTMLInputElement).value = m.key;
        (ui.agentMemoryValue as HTMLTextAreaElement).value = m.value;
        (ui.agentMemoryCategory as HTMLSelectElement).value = m.category;
        (ui.agentMemoryScope as HTMLSelectElement).value = m.scope;
      };
      row.appendChild(editBtn);
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.innerHTML = '<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>';
      delBtn.title = 'Hapus';
      delBtn.onclick = () => {
        state.agentMemories = state.agentMemories.filter(x => x.key !== m.key || x.scope !== m.scope);
        // Persist
        const scopeMems = state.agentMemories.filter(x => x.scope === m.scope);
        try {
          const key = m.scope === 'global' ? 'cstl_agent_memory_global' : `cstl_agent_memory_${state.currentProjectId}`;
          localStorage.setItem(key, JSON.stringify(scopeMems));
        } catch {}
        renderAgentMemoryList();
      };
      row.appendChild(delBtn);
      listEl.appendChild(row);
    }
  }

  ui.btnAgentMemory?.addEventListener('click', () => {
    renderAgentMemoryList();
    (ui.agentMemoryModal as HTMLElement).style.display = 'flex';
  });
  ui.btnAgentMemoryCancel?.addEventListener('click', () => {
    (ui.agentMemoryModal as HTMLElement).style.display = 'none';
  });
  ui.btnAgentMemorySave?.addEventListener('click', async () => {
    const key = (ui.agentMemoryKey as HTMLInputElement).value.trim();
    const value = (ui.agentMemoryValue as HTMLTextAreaElement).value.trim();
    const category = (ui.agentMemoryCategory as HTMLSelectElement).value;
    const scope = (ui.agentMemoryScope as HTMLSelectElement).value as 'global' | 'project';
    if (!key || !value) { alert('Key dan value tidak boleh kosong.'); return; }
    const now = Date.now();
    const existing = state.agentMemories.findIndex(m => m.key === key && m.scope === scope);
    if (existing >= 0) {
      state.agentMemories[existing].value = value;
      state.agentMemories[existing].category = category as any;
      state.agentMemories[existing].updated = now;
    } else {
      state.agentMemories.push({ key, value, category: category as any, scope, created: now, updated: now });
    }
    const scopeMems = state.agentMemories.filter(m => m.scope === scope);
    try {
      const storageKey = scope === 'global' ? 'cstl_agent_memory_global' : `cstl_agent_memory_${state.currentProjectId}`;
      localStorage.setItem(storageKey, JSON.stringify(scopeMems));
    } catch {}
    (ui.agentMemoryKey as HTMLInputElement).value = '';
    (ui.agentMemoryValue as HTMLTextAreaElement).value = '';
    renderAgentMemoryList();
  });

  const doAgentSend = async () => {
    const input = ui.agentInput as HTMLTextAreaElement;
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    
    const historyEl = ui.agentChatHistory as HTMLElement;
    const userDiv = document.createElement('div');
    userDiv.className = 'agent-msg user';
    userDiv.textContent = text;
    historyEl.appendChild(userDiv);
    historyEl.scrollTop = historyEl.scrollHeight;
    
    const respDiv = document.createElement('div');
    respDiv.className = 'agent-msg system';
    respDiv.textContent = 'Agent is thinking...';
    historyEl.appendChild(respDiv);
    historyEl.scrollTop = historyEl.scrollHeight;
    
    const sendAgentMessage = (await import('./ai-agent')).sendAgentMessage;
    
    try {
      await sendAgentMessage(text, (msg, role) => {
        respDiv.className = `agent-msg ${role}`;
        
        let html = msg
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/\`(.*?)\`/g, '<code>$1</code>');
          
        respDiv.innerHTML = html;
        historyEl.scrollTop = historyEl.scrollHeight;
      });
    } catch (e: any) {
      respDiv.className = 'agent-msg system';
      respDiv.style.color = 'var(--danger)';
      respDiv.textContent = `Error: ${e.message}`;
    }
  };

  ui.btnAgentSend?.addEventListener('click', doAgentSend);
  ui.agentInput?.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && !ke.shiftKey) {
      ke.preventDefault();
      doAgentSend();
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// ─── Color Palette System ────────────────────────────────────────────────────
interface ColorPalette {
  '--bg': string; '--bg-2': string; '--panel': string; '--panel-2': string;
  '--line': string; '--line-2': string; '--primary': string; '--primary-hover': string;
  '--primary-soft': string; '--accent': string;
}

const PALETTES: Record<string, ColorPalette> = {
  indigo: {
    '--bg': '#0a0e1a', '--bg-2': '#0d1220', '--panel': '#131826', '--panel-2': '#1a2030',
    '--line': '#252d3f', '--line-2': '#2f3850', '--primary': '#6366f1', '--primary-hover': '#4f46e5',
    '--primary-soft': 'rgba(99, 102, 241, 0.14)', '--accent': '#a855f7',
  },
  ocean: {
    '--bg': '#0f172a', '--bg-2': '#111c33', '--panel': '#1e293b', '--panel-2': '#243349',
    '--line': '#334155', '--line-2': '#3e4d66', '--primary': '#3b82f6', '--primary-hover': '#2563eb',
    '--primary-soft': 'rgba(59, 130, 246, 0.14)', '--accent': '#6366f1',
  },
  forest: {
    '--bg': '#0a1410', '--bg-2': '#0d1a14', '--panel': '#122018', '--panel-2': '#1a2a20',
    '--line': '#1f3a2b', '--line-2': '#2a4d39', '--primary': '#10b981', '--primary-hover': '#059669',
    '--primary-soft': 'rgba(16, 185, 129, 0.14)', '--accent': '#34d399',
  },
  sunset: {
    '--bg': '#1a0f0a', '--bg-2': '#1f120c', '--panel': '#241510', '--panel-2': '#2e1c14',
    '--line': '#3d231a', '--line-2': '#4d2d22', '--primary': '#f97316', '--primary-hover': '#ea580c',
    '--primary-soft': 'rgba(249, 115, 22, 0.14)', '--accent': '#fb923c',
  },
  rose: {
    '--bg': '#140a12', '--bg-2': '#190c16', '--panel': '#1f1020', '--panel-2': '#281428',
    '--line': '#3a1f3a', '--line-2': '#4a2a4a', '--primary': '#ec4899', '--primary-hover': '#db2777',
    '--primary-soft': 'rgba(236, 72, 153, 0.14)', '--accent': '#f472b6',
  },
};

function applyPalette(name: string): void {
  const palette = PALETTES[name] || PALETTES['indigo'];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(key, value);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', palette['--bg']);
}

function loadPalette(): void {
  const saved = localStorage.getItem('cstl_color_palette') || 'indigo';
  applyPalette(saved);
  const select = document.getElementById('paletteSelect') as HTMLSelectElement;
  if (select) select.value = saved;
}

export async function init(): Promise<void> {
  const globalWindow = window as any;
  if (globalWindow.__cstlInitialized) return;
  globalWindow.__cstlInitialized = true;

  // Register PWA service worker
  if ('serviceWorker' in navigator) {
    import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({ immediate: true });
    }).catch(console.error);
  }

  loadPalette();
  cacheElements();
  initScrollers();
  bindEvents();

  if (!navigator.storage || !navigator.storage.getDirectory) {
    alert('Browser kamu tidak mendukung Sistem File OPFS. Beberapa fitur tidak akan berjalan optimal.');
    (ui.projectList as HTMLElement).innerHTML = `<p class="hint" style="grid-column: 1/-1; color: var(--danger);">Browser tidak mendukung OPFS. Sistem penyimpanan tidak dapat diakses.</p>`;
  } else {
    await loadDashboardProjects();
  }

  loadApiSettings();
  initDictionary();
}


