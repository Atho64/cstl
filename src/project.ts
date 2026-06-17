// @module project.ts — Project management, OPFS persistence, dashboard, backup & restore

import { state, ui, setSaveTimeout, getSaveTimeout, getOpfsRoot } from './state';
import {
  APP_VERSION, PROJECT_EXT,
  DEFAULT_PROMPT_HEADER, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_LUCA_MC_DISPLAY_NAME,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_SELECTION_BATCH_SIZE, DEFAULT_GLOSSARY_BATCH_SIZE, DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_SELECTION_BATCH_PREV_SHORTCUT, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
} from './constants';
import { DEFAULT_LUCA_PROFILE, clearLucaFileLineBytesCache } from './luca-engine';
import { normalizeAiTranslationFormat } from './ai-format';
import { readEpubSourceForBackup, writeEpubSourceFromBackup, cloneExistingEpubSource } from './binary-utils';
import { resetSelectionHistory, switchWorkspaceTab, normalizeSelectionBatchSize } from './selection';
import { normalizeLineDict } from './state';
import { normalizeShortcutString } from './shortcuts';

// ─── Lazy render helpers (breaks render.js ↔ project.js circular dep) ─────────
async function refreshAll() { return (await import('./render')).refreshAll(); }
async function flashHintAsync(msg: string, keepAlive?: boolean) { return (await import('./render')).flashHint(msg, keepAlive); }
function flashHint(msg: string, keepAlive?: boolean) { import('./render').then(m => m.flashHint(msg, keepAlive)); }
async function updateButtonStates() { return (await import('./render')).updateButtonStates(); }
async function updateStatusBar() { return (await import('./render')).updateStatusBar(); }
async function applyHtlMode() { return (await import('./htl-mode')).applyHtlMode(); }

// ─── Modal helpers ────────────────────────────────────────────────────────────
export function openModal(el: HTMLElement): void { el.classList.add('open'); }
export function closeModal(el: HTMLElement): void { el.classList.remove('open'); }

// ─── Dashboard default settings ───────────────────────────────────────────────
export const DS_STORAGE_KEY = 'cstl_default_settings';

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
    selectionBatch: DEFAULT_SELECTION_BATCH_SIZE,
    glossaryBatch: DEFAULT_GLOSSARY_BATCH_SIZE,
    aiCheckBatch: DEFAULT_AI_CHECK_BATCH_SIZE,
    regexFilter: '',
  };
}

export function openDashboardSettings(): void {
  const d = getDefaultSettings();
  (ui.dsSourceLang as HTMLSelectElement).value = d.sourceLang;
  (ui.dsTargetLang as HTMLSelectElement).value = d.targetLang;
  if (ui.dsTranslationMode) (ui.dsTranslationMode as HTMLSelectElement).value = d.translationMode || 'ai';
  (ui.dsAiFormat as HTMLSelectElement).value = d.aiFormat;
  (ui.dsContextLines as HTMLInputElement).value = d.contextLines;
  (ui.dsSelectionBatch as HTMLInputElement).value = d.selectionBatch;
  (ui.dsGlossaryBatch as HTMLInputElement).value = d.glossaryBatch;
  (ui.dsAiCheckBatch as HTMLInputElement).value = d.aiCheckBatch;
  (ui.dsRegexFilter as HTMLInputElement).value = d.regexFilter || '';
  (ui.dashboardSettingsModal as HTMLElement).classList.add('open');
}

