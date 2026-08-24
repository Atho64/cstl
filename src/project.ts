// @module project.ts — Project management, OPFS persistence, dashboard, backup & restore

import { state, ui, setSaveTimeout, getSaveTimeout, getOpfsRoot } from './state';
import {
  APP_VERSION, PROJECT_EXT,
  DEFAULT_PROMPT_HEADER, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_AGENT_PROMPT, DEFAULT_SUMMARY_PROMPT,
  DEFAULT_LUCA_MC_DISPLAY_NAME,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_SELECTION_BATCH_SIZE, DEFAULT_GLOSSARY_BATCH_SIZE, DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_SELECTION_BATCH_PREV_SHORTCUT, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
} from './constants';
import { DEFAULT_LUCA_PROFILE, clearLucaFileLineBytesCache, parseLucaTxt } from './luca-engine';
import type { Line } from './types';
import { normalizeAiTranslationFormat, getDefaultPromptHeaderForFormat } from './ai-format';
import { readEpubSourceForBackup, writeEpubSourceFromBackup, cloneExistingEpubSource } from './binary-utils';
import { resetSelectionHistory, switchWorkspaceTab, normalizeSelectionBatchSize } from './selection';
import { normalizeLineDict, isIlustrasiLine } from './state';
import { normalizeShortcutString } from './shortcuts';
import { getDictHistory, setDictHistory } from './dictionary';
import { applyProjectLoggingVisibility } from './logging';
import { salvageJsonObject } from './json-repair';
import { icon } from './icons';
import { preloadEpubImages, clearEpubImageCache } from './epub-images';
import { getCustomParser, isValidCustomParser, upsertCustomParser } from './custom-parsers';

// ─── Luca raw-field recovery (migration for saves made before the luca_raw_index fix) ───
function recoverLucaRawFields(): void {
  if (state.projectType !== 'luca') return;
  const needsRecovery = state.lines.some(l => l.luca_command && l.luca_raw_index == null);
  if (!needsRecovery) return;

  // Group existing translated lines by file
  const existingByFile = new Map<string, Line[]>();
  for (const l of state.lines) {
    if (!existingByFile.has(l.file)) existingByFile.set(l.file, []);
    existingByFile.get(l.file)!.push(l);
  }

  let recovered = 0;
  for (const [fileName, fileLines] of existingByFile.entries()) {
    const rawLinesArr = state.lucaRawFiles[fileName];
    if (!rawLinesArr || !rawLinesArr.length) continue;

    // Re-parse so we get lines with correct luca_raw_index values
    const freshLines = parseLucaTxt(rawLinesArr.join('\n'), fileName, 0, state.lucaProfile || DEFAULT_LUCA_PROFILE);
    if (!freshLines.length) continue;

    // Match MESSAGE/MESSAGE_WAIT lines positionally (nth in file = nth fresh parse)
    const existingMsg = fileLines.filter(l => l.luca_command === 'MESSAGE' || l.luca_command === 'MESSAGE_WAIT');
    const freshMsg    = freshLines.filter(l => l.luca_command === 'MESSAGE' || l.luca_command === 'MESSAGE_WAIT');
    for (let i = 0; i < existingMsg.length && i < freshMsg.length; i++) {
      const ex = existingMsg[i], fr = freshMsg[i];
      if (ex.luca_raw_index != null) continue;
      ex.luca_raw_index   = fr.luca_raw_index;
      ex.luca_raw         = fr.luca_raw;
      ex.luca_profile     = fr.luca_profile;
      ex.luca_heavy_quotes = fr.luca_heavy_quotes;
      ex.luca_text_prefix = fr.luca_text_prefix;
      ex.luca_prefix_b64  = fr.luca_prefix_b64;
      ex.luca_pre         = fr.luca_pre;
      recovered++;
    }

    // Match SELECT lines positionally
    const existingSelect = fileLines.filter(l => l.luca_command === 'SELECT');
    const freshSelect    = freshLines.filter(l => l.luca_command === 'SELECT');
    for (let i = 0; i < existingSelect.length && i < freshSelect.length; i++) {
      const ex = existingSelect[i], fr = freshSelect[i];
      if (ex.luca_raw_index != null) continue;
      ex.luca_raw_index = fr.luca_raw_index;
      ex.luca_raw       = fr.luca_raw;
      ex.luca_profile   = fr.luca_profile;
      ex.luca_pre       = fr.luca_pre;
      recovered++;
    }
  }

  if (recovered > 0) {
    console.log(`[CSTL] Migrated luca raw fields for ${recovered} lines — queuing save.`);
    // Persist the repaired data so future opens are clean
    queueAutoSave();
  }
}

// ─── Lazy render helpers (breaks render.js ↔ project.js circular dep) ─────────
async function refreshAll() { return (await import('./render')).refreshAll(); }
async function flashHintAsync(msg: string, keepAlive?: boolean) { return (await import('./render')).flashHint(msg, keepAlive); }
function flashHint(msg: string, keepAlive?: boolean) { import('./render').then(m => m.flashHint(msg, keepAlive)); }
async function updateButtonStates() { return (await import('./render')).updateButtonStates(); }
async function updateStatusBar() { return (await import('./render')).updateStatusBar(); }
async function applyHtlMode() { return (await import('./htl-mode')).applyHtlMode(); }

// ─── Modal helpers ────────────────────────────────────────────────────────────
export function openModal(el: HTMLElement): void { el.classList.add('open'); }
export function closeModal(el: HTMLElement): void {
  el.classList.add('closing');
  setTimeout(() => {
    el.classList.remove('open');
    el.classList.remove('closing');
  }, 220); // matches --dur-2
}

// ─── Dashboard default settings ───────────────────────────────────────────────
export const DS_STORAGE_KEY = 'cstl_default_settings';

// ─── Color palettes — all ink/manuscript-grounded (no neon SaaS) ───────────────
const PALETTES: Record<string, Record<string, string>> = {
  indigo: {
    '--primary':       '#c84e18',
    '--primary-hover': '#a93f12',
    '--primary-soft':  'rgba(200,78,24,0.14)',
    '--accent':        '#b9975b',
    '--shadow-glow':   '0 0 24px -6px rgba(200,78,24,0.28)',
  },
  ocean: {
    '--primary':       '#1e6b8a',
    '--primary-hover': '#16546e',
    '--primary-soft':  'rgba(30,107,138,0.16)',
    '--accent':        '#8fb4c0',
    '--shadow-glow':   '0 0 24px -6px rgba(30,107,138,0.30)',
  },
  forest: {
    '--primary':       '#3d6b4a',
    '--primary-hover': '#2f5239',
    '--primary-soft':  'rgba(61,107,74,0.16)',
    '--accent':        '#9ab89e',
    '--shadow-glow':   '0 0 24px -6px rgba(61,107,74,0.30)',
  },
  sunset: {
    '--primary':       '#8a4a1a',
    '--primary-hover': '#6e3b15',
    '--primary-soft':  'rgba(138,74,26,0.16)',
    '--accent':        '#c9a47a',
    '--shadow-glow':   '0 0 24px -6px rgba(138,74,26,0.28)',
  },
  rose: {
    '--primary':       '#8b2d3a',
    '--primary-hover': '#6e2430',
    '--primary-soft':  'rgba(139,45,58,0.16)',
    '--accent':        '#c49aa0',
    '--shadow-glow':   '0 0 24px -6px rgba(139,45,58,0.28)',
  },
};

export function applyPalette(name: string): void {
  // Resolve the key first so an unknown name falls back fully to indigo (icon included).
  const key = PALETTES[name] ? name : 'indigo';
  const vars = PALETTES[key];
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(vars)) {
    root.style.setProperty(prop, val);
  }
  const iconUrl = `./icon-${key}.svg`;
  const logoImg = document.querySelector('.hero-logo-img') as HTMLImageElement | null;
  if (logoImg) logoImg.src = iconUrl;
  const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (favicon) favicon.href = iconUrl;
}

export function getDefaultSettings(): Record<string, any> {
  try {
    const saved = localStorage.getItem(DS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.translationMode) parsed.translationMode = 'ai';
      return parsed;
    }
  } catch (e) {}
  return {
    sourceLang: 'Japanese',
    targetLang: 'Indonesian',
    translationMode: 'ai',
    aiFormat: DEFAULT_AI_TRANSLATION_FORMAT,
    contextLines: 10,
    contextType: 'raw',
    selectionBatch: DEFAULT_SELECTION_BATCH_SIZE,
    glossaryBatch: DEFAULT_GLOSSARY_BATCH_SIZE,
    aiCheckBatch: DEFAULT_AI_CHECK_BATCH_SIZE,
    parallelBatchSize: 1,
    subagentWorkers: 3,
    regexFilter: '',
    palette: 'indigo',
    enableLogging: false,
    disableEmptyLineValidation: false,
    showFurigana: false,
    furiganaType: 'hiragana',
    fontSize: 14,
    enableDictionary: false,
    dictionaryEngine: 'llm',
    dictionaryPrompt: 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.',
    checkKanaResidue: false,
    checkSimilarity: false,
    similarityThreshold: 70,
    checkLengthRatio: false,
    lengthRatioThreshold: 2.5,
    checkLinebreak: true,
    checkLanguage: true,
    checkPunctuation: true,
    checkUntransName: false,
    enableUncertainMarking: false,
    safeTagsForChatgpt: false,
    agentMaxTurns: 10,
    enableBackgroundChaining: false,
    epubTags: 'p',
    showEpubImages: true,
    selectionPrevShortcut: DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
    selectionNextShortcut: DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
  };
}

