// @module types.ts — Shared TypeScript interfaces for the CSTL application

// ─── Core Line Object ──────────────────────────────────────────────────────────

export interface Line {
  line_num: number;
  file: string;
  name: string | null;
  message: string;
  trans_name: string | null;
  trans_message: string | null;
  is_translated: boolean;
  _hidden?: boolean;
  _glossary_extracted?: boolean;
  _ai_checked?: boolean;

  // LucaSystem fields
  luca_command?: string;
  luca_choice_index?: number;
  luca_choice_count?: number;
  luca_pre?: string;
  luca_post?: string;
  luca_slot_index?: number;
  luca_file?: string;
  luca_line_index?: number;
  luca_raw_index?: number;
  luca_prefix_b64?: string;
  luca_heavy_quotes?: boolean;
  luca_text_prefix?: string | null;
  luca_raw?: string;
  luca_profile?: string;

  // Reference language fields (HTL mode)
  ref_lang_1?: string | null;
  ref_lang_1_name?: string | null;
  ref_lang_2?: string | null;
  ref_lang_2_name?: string | null;

  // EPUB fields
  epub_selector?: string;
  epub_id?: string;

  // Luca language fields
  luca_jp?: string;
  luca_en?: string;
  luca_zh?: string;
}

// ─── Application State ────────────────────────────────────────────────────────

export interface AppState {
  sourceLang: string;
  targetLang: string;
  regexFilter: string;
  preReplaceRules: string;
  postReplaceRules: string;
  enableBackgroundChaining: boolean;
  currentBackground: string;
  disableEmptyLineValidation: boolean;
  showFurigana: boolean;
  furiganaType: 'furigana' | 'hiragana' | 'katakana' | 'romaji';
  fontSize: number;
  enableDictionary: boolean;
  dictionaryEngine: 'llm' | 'jisho';
  dictionaryPrompt: string;
  checkKanaResidue: boolean;
  checkSimilarity: boolean;
  similarityThreshold: number;
  checkLinebreak: boolean;
  checkLengthRatio: boolean;
  lengthRatioThreshold: number;
  checkLanguage: boolean;
  checkPunctuation: boolean;
  enableUncertainMarking: boolean;
  aiBackupKeys: string;
  aiKeyStrategy: 'fallback' | 'random';
  aiTranslateMode: 'auto' | 'agent';
  agentMaxTurns: number;
  currentProjectId: string | null;
  projectName: string;
  projectType: string;
  translationMode: 'ai' | 'htl';
  jsonRefLang: string;
  epubTags: string;
  epubSourceId: string | null;
  lucaExportLang: string;
  lucaProfile: string;
  lucaMcDisplayName: string;
  lucaRawFiles: Record<string, string[]>;
  lucaRawBuffers: Record<string, string>;
  lines: Line[];
  importedFiles: string[];
  aiInstructionHeader: string;
  aiTranslationFormat: string;
  aiApiType: 'openai' | 'gemini';
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiTemperature: number;
  aiTopP: number;
  aiRpm: number;
  aiThinkingMode: 'default' | 'off' | 'on';
  aiFilterThinkingOutput: boolean;
  glossaryPrompt: string;
  aiCheckPrompt: string;
  agentPrompt: string;
  glossaryText: string;
  contextLines: number;
  contextType: string;
  selectionBatchSize: number;
  glossaryBatchSize: number;
  aiCheckBatchSize: number;
  selectionBatchPrevShortcut: string;
  selectionBatchNextShortcut: string;
  undoStack: UndoSnapshot[];
  redoStack: UndoSnapshot[];
  selectedLines: Set<number>;
  selectionHistory: number[][];
  selectionHistoryIndex: number;
  activeWorkspaceTab: WorkspaceTab;
  displayRows: DisplayRow[];
  lineByNum: Map<number, Line>;
  proofreadMatches: ProofreadMatch[];
  qaMatches: QaMatch[];
  aiCheckCorrections: AiCheckCorrection[];
  dashboardProjects: DashboardProject[];
}

export type WorkspaceTab = 'translate' | 'glossary' | 'aiCheck' | 'delete';

// ─── Undo ─────────────────────────────────────────────────────────────────────

export interface PartialLineSnapshot {
  line_num: number;
  trans_name: string | null;
  trans_message: string | null;
  is_translated: boolean;
  _hidden?: boolean;
  _glossary_extracted?: boolean;
  _ai_checked?: boolean;
}

export interface UndoSnapshot {
  lines: PartialLineSnapshot[];
}

// ─── Display / Render ─────────────────────────────────────────────────────────

export interface DisplayRow {
  type: 'line' | 'separator';
  line?: Line;
  file?: string;
}

// ─── Proofread ────────────────────────────────────────────────────────────────

export interface ProofreadMatch {
  num: number;
  file: string;
  origName: string;
  origMsg: string;
  transName: string | null;
  transMsg: string | null;
  isTrans: boolean;
}

// ─── QA ───────────────────────────────────────────────────────────────────────

export interface QaMatch {
  num: number;
  file: string;
  origName: string | null;
  origMsg: string;
  transName: string | null;
  transMsg: string | null;
  errors: string[];
}

// ─── AI Check ─────────────────────────────────────────────────────────────────

export interface AiCheckCorrection {
  num: number;
  reason: string;
  name: string;
  text: string;
  checked: boolean;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardProject {
  id: string;
  name: string;
  projectType: string;
  translationMode: string;
  totalLines: number;
  translatedLines: number;
  updatedAt: number;
}

// ─── Glossary ─────────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  target: string;
  type: string;
  desc: string;
}

// ─── Shortcut ─────────────────────────────────────────────────────────────────

export interface ShortcutParsed {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

// ─── Parsed Translation Items ────────────────────────────────────────────────

export interface ParsedTranslationItem {
  num: number;
  name: string | null;
  msg: string;
  rawMsg: string;
}

// ─── UI Cache (populated dynamically by ui-init.ts) ──────────────────────────

export type UiCache = Record<string, HTMLElement | any>;
