// @module state.js — Shared application state, ui cache, and module-level variables

import {
  DEFAULT_LUCA_MC_DISPLAY_NAME,
  DEFAULT_PROMPT_HEADER,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_GLOSSARY_PROMPT,
  DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_SELECTION_BATCH_SIZE,
  DEFAULT_GLOSSARY_BATCH_SIZE,
  DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
  DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
} from './constants.js';

// ─── Shared Application State ────────────────────────────────────────────────
export const state = {
  sourceLang: "Japanese",
  targetLang: "Indonesian",
  regexFilter: "",
  disableEmptyLineValidation: false,
  checkKanaResidue: false,
  checkSimilarity: false,
  similarityThreshold: 0.7,
  currentProjectId: null,
  projectName: "",
  projectType: "",
  epubTags: "p",
  epubSourceId: null,
  lucaExportLang: "en",
  lucaProfile: "summer-pockets-steam",
  lucaMcDisplayName: DEFAULT_LUCA_MC_DISPLAY_NAME,
  lucaRawFiles: {},
  lucaRawBuffers: {},
  lines: [],
  importedFiles: [],
  aiInstructionHeader: DEFAULT_PROMPT_HEADER,
  aiTranslationFormat: DEFAULT_AI_TRANSLATION_FORMAT,
  glossaryPrompt: DEFAULT_GLOSSARY_PROMPT,
  aiCheckPrompt: DEFAULT_AI_CHECK_PROMPT,
  glossaryText: "",
  contextLines: 10,
  selectionBatchSize: DEFAULT_SELECTION_BATCH_SIZE,
  glossaryBatchSize: DEFAULT_GLOSSARY_BATCH_SIZE,
  aiCheckBatchSize: DEFAULT_AI_CHECK_BATCH_SIZE,
  selectionBatchPrevShortcut: DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
  selectionBatchNextShortcut: DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
  undoStack: [],
  selectedLines: new Set(),
  selectionHistory: [],
  selectionHistoryIndex: -1,
  activeWorkspaceTab: "translate",
  displayRows: [],
  lineByNum: new Map(),
  proofreadMatches: [],
  qaMatches: [],
  aiCheckCorrections: [],
  dashboardProjects: [],
};

// ─── Shared UI Element Cache ──────────────────────────────────────────────────
export const ui = {};

// ─── Module-Level Variables ───────────────────────────────────────────────────
// These are mutable references shared across modules via getters/setters.

let _mainScroller = null;
let _proofreadScroller = null;
let _qaScroller = null;
let _activeLineEditorLineNum = null;
let _saveTimeout = null;
let _hintToken = 0;

export function getMainScroller() { return _mainScroller; }
export function setMainScroller(s) { _mainScroller = s; }

export function getProofreadScroller() { return _proofreadScroller; }
export function setProofreadScroller(s) { _proofreadScroller = s; }

export function getQaScroller() { return _qaScroller; }
export function setQaScroller(s) { _qaScroller = s; }

export function getActiveLineEditorLineNum() { return _activeLineEditorLineNum; }
export function setActiveLineEditorLineNum(n) { _activeLineEditorLineNum = n; }

export function getSaveTimeout() { return _saveTimeout; }
export function setSaveTimeout(t) { _saveTimeout = t; }

export function getHintToken() { return _hintToken; }
export function incrementHintToken() { return ++_hintToken; }

// ─── Core Helpers (used everywhere) ──────────────────────────────────────────

export function isTranslated(line) {
  return !!line.is_translated && (state.disableEmptyLineValidation || !!String(line.trans_message).trim());
}

export function normalizeLineDict(line) {
  const normalized = {
    line_num: Number(line.line_num),
    file: String(line.file),
    name: line.name == null ? null : String(line.name).replace(/\r?\n/g, "\\n").trim(),
    message: String(line.message).replace(/\r?\n/g, "\\n").trim(),
    trans_name: line.trans_name == null ? null : String(line.trans_name).replace(/\r?\n/g, "\\n").trim(),
    trans_message: line.trans_message == null ? null : String(line.trans_message).replace(/\r?\n/g, "\\n").trim(),
    is_translated: Boolean(line.is_translated),
    ...(line.luca_jp != null ? { luca_jp: String(line.luca_jp) } : {}),
    ...(line.luca_en != null ? { luca_en: String(line.luca_en) } : {}),
  };
  if (line.luca_command) normalized.luca_command = String(line.luca_command);
  if (line.luca_choice_index != null) normalized.luca_choice_index = Number(line.luca_choice_index);
  if (line.luca_choice_count != null) normalized.luca_choice_count = Number(line.luca_choice_count);
  if (line.luca_pre != null) normalized.luca_pre = String(line.luca_pre);
  if (line.luca_post != null) normalized.luca_post = String(line.luca_post);
  if (line.luca_slot_index != null) normalized.luca_slot_index = Number(line.luca_slot_index);
  if (line.luca_file != null) normalized.luca_file = String(line.luca_file);
  if (line.luca_line_index != null) normalized.luca_line_index = Number(line.luca_line_index);
  if (line.epub_selector != null) normalized.epub_selector = String(line.epub_selector);
  if (line.epub_id != null) normalized.epub_id = String(line.epub_id);
  return normalized;
}

export function getOpfsRoot() {
  return navigator.storage.getDirectory();
}