export function saveDashboardSettings(): void {
  const d = {
    sourceLang: (ui.dsSourceLang as HTMLSelectElement).value,
    targetLang: (ui.dsTargetLang as HTMLSelectElement).value,
    translationMode: (ui.dsTranslationMode as HTMLSelectElement)?.value === 'htl' ? 'htl' : 'ai',
    aiFormat: (ui.dsAiFormat as HTMLSelectElement).value,
    contextLines: parseInt((ui.dsContextLines as HTMLInputElement).value) || 10,
    selectionBatch: parseInt((ui.dsSelectionBatch as HTMLInputElement).value) || DEFAULT_SELECTION_BATCH_SIZE,
    glossaryBatch: parseInt((ui.dsGlossaryBatch as HTMLInputElement).value) || DEFAULT_GLOSSARY_BATCH_SIZE,
    aiCheckBatch: parseInt((ui.dsAiCheckBatch as HTMLInputElement).value) || DEFAULT_AI_CHECK_BATCH_SIZE,
    regexFilter: (ui.dsRegexFilter as HTMLInputElement).value || '',
  };
  localStorage.setItem(DS_STORAGE_KEY, JSON.stringify(d));
  (ui.dashboardSettingsModal as HTMLElement).classList.remove('open');
}

export function resetDashboardSettings(): void {
  localStorage.removeItem(DS_STORAGE_KEY);
  const d = getDefaultSettings();
  (ui.dsSourceLang as HTMLSelectElement).value = d.sourceLang;
  (ui.dsTargetLang as HTMLSelectElement).value = d.targetLang;
  if (ui.dsTranslationMode) (ui.dsTranslationMode as HTMLSelectElement).value = d.translationMode || 'ai';
  (ui.dsAiFormat as HTMLSelectElement).value = d.aiFormat;
  (ui.dsContextLines as HTMLInputElement).value = d.contextLines;
  (ui.dsSelectionBatch as HTMLInputElement).value = d.selectionBatch;
  (ui.dsGlossaryBatch as HTMLInputElement).value = d.glossaryBatch;
  (ui.dsAiCheckBatch as HTMLInputElement).value = d.aiCheckBatch;
  (ui.dsRegexFilter as HTMLInputElement).value = d.regexFilter;
}

