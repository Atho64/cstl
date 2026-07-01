// @module ai-check.ts — AI Check tab: copy, parse, render, apply corrections

import { state, ui } from './state';
import { isTranslated } from './state';
import { unescapeStoredNewlines, escapeStoredNewlines, applyReplaceRules } from './string-utils';
import { getLineDisplayName, formatLineLabel } from './luca-engine';
import { rebuildDisplayState, renderPreviewRows, syncCheckboxUI, updateButtonStates, pushUndoSnapshot, refreshAll, flashHint } from './render';
import { queueAutoSave } from './project';
import { applyPromptVariables } from './ai-format';
import { getGlossaryPrompt } from './glossary';
import { DEFAULT_AI_CHECK_PROMPT } from './constants';
import type { Line, AiCheckCorrection } from './types';


export function getSelectedTranslatedLines(): Line[] {
  return state.lines.filter(l => state.selectedLines.has(l.line_num) && isTranslated(l));
}

export function getLineForAiCheck(line: Line): string {
  const originalName = line.name || '';
  const translatedName = (line.trans_name || '').trim() || originalName;
  const originalText = originalName ? `${originalName}: ${line.message}` : line.message;
  const translatedText = translatedName ? `${translatedName}: ${line.trans_message}` : line.trans_message;
  const glossary = getGlossaryPrompt(`${originalText}\n${translatedText}`).trim();
  return [
    `[line ${line.line_num}]`,
    `original: ${originalText}`,
    `translation: ${translatedText}`,
    glossary ? glossary : '',
  ].filter(Boolean).join('\n');
}

export function setAiCheckStatus(message: string, keepAlive = false): void {
  ui.aiCheckStatus.textContent = message;
  ui.aiCheckStatus.classList.remove('empty');
  if (!keepAlive) {
    setTimeout(() => {
      if (ui.aiCheckStatus.textContent === message) ui.aiCheckStatus.classList.add('empty');
    }, 4000);
  }
}

export async function onCopyForAiCheck(): Promise<void> {
  const sel = getSelectedTranslatedLines();
  if (!sel.length) {
    setAiCheckStatus('Tidak ada baris terjemahan yang dipilih.');
    return;
  }
  const baseCheck = applyPromptVariables((state.aiCheckPrompt || DEFAULT_AI_CHECK_PROMPT).trim());
  const promptText = `${baseCheck}\n\n${sel.map(getLineForAiCheck).join('\n\n')}\n`;
  try {
    await navigator.clipboard.writeText(promptText);
    setAiCheckStatus(`Disalin ${sel.length} baris untuk AI Check.`);
  } catch (_) {
    ui.pasteAiCheckArea.value = promptText;
    setAiCheckStatus('Clipboard gagal, prompt dimasukkan ke kotak paste.');
  }
  updateButtonStates();
}

export function parseAiCheckBlocks(text: string): { num: number; reason: string; name: string; text: string }[] {
  const lines = text.split(/\r?\n/);
  const blocks: { num: number; reason: string; name: string; text: string }[] = [];
  let current: { num: number; reason: string; name: string; text: string } | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === '```' || line === '```plaintext' || line === '```text') continue;
    const header = line.match(/^\[line\s+(\d+)\]$/i);
    if (header) {
      if (current) blocks.push(current);
      current = { num: Number(header[1]), reason: '', name: '', text: '' };
      continue;
    }
    if (!current) throw new Error(`Baris tanpa header [line N]: "${line.slice(0, 50)}"`);
    const field = line.match(/^(reason|name|text)\s*:\s*(.*)$/i);
    if (!field) throw new Error(`Format field rusak pada line ${current.num}: "${line.slice(0, 50)}"`);
    const key = field[1].toLowerCase() as 'reason' | 'name' | 'text';
    current[key] = field[2].trim();
  }
  if (current) blocks.push(current);
  if (!blocks.length) throw new Error('Tidak ada blok [line N] yang valid.');
  return blocks;
}

