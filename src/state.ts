// @module state.ts — Shared application state, ui cache, and module-level variables

import type { AppState, UiCache, Line } from './types';
import {
  DEFAULT_LUCA_MC_DISPLAY_NAME,
  DEFAULT_PROMPT_HEADER,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_GLOSSARY_PROMPT,
  DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_AGENT_PROMPT,
  DEFAULT_SELECTION_BATCH_SIZE,
  DEFAULT_GLOSSARY_BATCH_SIZE,
  DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
  DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
} from './constants';

// ─── Shared Application State ────────────────────────────────────────────────────
export const state: AppState = {
  sourceLang: 'Japanese',
  targetLang: 'Indonesian',
  regexFilter: '',
  preReplaceRules: '',
  postReplaceRules: '',
  enableBackgroundChaining: false,
  currentBackground: '',
  disableEmptyLineValidation: false,
  showFurigana: false,
  furiganaType: 'furigana',
  fontSize: 14,
  enableDictionary: false,
  dictionaryEngine: 'llm',
  dictionaryPrompt: 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.',
  checkKanaResidue: false,
  checkSimilarity: false,
  similarityThreshold: 0.7,
  checkLinebreak: false,
  checkLengthRatio: false,
  lengthRatioThreshold: 2.5,
  checkLanguage: false,
  checkPunctuation: false,
  checkUntransName: false,
  enableUncertainMarking: false,
  aiBackupKeys: '',
  aiKeyStrategy: 'fallback',
  aiTranslateMode: 'auto',
  tavilyApiKey: '',
  agentMaxTurns: 10,
  currentProjectId: null,
  projectName: '',
  projectType: '',
  translationMode: 'ai', // "ai" or "htl" — HTL hides all AI features
  jsonRefLang: '', // optional reference language code for json projects: "en", "zh", etc. (empty = disabled)
  epubTags: 'p',
  epubSourceId: null,
  lucaExportLang: 'en',
  lucaProfile: 'summer-pockets-steam',
  lucaMcDisplayName: DEFAULT_LUCA_MC_DISPLAY_NAME,
  lucaRawFiles: {},
  lucaRawBuffers: {},
  lines: [],
  importedFiles: [],
  aiInstructionHeader: DEFAULT_PROMPT_HEADER,
  aiTranslationFormat: DEFAULT_AI_TRANSLATION_FORMAT,
  aiApiType: 'openai',
  aiApiUrl: '',
  aiApiKey: '',
  aiModel: 'gpt-4o-mini',
  aiTemperature: 1.0,
  aiTopP: 1.0,
  aiRpm: 10,
  aiThinkingMode: 'default',
  aiFilterThinkingOutput: true,
  glossaryPrompt: DEFAULT_GLOSSARY_PROMPT,
  aiCheckPrompt: DEFAULT_AI_CHECK_PROMPT,
  agentPrompt: DEFAULT_AGENT_PROMPT,
  glossaryText: '',
  contextLines: 10,
  contextType: 'raw',
  selectionBatchSize: DEFAULT_SELECTION_BATCH_SIZE,
  glossaryBatchSize: DEFAULT_GLOSSARY_BATCH_SIZE,
  aiCheckBatchSize: DEFAULT_AI_CHECK_BATCH_SIZE,
  parallelBatchSize: 1,
  selectionBatchPrevShortcut: DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
  selectionBatchNextShortcut: DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
  undoStack: [],
  redoStack: [],
  selectedLines: new Set(),
  selectionHistory: [],
  selectionHistoryIndex: -1,
  activeWorkspaceTab: 'translate',
  displayRows: [],
  lineByNum: new Map(),
  proofreadMatches: [],
  qaMatches: [],
  aiCheckCorrections: [],
  dashboardProjects: [],
  agentMemories: [],
};

// ─── Shared UI Element Cache ──────────────────────────────────────────────────
export const ui: UiCache = {};

// ─── Module-Level Variables ───────────────────────────────────────────────────
// These are mutable references shared across modules via getters/setters.

let _mainScroller: any = null;
let _proofreadScroller: any = null;
let _qaScroller: any = null;
let _activeLineEditorLineNum: number | null = null;
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;
let _hintToken = 0;