export function openDashboardSettings(): void {
  const d = getDefaultSettings();
  if (ui.dsSourceLang) (ui.dsSourceLang as HTMLSelectElement).value = d.sourceLang || 'Japanese';
  if (ui.dsTargetLang) (ui.dsTargetLang as HTMLSelectElement).value = d.targetLang || 'Indonesian';
  if (ui.dsTranslationMode) (ui.dsTranslationMode as HTMLSelectElement).value = d.translationMode || 'ai';
  if (ui.dsAiFormat) (ui.dsAiFormat as HTMLSelectElement).value = d.aiFormat || DEFAULT_AI_TRANSLATION_FORMAT;
  if (ui.dsContextLines) (ui.dsContextLines as HTMLInputElement).value = String(d.contextLines !== undefined ? d.contextLines : 10);
  if (ui.dsContextType) (ui.dsContextType as HTMLSelectElement).value = d.contextType || 'raw';
  if (ui.dsSelectionBatch) (ui.dsSelectionBatch as HTMLInputElement).value = String(d.selectionBatch || DEFAULT_SELECTION_BATCH_SIZE);
  if (ui.dsGlossaryBatch) (ui.dsGlossaryBatch as HTMLInputElement).value = String(d.glossaryBatch || DEFAULT_GLOSSARY_BATCH_SIZE);
  if (ui.dsAiCheckBatch) (ui.dsAiCheckBatch as HTMLInputElement).value = String(d.aiCheckBatch || DEFAULT_AI_CHECK_BATCH_SIZE);
  if (ui.dsParallelBatch) (ui.dsParallelBatch as HTMLInputElement).value = String(d.parallelBatchSize || 1);
  if (ui.dsSubagentWorkers) (ui.dsSubagentWorkers as HTMLInputElement).value = String(d.subagentWorkers || 3);
  if (ui.dsShowFurigana) (ui.dsShowFurigana as HTMLInputElement).checked = !!d.showFurigana;
  if (ui.dsFuriganaType) (ui.dsFuriganaType as HTMLSelectElement).value = d.furiganaType || 'hiragana';
  if (ui.dsFontSize) (ui.dsFontSize as HTMLInputElement).value = String(d.fontSize || 14);
  if (ui.dsEnableDictionary) (ui.dsEnableDictionary as HTMLInputElement).checked = !!d.enableDictionary;
  if (ui.dsDictionaryEngine) (ui.dsDictionaryEngine as HTMLSelectElement).value = d.dictionaryEngine || 'llm';
  if (ui.dsDictionaryPrompt) (ui.dsDictionaryPrompt as HTMLTextAreaElement).value = d.dictionaryPrompt || 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.';
  if (ui.dsRegexFilter) (ui.dsRegexFilter as HTMLInputElement).value = d.regexFilter || '';
  if (ui.dsDisableEmptyLineValidation) (ui.dsDisableEmptyLineValidation as HTMLInputElement).checked = !!d.disableEmptyLineValidation;
  if (ui.dsCheckKanaResidue) (ui.dsCheckKanaResidue as HTMLInputElement).checked = !!d.checkKanaResidue;
  if (ui.dsCheckSimilarity) (ui.dsCheckSimilarity as HTMLInputElement).checked = !!d.checkSimilarity;
  if (ui.dsSimilarityThreshold) (ui.dsSimilarityThreshold as HTMLInputElement).value = String(d.similarityThreshold !== undefined ? d.similarityThreshold : 70);
  if (ui.dsCheckLengthRatio) (ui.dsCheckLengthRatio as HTMLInputElement).checked = !!d.checkLengthRatio;
  if (ui.dsLengthRatioThreshold) (ui.dsLengthRatioThreshold as HTMLInputElement).value = String(d.lengthRatioThreshold !== undefined ? d.lengthRatioThreshold : 2.5);
  if (ui.dsCheckLinebreak) (ui.dsCheckLinebreak as HTMLInputElement).checked = d.checkLinebreak !== undefined ? !!d.checkLinebreak : true;
  if (ui.dsCheckLanguage) (ui.dsCheckLanguage as HTMLInputElement).checked = d.checkLanguage !== undefined ? !!d.checkLanguage : true;
  if (ui.dsCheckPunctuation) (ui.dsCheckPunctuation as HTMLInputElement).checked = d.checkPunctuation !== undefined ? !!d.checkPunctuation : true;
  if (ui.dsCheckUntransName) (ui.dsCheckUntransName as HTMLInputElement).checked = !!d.checkUntransName;
  if (ui.dsEnableBackgroundChaining) (ui.dsEnableBackgroundChaining as HTMLInputElement).checked = !!d.enableBackgroundChaining;
  if (ui.dsEnableUncertainMarking) (ui.dsEnableUncertainMarking as HTMLInputElement).checked = !!d.enableUncertainMarking;
  if (ui.dsSafeTagsForChatgpt) (ui.dsSafeTagsForChatgpt as HTMLInputElement).checked = !!d.safeTagsForChatgpt;
  if (ui.dsAgentMaxTurns) (ui.dsAgentMaxTurns as HTMLInputElement).value = String(d.agentMaxTurns || 10);
  if (ui.dsEpubTags) (ui.dsEpubTags as HTMLInputElement).value = d.epubTags || 'p';
  const dsShowEpub = (document.getElementById('dsShowEpubImages') || ui.dsShowEpubImages) as HTMLInputElement | null;
  if (dsShowEpub) dsShowEpub.checked = d.showEpubImages !== false;
  if (ui.dsSelectionPrevShortcut) (ui.dsSelectionPrevShortcut as HTMLInputElement).value = d.selectionPrevShortcut || DEFAULT_SELECTION_BATCH_PREV_SHORTCUT;
  if (ui.dsSelectionNextShortcut) (ui.dsSelectionNextShortcut as HTMLInputElement).value = d.selectionNextShortcut || DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT;
  if (ui.dsEnableLogging) (ui.dsEnableLogging as HTMLInputElement).checked = !!d.enableLogging;
  if (ui.paletteSelect) (ui.paletteSelect as HTMLSelectElement).value = d.palette || 'indigo';

  // Sync conditional wrap displays
  if (ui.dsSimilarityThresholdWrap) {
    (ui.dsSimilarityThresholdWrap as HTMLElement).style.display = (ui.dsCheckSimilarity as HTMLInputElement)?.checked ? 'flex' : 'none';
  }
  if (ui.dsLengthRatioWrap) {
    (ui.dsLengthRatioWrap as HTMLElement).style.display = (ui.dsCheckLengthRatio as HTMLInputElement)?.checked ? 'flex' : 'none';
  }

  (ui.dashboardSettingsModal as HTMLElement).classList.add('open');
}

export function saveDashboardSettings(): void {
  const d = getDefaultSettings();
  if (ui.dsSourceLang) d.sourceLang = (ui.dsSourceLang as HTMLSelectElement).value;
  if (ui.dsTargetLang) d.targetLang = (ui.dsTargetLang as HTMLSelectElement).value;
  if (ui.dsTranslationMode) d.translationMode = (ui.dsTranslationMode as HTMLSelectElement)?.value === 'htl' ? 'htl' : 'ai';
  if (ui.dsAiFormat) d.aiFormat = (ui.dsAiFormat as HTMLSelectElement).value;
  if (ui.dsContextLines) d.contextLines = parseInt((ui.dsContextLines as HTMLInputElement).value) || 10;
  if (ui.dsContextType) d.contextType = (ui.dsContextType as HTMLSelectElement).value || 'raw';
  if (ui.dsSelectionBatch) d.selectionBatch = parseInt((ui.dsSelectionBatch as HTMLInputElement).value) || DEFAULT_SELECTION_BATCH_SIZE;
  if (ui.dsGlossaryBatch) d.glossaryBatch = parseInt((ui.dsGlossaryBatch as HTMLInputElement).value) || DEFAULT_GLOSSARY_BATCH_SIZE;
  if (ui.dsAiCheckBatch) d.aiCheckBatch = parseInt((ui.dsAiCheckBatch as HTMLInputElement).value) || DEFAULT_AI_CHECK_BATCH_SIZE;
  if (ui.dsParallelBatch) d.parallelBatchSize = Math.max(1, Math.min(10, parseInt((ui.dsParallelBatch as HTMLInputElement).value) || 1));
  if (ui.dsSubagentWorkers) d.subagentWorkers = Math.max(1, Math.min(10, parseInt((ui.dsSubagentWorkers as HTMLInputElement).value) || 3));
  if (ui.dsShowFurigana) d.showFurigana = !!(ui.dsShowFurigana as HTMLInputElement).checked;
  if (ui.dsFuriganaType) d.furiganaType = (ui.dsFuriganaType as HTMLSelectElement).value || 'hiragana';
  if (ui.dsFontSize) d.fontSize = parseInt((ui.dsFontSize as HTMLInputElement).value) || 14;
  if (ui.dsEnableDictionary) d.enableDictionary = !!(ui.dsEnableDictionary as HTMLInputElement).checked;
  if (ui.dsDictionaryEngine) d.dictionaryEngine = (ui.dsDictionaryEngine as HTMLSelectElement).value || 'llm';
  if (ui.dsDictionaryPrompt) d.dictionaryPrompt = (ui.dsDictionaryPrompt as HTMLTextAreaElement).value || '';
  if (ui.dsRegexFilter) d.regexFilter = (ui.dsRegexFilter as HTMLInputElement).value || '';
  if (ui.dsDisableEmptyLineValidation) d.disableEmptyLineValidation = !!(ui.dsDisableEmptyLineValidation as HTMLInputElement).checked;
  if (ui.dsCheckKanaResidue) d.checkKanaResidue = !!(ui.dsCheckKanaResidue as HTMLInputElement).checked;
  if (ui.dsCheckSimilarity) d.checkSimilarity = !!(ui.dsCheckSimilarity as HTMLInputElement).checked;
  if (ui.dsSimilarityThreshold) d.similarityThreshold = parseInt((ui.dsSimilarityThreshold as HTMLInputElement).value) || 70;
  if (ui.dsCheckLengthRatio) d.checkLengthRatio = !!(ui.dsCheckLengthRatio as HTMLInputElement).checked;
  if (ui.dsLengthRatioThreshold) d.lengthRatioThreshold = parseFloat((ui.dsLengthRatioThreshold as HTMLInputElement).value) || 2.5;
  if (ui.dsCheckLinebreak) d.checkLinebreak = !!(ui.dsCheckLinebreak as HTMLInputElement).checked;
  if (ui.dsCheckLanguage) d.checkLanguage = !!(ui.dsCheckLanguage as HTMLInputElement).checked;
  if (ui.dsCheckPunctuation) d.checkPunctuation = !!(ui.dsCheckPunctuation as HTMLInputElement).checked;
  if (ui.dsCheckUntransName) d.checkUntransName = !!(ui.dsCheckUntransName as HTMLInputElement).checked;
  if (ui.dsEnableBackgroundChaining) d.enableBackgroundChaining = !!(ui.dsEnableBackgroundChaining as HTMLInputElement).checked;
  if (ui.dsEnableUncertainMarking) d.enableUncertainMarking = !!(ui.dsEnableUncertainMarking as HTMLInputElement).checked;
  if (ui.dsSafeTagsForChatgpt) d.safeTagsForChatgpt = !!(ui.dsSafeTagsForChatgpt as HTMLInputElement).checked;
  if (ui.dsAgentMaxTurns) d.agentMaxTurns = parseInt((ui.dsAgentMaxTurns as HTMLInputElement).value) || 10;
  if (ui.dsEpubTags) d.epubTags = (ui.dsEpubTags as HTMLInputElement).value || 'p';
  const dsShowEpub = (document.getElementById('dsShowEpubImages') || ui.dsShowEpubImages) as HTMLInputElement | null;
  if (dsShowEpub) d.showEpubImages = dsShowEpub.checked;
  if (ui.dsSelectionPrevShortcut) d.selectionPrevShortcut = (ui.dsSelectionPrevShortcut as HTMLInputElement).value || DEFAULT_SELECTION_BATCH_PREV_SHORTCUT;
  if (ui.dsSelectionNextShortcut) d.selectionNextShortcut = (ui.dsSelectionNextShortcut as HTMLInputElement).value || DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT;
  if (ui.dsEnableLogging) d.enableLogging = !!(ui.dsEnableLogging as HTMLInputElement).checked;
  if (ui.paletteSelect) d.palette = (ui.paletteSelect as HTMLSelectElement)?.value || 'indigo';

  localStorage.setItem(DS_STORAGE_KEY, JSON.stringify(d));
  applyPalette(d.palette);
  state.projectLoggingEnabled = !!d.enableLogging;
  applyProjectLoggingVisibility();
  (ui.dashboardSettingsModal as HTMLElement).classList.remove('open');
}

