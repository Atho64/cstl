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
  bookmarked?: boolean;
  _hidden?: boolean;
  _glossary_extracted?: boolean;
  _ai_checked?: boolean;
  _ai_confirmed?: boolean;

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
  epub_img_src?: string;

  // Luca language fields
  luca_jp?: string;
  luca_en?: string;
  luca_zh?: string;

  // Custom parser fields
  /** Original snippet captured by a custom parser at import time, handed back
   *  to the parser's serialize() at export time (patch-style round-trip). */
  custom_raw?: string;
}

// ─── Custom Parser (user-defined import/export formats) ───────────────────────

export interface CustomParser {
  id: string;
  name: string;
  language: 'js' | 'python';
  /** Lowercase extensions including the dot, e.g. ['.xyz', '.dat'] */
  extensions: string[];
  /** Code defining parse(ctx) — runs sandboxed in a worker */
  parseScript: string;
  /** Optional code defining serialize(ctx) for round-trip export */
  serializeScript: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Entry returned by a custom parse() call before normalization into Line. */
export interface CustomParsedEntry {
  name?: string | null;
  message: string;
  raw?: string | null;
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
  summaryPrompt: string;
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
  checkUntransName: boolean;
  enableUncertainMarking: boolean;
  /** Replace angle-bracket section tags (<Glossary>, <Context>, <lines>, …) with
   *  safe `=== LABEL ===` markers before sending to LLM. Prevents ChatGPT from
   *  stripping the tags as if they were HTML. Applies to all Auto Copas targets. */
  safeTagsForChatgpt: boolean;
  aiBackupKeys: string;
  aiKeyStrategy: 'fallback' | 'random';
  aiTranslateMode: 'auto' | 'agent';
  tavilyApiKey: string;
  agentMaxTurns: number;
  currentProjectId: string | null;
  projectName: string;
  projectType: string;
  translationMode: 'ai' | 'htl';
  jsonRefLang: string;
  epubTags: string;
  epubSourceId: string | null;
  showEpubImages: boolean;
  lucaExportLang: string;
  lucaProfile: string;
  lucaMcDisplayName: string;
  lucaRawFiles: Record<string, string[]>;
  lucaRawBuffers: Record<string, string>;
  /** Active custom parser id when projectType === 'custom' */
  customParserId: string | null;
  /** Original decoded text per file for custom-parser round-trip export */
  customRawFiles: Record<string, string>;
  /** Original file bytes (base64) per file for custom-parser round-trip export */
  customRawBuffers: Record<string, string>;
  lines: Line[];
  importedFiles: string[];
  fileOrder: string[];
  aiInstructionHeader: string;
  aiTranslationFormat: string;
  aiApiType: 'openai' | 'gemini' | 'anthropic';
  /** Number of untranslated lines exported by the most recent Copy for AI call. Used to populate {{lineCount}} in prompts. */
  _lastExportedLineCount: number;
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiTemperature: number;
  aiTopP: number;
  aiMaxTokens: number;
  aiFrequencyPenalty: number;
  aiPresencePenalty: number;
  aiSeed: number | null;
  aiReasoningEffort: 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  aiRpm: number;
  aiThinkingMode: 'default' | 'off' | 'on';
  aiFilterThinkingOutput: boolean;
  /** Merge role:system into user message (workaround for gateways that drop system on OpenAI-compatible routes). */
  aiMergeSystemPrompt: boolean;
  glossaryPrompt: string;
  aiCheckPrompt: string;
  agentPrompt: string;
  glossaryText: string;
  contextLines: number;
  contextType: string;
  selectionBatchSize: number;
  glossaryBatchSize: number;
  aiCheckBatchSize: number;
  parallelBatchSize: number;
  subagentWorkers: number;
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
  agentMemories: AgentMemory[];
  projectLoggingEnabled: boolean;
  aiStreaming: boolean;
  autoRepeatOnFailure: boolean;
}

export type WorkspaceTab = 'translate' | 'glossary' | 'aiCheck' | 'delete';

// ─── Undo ─────────────────────────────────────────────────────────────────────

export interface PartialLineSnapshot {
  line_num: number;
  file?: string;
  name?: string | null;
  message?: string;
  trans_name: string | null;
  trans_message: string | null;
  is_translated: boolean;
  bookmarked?: boolean;
  _hidden?: boolean;
  _glossary_extracted?: boolean;
  _ai_checked?: boolean;
  _ai_confirmed?: boolean;
  luca_command?: string;
  luca_pre?: string;
  luca_post?: string;
  luca_text_prefix?: string | null;
  epub_selector?: string;
  epub_id?: string;
}

export interface UndoSnapshot {
  lines: PartialLineSnapshot[];
  /** File-level operations (add/remove/reorder) — when present, lines is empty */
  fileAction?: FileActionSnapshot;
}

export interface FileActionSnapshot {
  type: 'add' | 'remove' | 'reorder';
  /** Files affected by this action */
  files: string[];
  /** Lines that were removed (for 'remove' action undo) */
  removedLines?: Line[];
  /** Lines that were added (for 'add' action undo — to remove them on undo) */
  addedLines?: Line[];
  /** Previous file order (for 'reorder' action undo) */
  prevOrder?: string[];
  /** New file order (for 'reorder' action redo) */
  newOrder?: string[];
  /** Full state snapshot for add/remove (for reliable redo) */
  prevImportedFiles?: string[];
  newImportedFiles?: string[];
  prevFileOrder?: string[];
  newFileOrder?: string[];
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
  category: string;
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
  fileCount: number;
  lineCount?: number;
  updatedAt: number;
  /** Set when the .cstl file exists but cannot be parsed — shown as a recovery card. */
  corrupt?: boolean;
  /** For projectType 'custom': which custom parser the project uses. */
  customParserId?: string | null;
}

// ─── AI Agent Memory ──────────────────────────────────────────────────────────

export type MemoryCategory = 'style' | 'terminology' | 'character' | 'preference' | 'note';
export type MemoryScope = 'global' | 'project';

export interface AgentMemory {
  key: string;
  value: string;
  category: MemoryCategory;
  scope: MemoryScope;
  created: number;
  updated: number;
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
