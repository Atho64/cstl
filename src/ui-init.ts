// @module ui-init.ts — DOM element caching, scroller initialization, and event binding

import { state, ui, setMainScroller, setProofreadScroller, setQaScroller } from './state';
import {
  DEFAULT_AI_TRANSLATION_FORMAT, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
  DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL, DEFAULT_PROMPT_HEADER_JSON_ARRAY,
} from './constants';
import { VirtualScroller } from './virtual-scroller';
import { renderMainRow, syncCheckboxUI, updateButtonStates, onSaveLineEditor, flashHint } from './render';
import { renderProofreadRow } from './proofread';
import { renderQaRow } from './qa';
import { onSelectionHistoryKeydown, isSelectableForActiveTab, recordSelectionHistory, switchWorkspaceTab } from './selection';
import { onSaveGlossary, onImportGlossaryFile, onExportGlossaryFile, onDeleteTranslation, onCopyForGlossaryAi } from './glossary';
import { onCopyForAi, onApplyTranslation, onUndoLastApply } from './translate';
import { onCopyNamesForAi, onApplyNameTranslations, onResetNameTranslations } from './name-translation';
import { onCopyForAiCheck, onParseAiCheck, onApplyAiCheckCorrections, onClearAiCheck } from './ai-check';
import { onOpenProofread, onResetProofread, onProofreadReplaceAll, renderProofreadResults } from './proofread';
import { onOpenQa, onResetQa, runQaCheck } from './qa';
import { onOpenSettings, onSavePromptSettings, onOpenPromptsSettings, onOpenGlossarySettings, onSavePromptsSettings, onSaveGlossarySettings } from './settings';
import { onExport } from './export';
import { onImportVndbNames, onImportAnilistNames } from './vndb-anilist';
import { onExtractEpubRubyNames } from './epub-ruby';
import {
  onImportRefLang1, onImportRefLang2, onImportRefLang1Folder, onImportRefLang2Folder,
  onRefLang1FileChange, onRefLang2FileChange, onRefLang1FolderChange, onRefLang2FolderChange,
  onClearRefLang1, onClearRefLang2, applyHtlMode, refreshHtlPanels,
} from './htl-mode';
import { loadApiSettings, onOpenApiSettings, onSaveApiSettings, onAutoTranslate, updateDelayPreview } from './auto-translate';
import {
  onImportFileChange, onImportFolderChange, onImportZipChange,
  onImportLucaTxtChange, onImportLucaTxtFolderChange,
} from './import-source';
import { onImportTranslatedFileChange, onImportTranslatedFolderChange } from './import-translated';
import {
  createNewProject, closeProject, onRestoreProject, renderDashboardProjects,
  openDashboardSettings, saveDashboardSettings, resetDashboardSettings,
  openModal, closeModal, loadDashboardProjects,
} from './project';
import { getDefaultPromptHeaderForFormat } from './ai-format';
import { getLucaProfile, populateLucaExportSlotSelect, DEFAULT_LUCA_PROFILE } from './luca-engine';
import { bindShortcutCaptureInput } from './shortcuts';
import { getMainScroller } from './state';

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
    'btnBackToDashboard', 'projectNameDisplay', 'restoreProjectInput', 'btnDropdownImport', 'dropdownImportMenu', 'btnImportFile',
    'btnDropdownDashboardSettings', 'dropdownDashboardSettingsMenu', 'btnDashboardSettings', 'dashboardSettingsModal', 'btnDashboardSettingsSave', 'btnDashboardSettingsReset', 'btnDashboardSettingsCancel', 'btnDashboardPrompts', 'dashboardPromptsModal', 'dpPromptInput', 'dpGlossaryPromptInput', 'dpAiCheckPromptInput', 'btnDashboardPromptsSave', 'btnDashboardPromptsReset', 'btnDashboardPromptsCancel',
    'dsSourceLang', 'dsTargetLang', 'dsTranslationMode', 'dsAiFormat', 'dsContextLines', 'dsSelectionBatch', 'dsGlossaryBatch', 'dsAiCheckBatch', 'dsRegexFilter',
    'btnImportFolder', 'btnImportZip', 'btnImportTranslatedFile', 'btnImportTranslatedFolder', 'btnExport', 'btnProofread', 'btnSettings',
    'previewViewport', 'previewContainer', 'progressFill', 'progressText', 'btnSelectAll',
    'btnClearSelection', 'copyCount', 'btnCopyForAi', 'copyStatus', 'pasteArea', 'btnApply', 'checkIgnorePasteNames',
    'btnUndo', 'nameTableBody', 'statusBar', 'importFileInput', 'importFolderInput', 'importTranslatedFileInput', 'importTranslatedFolderInput',
    'btnCopyNamesForAi', 'copyNameCount', 'pasteNameArea', 'btnApplyNameTranslations', 'btnResetNameTranslations',
    'glossaryPreviewWrap', 'glossaryPreviewText',
    'importZipInput', 'importLucaTxtInput', 'importLucaTxtFolderInput', 'btnImportLucaTxt', 'btnImportLucaTxtFolder',
    'glossaryFileInput', 'settingsModal', 'settingsPromptInput', 'settingsGlossaryPromptInput', 'settingsAiCheckPromptInput', 'settingsEpubTagsInput',
    'settingsLucaWrap', 'settingsLucaProfileSelect', 'settingsLucaMcWrap', 'settingsLucaMcDisplayNameInput', 'settingsLucaExportLangWrap', 'settingsLucaExportLangSelect', 'settingsSourceLangSelect', 'settingsTargetLangSelect', 'settingsTranslationModeSelect', 'settingsRegexFilterInput', 'settingsRefLangWrap', 'settingsRefLang1Select', 'settingsRefLang2Select', 'btnImportRefLang1', 'btnImportRefLang2', 'btnImportRefLang1Folder', 'btnImportRefLang2Folder', 'btnClearRefLang1', 'btnClearRefLang2', 'refLang1Input', 'refLang2Input', 'refLang1FolderInput', 'refLang2FolderInput',
    'settingsDisableEmptyLineValidation', 'settingsAiTranslationFormatSelect', 'settingsGlossaryInput', 'settingsContextLinesInput', 'settingsSelectionBatchSizeInput', 'settingsGlossaryBatchSizeInput', 'settingsAiCheckBatchSizeInput', 'settingsSelectionPrevShortcutInput', 'settingsSelectionNextShortcutInput', 'btnSettingsReset', 'btnSettingsGlossaryReset', 'btnSettingsAiCheckReset', 'btnSettingsCancel', 'btnSettingsSave', 'lineEditorModal', 'lineEditorTitle',
    'btnDropdownSettings', 'dropdownSettingsMenu', 'btnSettingsGeneral', 'btnSettingsPrompts', 'btnSettingsGlossary', 'settingsPromptsModal', 'settingsGlossaryModal', 'btnSettingsPromptsCancel', 'btnSettingsPromptsSave', 'btnSettingsGlossaryCancel', 'btnSettingsGlossarySave',
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
    'proofreadReplaceInput', 'btnProofreadReplaceAll', 'rangeFromInput', 'rangeToInput', 'btnSelectRange',
    'settingsCheckKanaResidue', 'settingsCheckSimilarity', 'settingsSimilarityThreshold', 'settingsSimilarityThresholdWrap',
    'settingsContextTypeSelect',
    'btnQaCheck', 'qaModal', 'qaCheckGlossary', 'qaCheckKana', 'qaCheckSimilarity', 'btnRunQa', 'btnQaReset', 'qaStats', 'qaResults', 'btnQaClose',
    'btnAutoTranslate', 'btnAutoGlossaryAi', 'btnAutoAiCheck', 'btnFloatingApiSettings', 'apiSettingsModal', 'apiTypeSelect', 'apiUrlInput', 'apiKeyInput', 'apiModelInput', 'apiTemperatureInput', 'apiTopPInput', 'apiRpmInput', 'apiDelayPreview', 'btnApiSettingsCancel', 'btnApiSettingsSave'
  ];
  for (const id of ids) {
    ui[id] = document.getElementById(id);
  }
}