export function getMainScroller() { return _mainScroller; }
export function setMainScroller(s: any) {
  if (_mainScroller && _mainScroller !== s) _mainScroller.dispose?.();
  _mainScroller = s;
}

export function getProofreadScroller() { return _proofreadScroller; }
export function setProofreadScroller(s: any) {
  if (_proofreadScroller && _proofreadScroller !== s) _proofreadScroller.dispose?.();
  _proofreadScroller = s;
}

export function getQaScroller() { return _qaScroller; }
export function setQaScroller(s: any) {
  if (_qaScroller && _qaScroller !== s) _qaScroller.dispose?.();
  _qaScroller = s;
}

export function getActiveLineEditorLineNum() { return _activeLineEditorLineNum; }
export function setActiveLineEditorLineNum(n: number | null) { _activeLineEditorLineNum = n; }

export function getSaveTimeout() { return _saveTimeout; }
export function setSaveTimeout(t: ReturnType<typeof setTimeout> | null) { _saveTimeout = t; }

export function getHintToken() { return _hintToken; }
export function incrementHintToken() { return ++_hintToken; }

// ─── Core Helpers (used everywhere) ──────────────────────────────────────────

export function isTranslated(line: Line): boolean {
  return !!line.is_translated && (state.disableEmptyLineValidation || !!String(line.trans_message).trim());
}

export function normalizeLineDict(line: any): Line {
  const normalized: Line = {
    line_num: Number(line.line_num),
    file: String(line.file),
    name: line.name == null ? null : String(line.name).replace(/\r?\n/g, '\\n').trim(),
    message: String(line.message).replace(/\r?\n/g, '\\n').trim(),
    trans_name: line.trans_name == null ? null : String(line.trans_name).replace(/\r?\n/g, '\\n').trim(),
    trans_message: line.trans_message == null ? null : String(line.trans_message).replace(/\r?\n/g, '\\n').trim(),
    is_translated: Boolean(line.is_translated),
    ...(line.luca_jp != null ? { luca_jp: String(line.luca_jp) } : {}),
    ...(line.luca_en != null ? { luca_en: String(line.luca_en) } : {}),
    ...(line.luca_zh != null ? { luca_zh: String(line.luca_zh) } : {}),
    ...(line.ref_lang_1 != null ? { ref_lang_1: String(line.ref_lang_1) } : {}),
    ...(line.ref_lang_2 != null ? { ref_lang_2: String(line.ref_lang_2) } : {}),
  };
  if (line.luca_command) normalized.luca_command = String(line.luca_command);
  if (line.luca_choice_index != null) normalized.luca_choice_index = Number(line.luca_choice_index);
  if (line.luca_choice_count != null) normalized.luca_choice_count = Number(line.luca_choice_count);
  if (line.luca_pre != null) normalized.luca_pre = String(line.luca_pre);
  if (line.luca_post != null) normalized.luca_post = String(line.luca_post);
  if (line.luca_slot_index != null) normalized.luca_slot_index = Number(line.luca_slot_index);
  if (line.luca_file != null) normalized.luca_file = String(line.luca_file);
  if (line.luca_line_index != null) normalized.luca_line_index = Number(line.luca_line_index);
  if (line.luca_raw_index != null) normalized.luca_raw_index = Number(line.luca_raw_index);
  if (line.luca_raw != null) normalized.luca_raw = String(line.luca_raw);
  if (line.luca_profile != null) normalized.luca_profile = String(line.luca_profile);
  if (line.luca_heavy_quotes != null) normalized.luca_heavy_quotes = Boolean(line.luca_heavy_quotes);
  if (line.luca_text_prefix != null) normalized.luca_text_prefix = String(line.luca_text_prefix);
  if (line.luca_prefix_b64 != null) normalized.luca_prefix_b64 = String(line.luca_prefix_b64);
  if (line.epub_selector != null) normalized.epub_selector = String(line.epub_selector);
  if (line.epub_id != null) normalized.epub_id = String(line.epub_id);
  return normalized;
}

export function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}