export function onParseAiCheck(): void {
  try {
    const parsed = parseAiCheckBlocks(ui.pasteAiCheckArea.value.trim());
    const selectedTranslated = new Set(getSelectedTranslatedLines().map(l => l.line_num));
    const corrections: AiCheckCorrection[] = [];
    const errors: string[] = [];
    const seen = new Set<number>();
    for (const item of parsed) {
      const line = state.lineByNum.get(item.num);
      if (seen.has(item.num)) errors.push(`[#${item.num}] Duplikat koreksi.`);
      seen.add(item.num);
      if (!line) errors.push(`[#${item.num}] Tidak ada di proyek.`);
      else if (!selectedTranslated.has(item.num)) errors.push(`[#${item.num}] Tidak termasuk baris terjemahan yang dipilih.`);
      else if (!isTranslated(line)) errors.push(`[#${item.num}] Baris belum diterjemahkan.`);
      if (!item.reason) errors.push(`[#${item.num}] Reason kosong.`);
      if (!item.text) errors.push(`[#${item.num}] Text koreksi kosong.`);
      if (line && item.text && item.reason && selectedTranslated.has(item.num)) {
        corrections.push({ ...item, checked: true });
      }
    }
    if (errors.length) {
      state.aiCheckCorrections = [];
      renderAiCheckCorrections();
      return alert('AI CHECK DITOLAK:\n\n' + errors.slice(0, 12).join('\n') + (errors.length > 12 ? `\n\n... (+${errors.length - 12} error lain)` : ''));
    }
    state.aiCheckCorrections = corrections;
    renderAiCheckCorrections();
    setAiCheckStatus(`Parsed ${corrections.length} koreksi.`);
  } catch (err: any) {
    state.aiCheckCorrections = [];
    renderAiCheckCorrections();
    alert('Gagal parse AI Check:\n\n' + err.message);
  }
}

export function renderAiCheckCorrections(): void {
  ui.aiCheckResults.textContent = '';
  const frag = document.createDocumentFragment();
  for (const correction of state.aiCheckCorrections) {
    const line = state.lineByNum.get(correction.num);
    if (!line) continue;
    const row = document.createElement('div');
    row.className = 'ai-check-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = correction.checked;
    checkbox.addEventListener('change', () => {
      correction.checked = checkbox.checked;
      updateButtonStates();
    });

    const body = document.createElement('div');
    body.className = 'ai-check-body';
    const title = document.createElement('div');
    title.className = 'mono ai-check-title';
    title.textContent = `Line ${correction.num}`;
    const reason = document.createElement('div');
    reason.className = 'ai-check-reason';
    reason.textContent = `Reason: ${correction.reason}`;
    const current = document.createElement('div');
    current.className = 'original';
    const currentName = (line.trans_name || '').trim() || line.name || '';
    current.textContent = `Current: ${currentName ? `${currentName}: ` : ''}${line.trans_message}`;
    const proposed = document.createElement('div');
    proposed.className = 'translated';
    proposed.textContent = `Proposed: ${correction.name ? `${correction.name}: ` : ''}${correction.text}`;
    body.append(title, reason, current, proposed);
    row.append(checkbox, body);
    frag.appendChild(row);
  }
  ui.aiCheckResults.appendChild(frag);
  updateButtonStates();
}

export function stripDuplicateSpeakerPrefix(text: string, name: string): string {
  const cleanName = String(name || '').trim();
  let cleanText = String(text || '').trim();
  if (!cleanName || !cleanText) return cleanText;
  const separators = [':', '：'];
  for (const sep of separators) {
    const prefix = `${cleanName}${sep}`;
    if (cleanText.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleanText = cleanText.slice(prefix.length).trim();
      break;
    }
  }
  return cleanText;
}

export function onApplyAiCheckCorrections(): void {
  const corrections = state.aiCheckCorrections.filter(c => c.checked);
  if (!corrections.length) return;
  pushUndoSnapshot();
  let applied = 0;
  for (const correction of corrections) {
    const line = state.lineByNum.get(correction.num);
    if (!line || !isTranslated(line)) continue;
    const effectiveName = line.name && correction.name ? correction.name : ((line.trans_name || '').trim() || line.name || '');
    if (line.name && correction.name) line.trans_name = correction.name;
    let correctedMsg = correction.text.replace(/<br>/gi, '\\n');
    correctedMsg = applyReplaceRules(correctedMsg, state.postReplaceRules, 'msg');
    if (line.name) correctedMsg = stripDuplicateSpeakerPrefix(correctedMsg, effectiveName);
    line.trans_message = escapeStoredNewlines(correctedMsg);
    line.is_translated = true;
    applied++;
  }
  state.aiCheckCorrections = state.aiCheckCorrections.filter(c => !c.checked);
  renderAiCheckCorrections();
  refreshAll();
  queueAutoSave();
  setAiCheckStatus(`Diterapkan ${applied} koreksi.`);
}

export function onClearAiCheck(): void {
  state.aiCheckCorrections = [];
  ui.pasteAiCheckArea.value = '';
  ui.aiCheckResults.textContent = '';
  setAiCheckStatus('AI Check dibersihkan.');
  updateButtonStates();
}