export function openDashboardPrompts(): void {
  const d = getDefaultSettings();
  (ui.dpPromptInput as HTMLTextAreaElement).value = d.promptHeader !== undefined ? d.promptHeader : getDefaultPromptHeaderForFormat(d.aiFormat);
  (ui.dpGlossaryPromptInput as HTMLTextAreaElement).value = d.glossaryPrompt !== undefined ? d.glossaryPrompt : DEFAULT_GLOSSARY_PROMPT;
  (ui.dpAiCheckPromptInput as HTMLTextAreaElement).value = d.aiCheckPrompt !== undefined ? d.aiCheckPrompt : DEFAULT_AI_CHECK_PROMPT;
  (ui.dpAgentPromptInput as HTMLTextAreaElement).value = d.agentPrompt !== undefined ? d.agentPrompt : DEFAULT_AGENT_PROMPT;
  if (ui.dpSummaryPromptInput) {
    (ui.dpSummaryPromptInput as HTMLTextAreaElement).value = d.summaryPrompt !== undefined ? d.summaryPrompt : DEFAULT_SUMMARY_PROMPT;
  }
  (ui.dashboardPromptsModal as HTMLElement).classList.add('open');
}

export function saveDashboardPrompts(): void {
  const d = getDefaultSettings();
  d.promptHeader = (ui.dpPromptInput as HTMLTextAreaElement).value;
  d.glossaryPrompt = (ui.dpGlossaryPromptInput as HTMLTextAreaElement).value;
  d.aiCheckPrompt = (ui.dpAiCheckPromptInput as HTMLTextAreaElement).value;
  d.agentPrompt = (ui.dpAgentPromptInput as HTMLTextAreaElement).value;
  if (ui.dpSummaryPromptInput) {
    d.summaryPrompt = (ui.dpSummaryPromptInput as HTMLTextAreaElement).value;
  }
  localStorage.setItem(DS_STORAGE_KEY, JSON.stringify(d));
  (ui.dashboardPromptsModal as HTMLElement).classList.remove('open');
}

export function resetDashboardPrompts(): void {
  const d = getDefaultSettings();
  (ui.dpPromptInput as HTMLTextAreaElement).value = getDefaultPromptHeaderForFormat(d.aiFormat);
  (ui.dpGlossaryPromptInput as HTMLTextAreaElement).value = DEFAULT_GLOSSARY_PROMPT;
  (ui.dpAiCheckPromptInput as HTMLTextAreaElement).value = DEFAULT_AI_CHECK_PROMPT;
  (ui.dpAgentPromptInput as HTMLTextAreaElement).value = DEFAULT_AGENT_PROMPT;
  if (ui.dpSummaryPromptInput) {
    (ui.dpSummaryPromptInput as HTMLTextAreaElement).value = DEFAULT_SUMMARY_PROMPT;
  }
}

export function resetDashboardSettings(): void {
  localStorage.removeItem(DS_STORAGE_KEY);
  openDashboardSettings();
  applyPalette('indigo');
  state.projectLoggingEnabled = false;
  applyProjectLoggingVisibility();
}

