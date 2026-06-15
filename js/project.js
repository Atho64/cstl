// @module project.js — Project management, OPFS persistence, dashboard, backup & restore

import { state, ui, setSaveTimeout, getSaveTimeout, getOpfsRoot } from './state.js';
import {
  APP_VERSION, PROJECT_EXT,
  DEFAULT_PROMPT_HEADER, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT,
  DEFAULT_LUCA_MC_DISPLAY_NAME,
  DEFAULT_AI_TRANSLATION_FORMAT,
  DEFAULT_SELECTION_BATCH_SIZE, DEFAULT_GLOSSARY_BATCH_SIZE, DEFAULT_AI_CHECK_BATCH_SIZE,
  DEFAULT_SELECTION_BATCH_PREV_SHORTCUT, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT,
} from './constants.js';
import {
  DEFAULT_LUCA_PROFILE,
  clearLucaFileLineBytesCache,
  normalizeAiTranslationFormat,
} from './luca-engine.js';
import {
  arrayBufferToBase64,
  readEpubSourceForBackup,
  writeEpubSourceFromBackup,
  cloneExistingEpubSource,
} from './binary-utils.js';
import { resetSelectionHistory, switchWorkspaceTab } from './selection.js';
import { normalizeLineDict } from './state.js';
import { normalizeShortcutString } from './shortcuts.js';

// ─── Lazy render helpers (breaks render.js ↔ project.js circular dep) ─────────
async function refreshAll() { return (await import('./render.js')).refreshAll(); }
async function flashHint(msg, keepAlive) { return (await import('./render.js')).flashHint(msg, keepAlive); }
async function updateButtonStates() { return (await import('./render.js')).updateButtonStates(); }
async function updateStatusBar() { return (await import('./render.js')).updateStatusBar(); }


// ─── Modal helpers ────────────────────────────────────────────────────────────
export function openModal(el) { el.classList.add("open"); }
export function closeModal(el) { el.classList.remove("open"); }

// ─── Debounce ─────────────────────────────────────────────────────────────────
export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ─── Dashboard default settings ───────────────────────────────────────────────
export const DS_STORAGE_KEY = "cstl_default_settings";

export function getDefaultSettings() {
  try {
    const saved = localStorage.getItem(DS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return {
    sourceLang: "Japanese",
    targetLang: "Indonesian",
    aiFormat: DEFAULT_AI_TRANSLATION_FORMAT,
    contextLines: 10,
    selectionBatch: DEFAULT_SELECTION_BATCH_SIZE,
    glossaryBatch: DEFAULT_GLOSSARY_BATCH_SIZE,
    aiCheckBatch: DEFAULT_AI_CHECK_BATCH_SIZE,
    regexFilter: ""
  };
}

export function openDashboardSettings() {
  const d = getDefaultSettings();
  ui.dsSourceLang.value = d.sourceLang;
  ui.dsTargetLang.value = d.targetLang;
  ui.dsAiFormat.value = d.aiFormat;
  ui.dsContextLines.value = d.contextLines;
  ui.dsSelectionBatch.value = d.selectionBatch;
  ui.dsGlossaryBatch.value = d.glossaryBatch;
  ui.dsAiCheckBatch.value = d.aiCheckBatch;
  ui.dsRegexFilter.value = d.regexFilter || "";
  ui.dashboardSettingsModal.classList.add("open");
}

export function saveDashboardSettings() {
  const d = {
    sourceLang: ui.dsSourceLang.value,
    targetLang: ui.dsTargetLang.value,
    aiFormat: ui.dsAiFormat.value,
    contextLines: parseInt(ui.dsContextLines.value) || 10,
    selectionBatch: parseInt(ui.dsSelectionBatch.value) || DEFAULT_SELECTION_BATCH_SIZE,
    glossaryBatch: parseInt(ui.dsGlossaryBatch.value) || DEFAULT_GLOSSARY_BATCH_SIZE,
    aiCheckBatch: parseInt(ui.dsAiCheckBatch.value) || DEFAULT_AI_CHECK_BATCH_SIZE,
    regexFilter: ui.dsRegexFilter.value || ""
  };
  localStorage.setItem(DS_STORAGE_KEY, JSON.stringify(d));
  ui.dashboardSettingsModal.classList.remove("open");
}

export function resetDashboardSettings() {
  localStorage.removeItem(DS_STORAGE_KEY);
  const d = getDefaultSettings();
  ui.dsSourceLang.value = d.sourceLang;
  ui.dsTargetLang.value = d.targetLang;
  ui.dsAiFormat.value = d.aiFormat;
  ui.dsContextLines.value = d.contextLines;
  ui.dsSelectionBatch.value = d.selectionBatch;
  ui.dsGlossaryBatch.value = d.glossaryBatch;
  ui.dsAiCheckBatch.value = d.aiCheckBatch;
  ui.dsRegexFilter.value = d.regexFilter;
}

// ─── Dashboard project list ───────────────────────────────────────────────────
export async function loadDashboardProjects() {
  state.dashboardProjects = [];
  ui.projectList.textContent = "";
  try {
    const root = await getOpfsRoot();
    const projects = [];
    for await (const [name, handle] of root.entries()) {
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
            data: data
          });
        } catch(e) {}
      }
    }
    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    state.dashboardProjects = projects;
    renderDashboardProjects();
  } catch (err) {
    renderDashboardMessage("Gagal mengakses storage browser.", true);
  }
}