// ─── Scroller Initialization ──────────────────────────────────────────────────

export function initScrollers(): void {
  setMainScroller(new VirtualScroller(ui.previewViewport as HTMLElement, ui.previewContainer as HTMLElement, 85, renderMainRow));
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
    if (isImportBtn) {
      e.preventDefault();
      const rect = isImportBtn.getBoundingClientRect();
      const menu = ui.dropdownImportMenu as HTMLElement;
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.left = rect.left + 'px';
      menu.classList.toggle('show');
    } else {
      if (ui.dropdownImportMenu) {
        (ui.dropdownImportMenu as HTMLElement).classList.remove('show');
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
      menu.style.left = rect.left + 'px';
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
  ui.btnApply?.addEventListener('click', onApplyTranslation);
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
      if (allDefaults.some(d => (ui.settingsPromptInput as HTMLTextAreaElement).value.trim() === d.trim())) {
        (ui.settingsPromptInput as HTMLTextAreaElement).value = currentDefault;
      }
    });
  }

  ui.btnSettingsGlossaryReset?.addEventListener('click', () => { (ui.settingsGlossaryPromptInput as HTMLTextAreaElement).value = DEFAULT_GLOSSARY_PROMPT; });
  ui.btnSettingsAiCheckReset?.addEventListener('click', () => { (ui.settingsAiCheckPromptInput as HTMLTextAreaElement).value = DEFAULT_AI_CHECK_PROMPT; });
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
  ui.proofreadScope?.addEventListener('change', renderProofreadResults);
  ui.proofreadRegexCheck?.addEventListener('change', renderProofreadResults);
  ui.proofreadCaseCheck?.addEventListener('change', renderProofreadResults);
  ui.proofreadExactCheck?.addEventListener('change', renderProofreadResults);
  ui.proofreadTranslatedOnlyCheck?.addEventListener('change', renderProofreadResults);

  ui.btnQaCheck?.addEventListener('click', onOpenQa);
  ui.btnQaClose?.addEventListener('click', () => closeModal(ui.qaModal as HTMLElement));
  ui.btnQaReset?.addEventListener('click', onResetQa);
  ui.btnRunQa?.addEventListener('click', runQaCheck);

  ui.btnAutoTranslate?.addEventListener('click', onAutoTranslate);
  ui.btnAutoGlossaryAi?.addEventListener('click', () => import('./auto-translate').then(m => m.onAutoGlossary()));
  ui.btnAutoAiCheck?.addEventListener('click', () => import('./auto-translate').then(m => m.onAutoAiCheck()));

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
  ui.apiRpmInput?.addEventListener('input', updateDelayPreview);

  bindShortcutCaptureInput(ui.settingsSelectionPrevShortcutInput as HTMLInputElement);
  bindShortcutCaptureInput(ui.settingsSelectionNextShortcutInput as HTMLInputElement);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  // Register PWA service worker
  if ('serviceWorker' in navigator) {
    import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({ immediate: true });
    }).catch(console.error);
  }

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
}
