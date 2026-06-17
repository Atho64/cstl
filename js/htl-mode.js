// @module htl-mode.js — HTL (Human Translation) mode toggle & reference language panel

import { state, ui } from './state.js';
import { parseJsonFromFileObject, parseJsonEntries } from './luca-engine.js';
import { switchWorkspaceTab } from './selection.js';
import { refreshAll, flashHint } from './render.js';
import { queueAutoSave } from './project.js';

const REFLANG_1 = "ref_lang_1";
const REFLANG_2 = "ref_lang_2";

function isHtl() {
  return state.translationMode === "htl";
}

// ─── HTL visibility toggle ────────────────────────────────────────────────────

export function applyHtlMode() {
  const htl = isHtl();
  document.body.classList.toggle("htl-mode", htl);

  // Hide every element marked data-htl-hide
  for (const el of document.querySelectorAll("[data-htl-hide]")) {
    el.style.display = htl ? "none" : "";
  }
  // Show every element marked data-htl-show when htl is active
  for (const el of document.querySelectorAll("[data-htl-show]")) {
    el.style.display = htl ? "block" : "none";
  }

  // If currently on an AI-only tab, force back to translate (HTL doesn't have those tabs)
  if (htl && (state.activeWorkspaceTab === "glossary" || state.activeWorkspaceTab === "aiCheck")) {
    switchWorkspaceTab("translate");
  }
  // In HTL mode, the bottom right panel "Area Kerja" can be collapsed via a body class
  // CSS will handle the actual hiding of the bottom AI translation box for mobile

  // Update the right panel "Area Kerja" header label
  const panelTitle = document.querySelector(".panel-right .panel-title");
  if (panelTitle) panelTitle.textContent = htl ? "Mode HTL" : "Area Kerja";

  updateHtlRefLangPanels();
}

function updateHtlRefLangPanels() {
  if (!isHtl()) return;
  const has1 = state.lines.some(l => l.ref_lang_1 != null);
  const has2 = state.lines.some(l => l.ref_lang_2 != null);

  const box1 = document.getElementById("htlRefLang1Box");
  const box2 = document.getElementById("htlRefLang2Box");
  const text1 = document.getElementById("htlRefLang1Text");
  const text2 = document.getElementById("htlRefLang2Text");

  if (box1) box1.style.display = has1 ? "block" : "none";
  if (box2) box2.style.display = has2 ? "block" : "none";

  if (has1 && text1) {
    const out = [];
    for (const l of state.lines) {
      if (l.ref_lang_1 == null) continue;
      const nm = l.name ? `${l.name}: ` : "";
      out.push(`${l.line_num}. ${nm}${l.ref_lang_1}`);
    }
    text1.textContent = out.join("\n");
  }
  if (has2 && text2) {
    const out = [];
    for (const l of state.lines) {
      if (l.ref_lang_2 == null) continue;
      const nm = l.name ? `${l.name}: ` : "";
      out.push(`${l.line_num}. ${nm}${l.ref_lang_2}`);
    }
    text2.textContent = out.join("\n");
  }
}

// ─── Reference language import (JSON, position-matched) ───────────────────────

async function applyRefJsonToLines(slot, json) {
  if (!Array.isArray(json)) throw new Error("File JSON harus berupa array of {name, message}.");
  if (json.length === 0) throw new Error("File JSON kosong.");
  const cur = state.lines.length;
  const limit = Math.min(json.length, cur);
  let applied = 0;
  for (let i = 0; i < limit; i++) {
    const entry = json[i];
    if (!entry || typeof entry !== "object") continue;
    const msg = entry.message != null ? String(entry.message).replace(/\r?\n/g, "\\n").trim() : "";
    const name = entry.name != null ? String(entry.name).replace(/\r?\n/g, "\\n").trim() : null;
    const line = state.lines[i];
    if (!line) continue;
    if (slot === 1) {
      line.ref_lang_1 = msg || null;
      line.ref_lang_1_name = name;
    } else {
      line.ref_lang_2 = msg || null;
      line.ref_lang_2_name = name;
    }
    if (msg) applied++;
  }
  return applied;
}

// Match a ref file's basename to a project's imported file basename
function findProjectFileNameForRef(refFile) {
  // Get the candidate basenames for this ref file
  const candidates = new Set();
  const nameNoExt = refFile.name.replace(/\.(json|xhtml|html|txt)$/i, "");
  candidates.add(nameNoExt.toLowerCase());
  // Also consider webkitRelativePath (e.g. "RefFolder/sub/script1.json")
  if (refFile.webkitRelativePath) {
    const relNoExt = refFile.webkitRelativePath.replace(/\.(json|xhtml|html|txt)$/i, "");
    candidates.add(relNoExt.toLowerCase());
    // And the basename of the relative path
    const relBase = relNoExt.split("/").pop();
    if (relBase) candidates.add(relBase.toLowerCase());
  }
  for (const f of state.importedFiles) {
    const fLower = f.toLowerCase();
    const fNoExt = fLower.replace(/\.(json|xhtml|html|txt)$/i, "");
    if (candidates.has(fNoExt) || candidates.has(fLower)) return f;
  }
  return null;
}