export function renderDashboardMessage(message, isError = false) {
  ui.projectList.textContent = "";
  const p = document.createElement("p");
  p.className = "hint";
  p.style.gridColumn = "1/-1";
  if (isError) p.style.color = "var(--danger)";
  p.textContent = message;
  ui.projectList.appendChild(p);
}

export function createProjectButton(label, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

export function renderDashboardProjects() {
  const query = (ui.projectFilterInput.value || "").trim().toLowerCase();
  const projects = query
    ? state.dashboardProjects.filter(p => p.name.toLowerCase().includes(query))
    : state.dashboardProjects;

  ui.projectList.textContent = "";
  if (state.dashboardProjects.length === 0) {
    renderDashboardMessage('Belum ada proyek. Klik "Buat Proyek Baru" untuk memulai.');
    return;
  }
  if (projects.length === 0) {
    renderDashboardMessage("Tidak ada proyek yang cocok dengan filter.");
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of projects) {
    const card = document.createElement("div");
    card.className = "project-card";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = p.name;
    info.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "project-meta mt-2";
    if (p.fileCount > 0 || p.lineCount > 0) {
      const badgeWrap = document.createElement("div");
      badgeWrap.style.marginBottom = "8px";
      const badge = document.createElement("span");
      badge.className = p.data.projectType === "epub" ? "badge badge-epub" : p.data.projectType === "luca" ? "badge badge-luca" : "badge badge-json";
      badge.textContent = p.data.projectType === "epub" ? "EPUB" : p.data.projectType === "luca" ? "TXT LUCA" : "JSON VNTP";
      badgeWrap.appendChild(badge);
      meta.appendChild(badgeWrap);
    }
    meta.append(
      document.createTextNode(`Terakhir diubah: ${new Date(p.updatedAt).toLocaleString("id-ID")}`),
      document.createElement("br"),
      document.createTextNode(`File: ${p.fileCount} | Baris: ${p.lineCount}`)
    );
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "project-actions";
    actions.append(
      createProjectButton("Buka", "btn btn-primary btn-sm", () => openProject(p.id, p.data)),
      createProjectButton("Ubah Nama", "btn btn-outline btn-sm", () => renameDashboardProject(p.id, p.name, p.data)),
      createProjectButton("Backup", "btn btn-outline btn-sm", () => backupDashboardProject(p.name, p.data)),
      createProjectButton("Hapus", "btn btn-danger btn-sm", () => deleteProject(p.id, p.data))
    );

    card.append(info, actions);
    frag.appendChild(card);
  }
  ui.projectList.appendChild(frag);
}

// ─── Project CRUD ─────────────────────────────────────────────────────────────
export async function createNewProject() {
  const name = prompt("Masukkan nama proyek baru:");
  if (!name || !name.trim()) return;
  const id = "proj_" + Date.now() + PROJECT_EXT;
  const d = getDefaultSettings();
  const initialData = {
    version: APP_VERSION,
    projectName: name.trim(),
    projectType: "json",
    epubTags: "p",
    epubSourceId: null,
    lucaExportLang: "en",
    luca_profile: DEFAULT_LUCA_PROFILE,
    luca_mc_display_name: DEFAULT_LUCA_MC_DISPLAY_NAME,
    lucaRawFiles: {},
    lucaRawBuffers: {},
    updatedAt: Date.now(),
    source_lang: d.sourceLang,
    target_lang: d.targetLang,
    regex_filter: d.regexFilter || "",
    disable_empty_line_validation: false,
    check_kana_residue: false,
    check_similarity: false,
    similarity_threshold: 0.7,
    imported_files: [],
    lines: [],
    prompt_header: DEFAULT_PROMPT_HEADER,
    ai_translation_format: d.aiFormat,
    glossary_prompt: DEFAULT_GLOSSARY_PROMPT,
    ai_check_prompt: DEFAULT_AI_CHECK_PROMPT,
    glossary_text: "",
    context_lines: d.contextLines,
    selection_batch_size: d.selectionBatch,
    glossary_batch_size: d.glossaryBatch,
    ai_check_batch_size: d.aiCheckBatch,
    selection_batch_prev_shortcut: DEFAULT_SELECTION_BATCH_PREV_SHORTCUT,
    selection_batch_next_shortcut: DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT
  };
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(id, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(initialData));
    await writable.close();
    openProject(id, initialData);
  } catch (e) {
    alert("Gagal membuat proyek: " + e.message);
  }
}