// ─── Dashboard project list ───────────────────────────────────────────────────
export async function loadDashboardProjects(): Promise<void> {
  state.dashboardProjects = [];
  (ui.projectList as HTMLElement).textContent = '';
  try {
    const root = await getOpfsRoot();
    const projects: any[] = [];
    for await (const [name, handle] of (root as any).entries()) {
      if (name.endsWith(PROJECT_EXT) && handle.kind === 'file') {
        const file = await handle.getFile();
        const text = await file.text();
        try {
          const data = JSON.parse(text);
          projects.push({
            id: name,
            name: data.projectName || name.replace(PROJECT_EXT, ''),
            updatedAt: data.updatedAt || file.lastModified,
            fileCount: data.imported_files?.length || 0,
            lineCount: data.lines?.length || 0,
            data,
          });
        } catch (_) {}
      }
    }
    projects.sort((a, b) => b.updatedAt - a.updatedAt);
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
  const query = ((ui.projectFilterInput as HTMLInputElement)?.value || '').trim().toLowerCase();
  const projects: any[] = query
    ? state.dashboardProjects.filter((p: any) => p.name.toLowerCase().includes(query))
    : state.dashboardProjects;

  (ui.projectList as HTMLElement).textContent = '';
  if (state.dashboardProjects.length === 0) {
    renderDashboardMessage('Belum ada proyek. Klik "Buat Proyek Baru" untuk memulai.');
    return;
  }
  if (projects.length === 0) {
    renderDashboardMessage('Tidak ada proyek yang cocok dengan filter.');
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const info = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = p.name;
    info.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'project-meta mt-2';
    if (p.fileCount > 0 || p.lineCount > 0) {
      const badgeWrap = document.createElement('div');
      badgeWrap.style.marginBottom = '8px';
      const badge = document.createElement('span');
      badge.className = p.data.projectType === 'epub' ? 'badge badge-epub' : p.data.projectType === 'luca' ? 'badge badge-luca' : 'badge badge-json';
      let badgeText = p.data.projectType === 'epub' ? 'EPUB' : p.data.projectType === 'luca' ? 'TXT LUCA' : 'JSON VNTP';
      if (p.data.translationMode === 'htl') badgeText += ' • HTL';
      badge.textContent = badgeText;
      badgeWrap.appendChild(badge);
      meta.appendChild(badgeWrap);
    }
    meta.append(
      document.createTextNode(`Terakhir diubah: ${new Date(p.updatedAt).toLocaleString('id-ID')}`),
      document.createElement('br'),
      document.createTextNode(`File: ${p.fileCount} | Baris: ${p.lineCount}`),
    );
    info.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'project-actions';
    actions.append(
      createProjectButton('Buka', 'btn btn-primary btn-sm', () => openProject(p.id, p.data)),
      createProjectButton('Ubah Nama', 'btn btn-outline btn-sm', () => renameDashboardProject(p.id, p.name, p.data)),
      createProjectButton('Backup', 'btn btn-outline btn-sm', () => backupDashboardProject(p.name, p.data)),
      createProjectButton('Hapus', 'btn btn-danger btn-sm', () => deleteProject(p.id, p.data)),
    );
    card.append(info, actions);
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
    version: APP_VERSION, projectName: name.trim(), projectType: 'json', translationMode: 'ai',
    jsonRefLang: '', epubTags: 'p', epubSourceId: null, lucaExportLang: 'en',
    luca_profile: DEFAULT_LUCA_PROFILE, luca_mc_display_name: DEFAULT_LUCA_MC_DISPLAY_NAME,
    lucaRawFiles: {}, lucaRawBuffers: {}, updatedAt: Date.now(),
    source_lang: d.sourceLang, target_lang: d.targetLang, regex_filter: d.regexFilter || '',
    disable_empty_line_validation: false, check_kana_residue: false, check_similarity: false, similarity_threshold: 0.7,
    imported_files: [], lines: [],
    prompt_header: DEFAULT_PROMPT_HEADER, ai_translation_format: d.aiFormat,
    glossary_prompt: DEFAULT_GLOSSARY_PROMPT, ai_check_prompt: DEFAULT_AI_CHECK_PROMPT,
    glossary_text: '', context_lines: d.contextLines, context_type: 'raw',
    selection_batch_size: d.selectionBatch, glossary_batch_size: d.glossaryBatch, ai_check_batch_size: d.aiCheckBatch,
    selection_batch_prev_shortcut: DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
    selection_batch_next_shortcut: DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
  };
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(id, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(initialData));
    await writable.close();
    openProject(id, initialData);
  } catch (e: any) {
    alert('Gagal membuat proyek: ' + e.message);
  }
}

export async function deleteProject(id: string, data: any): Promise<void> {
  if (!confirm('Hapus proyek ini secara permanen?')) return;
  try {
    const root = await getOpfsRoot();
    if (data.epubSourceId) {
      try { await root.removeEntry(data.epubSourceId); } catch (_) {}
    }
    await root.removeEntry(id);
    loadDashboardProjects();
  } catch (e: any) {
    alert('Gagal menghapus: ' + e.message);
  }
}

export async function renameDashboardProject(id: string, oldName: string, data: any): Promise<void> {
  const newName = prompt('Masukkan nama baru untuk proyek:', oldName);
  if (!newName || newName.trim() === '' || newName === oldName) return;
  data.projectName = newName.trim();
  await saveProjectToOpfs(id, data);
  loadDashboardProjects();
}

// ─── Backup & Restore ─────────────────────────────────────────────────────────
export async function backupDashboardProject(name: string, data: any): Promise<void> {
  const backupData = JSON.parse(JSON.stringify(data));
  if (backupData.projectType === 'epub' && backupData.epubSourceId) {
    try {
      backupData.epub_source = await readEpubSourceForBackup(backupData.epubSourceId);
    } catch (err: any) {
      alert(`Backup dibuat tanpa file EPUB asli.\n\n${err.message}`);
    }
  }
  const strData = JSON.stringify(backupData);
  const b = new Blob([strData], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  a.download = `${safeName}_backup${PROJECT_EXT}`;
  a.click();
}

// ─── OPFS persistence ─────────────────────────────────────────────────────────
export async function saveProjectToOpfs(id: string, dataObj: any): Promise<void> {
  try {
    dataObj.updatedAt = Date.now();
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(id, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dataObj));
    await writable.close();
  } catch (_) {
    flashHint('Gagal menyimpan ke storage!');
  }
}