async function importRefJson(slot, file) {
  if (state.projectType !== "json") {
    return alert("Referensi bahasa tambahan hanya untuk proyek JSON VNTP.");
  }
  if (!state.lines.length) {
    return alert("Impor file sumber JSON dulu sebelum impor referensi.");
  }
  try {
    const json = await parseJsonFromFileObject(file);
    const applied = await applyRefJsonToLines(slot, json);
    refreshAll();
    queueAutoSave();
    flashHint(`Berhasil impor ${applied} baris Referensi ${slot} (${file.name}).`);
  } catch (err) {
    alert(`Gagal impor Referensi ${slot}: ${err.message}`);
  }
}

async function importRefJsonFolder(slot, files) {
  if (!state.lines.length) {
    return alert("Impor file sumber JSON dulu sebelum impor referensi.");
  }
  const jsonFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".json"));
  console.log("[Ref Folder Import] json files:", jsonFiles.map(f => f.name));
  if (jsonFiles.length === 0) {
    return alert("Tidak ada file JSON dalam folder.");
  }
  // Group project lines by file so we can match each ref file by basename
  const linesByFile = new Map();
  for (const l of state.lines) {
    if (!linesByFile.has(l.file)) linesByFile.set(l.file, []);
    linesByFile.get(l.file).push(l);
  }
  let totalApplied = 0;
  const matched = [];
  const unmatched = [];
  const errors = [];
  for (const f of jsonFiles) {
    const targetFile = findProjectFileNameForRef(f);
    if (!targetFile) { unmatched.push(f.name); continue; }
    try {
      const json = await parseJsonFromFileObject(f);
      if (!Array.isArray(json)) { errors.push(`${f.name}: bukan array JSON`); continue; }
      const targetLines = linesByFile.get(targetFile) || [];
      const limit = Math.min(json.length, targetLines.length);
      let applied = 0;
      for (let i = 0; i < limit; i++) {
        const entry = json[i];
        if (!entry || typeof entry !== "object") continue;
        const msg = entry.message != null ? String(entry.message).replace(/\r?\n/g, "\\n").trim() : "";
        const name = entry.name != null ? String(entry.name).replace(/\r?\n/g, "\\n").trim() : null;
        const line = targetLines[i];
        if (slot === 1) {
          line.ref_lang_1 = msg || null;
          line.ref_lang_1_name = name;
        } else {
          line.ref_lang_2 = msg || null;
          line.ref_lang_2_name = name;
        }
        if (msg) applied++;
      }
      totalApplied += applied;
      matched.push(`${f.name} → ${targetFile} (${applied} baris)`);
    } catch (err) {
      errors.push(`${f.name}: ${err.message}`);
    }
  }
  refreshAll();
  queueAutoSave();
  let msg = `Berhasil impor ${totalApplied} baris Referensi ${slot} dari ${matched.length} file.`;
  if (unmatched.length) msg += ` (${unmatched.length} file tanpa pasangan, dilewati)`;
  flashHint(msg);
  const lines = [];
  if (matched.length) lines.push(`Cocok: ${matched.length} file`, ...matched.slice(0, 8), matched.length > 8 ? `...+${matched.length - 8} lainnya` : "");
  if (unmatched.length) lines.push("", `Tidak ada pasangan: ${unmatched.length} file`, ...unmatched.slice(0, 8), unmatched.length > 8 ? `...+${unmatched.length - 8} lainnya` : "");
  if (errors.length) lines.push("", `Error: ${errors.length}`, ...errors.slice(0, 5));
  if (lines.length) alert(`Impor Referensi ${slot} selesai:\n\n` + lines.filter(Boolean).join("\n"));
}

function clearRefLang(slot) {
  if (!confirm(`Hapus data Referensi ${slot} dari semua baris?`)) return;
  for (const l of state.lines) {
    if (slot === 1) {
      delete l.ref_lang_1;
      delete l.ref_lang_1_name;
    } else {
      delete l.ref_lang_2;
      delete l.ref_lang_2_name;
    }
  }
  refreshAll();
  queueAutoSave();
  flashHint(`Referensi ${slot} dihapus dari semua baris.`);
}

// ─── Public handler binders ───────────────────────────────────────────────────

export function onImportRefLang1() {
  ui.refLang1Input.click();
}

export function onImportRefLang2() {
  ui.refLang2Input.click();
}

export function onImportRefLang1Folder() {
  ui.refLang1FolderInput.click();
}

export function onImportRefLang2Folder() {
  ui.refLang2FolderInput.click();
}

export function onRefLang1FileChange(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = "";
  if (!f) return;
  importRefJson(1, f);
}

export function onRefLang2FileChange(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = "";
  if (!f) return;
  importRefJson(2, f);
}

export function onRefLang1FolderChange(ev) {
  // IMPORTANT: copy files to an array BEFORE clearing ev.target.value,
  // because some browsers clear ev.target.files when value is set to "".
  const files = ev.target.files ? Array.from(ev.target.files) : null;
  ev.target.value = "";
  if (!files || files.length === 0) return;
  importRefJsonFolder(1, files).catch(err => console.error("[importRefJsonFolder error]", err));
}

export function onRefLang2FolderChange(ev) {
  const files = ev.target.files ? Array.from(ev.target.files) : null;
  ev.target.value = "";
  if (!files || files.length === 0) return;
  importRefJsonFolder(2, files);
}

export function onClearRefLang1() { clearRefLang(1); }
export function onClearRefLang2() { clearRefLang(2); }

export function refreshHtlPanels() {
  if (isHtl()) updateHtlRefLangPanels();
}