// ─── Dashboard project list ───────────────────────────────────────────────────
export function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatDashboardDate(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const month = months[d.getMonth()] || '';
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} · ${hours}.${minutes}`;
}

export async function loadDashboardProjects(): Promise<void> {
  state.dashboardProjects = [];
  (ui.projectList as HTMLElement).textContent = '';
  try {
    const root = await getOpfsRoot();
    const projects: any[] = [];
    for await (const [name, handle] of (root as any).entries()) {
      if (name.endsWith(PROJECT_EXT) && handle.kind === 'file') {
        const file = await handle.getFile();
        let data: any = null;
        try {
          data = JSON.parse(await file.text());
          if (!data || typeof data !== 'object') data = null;
        } catch (_) { data = null; }
        if (!data) {
          // Keep unreadable files visible: silently skipping them makes a bad
          // read look like the project vanished. The file is still on disk
          // and can be replaced by restoring a backup.
          projects.push({
            id: name,
            name: name.replace(PROJECT_EXT, ''),
            updatedAt: file.lastModified,
            fileCount: 0,
            lineCount: 0,
            totalLines: 0,
            translatedLines: 0,
            projectType: undefined,
            translationMode: undefined,
            corrupt: true,
          });
          continue;
        }

        const lines = Array.isArray(data.lines) ? data.lines : [];
        const totalLines = lines.length;
        let translatedLines = 0;
        for (const l of lines) {
          if (isIlustrasiLine(l) || (l && l.is_translated && (data.disable_empty_line_validation || !!String(l.trans_message || '').trim()))) {
            translatedLines++;
          }
        }
        const fileCount = Array.isArray(data.imported_files) && data.imported_files.length > 0
          ? data.imported_files.length
          : (Array.isArray(data.file_order) ? data.file_order.length : 0);

        projects.push({
          id: name,
          name: data.projectName || name.replace(PROJECT_EXT, ''),
          updatedAt: data.updatedAt || file.lastModified,
          fileCount,
          lineCount: totalLines,
          totalLines,
          translatedLines,
          projectType: data.projectType,
          translationMode: data.translationMode,
          customParserId: data.custom_parser_id || null,
        });
      }
    }
    projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.dashboardProjects = projects;
    renderDashboardProjects();
  } catch (err) {
    renderDashboardMessage('Gagal mengakses storage browser.', true);
  }
}

export function renderDashboardMessage(message: string, isError = false): void {
  (ui.projectList as HTMLElement).textContent = '';
  const p = document.createElement('p');
  p.className = 'hint';
  p.style.gridColumn = '1/-1';
  p.style.padding = '24px 0';
  if (isError) p.style.color = 'var(--danger)';
  p.textContent = message;
  (ui.projectList as HTMLElement).appendChild(p);
}

export function createProjectButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderDashboardProjects(): void {
  const badgeEl = document.getElementById('projectCountBadge') || ui.projectCountBadge;
  if (badgeEl) {
    badgeEl.textContent = String(state.dashboardProjects.length);
  }

  const query = ((ui.projectFilterInput as HTMLInputElement)?.value || '').trim().toLowerCase();
  let projects: any[] = query
    ? state.dashboardProjects.filter((p: any) => p.name.toLowerCase().includes(query))
    : [...state.dashboardProjects];

  const sortSelect = document.getElementById('projectSortSelect') as HTMLSelectElement | null;
  const sortOption = sortSelect ? sortSelect.value : 'newest';

  if (sortOption === 'newest') {
    projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } else if (sortOption === 'oldest') {
    projects.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  } else if (sortOption === 'name_asc') {
    projects.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  } else if (sortOption === 'name_desc') {
    projects.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
  } else if (sortOption === 'progress_desc') {
    projects.sort((a, b) => {
      const pctA = a.totalLines ? a.translatedLines / a.totalLines : 0;
      const pctB = b.totalLines ? b.translatedLines / b.totalLines : 0;
      return pctB - pctA;
    });
  } else if (sortOption === 'progress_asc') {
    projects.sort((a, b) => {
      const pctA = a.totalLines ? a.translatedLines / a.totalLines : 0;
      const pctB = b.totalLines ? b.translatedLines / b.totalLines : 0;
      return pctA - pctB;
    });
  }

  (ui.projectList as HTMLElement).textContent = '';
  if (state.dashboardProjects.length === 0) {
    renderDashboardMessage('Belum ada proyek tersimpan. Klik "+ Buat Project" atau "Pulihkan Project" untuk memulai.');
    return;
  }
  if (projects.length === 0) {
    renderDashboardMessage('Tidak ada proyek yang cocok dengan filter pencarian.');
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';

    if (p.corrupt) {
      card.classList.add('project-card-corrupt');
      card.innerHTML = `
        <div class="project-card-header">
          <h3 title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
          <span class="badge" style="background:var(--danger)">KORUP</span>
        </div>
        <div class="corrupt-box">
          File proyek tidak dapat dibaca. Coba perbaiki atau pulihkan dari file backup.
        </div>
        <div class="project-meta-list">
          <div class="project-meta-row">
            ${icon('clock', 15, 'meta-icon')}
            <span>${formatDashboardDate(p.updatedAt)}</span>
          </div>
          <div class="project-meta-row">
            ${icon('file', 15, 'meta-icon')}
            <span>ID: ${escapeHtml(p.id)}</span>
          </div>
        </div>
        <div class="project-actions-container">
          <button type="button" class="btn btn-primary btn-open-project btn-repair">
            ${icon('wrench', 16)} <span>Coba Perbaiki</span>
          </button>
          <div class="project-actions-row">
            <button type="button" class="btn btn-outline card-btn-action btn-restore-card">
              ${icon('restore', 14)} <span>Pulihkan</span>
            </button>
            <button type="button" class="btn btn-danger-outline card-btn-action btn-delete">
              ${icon('trash', 14)} <span>Hapus</span>
            </button>
          </div>
        </div>
      `;

      card.querySelector('.btn-repair')?.addEventListener('click', async function(this: HTMLButtonElement) {
        this.disabled = true;
        this.textContent = 'Memperbaiki...';
        try {
          const result = await tryRepairProject(p.id);
          alert(result.message);
          if (result.repaired) {
            loadDashboardProjects();
          } else {
            this.disabled = false;
            this.innerHTML = `${icon('wrench', 16)} <span>Coba Perbaiki</span>`;
          }
        } catch (e: any) {
          alert('Gagal memperbaiki: ' + (e?.message || e));
          this.disabled = false;
          this.innerHTML = `${icon('wrench', 16)} <span>Coba Perbaiki</span>`;
        }
      });

      card.querySelector('.btn-restore-card')?.addEventListener('click', () => {
        (ui.restoreProjectInput as HTMLInputElement | undefined)?.click();
      });

      card.querySelector('.btn-delete')?.addEventListener('click', async function(this: HTMLButtonElement) {
        if (!confirm(`Hapus permanen proyek "${p.name}"?`)) return;
        this.disabled = true;
        this.textContent = 'Menghapus...';
        try {
          await deleteProject(p.id, {});
        } finally {
          this.disabled = false;
          this.innerHTML = `${icon('trash', 14)} <span>Hapus</span>`;
        }
      });

      frag.appendChild(card);
      continue;
    }

    const total = p.totalLines || 0;
    const trans = p.translatedLines || 0;
    const pct = total > 0 ? Math.floor((trans / total) * 100) : 0;

    let badgeClass = 'badge-json';
    let badgeText = 'JSON VNTP';
    let badgeTitle = '';
    if (p.projectType === 'epub') {
      badgeClass = 'badge-epub';
      badgeText = 'EPUB';
    } else if (p.projectType === 'luca') {
      badgeClass = 'badge-luca';
      badgeText = 'TXT LUCA';
    } else if (p.projectType === 'custom') {
      const parser = getCustomParser(p.customParserId);
      badgeClass = 'badge-custom';
      if (parser) {
        const parserName = parser.name.trim();
        badgeText = 'CUSTOM • ' + (parserName.length > 18 ? parserName.slice(0, 17) + '…' : parserName);
        badgeTitle = 'Parser Custom: ' + parserName;
      } else {
        badgeText = 'PARSER CUSTOM';
        badgeTitle = p.customParserId ? 'Parser custom sudah tidak ada — ekspor jatuh ke JSON' : '';
      }
    }
    if (p.translationMode === 'htl') {
      badgeText += ' • HTL';
    }

    card.innerHTML = `
      <div class="project-card-header">
        <h3 title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
        <span class="badge ${badgeClass}"${badgeTitle ? ` title="${escapeHtml(badgeTitle)}"` : ''}>${escapeHtml(badgeText)}</span>
      </div>

      <div class="project-progress-wrap">
        <div class="project-progress-labels">
          <span class="project-progress-lines">${trans}/${total} baris</span>
          <span class="project-progress-pct">${pct}%</span>
        </div>
        <div class="project-progress-track">
          <div class="project-progress-fill" style="width: ${pct}%"></div>
        </div>
      </div>

      <div class="project-meta-list">
        <div class="project-meta-row">
          ${icon('clock', 15, 'meta-icon')}
          <span>${formatDashboardDate(p.updatedAt)}</span>
        </div>
        <div class="project-meta-row">
          ${icon('file', 15, 'meta-icon')}
          <span>${p.fileCount} file</span>
        </div>
      </div>

      <div class="project-actions-container">
        <button type="button" class="btn btn-primary btn-open-project btn-open">
          ${icon('arrow-right', 17)} <span>Buka Project</span>
        </button>
        <div class="project-actions-row">
          <button type="button" class="btn btn-outline card-btn-action btn-rename" title="Ubah Nama">
            ${icon('pencil', 14)} <span>Ubah</span>
          </button>
          <button type="button" class="btn btn-outline card-btn-action btn-backup" title="Backup Project">
            ${icon('download', 14)} <span>Backup</span>
          </button>
          <button type="button" class="btn btn-danger-outline card-btn-action btn-delete" title="Hapus Project">
            ${icon('trash', 14)} <span>Hapus</span>
          </button>
        </div>
      </div>
    `;

    card.querySelector('.btn-open')?.addEventListener('click', async function(this: HTMLButtonElement) {
      this.disabled = true;
      this.textContent = 'Membuka...';
      try {
        await openProject(p.id, await fetchProjectData(p.id));
      } finally {
        this.disabled = false;
        this.innerHTML = `${icon('arrow-right', 17)} <span>Buka Project</span>`;
      }
    });

    card.querySelector('.btn-rename')?.addEventListener('click', async function(this: HTMLButtonElement) {
      this.disabled = true;
      try {
        await renameDashboardProject(p.id, p.name, await fetchProjectData(p.id));
      } finally {
        this.disabled = false;
      }
    });

    card.querySelector('.btn-backup')?.addEventListener('click', async function(this: HTMLButtonElement) {
      this.disabled = true;
      try {
        await backupDashboardProject(p.name, await fetchProjectData(p.id), p.id);
      } finally {
        this.disabled = false;
      }
    });

    card.querySelector('.btn-delete')?.addEventListener('click', async function(this: HTMLButtonElement) {
      if (!confirm(`Hapus permanen proyek "${p.name}"?`)) return;
      this.disabled = true;
      this.textContent = 'Menghapus...';
      try {
        await deleteProject(p.id, await fetchProjectData(p.id));
      } finally {
        this.disabled = false;
        this.innerHTML = `${icon('trash', 14)} <span>Hapus</span>`;
      }
    });

    frag.appendChild(card);
  }
  (ui.projectList as HTMLElement).appendChild(frag);
}

// ─── Project CRUD ─────────────────────────────────────────────────────────────
export async function createNewProject(): Promise<void> {
  const name = prompt('Masukkan nama proyek baru:');
  if (!name || !name.trim()) return;
  const id = 'proj_' + Date.now() + PROJECT_EXT;
  const d = getDefaultSettings();
  const initialData: Record<string, any> = {
    version: APP_VERSION, projectName: name.trim(), projectType: 'json',
    translationMode: d.translationMode || 'ai',
    jsonRefLang: '', epubTags: d.epubTags || 'p', epubSourceId: null, lucaExportLang: 'en',
    luca_profile: DEFAULT_LUCA_PROFILE, luca_mc_display_name: DEFAULT_LUCA_MC_DISPLAY_NAME,
    custom_parser_id: null,
    lucaRawFiles: {}, lucaRawBuffers: {}, updatedAt: Date.now(),
    source_lang: d.sourceLang || 'Japanese',
    target_lang: d.targetLang || 'Indonesian',
    regex_filter: d.regexFilter || '',
    disable_empty_line_validation: !!d.disableEmptyLineValidation,
    show_furigana: !!d.showFurigana,
    furigana_type: d.furiganaType || 'hiragana',
    font_size: d.fontSize || 14,
    enable_dictionary: !!d.enableDictionary,
    dictionary_engine: d.dictionaryEngine || 'llm',
    dictionary_prompt: d.dictionaryPrompt !== undefined ? d.dictionaryPrompt : 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.',
    check_kana_residue: !!d.checkKanaResidue,
    check_similarity: !!d.checkSimilarity,
    similarity_threshold: (typeof d.similarityThreshold === 'number' ? d.similarityThreshold : 70) / 100,
    check_length_ratio: !!d.checkLengthRatio,
    length_ratio_threshold: typeof d.lengthRatioThreshold === 'number' ? d.lengthRatioThreshold : 2.5,
    check_linebreak: d.checkLinebreak !== undefined ? !!d.checkLinebreak : true,
    check_language: d.checkLanguage !== undefined ? !!d.checkLanguage : true,
    check_punctuation: d.checkPunctuation !== undefined ? !!d.checkPunctuation : true,
    check_untrans_name: !!d.checkUntransName,
    enable_uncertain_marking: !!d.enableUncertainMarking,
    safe_tags_for_chatgpt: !!d.safeTagsForChatgpt,
    agent_max_turns: d.agentMaxTurns || 10,
    enableBackgroundChaining: !!d.enableBackgroundChaining,
    currentBackground: '',
    summary_prompt: d.summaryPrompt !== undefined ? d.summaryPrompt : '',
    show_epub_images: d.showEpubImages !== undefined ? !!d.showEpubImages : true,
    imported_files: [], file_order: [], lines: [],
    prompt_header: d.promptHeader !== undefined ? d.promptHeader : getDefaultPromptHeaderForFormat(d.aiFormat),
    ai_translation_format: d.aiFormat || DEFAULT_AI_TRANSLATION_FORMAT,
    glossary_prompt: d.glossaryPrompt !== undefined ? d.glossaryPrompt : DEFAULT_GLOSSARY_PROMPT,
    ai_check_prompt: d.aiCheckPrompt !== undefined ? d.aiCheckPrompt : DEFAULT_AI_CHECK_PROMPT,
    agent_prompt: d.agentPrompt !== undefined ? d.agentPrompt : DEFAULT_AGENT_PROMPT,
    glossary_text: '',
    context_lines: d.contextLines !== undefined ? d.contextLines : 10,
    context_type: d.contextType || 'raw',
    selection_batch_size: d.selectionBatch || DEFAULT_SELECTION_BATCH_SIZE,
    glossary_batch_size: d.glossaryBatch || DEFAULT_GLOSSARY_BATCH_SIZE,
    ai_check_batch_size: d.aiCheckBatch || DEFAULT_AI_CHECK_BATCH_SIZE,
    parallel_batch_size: d.parallelBatchSize || 1,
    subagent_workers: d.subagentWorkers || 3,
    selection_batch_prev_shortcut: d.selectionPrevShortcut || DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
    selection_batch_next_shortcut: d.selectionNextShortcut || DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
    enable_logging: !!d.enableLogging,
  };
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(id, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(initialData));
    await writable.close();
    await openProject(id, initialData);
  } catch (e: any) {
    alert('Gagal membuat proyek: ' + e.message);
  }
}

export async function fetchProjectData(id: string): Promise<any> {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(id);
  const file = await fileHandle.getFile();
  const text = await file.text();
  return JSON.parse(text);
}

export async function deleteProject(id: string, data: any): Promise<void> {
  if (!confirm('Hapus proyek ini secara permanen?')) return;
  try {
    const root = await getOpfsRoot();
    if (data.epubSourceId) {
      try { await root.removeEntry(data.epubSourceId); } catch (_) {}
    }
    try {
      const lucaId = id.replace(PROJECT_EXT, '_luca.json');
      await root.removeEntry(lucaId);
    } catch (_) {}
    try {
      const customId = id.replace(PROJECT_EXT, '_custom_src.json');
      await root.removeEntry(customId);
    } catch (_) {}
    try {
      await root.removeEntry(id + '.corrupt-bak');
    } catch (_) {}
    await root.removeEntry(id);
    loadDashboardProjects();
  } catch (e: any) {
    alert('Gagal menghapus: ' + e.message);
  }
}

// ─── Corrupt project repair ───────────────────────────────────────────────────
/**
 * Attempt to salvage a project file that fails JSON.parse. Keeps every
 * top-level field and every complete `lines` entry before the damage point,
 * writes the result back under the same id (original bytes preserved as
 * `<id>.corrupt-bak`), and reports what was recovered.
 */
export async function tryRepairProject(id: string): Promise<{ repaired: boolean; message: string }> {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(id);
  const text = await (await fileHandle.getFile()).text();

  // A transient read error can heal on retry — check before declaring damage.
  try {
    const ok = JSON.parse(text);
    if (ok && typeof ok === 'object') {
      return { repaired: true, message: 'File terbaca normal sekarang (kemungkinan error baca sementara). Daftar proyek dimuat ulang.' };
    }
  } catch (_) {}

  const salvaged = salvageJsonObject(text);
  if (!salvaged) {
    return { repaired: false, message: 'Tidak ada data yang bisa diselamatkan dari file ini.\n\nPulihkan dari backup, atau hapus filenya.' };
  }

  const rawLines: any[] = Array.isArray(salvaged.lines) ? salvaged.lines : [];
  const lines = rawLines.filter(l =>
    l && typeof l === 'object' &&
    typeof l.line_num === 'number' && typeof l.file === 'string'
  );
  if (!lines.length && typeof salvaged.projectName !== 'string') {
    return { repaired: false, message: 'File hanya berisi pengaturan tanpa nama proyek dan baris — tidak layak diselamatkan.\n\nPulihkan dari backup, atau hapus filenya.' };
  }
  salvaged.lines = lines;
  if (typeof salvaged.projectName !== 'string' || !salvaged.projectName) {
    salvaged.projectName = id.replace(PROJECT_EXT, '');
  }

  // Preserve the original damaged bytes before overwriting, so a manual /
  // deeper recovery attempt is still possible later.
  const bakHandle = await root.getFileHandle(id + '.corrupt-bak', { create: true });
  const bakWritable = await bakHandle.createWritable();
  await bakWritable.write(text);
  await bakWritable.close();

  await saveProjectToOpfs(id, salvaged);

  const lastLineNum = lines.reduce((m, l) => Math.max(m, l.line_num), 0);
  const estLost = Math.max(0, lastLineNum - lines.length);
  let msg = `Perbaikan selesai.\n\nData diselamatkan: ${lines.length} baris`;
  if (estLost > 0) msg += ` (perkiraan hingga ~${estLost} baris hilang di titik kerusakan)`;
  msg += `.\n\nSalinan file rusak asli disimpan sebagai ${id}.corrupt-bak.`;
  msg += '\nCek hasilnya — kalau ada yang kurang, pulihkan dari backup.';
  return { repaired: true, message: msg };
}

export async function renameDashboardProject(id: string, oldName: string, data: any): Promise<void> {
  const newName = prompt('Masukkan nama baru untuk proyek:', oldName);
  if (!newName || newName.trim() === '' || newName === oldName) return;
  data.projectName = newName.trim();
  try {
    await saveProjectToOpfs(id, data);
    loadDashboardProjects();
  } catch (err: any) {
    data.projectName = oldName;
    alert('Gagal mengubah nama proyek: ' + (err?.message || err));
  }
}

// ─── Backup & Restore ─────────────────────────────────────────────────────────
/**
 * Build the full backup payload for one project: merges the Luca sidecar and
 * the original EPUB into a single portable object. Returns null when the Luca
 * sidecar is corrupt — the caller must abort that project's backup.
 */
export async function prepareProjectBackupData(data: any, id: string): Promise<Record<string, any> | null> {
  const backupData = JSON.parse(JSON.stringify(data));
  // Merge lucaRawBuffers from separate OPFS file if available
  if (backupData.projectType === 'luca') {
    const lucaData = await loadLucaDataFromOpfs(id);
    if (!lucaData) {
      const sidecarExists = await (async () => {
        try { const root = await getOpfsRoot(); await root.getFileHandle(id.replace(PROJECT_EXT, '_luca.json')); return true; } catch { return false; }
      })();
      if (sidecarExists) {
        alert('Backup Luca dibatalkan: sidecar corrupt dan tidak dapat dibaca.');
        return null;
      }
    } else {
      backupData.lucaRawFiles = lucaData.lucaRawFiles || {};
      backupData.lucaRawBuffers = lucaData.lucaRawBuffers || {};
    }
  }
  if (backupData.projectType === 'epub' && backupData.epubSourceId) {
    try {
      backupData.epub_source = await readEpubSourceForBackup(backupData.epubSourceId);
    } catch (err: any) {
      alert(`Backup dibuat tanpa file EPUB asli.\n\n${err.message}`);
    }
  }
  // Custom-parser sidecar: missing sidecar only means empty original sources,
  // so unlike Luca this never aborts the backup.
  if (backupData.projectType === 'custom') {
    const customData = await loadCustomSourcesFromOpfs(id);
    if (customData) {
      backupData.customRawFiles = customData.customRawFiles || {};
      backupData.customRawBuffers = customData.customRawBuffers || {};
    }
    // Definisi parser ikut backup — tanpa ini restore di browser lain jatuh ke
    // ekspor JSON karena script parser hanya hidup di localStorage browser ini.
    backupData.customParserDef = getCustomParser(backupData.custom_parser_id);
  }
  return backupData;
}

export async function backupDashboardProject(name: string, data: any, id: string): Promise<void> {
  const backupData = await prepareProjectBackupData(data, id);
  if (!backupData) return;
  const strData = JSON.stringify(backupData);
  const b = new Blob([strData], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  a.download = `${safeName}_backup${PROJECT_EXT}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function getProofreadSettings(): Record<string, any> {
  return {
    scope: (ui.proofreadScope as HTMLSelectElement)?.value,
    regex: (ui.proofreadRegexCheck as HTMLInputElement)?.checked,
    case: (ui.proofreadCaseCheck as HTMLInputElement)?.checked,
    preserveCase: (ui.proofreadPreserveCaseCheck as HTMLInputElement)?.checked,
    exact: (ui.proofreadExactCheck as HTMLInputElement)?.checked,
    translatedOnly: (ui.proofreadTranslatedOnlyCheck as HTMLInputElement)?.checked,
    jump: (ui.proofreadJumpCheck as HTMLInputElement)?.checked,
  };
}