export function queueAutoSave(): void {
  if (!state.currentProjectId) return;
  clearTimeout(getSaveTimeout()!);
  setSaveTimeout(setTimeout(async () => {
    const data = {
      version: APP_VERSION, projectName: state.projectName, projectType: state.projectType,
      translationMode: state.translationMode || 'ai', jsonRefLang: state.jsonRefLang || '',
      epubTags: state.epubTags, epubSourceId: state.epubSourceId,
      lucaExportLang: state.lucaExportLang,
      luca_profile: state.lucaProfile || DEFAULT_LUCA_PROFILE,
      luca_mc_display_name: state.lucaMcDisplayName || DEFAULT_LUCA_MC_DISPLAY_NAME,
      lucaRawFiles: state.lucaRawFiles, lucaRawBuffers: state.lucaRawBuffers,
      regex_filter: state.regexFilter, disable_empty_line_validation: state.disableEmptyLineValidation,
      check_kana_residue: state.checkKanaResidue, check_similarity: state.checkSimilarity,
      similarity_threshold: state.similarityThreshold,
      imported_files: state.importedFiles, lines: state.lines,
      prompt_header: state.aiInstructionHeader,
      ai_translation_format: state.aiTranslationFormat || DEFAULT_AI_TRANSLATION_FORMAT,
      glossary_prompt: state.glossaryPrompt, ai_check_prompt: state.aiCheckPrompt,
      glossary_text: state.glossaryText, context_lines: state.contextLines,
      context_type: state.contextType, selection_batch_size: state.selectionBatchSize,
      glossary_batch_size: state.glossaryBatchSize, ai_check_batch_size: state.aiCheckBatchSize,
      selection_batch_prev_shortcut: state.selectionBatchPrevShortcut,
      selection_batch_next_shortcut: state.selectionBatchNextShortcut,
    };
    await saveProjectToOpfs(state.currentProjectId!, data);
    (ui.statusBar as HTMLElement).textContent = (ui.statusBar as HTMLElement).textContent!.replace(' | Tersimpan!', '') + ' | Tersimpan!';
    setTimeout(() => { updateStatusBar(); }, 2000);
  }, 1000));
}