export async function deleteProject(id, data) {
  if (!confirm("Hapus proyek ini secara permanen?")) return;
  try {
    const root = await getOpfsRoot();
    if (data.epubSourceId) {
      try { await root.removeEntry(data.epubSourceId); } catch(e) {}
    }
    await root.removeEntry(id);
    loadDashboardProjects();
  } catch (e) {
    alert("Gagal menghapus: " + e.message);
  }
}

export async function renameDashboardProject(id, oldName, data) {
  const newName = prompt("Masukkan nama baru untuk proyek:", oldName);
  if (!newName || newName.trim() === "" || newName === oldName) return;
  data.projectName = newName.trim();
  await saveProjectToOpfs(id, data);
  loadDashboardProjects();
}

// ─── Backup & Restore ─────────────────────────────────────────────────────────
export async function backupDashboardProject(name, data) {
  const backupData = JSON.parse(JSON.stringify(data));
  if (backupData.projectType === "epub" && backupData.epubSourceId) {
    try {
      backupData.epub_source = await readEpubSourceForBackup(backupData.epubSourceId);
    } catch (err) {
      alert(`Backup dibuat tanpa file EPUB asli karena sumber EPUB tidak bisa dibaca.\n\n${err.message}`);
    }
  }
  const strData = JSON.stringify(backupData);
  const b = new Blob([strData], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  a.download = `${safeName}_backup${PROJECT_EXT}`;
  a.click();
}

// ─── OPFS persistence ─────────────────────────────────────────────────────────
export async function saveProjectToOpfs(id, dataObj) {
  try {
    dataObj.updatedAt = Date.now();
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(id, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dataObj));
    await writable.close();
  } catch (e) {
    flashHint("Gagal menyimpan ke storage!");
  }
}

export function queueAutoSave() {
  if (!state.currentProjectId) return;
  clearTimeout(getSaveTimeout());
  setSaveTimeout(setTimeout(async () => {
    const data = {
      version: APP_VERSION,
      projectName: state.projectName,
      projectType: state.projectType,
      epubTags: state.epubTags,
      epubSourceId: state.epubSourceId,
      lucaExportLang: state.lucaExportLang,
      luca_profile: state.lucaProfile || DEFAULT_LUCA_PROFILE,
      luca_mc_display_name: state.lucaMcDisplayName || DEFAULT_LUCA_MC_DISPLAY_NAME,
      lucaRawFiles: state.lucaRawFiles,
      lucaRawBuffers: state.lucaRawBuffers,
      regex_filter: state.regexFilter,
      disable_empty_line_validation: state.disableEmptyLineValidation,
      check_kana_residue: state.checkKanaResidue,
      check_similarity: state.checkSimilarity,
      similarity_threshold: state.similarityThreshold,
      imported_files: state.importedFiles,
      lines: state.lines,
      prompt_header: state.aiInstructionHeader,
      ai_translation_format: state.aiTranslationFormat || DEFAULT_AI_TRANSLATION_FORMAT,
      glossary_prompt: state.glossaryPrompt,
      ai_check_prompt: state.aiCheckPrompt,
      glossary_text: state.glossaryText,
      context_lines: state.contextLines,
      selection_batch_size: state.selectionBatchSize,
      glossary_batch_size: state.glossaryBatchSize,
      ai_check_batch_size: state.aiCheckBatchSize,
      selection_batch_prev_shortcut: state.selectionBatchPrevShortcut,
      selection_batch_next_shortcut: state.selectionBatchNextShortcut
    };
    await saveProjectToOpfs(state.currentProjectId, data);
    ui.statusBar.textContent = ui.statusBar.textContent.replace(" | Tersimpan!", "") + " | Tersimpan!";
    setTimeout(() => {
      updateStatusBar();
    }, 2000);
  }, 1000));
}