/** Build the complete project payload shared by autosave, close, and backup. */
function buildProjectPersistenceData(): Record<string, any> {
  return {
    version: APP_VERSION, projectName: state.projectName, projectType: state.projectType,
    source_lang: state.sourceLang, target_lang: state.targetLang,
    translationMode: state.translationMode || 'ai', jsonRefLang: state.jsonRefLang || '',
    epubTags: state.epubTags, epubSourceId: state.epubSourceId,
    lucaExportLang: state.lucaExportLang,
    luca_profile: state.lucaProfile || DEFAULT_LUCA_PROFILE,
    luca_mc_display_name: state.lucaMcDisplayName || DEFAULT_LUCA_MC_DISPLAY_NAME,
    custom_parser_id: state.customParserId,
    regex_filter: state.regexFilter, pre_replace_rules: state.preReplaceRules,
    post_replace_rules: state.postReplaceRules,
    disable_empty_line_validation: state.disableEmptyLineValidation,
    check_kana_residue: state.checkKanaResidue, check_similarity: state.checkSimilarity,
    check_linebreak: state.checkLinebreak, check_length_ratio: state.checkLengthRatio,
    length_ratio_threshold: state.lengthRatioThreshold, check_language: state.checkLanguage,
    check_punctuation: state.checkPunctuation, check_untrans_name: state.checkUntransName,
    enable_uncertain_marking: state.enableUncertainMarking,
    safe_tags_for_chatgpt: state.safeTagsForChatgpt, agent_max_turns: state.agentMaxTurns,
    show_furigana: state.showFurigana, furigana_type: state.furiganaType || 'hiragana',
    font_size: state.fontSize, enable_dictionary: state.enableDictionary,
    dictionary_engine: state.dictionaryEngine, dictionary_prompt: state.dictionaryPrompt,
    similarity_threshold: state.similarityThreshold,
    imported_files: state.importedFiles, file_order: state.fileOrder, lines: state.lines,
    prompt_header: state.aiInstructionHeader,
    ai_translation_format: state.aiTranslationFormat || DEFAULT_AI_TRANSLATION_FORMAT,
    glossary_prompt: state.glossaryPrompt, ai_check_prompt: state.aiCheckPrompt,
    agent_prompt: state.agentPrompt, dict_history: getDictHistory(),
    paste_area: (ui.pasteArea as HTMLTextAreaElement)?.value || '',
    paste_glossary_area: (ui.pasteGlossaryArea as HTMLTextAreaElement)?.value || '',
    paste_ai_check_area: (ui.pasteAiCheckArea as HTMLTextAreaElement)?.value || '',
    glossary_text: state.glossaryText, context_lines: state.contextLines,
    context_type: state.contextType, selection_batch_size: state.selectionBatchSize,
    glossary_batch_size: state.glossaryBatchSize, ai_check_batch_size: state.aiCheckBatchSize,
    parallel_batch_size: state.parallelBatchSize,
    subagent_workers: state.subagentWorkers,
    selection_batch_prev_shortcut: state.selectionBatchPrevShortcut,
    selection_batch_next_shortcut: state.selectionBatchNextShortcut,
    enableBackgroundChaining: state.enableBackgroundChaining,
    currentBackground: state.currentBackground,
    summary_prompt: state.summaryPrompt,
    enable_logging: state.projectLoggingEnabled,
    show_epub_images: state.showEpubImages === true,
    proofread_settings: getProofreadSettings(),
  };
}