// ─── Open / Close project ─────────────────────────────────────────────────────
export function openProject(id: string, data: any): void {
  state.currentProjectId = id;
  state.projectName = data.projectName || 'Unknown Project';
  state.projectType = data.projectType || 'json';
  state.translationMode = data.translationMode || 'ai';
  state.jsonRefLang = data.jsonRefLang || '';
  state.epubTags = data.epubTags || 'p';
  state.epubSourceId = data.epubSourceId || null;
  state.lucaExportLang = data.lucaExportLang || 'en';
  state.lucaProfile = data.luca_profile || DEFAULT_LUCA_PROFILE;
  state.lucaMcDisplayName = data.luca_mc_display_name || DEFAULT_LUCA_MC_DISPLAY_NAME;
  state.lucaRawFiles = data.lucaRawFiles || {};
  state.lucaRawBuffers = data.lucaRawBuffers || {};
  clearLucaFileLineBytesCache();
  state.regexFilter = data.regex_filter || '';
  state.disableEmptyLineValidation = !!data.disable_empty_line_validation;
  state.checkKanaResidue = !!data.check_kana_residue;
  state.checkSimilarity = !!data.check_similarity;
  state.similarityThreshold = (typeof data.similarity_threshold === 'number' && data.similarity_threshold > 0 && data.similarity_threshold < 1)
    ? data.similarity_threshold : 0.7;
  state.lines = (data.lines || []).map(normalizeLineDict);
  state.importedFiles = data.imported_files || [];
  state.aiInstructionHeader = data.prompt_header || DEFAULT_PROMPT_HEADER;
  state.aiTranslationFormat = data.ai_translation_format != null
    ? normalizeAiTranslationFormat(data.ai_translation_format)
    : DEFAULT_AI_TRANSLATION_FORMAT;
  state.glossaryPrompt = data.glossary_prompt || DEFAULT_GLOSSARY_PROMPT;
  state.aiCheckPrompt = data.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT;
  state.glossaryText = data.glossary_text || '';
  state.contextLines = data.context_lines !== undefined ? data.context_lines : 10;
  state.contextType = data.context_type || 'raw';
  state.selectionBatchSize = normalizeSelectionBatchSize(data.selection_batch_size);
  state.glossaryBatchSize = normalizeSelectionBatchSize(data.glossary_batch_size, DEFAULT_GLOSSARY_BATCH_SIZE);
  state.aiCheckBatchSize = normalizeSelectionBatchSize(data.ai_check_batch_size, DEFAULT_AI_CHECK_BATCH_SIZE);
  state.selectionBatchPrevShortcut = normalizeShortcutString(data.selection_batch_prev_shortcut, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT);
  state.selectionBatchNextShortcut = normalizeShortcutString(data.selection_batch_next_shortcut, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT);
  state.selectedLines.clear();
  state.undoStack = [];
  state.aiCheckCorrections = [];
  state.activeWorkspaceTab = 'translate';
  resetSelectionHistory();
  if (ui.pasteAiCheckArea) (ui.pasteAiCheckArea as HTMLTextAreaElement).value = '';
  if (ui.aiCheckResults) (ui.aiCheckResults as HTMLElement).textContent = '';
  (ui.projectNameDisplay as HTMLElement).textContent = state.translationMode === 'htl'
    ? `${state.projectName} [HTL]`
    : state.projectName;
  (ui.dashboardView as HTMLElement).classList.remove('open');
  (ui.workspaceView as HTMLElement).style.display = 'flex';
  refreshAll();
  applyHtlMode();
  switchWorkspaceTab('translate');
}

export function closeProject(): void {
  if (getSaveTimeout()) {
    clearTimeout(getSaveTimeout()!);
    const data: Record<string, any> = {
      version: APP_VERSION, projectName: state.projectName, projectType: state.projectType,
      translationMode: state.translationMode || 'ai', jsonRefLang: state.jsonRefLang || '',
      epubTags: state.epubTags, epubSourceId: state.epubSourceId,
      lucaExportLang: state.lucaExportLang, luca_profile: state.lucaProfile || DEFAULT_LUCA_PROFILE,
      luca_mc_display_name: state.lucaMcDisplayName || DEFAULT_LUCA_MC_DISPLAY_NAME,
      lucaRawFiles: state.lucaRawFiles, lucaRawBuffers: state.lucaRawBuffers,
      regex_filter: state.regexFilter, disable_empty_line_validation: state.disableEmptyLineValidation,
      check_kana_residue: state.checkKanaResidue, check_similarity: state.checkSimilarity,
      similarity_threshold: state.similarityThreshold,
      imported_files: state.importedFiles, lines: state.lines,
      prompt_header: state.aiInstructionHeader,
      ai_translation_format: state.aiTranslationFormat || DEFAULT_AI_TRANSLATION_FORMAT,
      glossary_prompt: state.glossaryPrompt, ai_check_prompt: state.aiCheckPrompt,
      glossary_text: state.glossaryText, context_lines: state.contextLines, context_type: state.contextType,
      selection_batch_size: state.selectionBatchSize, glossary_batch_size: state.glossaryBatchSize,
      ai_check_batch_size: state.aiCheckBatchSize,
      selection_batch_prev_shortcut: state.selectionBatchPrevShortcut,
      selection_batch_next_shortcut: state.selectionBatchNextShortcut,
    };
    saveProjectToOpfs(state.currentProjectId!, data).then(() => finishClose());
  } else {
    finishClose();
  }
}