// ─── Open / Close project ─────────────────────────────────────────────────────
export function openProject(id, data) {
  state.currentProjectId = id;
  state.projectName = data.projectName || "Unknown Project";
  state.projectType = data.projectType || "json";
  state.epubTags = data.epubTags || "p";
  state.epubSourceId = data.epubSourceId || null;
  state.lucaExportLang = data.lucaExportLang || "en";
  state.lucaProfile = data.luca_profile || DEFAULT_LUCA_PROFILE;
  state.lucaMcDisplayName = data.luca_mc_display_name || DEFAULT_LUCA_MC_DISPLAY_NAME;
  state.lucaRawFiles = data.lucaRawFiles || {};
  state.lucaRawBuffers = data.lucaRawBuffers || {};
  clearLucaFileLineBytesCache();
  state.regexFilter = data.regex_filter || "";
  state.disableEmptyLineValidation = !!data.disable_empty_line_validation;
  state.checkKanaResidue = !!data.check_kana_residue;
  state.checkSimilarity = !!data.check_similarity;
  state.similarityThreshold = (typeof data.similarity_threshold === "number" && data.similarity_threshold > 0 && data.similarity_threshold < 1)
    ? data.similarity_threshold : 0.7;
  state.lines = (data.lines || []).map(normalizeLineDict);
  state.importedFiles = data.imported_files || [];
  state.aiInstructionHeader = data.prompt_header || DEFAULT_PROMPT_HEADER;
  state.aiTranslationFormat = data.ai_translation_format != null
    ? normalizeAiTranslationFormat(data.ai_translation_format)
    : DEFAULT_AI_TRANSLATION_FORMAT;
  state.glossaryPrompt = data.glossary_prompt || DEFAULT_GLOSSARY_PROMPT;
  state.aiCheckPrompt = data.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT;
  state.glossaryText = data.glossary_text || "";
  state.contextLines = data.context_lines !== undefined ? data.context_lines : 10;
  state.selectionBatchSize = normalizeSelectionBatchSize(data.selection_batch_size);
  state.glossaryBatchSize = normalizeSelectionBatchSize(data.glossary_batch_size, DEFAULT_GLOSSARY_BATCH_SIZE);
  state.aiCheckBatchSize = normalizeSelectionBatchSize(data.ai_check_batch_size, DEFAULT_AI_CHECK_BATCH_SIZE);
  state.selectionBatchPrevShortcut = normalizeShortcutString(data.selection_batch_prev_shortcut, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT);
  state.selectionBatchNextShortcut = normalizeShortcutString(data.selection_batch_next_shortcut, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT);
  state.selectedLines.clear();
  state.undoStack = [];
  state.aiCheckCorrections = [];
  state.activeWorkspaceTab = "translate";
  resetSelectionHistory();
  if (ui.pasteAiCheckArea) ui.pasteAiCheckArea.value = "";
  if (ui.aiCheckResults) ui.aiCheckResults.textContent = "";
  ui.projectNameDisplay.textContent = state.projectName;

  ui.dashboardView.classList.remove("open");
  ui.workspaceView.style.display = "flex";

  refreshAll();
  switchWorkspaceTab("translate");
}

export function closeProject() {
  if (getSaveTimeout()) {
    clearTimeout(getSaveTimeout());
    const data = {
      version: APP_VERSION, projectName: state.projectName,
      projectType: state.projectType, epubTags: state.epubTags, epubSourceId: state.epubSourceId,
      lucaExportLang: state.lucaExportLang,
      luca_profile: state.lucaProfile || DEFAULT_LUCA_PROFILE,
      luca_mc_display_name: state.lucaMcDisplayName || DEFAULT_LUCA_MC_DISPLAY_NAME,
      lucaRawFiles: state.lucaRawFiles,
      lucaRawBuffers: state.lucaRawBuffers,
      regex_filter: state.regexFilter,
      disable_empty_line_validation: state.disableEmptyLineValidation,
      check_kana_residue: state.checkKanaResidue,
      check_similarity: state.checkSimilarity,
      similarity_threshold: state.similarityThreshold,
      imported_files: state.importedFiles, lines: state.lines,
      prompt_header: state.aiInstructionHeader,
      ai_translation_format: state.aiTranslationFormat || DEFAULT_AI_TRANSLATION_FORMAT,
      glossary_prompt: state.glossaryPrompt,
      ai_check_prompt: state.aiCheckPrompt,
      glossary_text: state.glossaryText,
      context_lines: state.contextLines,
      selection_batch_size: state.selectionBatchSize,
      glossary_batch_size: state.glossaryBatchSize,
      ai_check_batch_size: state.aiCheckBatchSize,
      selection_batch_prev_shortcut: state.selectionBatchPrevShortcut,
      selection_batch_next_shortcut: state.selectionBatchNextShortcut
    };
    saveProjectToOpfs(state.currentProjectId, data).then(() => {
      finishClose();
    });
  } else {
    finishClose();
  }
}

