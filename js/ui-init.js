// @module ui-init.js — DOM element caching, scroller initialization, and event binding

import { state, ui, setMainScroller, setProofreadScroller, setQaScroller } from './state.js';
import {
  DEFAULT_AI_TRANSLATION_FORMAT, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
  DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL,
} from './constants.js';
import { VirtualScroller } from './virtual-scroller.js';
import { renderMainRow, syncCheckboxUI, updateButtonStates, onSaveLineEditor, flashHint } from './render.js';
import { renderProofreadRow } from './proofread.js';
import { renderQaRow } from './qa.js';
import {
  onSelectionHistoryKeydown, isSelectableForActiveTab, recordSelectionHistory,
  switchWorkspaceTab,
} from './selection.js';
import { onSaveGlossary, onImportGlossaryFile, onExportGlossaryFile, onDeleteTranslation, onCopyForGlossaryAi } from './glossary.js';
import { onCopyForAi, onApplyTranslation, onUndoLastApply } from './translate.js';
import { onCopyNamesForAi, onApplyNameTranslations, onResetNameTranslations } from './name-translation.js';
import { onCopyForAiCheck, onParseAiCheck, onApplyAiCheckCorrections, onClearAiCheck } from './ai-check.js';
import { onOpenProofread, onResetProofread, onProofreadReplaceAll, renderProofreadResults } from './proofread.js';
import { onOpenQa, onResetQa, runQaCheck } from './qa.js';
import { onOpenSettings, onSavePromptSettings } from './settings.js';
import { onExport } from './export.js';
import { onImportVndbNames } from './vndb-anilist.js';
import { onImportAnilistNames } from './vndb-anilist.js';
import { onExtractEpubRubyNames } from './epub-ruby.js';
import {
  onImportFileChange, onImportFolderChange, onImportZipChange,
  onImportLucaTxtChange, onImportLucaTxtFolderChange,
} from './import-source.js';
import { onImportTranslatedFileChange, onImportTranslatedFolderChange } from './import-translated.js';
import {
  createNewProject, closeProject, onRestoreProject, renderDashboardProjects,
  openDashboardSettings, saveDashboardSettings, resetDashboardSettings,
  openModal, closeModal, loadDashboardProjects,
} from './project.js';
import {
  getDefaultPromptHeaderForFormat, DEFAULT_LUCA_PROFILE,
} from './ai-format.js';
import { getLucaProfile, populateLucaExportSlotSelect } from './luca-engine.js';
import { bindShortcutCaptureInput } from './shortcuts.js';
import { getMainScroller } from './state.js';

// ─── Debounce Utility ─────────────────────────────────────────────────────────

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ─── Element Caching ──────────────────────────────────────────────────────────

