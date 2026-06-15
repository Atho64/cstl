// @module glossary.js — Glossary parsing, management, and file I/O

import { state, ui } from './state.js';
import { isTranslated } from './state.js';
import { escapeStoredNewlines, unescapeStoredNewlines, containsJapanese, normalizeKana } from './string-utils.js';
import { rebuildDisplayState, renderPreviewRows, syncCheckboxUI, flashHint, updateButtonStates } from './render.js';
import { queueAutoSave } from './project.js';
import { recordSelectionHistory } from './selection.js';
import { getSelectedTranslationPlainText, applyPromptVariables } from './ai-format.js';
import { DEFAULT_GLOSSARY_PROMPT } from './constants.js';


export function getGlossaryMatches(copiedText) {
  const glossary = parseGlossaryToMap(state.glossaryText);
  const matched = [];
  const lowerText = copiedText.toLowerCase();

  for (const [source, entry] of glossary.entries()) {
    if (source && entry.target && lowerText.includes(source.toLowerCase())) {
      matched.push(formatGlossaryEntry(source, entry));
    }
  }

  return matched;
}

export function getGlossaryPrompt(copiedText) {
  const matched = getGlossaryMatches(copiedText);
  if (matched.length > 0) {
    return `\n\n<Glossary>\n${matched.join("\n")}\n</Glossary>`;
  }
  return "";
}

export function parseGlossaryToMap(text) {
  const m = new Map();
  if (!text) return m;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let raw = line.trim();
    if (!raw) continue;
    let type = "term";
    const typeMatch = raw.match(/^\[([a-z ]+)\]\s*/i);
    if (typeMatch) {
      type = normalizeGlossaryType(typeMatch[1]);
      raw = raw.slice(typeMatch[0].length).trim();
    }
    let sepIdx = raw.indexOf("=");
    if (sepIdx === -1) sepIdx = raw.indexOf(":");
    if (sepIdx !== -1) {
      const source = raw.substring(0, sepIdx).trim();
      let target = raw.substring(sepIdx + 1).trim();
      let desc = "";
      const descMatch = target.match(/\s*\{([^{}]+)\}\s*$/);
      if (descMatch) {
        desc = descMatch[1].trim();
        target = target.slice(0, descMatch.index).trim();
      }
      if (source) m.set(source, { target, type, desc });
    }
  }
  return m;
}

export function normalizeGlossaryType(type) {
  const clean = String(type || "").trim().toLowerCase().replace(/\s+/g, "-");
  const aliases = {
    char: "character",
    chars: "character",
    name: "character",
    names: "character",
    character: "character",
    characters: "character",
    place: "place",
    location: "place",
    locations: "place",
    organization: "organization",
    organisation: "organization",
    org: "organization",
    item: "item",
    object: "item",
    ability: "ability",
    skill: "ability",
    title: "title",
    concept: "concept",
    term: "term",
    other: "term",
  };
  return aliases[clean] || "term";
}

export function formatGlossaryEntry(source, entry) {
  const type = normalizeGlossaryType(entry?.type || "term");
  const target = typeof entry === "string" ? entry : entry.target;
  const desc = typeof entry === "string" ? "" : String(entry.desc || "").trim();
  return `[${type}] ${source} = ${target}${desc ? ` {${desc}}` : ""}`;
}

export function serializeGlossaryMap(map) {
  return Array.from(map.entries()).map(([k, v]) => formatGlossaryEntry(k, v)).join("\n");
}

export function mergeGlossaryEntries(entries) {
  const current = parseGlossaryToMap(state.glossaryText);
  let added = 0;
  let updated = 0;
  for (const [source, value] of entries.entries()) {
    const entry = typeof value === "string" ? { target: value, type: "term" } : value;
    const target = entry.target;
    if (!source || !target) continue;
    if (current.has(source)) updated++;
    else added++;
    current.set(source, { target, type: normalizeGlossaryType(entry.type), desc: String(entry.desc || "").trim() });
  }
  state.glossaryText = serializeGlossaryMap(current);
  renderGlossaryPreview();
  queueAutoSave();
  return { added, updated };
}

export function addNameGlossaryEntry(entries, source, target, type = "character", desc = "character name") {
  const cleanSource = String(source || "").replace(/\s+/g, " ").trim();
  const cleanTarget = String(target || "").replace(/\s+/g, " ").trim();
  if (!cleanSource || !cleanTarget || cleanSource === cleanTarget) return;

  entries.set(cleanSource, { target: cleanTarget, type, desc });

  const sourceParts = cleanSource.split(/[\s・･=＝]+/).filter(Boolean);
  const targetParts = cleanTarget.split(/\s+/).filter(Boolean);
  if (sourceParts.length >= 2 && sourceParts.length === targetParts.length) {
    for (let i = 0; i < sourceParts.length; i++) {
      if (sourceParts[i] && targetParts[i] && sourceParts[i] !== targetParts[i]) {
        entries.set(sourceParts[i], { target: targetParts[i], type, desc: i === 0 ? "family name" : `given name${desc.includes("female") ? " (female)" : desc.includes("male") ? " (male)" : ""}` });
      }
    }
  }
}