export function finishClose(): void {
  state.currentProjectId = null;
  state.lines = [];
  state.selectedLines.clear();
  resetSelectionHistory();
  (ui.workspaceView as HTMLElement).style.display = 'none';
  (ui.dashboardView as HTMLElement).classList.add('open');
  loadDashboardProjects();
}

export async function onRestoreProject(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  const f = target.files?.[0];
  target.value = '';
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    const name = p.projectName || f.name.replace(PROJECT_EXT, '');
    const id = 'proj_' + Date.now() + PROJECT_EXT;
    let restoredEpubSourceId = p.epubSourceId || null;
    let restoreNote = '';
    if ((p.projectType || 'json') === 'epub') {
      if (p.epub_source?.data) {
        restoredEpubSourceId = await writeEpubSourceFromBackup(p.epub_source);
      } else if (p.epubSourceId) {
        try {
          restoredEpubSourceId = await cloneExistingEpubSource(p.epubSourceId);
        } catch (_) {
          restoredEpubSourceId = null;
          restoreNote = '\n\nCatatan: backup lama ini tidak menyimpan file EPUB asli.';
        }
      }
    }
    const safeData: Record<string, any> = {
      version: APP_VERSION, projectName: name, projectType: p.projectType || 'json',
      translationMode: p.translationMode || 'ai', jsonRefLang: p.jsonRefLang || '',
      epubTags: p.epubTags || 'p', epubSourceId: restoredEpubSourceId,
      lucaExportLang: p.lucaExportLang || 'en', luca_profile: p.luca_profile || DEFAULT_LUCA_PROFILE,
      lucaRawFiles: p.lucaRawFiles || {}, lucaRawBuffers: p.lucaRawBuffers || {},
      updatedAt: Date.now(), regex_filter: p.regex_filter || '',
      disable_empty_line_validation: !!p.disable_empty_line_validation,
      check_kana_residue: !!p.check_kana_residue, check_similarity: !!p.check_similarity,
      similarity_threshold: (typeof p.similarity_threshold === 'number' && p.similarity_threshold > 0 && p.similarity_threshold < 1) ? p.similarity_threshold : 0.7,
      imported_files: p.imported_files || [],
      lines: (p.lines || []).map(normalizeLineDict),
      prompt_header: p.prompt_header || DEFAULT_PROMPT_HEADER,
      ai_translation_format: p.ai_translation_format != null ? normalizeAiTranslationFormat(p.ai_translation_format) : DEFAULT_AI_TRANSLATION_FORMAT,
      glossary_prompt: p.glossary_prompt || DEFAULT_GLOSSARY_PROMPT,
      ai_check_prompt: p.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT,
      glossary_text: p.glossary_text || '', context_lines: p.context_lines !== undefined ? p.context_lines : 10,
      context_type: p.context_type || 'raw',
      selection_batch_size: normalizeSelectionBatchSize(p.selection_batch_size),
      glossary_batch_size: normalizeSelectionBatchSize(p.glossary_batch_size, DEFAULT_GLOSSARY_BATCH_SIZE),
      ai_check_batch_size: normalizeSelectionBatchSize(p.ai_check_batch_size, DEFAULT_AI_CHECK_BATCH_SIZE),
      selection_batch_prev_shortcut: normalizeShortcutString(p.selection_batch_prev_shortcut, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT),
      selection_batch_next_shortcut: normalizeShortcutString(p.selection_batch_next_shortcut, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT),
    };
    await saveProjectToOpfs(id, safeData);
    loadDashboardProjects();
    alert(`Proyek "${name}" berhasil dipulihkan!${restoreNote}`);
  } catch (e: any) {
    alert('File backup korup atau tidak valid: ' + e.message);
  }
}