export function cacheElements() {
  const ids = [
    "dashboardView", "workspaceView", "projectList", "projectFilterInput", "btnNewProject", "btnRestoreProject",
    "btnBackToDashboard", "projectNameDisplay", "restoreProjectInput", "btnDropdownImport", "dropdownImportMenu", "btnImportFile",
    "btnDashboardSettings", "dashboardSettingsModal", "btnDashboardSettingsSave", "btnDashboardSettingsReset", "btnDashboardSettingsCancel",
    "dsSourceLang", "dsTargetLang", "dsAiFormat", "dsContextLines", "dsSelectionBatch", "dsGlossaryBatch", "dsAiCheckBatch", "dsRegexFilter",
    "btnImportFolder", "btnImportZip", "btnImportTranslatedFile", "btnImportTranslatedFolder", "btnExport", "btnProofread", "btnSettings",
    "previewViewport", "previewContainer", "progressFill", "progressText", "btnSelectAll",
    "btnClearSelection", "copyCount", "btnCopyForAi", "copyStatus", "pasteArea", "btnApply", "checkIgnorePasteNames",
    "btnUndo", "nameTableBody", "statusBar", "importFileInput", "importFolderInput", "importTranslatedFileInput", "importTranslatedFolderInput",
    "btnCopyNamesForAi", "copyNameCount", "pasteNameArea", "btnApplyNameTranslations", "btnResetNameTranslations",
    "glossaryPreviewWrap", "glossaryPreviewText",
    "importZipInput", "importLucaTxtInput", "importLucaTxtFolderInput", "btnImportLucaTxt", "btnImportLucaTxtFolder",
    "glossaryFileInput", "settingsModal", "settingsPromptInput", "settingsGlossaryPromptInput", "settingsAiCheckPromptInput", "settingsEpubTagsInput",
    "settingsLucaWrap", "settingsLucaProfileSelect", "settingsLucaMcWrap", "settingsLucaMcDisplayNameInput", "settingsLucaExportLangWrap", "settingsLucaExportLangSelect", "settingsSourceLangSelect", "settingsTargetLangSelect", "settingsRegexFilterInput",
    "settingsDisableEmptyLineValidation", "settingsAiTranslationFormatSelect", "settingsGlossaryInput", "settingsContextLinesInput", "settingsSelectionBatchSizeInput", "settingsGlossaryBatchSizeInput", "settingsAiCheckBatchSizeInput", "settingsSelectionPrevShortcutInput", "settingsSelectionNextShortcutInput", "btnSettingsReset", "btnSettingsGlossaryReset", "btnSettingsAiCheckReset", "btnSettingsCancel", "btnSettingsSave", "lineEditorModal", "lineEditorTitle",
    "tabTranslate", "tabGlossary", "viewTranslate", "viewGlossary", "btnCopyForGlossaryAi", "pasteGlossaryArea", "btnSaveGlossary", "btnImportGlossaryFile", "btnExportGlossaryFile", "copyGlossaryCount", "btnDeleteTranslation", "deleteTranslationCount", "tabDelete", "viewDelete",
    "tabAiCheck", "viewAiCheck", "btnCopyForAiCheck", "copyAiCheckCount", "aiCheckStatus", "pasteAiCheckArea", "btnParseAiCheck", "btnApplyAiCheck", "btnClearAiCheck", "aiCheckResults",
    "vndbInput", "btnImportVndbNames", "vndbStatus",
    "btnExtractEpubRubyNames", "epubRubyStatus", "anilistInput", "btnImportAnilistNames", "anilistStatus",
    "lineOriginalView", "lineNameWrap", "lineNameInput", "lineMessageInput", "lineTranslatedCheck",
    "lucaRefWrap", "lineRefEnView", "lineRefZhView",
    "btnLineCancel", "btnLineSave", "proofreadModal", "proofreadSearchInput", "proofreadScope",
    "proofreadRegexCheck", "proofreadCaseCheck", "proofreadExactCheck", "proofreadTranslatedOnlyCheck",
    "btnProofreadReset", "proofreadStatus", "proofreadContainer", "btnProofreadClose",
    "proofreadReplaceInput", "btnProofreadReplaceAll", "rangeFromInput", "rangeToInput", "btnSelectRange",
    "settingsCheckKanaResidue", "settingsCheckSimilarity", "settingsSimilarityThreshold", "settingsSimilarityThresholdWrap",
    "btnQaCheck", "qaModal", "qaCheckGlossary", "qaCheckKana", "qaCheckSimilarity", "btnRunQa", "btnQaReset", "qaStats", "qaResults", "btnQaClose"
  ];
  for (const id of ids) {
    ui[id] = document.getElementById(id);
  }
}

// ─── Scroller Initialization ──────────────────────────────────────────────────

export function initScrollers() {
  setMainScroller(new VirtualScroller(ui.previewViewport, ui.previewContainer, 85, renderMainRow));

  const proofreadViewport = ui.proofreadContainer.closest('.proofread-results-wrap');
  setProofreadScroller(new VirtualScroller(proofreadViewport, ui.proofreadContainer, 90, renderProofreadRow));

  const qaViewport = ui.qaResults.closest('.proofread-results-wrap');
  setQaScroller(new VirtualScroller(qaViewport, ui.qaResults, 90, renderQaRow));
}