export function genderToDescription(gender) {
  const raw = Array.isArray(gender) ? gender.find(Boolean) : gender;
  const clean = String(raw || "").trim().toLowerCase();
  if (["f", "female", "woman", "girl"].includes(clean)) return "female name";
  if (["m", "male", "man", "boy"].includes(clean)) return "male name";
  if (["n", "non-binary", "nonbinary"].includes(clean)) return "non-binary character name";
  return "character name";
}

export function hasKanji(text) {
  return /[\u3400-\u9fff]/.test(text);
}

export function isLikelyRubyNameCandidate(base, reading) {
  const cleanBase = String(base || "").replace(/\s+/g, "").trim();
  const cleanReading = normalizeKana(reading);
  if (!hasKanji(cleanBase) || !cleanReading) return false;
  if (cleanBase.length < 2 || cleanBase.length > 8) return false;
  if (cleanReading.length < 2 || cleanReading.length > 12) return false;
  if (/[\u3040-\u30ff]/.test(cleanBase)) return false;
  if (/[々〆ヶ]/.test(cleanBase)) return true;
  return /^[\u3400-\u9fff]{2,4}(?:[\s　・･][\u3400-\u9fff]{1,4})?$/.test(base.trim());
}

export function renderGlossaryPreview() {
  const selectedText = getSelectedTranslationPlainText();
  const matches = selectedText ? getGlossaryMatches(selectedText) : [];
  if (!matches.length) {
    ui.glossaryPreviewWrap.hidden = true;
    ui.glossaryPreviewText.textContent = "";
    return;
  }
  ui.glossaryPreviewText.textContent = matches.join("\n");
  ui.glossaryPreviewWrap.hidden = false;
}

export async function onCopyForGlossaryAi() {
  const sel = state.lines.filter(l => state.selectedLines.has(l.line_num));
  if (!sel.length) return;
  const out = getSelectedTranslationPlainText().split("\n").filter(Boolean);
  const basePrompt = applyPromptVariables((state.glossaryPrompt || DEFAULT_GLOSSARY_PROMPT).trim());
  const promptText = `${basePrompt}\n\n${out.join("\n")}\n`;
  try {
    await navigator.clipboard.writeText(promptText);
    flashHint(`Disalin ${sel.length} baris untuk ekstraksi glossary.`);
  } catch (_) {
    ui.pasteGlossaryArea.value = promptText;
  }
}

export function onSaveGlossary() {
  const val = ui.pasteGlossaryArea.value.trim();
  if (!val) return;

  const currentMap = parseGlossaryToMap(state.glossaryText);
  const newMap = parseGlossaryToMap(val);

  for (const [k, v] of newMap.entries()) {
    currentMap.set(k, v);
  }

  state.glossaryText = serializeGlossaryMap(currentMap);

  ui.pasteGlossaryArea.value = "";
  renderGlossaryPreview();
  queueAutoSave();
  flashHint("Glossary berhasil disimpan!");
}

export function buildSafeFileName(name) {
  return String(name || "glossary").replace(/[<>:"\/\\|?*]/g, "_").trim() || "glossary";
}

export function onDeleteTranslation() {
  let deletedCount = 0;
  for (const line of state.lines) {
    if (state.selectedLines.has(line.line_num)) {
      if (line.trans_message || line.trans_name || line.is_translated) {
        line.trans_message = "";
        line.trans_name = "";
        line.is_translated = false;
        deletedCount++;
      }
    }
  }

  if (deletedCount > 0) {
    state.selectedLines.clear();
    recordSelectionHistory();
    rebuildDisplayState();
    renderPreviewRows();
    updateButtonStates();
    queueAutoSave();
    flashHint(`${deletedCount} baris terjemahan berhasil dihapus.`);
  } else {
    flashHint("Tidak ada terjemahan yang bisa dihapus pada baris yang dicentang.");
  }
}

export function onExportGlossaryFile() {
  const glossary = serializeGlossaryMap(parseGlossaryToMap(state.glossaryText));
  if (!glossary.trim()) return alert("Smart Glossary masih kosong.");
  const blob = new Blob([glossary + "\n"], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${buildSafeFileName(state.projectName)}_glossary.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  flashHint("Glossary diekspor ke file.");
}

export async function onImportGlossaryFile(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = "";
  if (!f) return;
  try {
    const text = await f.text();
    const imported = parseGlossaryToMap(text);
    if (!imported.size) return alert("File glossary kosong atau formatnya tidak valid.");
    const current = parseGlossaryToMap(state.glossaryText);
    let added = 0;
    let updated = 0;
    for (const [source, entry] of imported.entries()) {
      if (current.has(source)) updated++;
      else added++;
      current.set(source, entry);
    }
    state.glossaryText = serializeGlossaryMap(current);
    renderGlossaryPreview();
    updateButtonStates();
    queueAutoSave();
    flashHint(`Glossary file diimpor: ${added} baru, ${updated} diperbarui.`);
  } catch (err) {
    alert("Gagal impor file glossary: " + err.message);
  }
}