export function finishClose() {
  state.currentProjectId = null;
  state.lines = [];
  state.selectedLines.clear();
  resetSelectionHistory();
  ui.workspaceView.style.display = "none";
  ui.dashboardView.classList.add("open");
  loadDashboardProjects();
}

export async function onRestoreProject(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = "";
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    const name = p.projectName || f.name.replace(PROJECT_EXT, '');
    const id = "proj_" + Date.now() + PROJECT_EXT;
    let restoredEpubSourceId = p.epubSourceId || null;
    let restoreNote = "";
    if ((p.projectType || "json") === "epub") {
      if (p.epub_source?.data) {
        restoredEpubSourceId = await writeEpubSourceFromBackup(p.epub_source);
      } else if (p.epubSourceId) {
        try {
          restoredEpubSourceId = await cloneExistingEpubSource(p.epubSourceId);
        } catch (_) {
          restoredEpubSourceId = null;
          restoreNote = "\n\nCatatan: backup lama ini tidak menyimpan file EPUB asli, dan sumber EPUB lama tidak ditemukan. Teks proyek tetap dipulihkan, tapi export EPUB/ruby extraction butuh backup baru yang menyertakan EPUB.";
        }
      }
    }
    const safeData = {
      version: APP_VERSION,
      projectName: name,
      projectType: p.projectType || "json",
      epubTags: p.epubTags || "p",
      epubSourceId: restoredEpubSourceId,
      lucaExportLang: p.lucaExportLang || "en",
      luca_profile: p.luca_profile || DEFAULT_LUCA_PROFILE,
      lucaRawFiles: p.lucaRawFiles || {},
      lucaRawBuffers: p.lucaRawBuffers || {},
      updatedAt: Date.now(),
      regex_filter: p.regex_filter || "",
      disable_empty_line_validation: !!p.disable_empty_line_validation,
      check_kana_residue: !!p.check_kana_residue,
      check_similarity: !!p.check_similarity,
      similarity_threshold: (typeof p.similarity_threshold === "number" && p.similarity_threshold > 0 && p.similarity_threshold < 1) ? p.similarity_threshold : 0.7,
      imported_files: p.imported_files || [],
      lines: (p.lines || []).map(normalizeLineDict),
      prompt_header: p.prompt_header || DEFAULT_PROMPT_HEADER,
      ai_translation_format: p.ai_translation_format != null
        ? normalizeAiTranslationFormat(p.ai_translation_format)
        : DEFAULT_AI_TRANSLATION_FORMAT,
      glossary_prompt: p.glossary_prompt || DEFAULT_GLOSSARY_PROMPT,
      ai_check_prompt: p.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT,
      glossary_text: p.glossary_text || "",
      context_lines: p.context_lines !== undefined ? p.context_lines : 10,
      selection_batch_size: normalizeSelectionBatchSize(p.selection_batch_size),
      glossary_batch_size: normalizeSelectionBatchSize(p.glossary_batch_size, DEFAULT_GLOSSARY_BATCH_SIZE),
      ai_check_batch_size: normalizeSelectionBatchSize(p.ai_check_batch_size, DEFAULT_AI_CHECK_BATCH_SIZE),
      selection_batch_prev_shortcut: normalizeShortcutString(p.selection_batch_prev_shortcut, DEFAULT_SELECTION_BATCH_PREV_SHORTCUT),
      selection_batch_next_shortcut: normalizeShortcutString(p.selection_batch_next_shortcut, DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT)
    };
    await saveProjectToOpfs(id, safeData);
    loadDashboardProjects();
    alert(`Proyek "${name}" berhasil dipulihkan!${restoreNote}`);
  } catch (e) {
    alert("File backup korup atau tidak valid: " + e.message);
  }
}

// ─── Batch size helpers ───────────────────────────────────────────────────────
export function normalizeSelectionBatchSize(value, fallback = DEFAULT_SELECTION_BATCH_SIZE) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