// ─── Event Binding ────────────────────────────────────────────────────────────

export function bindEvents() {
  document.addEventListener("click", e => {
    const isImportBtn = e.target.closest('#btnDropdownImport');
    if (isImportBtn) {
      e.preventDefault();
      const rect = isImportBtn.getBoundingClientRect();
      ui.dropdownImportMenu.style.top = (rect.bottom + 4) + 'px';
      ui.dropdownImportMenu.style.left = rect.left + 'px';
      ui.dropdownImportMenu.classList.toggle("show");
    } else {
      if (!e.target.closest('.dropdown') && ui.dropdownImportMenu) {
        ui.dropdownImportMenu.classList.remove("show");
      }
    }
  });

  document.addEventListener("keydown", onSelectionHistoryKeydown);
  ui.btnNewProject.addEventListener("click", createNewProject);
  ui.projectFilterInput.addEventListener("input", () => renderDashboardProjects());
  ui.btnBackToDashboard.addEventListener("click", closeProject);
  ui.btnRestoreProject.addEventListener("click", () => ui.restoreProjectInput.click());
  ui.restoreProjectInput.addEventListener("change", onRestoreProject);

  // Dashboard default settings
  ui.btnDashboardSettings.addEventListener("click", openDashboardSettings);
  ui.btnDashboardSettingsSave.addEventListener("click", saveDashboardSettings);
  ui.btnDashboardSettingsReset.addEventListener("click", resetDashboardSettings);
  ui.btnDashboardSettingsCancel.addEventListener("click", () => ui.dashboardSettingsModal.classList.remove("open"));
  ui.btnImportFile.addEventListener("click", () => ui.importFileInput.click());
  ui.btnImportFolder.addEventListener("click", () => ui.importFolderInput.click());
  ui.btnImportZip.addEventListener("click", () => ui.importZipInput.click());
  ui.btnImportLucaTxt.addEventListener("click", () => ui.importLucaTxtInput.click());
  ui.btnImportLucaTxtFolder.addEventListener("click", () => ui.importLucaTxtFolderInput.click());
  ui.btnImportTranslatedFile.addEventListener("click", () => ui.importTranslatedFileInput.click());
  ui.btnImportTranslatedFolder.addEventListener("click", () => ui.importTranslatedFolderInput.click());
  ui.importFileInput.addEventListener("change", onImportFileChange);
  ui.importFolderInput.addEventListener("change", onImportFolderChange);
  ui.importZipInput.addEventListener("change", onImportZipChange);
  ui.importLucaTxtInput.addEventListener("change", onImportLucaTxtChange);
  ui.importLucaTxtFolderInput.addEventListener("change", onImportLucaTxtFolderChange);
  ui.importTranslatedFileInput.addEventListener("change", onImportTranslatedFileChange);
  ui.importTranslatedFolderInput.addEventListener("change", onImportTranslatedFolderChange);
  ui.glossaryFileInput.addEventListener("change", onImportGlossaryFile);
  ui.btnExport.addEventListener("click", onExport);
  ui.btnCopyForAi.addEventListener("click", onCopyForAi);
  ui.btnCopyNamesForAi.addEventListener("click", onCopyNamesForAi);
  ui.btnCopyForGlossaryAi.addEventListener("click", onCopyForGlossaryAi);
  ui.btnApply.addEventListener("click", onApplyTranslation);
  ui.btnApplyNameTranslations.addEventListener("click", onApplyNameTranslations);
  ui.btnResetNameTranslations.addEventListener("click", onResetNameTranslations);
  ui.pasteNameArea.addEventListener("input", updateButtonStates);
  ui.btnSaveGlossary.addEventListener("click", onSaveGlossary);
  ui.btnImportGlossaryFile.addEventListener("click", () => ui.glossaryFileInput.click());
  ui.btnExportGlossaryFile.addEventListener("click", onExportGlossaryFile);
  ui.btnDeleteTranslation.addEventListener("click", onDeleteTranslation);
  ui.btnImportVndbNames.addEventListener("click", onImportVndbNames);
  ui.btnExtractEpubRubyNames.addEventListener("click", onExtractEpubRubyNames);
  ui.btnImportAnilistNames.addEventListener("click", onImportAnilistNames);

  ui.tabTranslate.addEventListener("click", () => switchWorkspaceTab("translate"));
  ui.tabGlossary.addEventListener("click", () => switchWorkspaceTab("glossary"));
  ui.tabAiCheck.addEventListener("click", () => switchWorkspaceTab("aiCheck"));
  ui.tabDelete.addEventListener("click", () => switchWorkspaceTab("delete"));
  ui.btnCopyForAiCheck.addEventListener("click", onCopyForAiCheck);
  ui.btnParseAiCheck.addEventListener("click", onParseAiCheck);
  ui.btnApplyAiCheck.addEventListener("click", onApplyAiCheckCorrections);
  ui.btnClearAiCheck.addEventListener("click", onClearAiCheck);
  ui.pasteAiCheckArea.addEventListener("input", updateButtonStates);
  ui.btnUndo.addEventListener("click", onUndoLastApply);
  ui.btnProofread.addEventListener("click", onOpenProofread);
  ui.btnSelectAll.addEventListener("click", () => {
    state.selectedLines.clear();
    state.lines.forEach(l => {
      if (isSelectableForActiveTab(l)) state.selectedLines.add(l.line_num);
    });
    recordSelectionHistory();
    syncCheckboxUI();
  });
  ui.btnClearSelection.addEventListener("click", () => {
    state.selectedLines.clear();
    recordSelectionHistory();
    syncCheckboxUI();
  });
  ui.btnSelectRange.addEventListener("click", () => {
    const f = parseInt(ui.rangeFromInput.value);
    const t = parseInt(ui.rangeToInput.value);
    if (isNaN(f) || isNaN(t) || f > t) return alert("Range tidak valid.");
    state.selectedLines.clear();
    for (let i = f; i <= t; i++) {
      const l = state.lineByNum.get(i);
      if (l && isSelectableForActiveTab(l)) state.selectedLines.add(i);
    }
    recordSelectionHistory();
    syncCheckboxUI();
    const mainScroller = getMainScroller();
    const targetIndex = state.displayRows.findIndex(row => row.type === "line" && row.line.line_num === f);
    if (targetIndex !== -1) {
      mainScroller.scrollToIndex(targetIndex);
      setTimeout(() => {
        const targetEl = document.querySelector(`input[data-num="${f}"]`);
        if (targetEl) {
          const rowEl = targetEl.closest('.preview-row');
          rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
          const originalBg = rowEl.style.backgroundColor;
          rowEl.style.transition = "background-color 0.3s ease";
          rowEl.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
          setTimeout(() => { rowEl.style.backgroundColor = originalBg; }, 800);
        }
      }, 50);
    }
  });
  ui.btnSettings.addEventListener("click", onOpenSettings);
  ui.btnSettingsReset.addEventListener("click", () => {
    const format = ui.settingsAiTranslationFormatSelect?.value || DEFAULT_AI_TRANSLATION_FORMAT;
    ui.settingsPromptInput.value = getDefaultPromptHeaderForFormat(format);
    ui.settingsEpubTagsInput.value = "p";
  });
  if (ui.settingsAiTranslationFormatSelect) {
    ui.settingsAiTranslationFormatSelect.addEventListener("change", () => {
      const format = ui.settingsAiTranslationFormatSelect.value || DEFAULT_AI_TRANSLATION_FORMAT;
      const currentDefault = getDefaultPromptHeaderForFormat(format);
      const allDefaults = [
        DEFAULT_PROMPT_HEADER_NUMBERED,
        DEFAULT_PROMPT_HEADER_BLOCK,
        DEFAULT_PROMPT_HEADER_XML,
        DEFAULT_PROMPT_HEADER_JSONL,
      ];
      if (allDefaults.some(d => ui.settingsPromptInput.value.trim() === d.trim())) {
        ui.settingsPromptInput.value = currentDefault;
      }
    });
  }
  ui.btnSettingsGlossaryReset.addEventListener("click", () => {
    ui.settingsGlossaryPromptInput.value = DEFAULT_GLOSSARY_PROMPT;
  });
  ui.btnSettingsAiCheckReset.addEventListener("click", () => {
    ui.settingsAiCheckPromptInput.value = DEFAULT_AI_CHECK_PROMPT;
  });
  ui.btnSettingsCancel.addEventListener("click", () => closeModal(ui.settingsModal));
  ui.btnSettingsSave.addEventListener("click", onSavePromptSettings);
  if (ui.settingsCheckSimilarity) {
    ui.settingsCheckSimilarity.addEventListener("change", () => {
      ui.settingsSimilarityThresholdWrap.style.display = ui.settingsCheckSimilarity.checked ? "flex" : "none";
    });
  }
  if (ui.settingsLucaProfileSelect) {
    ui.settingsLucaProfileSelect.addEventListener("change", () => {
      if (state.lines.length > 0) return;
      const profileId = ui.settingsLucaProfileSelect.value || DEFAULT_LUCA_PROFILE;
      populateLucaExportSlotSelect(profileId);
      const profile = getLucaProfile(profileId);
      if (ui.settingsLucaMcWrap) {
        ui.settingsLucaMcWrap.style.display = profile.nameAtFormat ? "block" : "none";
      }
    });
  }
  ui.btnLineCancel.addEventListener("click", () => closeModal(ui.lineEditorModal));
  ui.btnLineSave.addEventListener("click", onSaveLineEditor);
  ui.btnProofreadClose.addEventListener("click", () => closeModal(ui.proofreadModal));
  ui.btnProofreadReset.addEventListener("click", onResetProofread);
  ui.btnProofreadReplaceAll.addEventListener("click", onProofreadReplaceAll);
  const debouncedSearch = debounce(renderProofreadResults, 250);
  ui.proofreadSearchInput.addEventListener("input", debouncedSearch);
  ui.proofreadScope.addEventListener("change", renderProofreadResults);
  ui.proofreadRegexCheck.addEventListener("change", renderProofreadResults);
  ui.proofreadCaseCheck.addEventListener("change", renderProofreadResults);
  ui.proofreadExactCheck.addEventListener("change", renderProofreadResults);
  ui.proofreadTranslatedOnlyCheck.addEventListener("change", renderProofreadResults);

  ui.btnQaCheck.addEventListener("click", onOpenQa);
  ui.btnQaClose.addEventListener("click", () => closeModal(ui.qaModal));
  ui.btnQaReset.addEventListener("click", onResetQa);
  ui.btnRunQa.addEventListener("click", runQaCheck);

  bindShortcutCaptureInput(ui.settingsSelectionPrevShortcutInput);
  bindShortcutCaptureInput(ui.settingsSelectionNextShortcutInput);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function init() {
  cacheElements();
  initScrollers();
  bindEvents();

  if (!navigator.storage || !navigator.storage.getDirectory) {
    alert("Browser kamu tidak mendukung Sistem File OPFS. Beberapa fitur tidak akan berjalan optimal.");
    ui.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1; color: var(--danger);">Browser tidak mendukung OPFS. Sistem penyimpanan tidak dapat diakses.</p>`;
    return;
  }

  await loadDashboardProjects();
}