function buildCurrentProjectBackupData(): Record<string, any> {
  return buildProjectPersistenceData();
}

export async function backupCurrentProject(): Promise<void> {
  if (!state.currentProjectId) return;
  await backupDashboardProject(state.projectName, buildCurrentProjectBackupData(), state.currentProjectId);
}

export async function backupAllProjectsAsZip(): Promise<void> {
  if (!(window as any).JSZip) { alert('JSZip tidak tersedia.'); return; }
  // Corrupt files cannot be read into the ZIP — skip them instead of failing
  // the whole backup; they are already flagged on the dashboard.
  const projects = (state.dashboardProjects || []).filter((p: any) => !p.corrupt);
  if (!projects.length) { alert('Belum ada proyek untuk dibackup.'); return; }
  if (!confirm(`Backup semua ${projects.length} proyek sebagai satu file ZIP?`)) return;
  const button = ui.btnBackupAllProjects as HTMLButtonElement | undefined;
  const originalLabel = button?.textContent || 'Backup Semua ZIP';
  if (button) {
    button.disabled = true;
    button.textContent = `Backup 0/${projects.length}...`;
  }
  try {
    flashHint('Menyiapkan backup semua proyek...', true);
    const zip = new (window as any).JSZip();
    const usedBackupNames = new Set<string>();
    for (let index = 0; index < projects.length; index++) {
      const p = projects[index];
      if (button) button.textContent = `Backup ${index + 1}/${projects.length}...`;
      flashHint(`Membackup proyek ${index + 1}/${projects.length}: ${p.name}`, true);
      const data = await fetchProjectData(p.id);
      const backupData = await prepareProjectBackupData(data, p.id);
      if (!backupData) {
        throw new Error(`Data mentah Luca untuk proyek "${p.name}" tidak dapat dibaca — sidecar corrupt, backup semua dibatalkan.`);
      }
      const safeName = String(p.name || p.id).replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
      const baseEntryName = `${safeName}_backup${PROJECT_EXT}`;
      let entryName = baseEntryName;
      let suffix = 2;
      while (usedBackupNames.has(entryName)) {
        entryName = `${safeName}_${suffix++}_backup${PROJECT_EXT}`;
      }
      usedBackupNames.add(entryName);
      zip.file(entryName, JSON.stringify(backupData));
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href;
    a.download = `cstl_projects_backup_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    flashHint('Backup semua proyek berhasil.');
  } catch (e: any) {
    alert('Gagal membuat backup ZIP: ' + e.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

// ─── OPFS persistence ─────────────────────────────────────────────────────────
export async function saveProjectToOpfs(id: string, dataObj: any): Promise<void> {
  dataObj.updatedAt = Date.now();
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(id, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(dataObj));
  await writable.close();
}
export async function saveLucaDataToOpfs(id: string, lucaData: any): Promise<void> {
  const root = await getOpfsRoot();
  const lucaId = id.replace(PROJECT_EXT, '_luca.json');
  const fileHandle = await root.getFileHandle(lucaId, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(lucaData));
  await writable.close();
}

export async function loadLucaDataFromOpfs(id: string): Promise<any> {
  try {
    const root = await getOpfsRoot();
    const lucaId = id.replace(PROJECT_EXT, '_luca.json');
    const fileHandle = await root.getFileHandle(lucaId);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// ─── Custom parser source sidecar (round-trip export) ────────────────────────
/** Simpan file asli proyek parser custom (teks + base64 bytes) ke OPFS sidecar,
 *  mengikuti pola sidecar Luca — biar file .cstl utama tetap ramping. */
export async function saveCustomSourcesToOpfs(id: string, customData: any): Promise<void> {
  const root = await getOpfsRoot();
  const customId = id.replace(PROJECT_EXT, '_custom_src.json');
  const fileHandle = await root.getFileHandle(customId, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(customData));
  await writable.close();
}

export async function loadCustomSourcesFromOpfs(id: string): Promise<any> {
  try {
    const root = await getOpfsRoot();
    const customId = id.replace(PROJECT_EXT, '_custom_src.json');
    const fileHandle = await root.getFileHandle(customId);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// ─── Project exclusive-open lock (Web Locks) ──────────────────────────────────
// Autosave always rewrites the whole project file from memory. If the same
// project is open in two windows, the stale window's save silently erases the
// newer one's edits. A held Web Lock per project makes the second open fail
// loudly instead. Browsers without Web Locks fail open (app stays usable).
const heldProjectLocks = new Map<string, () => void>();

async function acquireProjectLock(id: string): Promise<boolean> {
  const locks = (navigator as any).locks;
  if (!locks?.request) return true;
  return new Promise<boolean>(resolve => {
    locks.request('cstl-project-' + id, { ifAvailable: true }, (lock: any) => {
      if (!lock) { resolve(false); return; }
      let release: () => void = () => {};
      heldProjectLocks.set(id, () => release());
      resolve(true);
      // Never settles until releaseProjectLock() — that is what holds the lock.
      return new Promise<void>(r => { release = r; });
    }).catch(() => resolve(true));
  });
}

function releaseProjectLock(id: string | null): void {
  if (!id) return;
  const release = heldProjectLocks.get(id);
  if (release) {
    heldProjectLocks.delete(id);
    try { release(); } catch (_) {}
  }
}

let activeAutoSavePromise: Promise<void> | null = null;
let projectRevision = 0;
let isClosingProject = false;
let projectLoadGeneration = 0;
let activeLucaDataProjectId: string | null = null;
let activeLucaDataLoad: Promise<void> = Promise.resolve();

export function waitForLucaDataLoad(projectId: string | null = state.currentProjectId): Promise<void> {
  if (!projectId || projectId !== activeLucaDataProjectId) return Promise.resolve();
  return activeLucaDataLoad;
}

let activeCustomDataProjectId: string | null = null;
let activeCustomDataLoad: Promise<void> = Promise.resolve();

export function waitForCustomSourcesLoad(projectId: string | null = state.currentProjectId): Promise<void> {
  if (!projectId || projectId !== activeCustomDataProjectId) return Promise.resolve();
  return activeCustomDataLoad;
}

export function queueAutoSave(): void {
  const projectId = state.currentProjectId;
  if (!projectId) return;
  projectRevision++;
  if (isClosingProject) return;
  clearTimeout(getSaveTimeout()!);
  const saveGeneration = projectLoadGeneration;
  const timeout = setTimeout(async () => {
    // A delayed save must never serialize the state of a newer project under
    // the ID captured when this save was queued.
    if (state.currentProjectId !== projectId || projectLoadGeneration !== saveGeneration) {
      if (getSaveTimeout() === timeout) setSaveTimeout(null);
      return;
    }
    const data = buildProjectPersistenceData();
    const previousSave = activeAutoSavePromise;
    const savePromise = (previousSave ? previousSave.catch(() => {}) : Promise.resolve())
      .then(() => saveProjectToOpfs(projectId, data));
    activeAutoSavePromise = savePromise;
    try {
      await savePromise;
      (ui.statusBar as HTMLElement).textContent = (ui.statusBar as HTMLElement).textContent!.replace(' | Tersimpan!', '') + ' | Tersimpan!';
      setTimeout(() => { updateStatusBar(); }, 2000);
    } catch (err) {
      console.error('Failed to autosave project', err);
      flashHint('Gagal menyimpan ke storage!');
    } finally {
      if (activeAutoSavePromise === savePromise) activeAutoSavePromise = null;
      if (getSaveTimeout() === timeout) setSaveTimeout(null);
    }
  }, 1000);
  setSaveTimeout(timeout);
}

/** Best-effort immediate save for page unload — skips the 1s debounce. */
export function flushAutoSaveNow(): void {
  const projectId = state.currentProjectId;
  if (!projectId || isClosingProject || !getSaveTimeout()) return;
  clearTimeout(getSaveTimeout()!);
  setSaveTimeout(null);
  const data = buildProjectPersistenceData();
  const previousSave = activeAutoSavePromise;
  const savePromise = (previousSave ? previousSave.catch(() => {}) : Promise.resolve())
    .then(() => saveProjectToOpfs(projectId, data));
  activeAutoSavePromise = savePromise;
  savePromise.catch(() => {});
}

// ─── Open / Close project ─────────────────────────────────────────────────────
export async function openProject(id: string, data: any): Promise<void> {
  // Must be acquired before any state mutation. A second window holding the
  // lock means this open is refused, not silently raced against its saves.
  const lockAcquired = await acquireProjectLock(id);
  if (!lockAcquired) {
    alert('Proyek ini sedang terbuka di tab/jendela lain. Tutup dulu di sana untuk menghindari kehilangan data.');
    return;
  }
  const loadGeneration = ++projectLoadGeneration;
  const isCurrentLoad = () => state.currentProjectId === id && projectLoadGeneration === loadGeneration;
  state.currentProjectId = id;
  state.projectName = data.projectName || 'Unknown Project';
  state.projectType = data.projectType || 'json';
  // Logging visibility is controlled globally by Project Defaults for every project.
  state.projectLoggingEnabled = !!getDefaultSettings().enableLogging;
  state.sourceLang = data.source_lang || state.sourceLang || 'Japanese';
  state.targetLang = data.target_lang || state.targetLang || 'Indonesian';
  state.translationMode = data.translationMode || 'ai';
  state.jsonRefLang = data.jsonRefLang || '';
  state.epubTags = data.epubTags || 'p';
  state.epubSourceId = data.epubSourceId || null;
  state.lucaExportLang = data.lucaExportLang || 'en';
  state.lucaProfile = data.luca_profile || DEFAULT_LUCA_PROFILE;
  state.lucaMcDisplayName = data.luca_mc_display_name || DEFAULT_LUCA_MC_DISPLAY_NAME;
  // Load Luca sidecar before rendering or recovering legacy raw fields. The
  // generation guard prevents a slower previous project from touching state.
  state.lucaRawFiles = {};
  state.lucaRawBuffers = {};
  clearLucaFileLineBytesCache();
  // Custom-parser sidecar (original sources for round-trip export) — same guard.
  state.customParserId = data.custom_parser_id || null;
  state.customRawFiles = {};
  state.customRawBuffers = {};
  const customDataLoad = (async () => {
    const customData = await loadCustomSourcesFromOpfs(id);
    if (!isCurrentLoad()) return;
    if (customData) {
      state.customRawFiles = customData.customRawFiles || {};
      state.customRawBuffers = customData.customRawBuffers || {};
    }
  })();
  activeCustomDataProjectId = id;
  activeCustomDataLoad = customDataLoad;
  const lucaDataLoad = (async () => {
    const lucaData = await loadLucaDataFromOpfs(id);
    if (!isCurrentLoad()) return;
    if (lucaData) {
      state.lucaRawFiles = lucaData.lucaRawFiles || {};
      state.lucaRawBuffers = lucaData.lucaRawBuffers || {};
      return;
    }

    const hasEmbeddedLucaData = (data.lucaRawFiles && Object.keys(data.lucaRawFiles).length > 0)
      || (data.lucaRawBuffers && Object.keys(data.lucaRawBuffers).length > 0);
    if (!hasEmbeddedLucaData) return;

    // Migrate old format: save to separate file and clear it from the main save.
    state.lucaRawFiles = data.lucaRawFiles || {};
    state.lucaRawBuffers = data.lucaRawBuffers || {};
    try {
      await saveLucaDataToOpfs(id, { lucaRawFiles: state.lucaRawFiles, lucaRawBuffers: state.lucaRawBuffers });
      if (isCurrentLoad()) queueAutoSave();
    } catch (err) {
      console.error('Failed to migrate Luca project data', err);
      if (isCurrentLoad()) flashHint('Gagal memigrasikan data mentah Luca ke storage!');
    }
  })();
  activeLucaDataProjectId = id;
  activeLucaDataLoad = lucaDataLoad;
  state.regexFilter = data.regex_filter || '';
  state.preReplaceRules = data.pre_replace_rules || '';
  state.postReplaceRules = data.post_replace_rules || '';
  state.enableBackgroundChaining = !!(data.enableBackgroundChaining || data.enable_summary_chaining);
  state.currentBackground = data.currentBackground || data.current_summary || '';
  state.summaryPrompt = data.summary_prompt || data.summaryPrompt || '';
  state.disableEmptyLineValidation = !!data.disable_empty_line_validation;
  state.checkKanaResidue = !!data.check_kana_residue;
  state.checkSimilarity = !!data.check_similarity;
  state.checkLinebreak = data.check_linebreak !== undefined ? !!data.check_linebreak : false;
  state.checkLengthRatio = !!data.check_length_ratio;
  state.lengthRatioThreshold = (typeof data.length_ratio_threshold === 'number' && data.length_ratio_threshold > 0) ? data.length_ratio_threshold : 2.5;
  state.checkLanguage = data.check_language !== undefined ? !!data.check_language : false;
  state.checkPunctuation = data.check_punctuation !== undefined ? !!data.check_punctuation : false;
  state.checkUntransName = !!data.check_untrans_name;
  state.enableUncertainMarking = !!data.enable_uncertain_marking;
  state.safeTagsForChatgpt = data.safe_tags_for_chatgpt !== undefined ? !!data.safe_tags_for_chatgpt : false;
  state.agentMaxTurns = (typeof data.agent_max_turns === 'number' && data.agent_max_turns >= 3) ? data.agent_max_turns : 10;
  state.showFurigana = !!data.show_furigana;
  state.furiganaType = data.furigana_type || 'hiragana';
  state.showEpubImages = data.show_epub_images !== undefined ? !!data.show_epub_images : (getDefaultSettings().showEpubImages !== false);
  state.enableDictionary = !!data.enable_dictionary;
  state.dictionaryEngine = data.dictionary_engine === 'jisho' ? 'jisho' : 'llm';
  state.dictionaryPrompt = data.dictionary_prompt || 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.';
  state.fontSize = typeof data.font_size === 'number' ? data.font_size : 14;
  document.documentElement.style.setProperty('--content-font-size', state.fontSize + 'px');
  state.similarityThreshold = (typeof data.similarity_threshold === 'number' && data.similarity_threshold > 0 && data.similarity_threshold < 1)
    ? data.similarity_threshold : 0.7;
  state.lines = (data.lines || []).map(normalizeLineDict);
  state.importedFiles = data.imported_files || [];
  state.fileOrder = data.file_order || [];
  state.aiInstructionHeader = data.prompt_header || DEFAULT_PROMPT_HEADER;
  state.aiTranslationFormat = data.ai_translation_format != null
    ? normalizeAiTranslationFormat(data.ai_translation_format)
    : DEFAULT_AI_TRANSLATION_FORMAT;
  state.glossaryPrompt = data.glossary_prompt || DEFAULT_GLOSSARY_PROMPT;
  state.aiCheckPrompt = data.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT;
  state.agentPrompt = data.agent_prompt || DEFAULT_AGENT_PROMPT;
  state.glossaryText = data.glossary_text || '';
  state.contextLines = data.context_lines !== undefined ? data.context_lines : 10;
  state.contextType = data.context_type || 'raw';
  state.selectionBatchSize = normalizeSelectionBatchSize(data.selection_batch_size);
  state.glossaryBatchSize = normalizeSelectionBatchSize(data.glossary_batch_size, DEFAULT_GLOSSARY_BATCH_SIZE);
  state.aiCheckBatchSize = normalizeSelectionBatchSize(data.ai_check_batch_size, DEFAULT_AI_CHECK_BATCH_SIZE);
  state.parallelBatchSize = Math.max(1, Math.min(10, parseInt(data.parallel_batch_size) || 1));
  state.subagentWorkers = Math.max(1, Math.min(10, parseInt(data.subagent_workers) || 3));
  state.selectionBatchPrevShortcut = normalizeShortcutString(data.selection_batch_prev_shortcut, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT);
  state.selectionBatchNextShortcut = normalizeShortcutString(data.selection_batch_next_shortcut, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT);
  
  const proofreadSettings = data.proofread_settings || {};
  if (ui.proofreadScope) (ui.proofreadScope as HTMLSelectElement).value = proofreadSettings.scope || 'all';
  if (ui.proofreadRegexCheck) (ui.proofreadRegexCheck as HTMLInputElement).checked = !!proofreadSettings.regex;
  if (ui.proofreadCaseCheck) (ui.proofreadCaseCheck as HTMLInputElement).checked = !!proofreadSettings.case;
  if (ui.proofreadExactCheck) (ui.proofreadExactCheck as HTMLInputElement).checked = !!proofreadSettings.exact;
  if (ui.proofreadTranslatedOnlyCheck) (ui.proofreadTranslatedOnlyCheck as HTMLInputElement).checked = proofreadSettings.translatedOnly !== false;
  if (ui.proofreadJumpCheck) (ui.proofreadJumpCheck as HTMLInputElement).checked = !!proofreadSettings.jump;
  if (ui.proofreadPreserveCaseCheck) (ui.proofreadPreserveCaseCheck as HTMLInputElement).checked = proofreadSettings.preserveCase !== false;

  state.selectedLines.clear();
  state.undoStack = [];
  state.redoStack = [];
  state.aiCheckCorrections = [];
  state.activeWorkspaceTab = 'translate';
  resetSelectionHistory();
  if (ui.pasteArea) (ui.pasteArea as HTMLTextAreaElement).value = data.paste_area || '';
  if (ui.pasteGlossaryArea) (ui.pasteGlossaryArea as HTMLTextAreaElement).value = data.paste_glossary_area || '';
  if (ui.pasteAiCheckArea) (ui.pasteAiCheckArea as HTMLTextAreaElement).value = data.paste_ai_check_area || '';
  if (ui.aiCheckResults) (ui.aiCheckResults as HTMLElement).textContent = '';
  setDictHistory(data.dict_history || []);

  await lucaDataLoad;
  await customDataLoad;
  if (!isCurrentLoad()) {
    // A newer open superseded this one — release the lock it will never use.
    releaseProjectLock(id);
    return;
  }
  // Legacy recovery must see the asynchronously loaded raw sidecar, and all
  // other project settings above must be ready before recovery queues a save.
  recoverLucaRawFields();

  import('./ai-agent').then(({ loadChatHistory, renderChatHistory, loadAllAgentMemories }) => {
    loadAllAgentMemories();
    loadChatHistory();
    renderChatHistory();
  });
  (ui.projectNameDisplay as HTMLElement).textContent = state.translationMode === 'htl'
    ? `${state.projectName} [HTL]`
    : state.projectName;
  (ui.dashboardView as HTMLElement).classList.remove('open');
  (ui.workspaceView as HTMLElement).style.display = 'flex';
  if (state.projectType === 'epub' && state.epubSourceId && state.showEpubImages === true) {
    preloadEpubImages().then(() => {
      refreshAll();
    });
  }
  refreshAll();
  applyHtlMode();
  switchWorkspaceTab('translate');
  applyProjectLoggingVisibility();
}

export async function closeProject(): Promise<void> {
  const projectId = state.currentProjectId;
  if (!projectId) {
    finishClose();
    return;
  }
  if (isClosingProject) return;
  isClosingProject = true;
  if (getSaveTimeout()) clearTimeout(getSaveTimeout()!);
  setSaveTimeout(null);
  if (activeAutoSavePromise) {
    try {
      await activeAutoSavePromise;
    } catch (_) {
      // The final close-time save below retries with the latest project state.
    }
  }

  try {
    while (true) {
      const revision = projectRevision;
      await saveProjectToOpfs(projectId, buildProjectPersistenceData());
      if (revision === projectRevision) break;
    }
    finishClose();
  } catch (err: any) {
    console.error('Failed to save project before closing', err);
    alert('Gagal menyimpan proyek. Proyek tetap terbuka.\n\n' + (err?.message || err));
  } finally {
    isClosingProject = false;
  }
}

export function finishClose(): void {
  releaseProjectLock(state.currentProjectId);
  state.currentProjectId = null;
  state.projectLoggingEnabled = false;
  state.lines = [];
  state.selectedLines.clear();
  resetSelectionHistory();
  clearEpubImageCache();
  (ui.workspaceView as HTMLElement).style.display = 'none';
  (ui.dashboardView as HTMLElement).classList.add('open');
  loadDashboardProjects();
  applyProjectLoggingVisibility();
}

export async function onRestoreProject(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  const f = target.files?.[0];
  target.value = '';
  if (!f) return;
  await restoreProjectFromFile(f);
}

/** Restore pipeline shared by the dashboard file input and Folder Backup.
 *  Returns true when the project was restored, false after a failed attempt. */
export async function restoreProjectFromFile(f: File): Promise<boolean> {
  let restoreProjectId: string | null = null;
  let createdEpubSourceId: string | null = null;
  try {
    const p = JSON.parse(await f.text());
    const name = p.projectName || f.name.replace(PROJECT_EXT, '');
    const id = 'proj_' + Date.now() + PROJECT_EXT;
    restoreProjectId = id;
    let restoredEpubSourceId = p.epubSourceId || null;
    let restoreNote = '';
    if ((p.projectType || 'json') === 'epub') {
      if (p.epub_source?.data) {
        restoredEpubSourceId = await writeEpubSourceFromBackup(p.epub_source);
        createdEpubSourceId = restoredEpubSourceId;
      } else if (p.epubSourceId) {
        try {
          restoredEpubSourceId = await cloneExistingEpubSource(p.epubSourceId);
          createdEpubSourceId = restoredEpubSourceId;
        } catch (_) {
          restoredEpubSourceId = null;
          restoreNote = '\n\nCatatan: backup lama ini tidak menyimpan file EPUB asli.';
        }
      }
    }
    // Preserve every field already supported by autosave, while keeping the
    // large Luca/EPUB payloads in their dedicated sidecar files.
    const safeData: Record<string, any> = JSON.parse(JSON.stringify(p));
    delete safeData.epub_source;
    delete safeData.lucaRawFiles;
    delete safeData.lucaRawBuffers;
    delete safeData.customRawFiles;
    delete safeData.customRawBuffers;
    Object.assign(safeData, {
      version: APP_VERSION, projectName: name, projectType: p.projectType || 'json',
      source_lang: p.source_lang || 'Japanese', target_lang: p.target_lang || 'Indonesian',
      translationMode: p.translationMode || 'ai', jsonRefLang: p.jsonRefLang || '',
      epubTags: p.epubTags || 'p', epubSourceId: restoredEpubSourceId,
      lucaExportLang: p.lucaExportLang || 'en',
      luca_profile: p.luca_profile || DEFAULT_LUCA_PROFILE,
      luca_mc_display_name: p.luca_mc_display_name || DEFAULT_LUCA_MC_DISPLAY_NAME,
      custom_parser_id: p.custom_parser_id || null,
      updatedAt: Date.now(), regex_filter: p.regex_filter || '',
      pre_replace_rules: p.pre_replace_rules || '', post_replace_rules: p.post_replace_rules || '',
      disable_empty_line_validation: !!p.disable_empty_line_validation,
      check_kana_residue: !!p.check_kana_residue, check_similarity: !!p.check_similarity,
      check_linebreak: p.check_linebreak !== undefined ? !!p.check_linebreak : false,
      check_length_ratio: !!p.check_length_ratio,
      length_ratio_threshold: (typeof p.length_ratio_threshold === 'number' && p.length_ratio_threshold > 0) ? p.length_ratio_threshold : 2.5,
      check_language: p.check_language !== undefined ? !!p.check_language : false,
      check_punctuation: p.check_punctuation !== undefined ? !!p.check_punctuation : false,
      check_untrans_name: !!p.check_untrans_name,
      enable_uncertain_marking: !!p.enable_uncertain_marking,
      safe_tags_for_chatgpt: p.safe_tags_for_chatgpt !== undefined ? !!p.safe_tags_for_chatgpt : false,
      agent_max_turns: (typeof p.agent_max_turns === 'number' && p.agent_max_turns >= 3) ? p.agent_max_turns : 10,
      show_furigana: !!p.show_furigana,
      furigana_type: p.furigana_type || 'hiragana',
      font_size: typeof p.font_size === 'number' ? p.font_size : 14,
      enable_dictionary: !!p.enable_dictionary,
      dictionary_engine: p.dictionary_engine === 'jisho' ? 'jisho' : 'llm',
      dictionary_prompt: p.dictionary_prompt || 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.',
      similarity_threshold: (typeof p.similarity_threshold === 'number' && p.similarity_threshold > 0 && p.similarity_threshold < 1) ? p.similarity_threshold : 0.7,
      imported_files: p.imported_files || [], file_order: p.file_order || [],
      lines: (p.lines || []).map(normalizeLineDict),
      prompt_header: p.prompt_header || DEFAULT_PROMPT_HEADER,
      ai_translation_format: p.ai_translation_format != null ? normalizeAiTranslationFormat(p.ai_translation_format) : DEFAULT_AI_TRANSLATION_FORMAT,
      glossary_prompt: p.glossary_prompt || DEFAULT_GLOSSARY_PROMPT,
      ai_check_prompt: p.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT,
      agent_prompt: p.agent_prompt || DEFAULT_AGENT_PROMPT,
      dict_history: p.dict_history || [],
      paste_area: p.paste_area || '', paste_glossary_area: p.paste_glossary_area || '',
      paste_ai_check_area: p.paste_ai_check_area || '', glossary_text: p.glossary_text || '',
      context_lines: p.context_lines !== undefined ? p.context_lines : 10,
      context_type: p.context_type || 'raw',
      selection_batch_size: normalizeSelectionBatchSize(p.selection_batch_size),
      glossary_batch_size: normalizeSelectionBatchSize(p.glossary_batch_size, DEFAULT_GLOSSARY_BATCH_SIZE),
      ai_check_batch_size: normalizeSelectionBatchSize(p.ai_check_batch_size, DEFAULT_AI_CHECK_BATCH_SIZE),
      selection_batch_prev_shortcut: normalizeShortcutString(p.selection_batch_prev_shortcut, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT),
      selection_batch_next_shortcut: normalizeShortcutString(p.selection_batch_next_shortcut, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT),
      enableBackgroundChaining: !!p.enableBackgroundChaining,
      currentBackground: p.currentBackground || '', enable_logging: !!p.enable_logging,
      proofread_settings: p.proofread_settings || {},
    });
    await saveProjectToOpfs(id, safeData);
    if ((p.lucaRawFiles && Object.keys(p.lucaRawFiles).length > 0)
      || (p.lucaRawBuffers && Object.keys(p.lucaRawBuffers).length > 0)) {
      await saveLucaDataToOpfs(id, { lucaRawFiles: p.lucaRawFiles || {}, lucaRawBuffers: p.lucaRawBuffers || {} });
    }
    if ((p.customRawFiles && Object.keys(p.customRawFiles).length > 0)
      || (p.customRawBuffers && Object.keys(p.customRawBuffers).length > 0)) {
      await saveCustomSourcesToOpfs(id, { customRawFiles: p.customRawFiles || {}, customRawBuffers: p.customRawBuffers || {} });
    }
    // Definisi parser dari backup — pulihkan hanya kalau belum ada di browser
    // ini (versi lokal selalu menang agar edit terbaru tidak tertimpa backup).
    if (isValidCustomParser(p.customParserDef) && !getCustomParser(p.customParserDef.id)) {
      upsertCustomParser(p.customParserDef);
      restoreNote += `\n\nCatatan: definisi parser "${p.customParserDef.name}" ikut dipulihkan dari backup.`;
    }
    loadDashboardProjects();
    alert(`Proyek "${name}" berhasil dipulihkan!${restoreNote}`);
    return true;
  } catch (e: any) {
    try {
      const root = await getOpfsRoot();
      if (restoreProjectId) {
        try { await root.removeEntry(restoreProjectId); } catch (_) {}
        try { await root.removeEntry(restoreProjectId.replace(PROJECT_EXT, '_luca.json')); } catch (_) {}
        try { await root.removeEntry(restoreProjectId.replace(PROJECT_EXT, '_custom_src.json')); } catch (_) {}
      }
      if (createdEpubSourceId) {
        try { await root.removeEntry(createdEpubSourceId); } catch (_) {}
      }
    } catch (_) {}
    alert('Gagal memulihkan proyek: ' + e.message);
    return false;
  }
}
