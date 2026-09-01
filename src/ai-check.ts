// @module ai-check.ts — AI Check tab: copy, parse, render, apply corrections

import { state, ui } from './state';
import { isTranslated, isIlustrasiLine } from './state';
import { unescapeStoredNewlines, escapeStoredNewlines, applyReplaceRules } from './string-utils';
import { getLineDisplayName, formatLineLabel } from './luca-engine';
import { rebuildDisplayState, renderPreviewRows, syncCheckboxUI, updateButtonStates, pushUndoSnapshot, refreshAll, flashHint } from './render';
import { queueAutoSave } from './project';
import { applyPromptVariables } from './ai-format';
import { getGlossaryPrompt, sanitizeTagsForChatgpt } from './glossary';
import { DEFAULT_AI_CHECK_PROMPT } from './constants';
import { getDisplayOrderedLines } from './selection';
import type { Line, AiCheckCorrection } from './types';


// ─── Category helpers ─────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['Grammar', 'Naturalness', 'Punctuation', 'Consistency', 'Accuracy', 'Name'] as const;
const CATEGORY_COLORS: Record<string, string> = {
  Grammar: '#c98a12',
  Naturalness: '#2d7d5f',
  Punctuation: '#c84e18',
  Consistency: '#7a6ab8',
  Accuracy: '#c82a3a',
  Name: '#3a7a68',
};

function normalizeCategory(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  for (const cat of VALID_CATEGORIES) {
    if (cat.toLowerCase() === lower) return cat;
  }
  return trimmed || 'Naturalness';
}

export function getSelectedTranslatedLines(): Line[] {
  return getDisplayOrderedLines().filter(l => state.selectedLines.has(l.line_num) && isTranslated(l) && !isIlustrasiLine(l));
}

// ─── Context building (once, at the start — same logic as Copy for AI) ────────

function buildAiCheckContextBlock(sel: Line[]): string {
  if (state.contextLines <= 0 || !sel.length) return '';
  const orderedLines = getDisplayOrderedLines();
  const firstSelLineNum = sel[0].line_num;
  const firstSelIdx = orderedLines.findIndex(l => l.line_num === firstSelLineNum);
  if (firstSelIdx <= 0) return '';
  const startIdx = Math.max(0, firstSelIdx - state.contextLines);
  const ctxLines = orderedLines.slice(startIdx, firstSelIdx).filter(l => !l._hidden);
  if (!ctxLines.length) return '';
  const ctxOut: string[] = [];
  for (const l of ctxLines) {
    const origNameStr = l.name ? `${l.name}: ` : '';
    const transNameStr = (l.trans_name || l.name) ? `${(l.trans_name || l.name)!.trim()}: ` : '';
    if (state.contextType === 'raw') {
      ctxOut.push(`${origNameStr}${l.message}`);
    } else if (state.contextType === 'both') {
      ctxOut.push(`[Original] ${origNameStr}${l.message}\n[Translated] ${transNameStr}${l.trans_message || ''}`);
    } else {
      ctxOut.push(`${transNameStr}${l.trans_message || l.message}`);
    }
  }
  if (!ctxOut.length) return '';
  const block = `<Context>\nThese lines are for context only. Do NOT correct them.\n${ctxOut.join('\n')}\n</Context>`;
  return sanitizeTagsForChatgpt(block);
}

export function getLineForAiCheck(line: Line): string {
  const originalName = line.name || '';
  const translatedName = (line.trans_name || '').trim() || originalName;
  const originalText = originalName ? `${originalName}: ${line.message}` : line.message;
  const currentText = translatedName ? `${translatedName}: ${line.trans_message}` : line.trans_message;
  return [
    `[line ${line.line_num}]`,
    `original: ${originalText}`,
    `current: ${currentText}`,
  ].join('\n');
}

export function buildAiCheckPrompt(sel: Line[]): string {
  if (!sel.length) return '';
  const baseCheck = sanitizeTagsForChatgpt(applyPromptVariables((state.aiCheckPrompt || DEFAULT_AI_CHECK_PROMPT).trim()));
  const contextBlock = buildAiCheckContextBlock(sel);
  const joinedOriginal = sel.map(l => {
    const n = l.name || '';
    return n ? `${n}: ${l.message}` : l.message;
  }).join('\n');
  const glossaryBlock = getGlossaryPrompt(joinedOriginal).trim();
  const linesBlock = sanitizeTagsForChatgpt(`<lines>\n${sel.map(getLineForAiCheck).join('\n\n')}\n</lines>`);
  const sections: string[] = [baseCheck];
  if (contextBlock) sections.push(contextBlock);
  if (glossaryBlock) sections.push(glossaryBlock);
  sections.push(linesBlock);
  return sections.join('\n\n') + '\n';
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

// ─── Copy for AI Check (manual) ───────────────────────────────────────────────

export async function onCopyForAiCheck(): Promise<void> {
  const sel = getSelectedTranslatedLines();
  if (!sel.length) {
    setAiCheckStatus('Tidak ada baris terjemahan yang dipilih.');
    return;
  }
  const promptText = buildAiCheckPrompt(sel);
  try {
    await navigator.clipboard.writeText(promptText);
    setAiCheckStatus(`Disalin ${sel.length} baris untuk AI Check.`);
  } catch (_) {
    ui.pasteAiCheckArea.value = promptText;
    setAiCheckStatus('Clipboard gagal, prompt dimasukkan ke kotak paste.');
  }
  updateButtonStates();
}

// ─── Parse AI Check response ──────────────────────────────────────────────────

/** Split "Name: message" into name + message using the first ASCII/fullwidth colon. */
function splitNameMessage(correction: string): { name: string; message: string } {
  const raw = String(correction || '');
  const colonIdx = raw.indexOf(':');
  const jpColonIdx = raw.indexOf('：');
  let splitIdx = -1;
  if (colonIdx !== -1 && jpColonIdx !== -1) splitIdx = Math.min(colonIdx, jpColonIdx);
  else if (colonIdx !== -1) splitIdx = colonIdx;
  else if (jpColonIdx !== -1) splitIdx = jpColonIdx;
  if (splitIdx === -1) return { name: '', message: raw.trim() };
  return { name: raw.substring(0, splitIdx).trim(), message: raw.substring(splitIdx + 1).trim() };
}

export function parseAiCheckBlocks(text: string): { num: number; category: string; reason: string; name: string; text: string }[] {
  const lines = text.split(/\r?\n/);
  const blocks: { num: number; category: string; reason: string; name: string; text: string }[] = [];
  let current: { num: number; category: string; reason: string; name: string; text: string } | null = null;
  let lastField: 'reason' | 'text' | 'name' | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === '```' || line === '```plaintext' || line === '```text') continue;
    // Accept both [line N] and [N] headers
    const header = line.match(/^\[line\s+(\d+)\]$/i) || line.match(/^\[(\d+)\]$/);
    if (header) {
      if (current) blocks.push(current);
      current = { num: Number(header[1]), category: '', reason: '', name: '', text: '' };
      lastField = null;
      continue;
    }
    if (!current) continue; // lenient: skip stray lines before any header
    const field = line.match(/^(category|reason|name|text|correction)\s*:\s*(.*)$/i);
    if (field) {
      const key = field[1].toLowerCase() as 'category' | 'reason' | 'name' | 'text' | 'correction';
      const value = field[2];
      if (key === 'category') {
        current.category = normalizeCategory(value);
        lastField = null;
      } else if (key === 'correction') {
        // Combined "Name: message" — split using line context
        const lineObj = state.lineByNum.get(current.num);
        if (lineObj && lineObj.name) {
          const split = splitNameMessage(value);
          current.name = split.name;
          current.text = split.message;
        } else {
          current.name = '';
          current.text = value;
        }
        lastField = 'text'; // continuations append to the message
      } else {
        current[key] = value.trim();
        lastField = key;
      }
      continue;
    }
    // Continuation line for multi-line text/reason/name
    if (lastField === 'text') {
      current.text = current.text ? `${current.text}\n${rawLine}` : rawLine;
    } else if (lastField === 'reason') {
      current.reason = current.reason ? `${current.reason} ${line}` : line;
    } else if (lastField === 'name') {
      current.name = current.name ? `${current.name} ${line}` : line;
    }
    // else: lenient — skip unrecognized lines instead of throwing
  }
  if (current) blocks.push(current);
  if (!blocks.length) {
    const normalized = text.replace(/```(?:plaintext|text)?/gi, '').replace(/```/g, '').trim().toLowerCase();
    if (!normalized || /^(no corrections?(?: needed| are needed| are necessary)?|no errors?(?: found)?|tidak ada koreksi(?: yang diperlukan)?|tidak ada error(?: yang ditemukan)?)\.?$/.test(normalized)) {
      return [];
    }
    throw new Error('Tidak ada blok [line N] yang valid.');
  }
  return blocks;
}

export function onParseAiCheck(selectedLineNums?: Set<number>): boolean {
  try {
    const parsed = parseAiCheckBlocks(ui.pasteAiCheckArea.value.trim());
    const selectedTranslated = selectedLineNums
      ? new Set([...selectedLineNums].filter(num => {
          const line = state.lineByNum.get(num);
          return !!line && isTranslated(line);
        }))
      : new Set(getSelectedTranslatedLines().map(l => l.line_num));
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
        corrections.push({ ...item, category: item.category || 'Naturalness', checked: true });
      }
    }
    if (errors.length) {
      state.aiCheckCorrections = [];
      renderAiCheckCorrections();
      alert('AI CHECK DITOLAK:\n\n' + errors.slice(0, 12).join('\n') + (errors.length > 12 ? `\n\n... (+${errors.length - 12} error lain)` : ''));
      return false;
    }
    state.aiCheckCorrections = corrections;
    renderAiCheckCorrections();
    setAiCheckStatus(`Parsed ${corrections.length} koreksi.`);
    return true;
  } catch (err: any) {
    state.aiCheckCorrections = [];
    renderAiCheckCorrections();
    alert('Gagal parse AI Check:\n\n' + err.message);
    return false;
  }
}

// ─── Diff highlight ───────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter(t => t.length > 0);
}

function computeDiff(oldText: string, newText: string): { type: 'same' | 'del' | 'add'; text: string }[] {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  // Simple LCS-based diff
  const m = oldTokens.length;
  const n = newTokens.length;
  if (m === 0) return newTokens.map(t => ({ type: 'add', text: t }));
  if (n === 0) return oldTokens.map(t => ({ type: 'del', text: t }));

  // LCS table (limit size for performance)
  if (m * n > 50000) {
    // Fallback: just show old as del, new as add
    return [
      ...oldTokens.map(t => ({ type: 'del' as const, text: t })),
      ...newTokens.map(t => ({ type: 'add' as const, text: t })),
    ];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: { type: 'same' | 'del' | 'add'; text: string }[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1] === newTokens[j - 1]) {
      result.unshift({ type: 'same', text: oldTokens[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.unshift({ type: 'del', text: oldTokens[i - 1] });
      i--;
    } else {
      result.unshift({ type: 'add', text: newTokens[j - 1] });
      j--;
    }
  }
  while (i > 0) { result.unshift({ type: 'del', text: oldTokens[i - 1] }); i--; }
  while (j > 0) { result.unshift({ type: 'add', text: newTokens[j - 1] }); j--; }
  return result;
}

function renderDiff(oldText: string, newText: string): HTMLElement {
  const span = document.createElement('span');
  const diff = computeDiff(oldText, newText);
  for (const part of diff) {
    const s = document.createElement('span');
    s.textContent = part.text;
    if (part.type === 'del') {
      s.style.textDecoration = 'line-through';
      s.style.opacity = '0.5';
      s.style.color = 'var(--muted)';
    } else if (part.type === 'add') {
      s.style.textDecoration = 'underline';
      s.style.color = 'var(--primary)';
      s.style.fontWeight = '600';
    }
    span.appendChild(s);
  }
  return span;
}

// ─── Category filter ──────────────────────────────────────────────────────────

let activeCategoryFilter: string | null = null;

export function renderAiCheckCorrections(): void {
  ui.aiCheckResults.textContent = '';
  const allCorrections = state.aiCheckCorrections;
  const corrections = activeCategoryFilter
    ? allCorrections.filter(c => c.category === activeCategoryFilter)
    : allCorrections;

  // Build category summary bar
  if (allCorrections.length > 0) {
    const catCounts = new Map<string, number>();
    for (const c of allCorrections) {
      catCounts.set(c.category, (catCounts.get(c.category) || 0) + 1);
    }
    const filterBar = document.createElement('div');
    filterBar.className = 'ai-check-filter-bar';
    const allBtn = document.createElement('button');
    allBtn.className = 'btn btn-xs' + (activeCategoryFilter === null ? ' btn-primary' : '');
    allBtn.textContent = `All (${allCorrections.length})`;
    allBtn.addEventListener('click', () => { activeCategoryFilter = null; renderAiCheckCorrections(); });
    filterBar.appendChild(allBtn);
    for (const cat of VALID_CATEGORIES) {
      const count = catCounts.get(cat);
      if (!count) continue;
      const btn = document.createElement('button');
      btn.className = 'btn btn-xs' + (activeCategoryFilter === cat ? ' btn-primary' : '');
      btn.textContent = `${cat} (${count})`;
      btn.style.borderColor = CATEGORY_COLORS[cat];
      if (activeCategoryFilter !== cat) btn.style.color = CATEGORY_COLORS[cat];
      btn.addEventListener('click', () => { activeCategoryFilter = cat; renderAiCheckCorrections(); });
      filterBar.appendChild(btn);
    }
    ui.aiCheckResults.appendChild(filterBar);
  }

  const frag = document.createDocumentFragment();
  for (const correction of corrections) {
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

    // Category badge
    const catBadge = document.createElement('span');
    catBadge.className = 'badge';
    catBadge.style.background = CATEGORY_COLORS[correction.category] || 'var(--primary)';
    catBadge.textContent = correction.category;
    title.appendChild(catBadge);

    const reason = document.createElement('div');
    reason.className = 'ai-check-reason';
    reason.textContent = `Reason: ${correction.reason}`;

    // Current text
    const current = document.createElement('div');
    current.className = 'original';
    const currentName = (line.trans_name || '').trim() || line.name || '';
    const currentLabel = document.createElement('span');
    currentLabel.textContent = `Current: ${currentName ? `${currentName}: ` : ''}`;
    current.appendChild(currentLabel);
    current.appendChild(document.createTextNode(line.trans_message || ''));

    // Proposed text with diff
    const proposed = document.createElement('div');
    proposed.className = 'translated';
    const proposedLabel = document.createElement('span');
    proposedLabel.textContent = `Proposed: ${correction.name ? `${correction.name}: ` : ''}`;
    proposed.appendChild(proposedLabel);
    const oldText = line.trans_message || '';
    const newText = correction.text;
    proposed.appendChild(renderDiff(oldText, newText));

    body.append(title, reason, current, proposed);
    row.append(checkbox, body);
    frag.appendChild(row);
  }
  ui.aiCheckResults.appendChild(frag);
  updateButtonStates();
}

// ─── Apply corrections ────────────────────────────────────────────────────────

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

export function onApplyAiCheckCorrections(pushUndo = true): { applied: number; categories: Map<string, number> } {
  const corrections = state.aiCheckCorrections.filter(c => c.checked);
  if (!corrections.length) return { applied: 0, categories: new Map() };
  if (pushUndo) pushUndoSnapshot();
  let applied = 0;
  const catStats = new Map<string, number>();
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
    // Mark as checked after corrections are applied
    line._ai_checked = true;
    applied++;
    catStats.set(correction.category, (catStats.get(correction.category) || 0) + 1);
  }
  state.aiCheckCorrections = state.aiCheckCorrections.filter(c => !c.checked);
  renderAiCheckCorrections();
  refreshAll();
  queueAutoSave();
  const catSummary = Array.from(catStats.entries()).map(([k, v]) => `${k}: ${v}`).join(', ');
  setAiCheckStatus(`Diterapkan ${applied} koreksi${catSummary ? ` (${catSummary})` : ''}.`);
  return { applied, categories: catStats };
}

// ─── Skip / Confirm line ──────────────────────────────────────────────────────

export function onConfirmLine(num: number): void {
  const line = state.lineByNum.get(num);
  if (!line) return;
  line._ai_confirmed = true;
  line._ai_checked = true;
  flashHint(`Line ${num} ditandai sebagai sudah benar.`);
  updateButtonStates();
  queueAutoSave();
}

export function onUnconfirmLine(num: number): void {
  const line = state.lineByNum.get(num);
  if (!line) return;
  line._ai_confirmed = false;
  line._ai_checked = false;
  flashHint(`Line ${num} dikembalikan untuk di-cek.`);
  updateButtonStates();
  queueAutoSave();
}

export function onClearAiCheck(): void {
  state.aiCheckCorrections = [];
  activeCategoryFilter = null;
  ui.pasteAiCheckArea.value = '';
  ui.aiCheckResults.textContent = '';
  setAiCheckStatus('AI Check dibersihkan.');
  updateButtonStates();
}

// ─── Summary stats ────────────────────────────────────────────────────────────

export function getAiCheckSummary(): { total: number; checked: number; corrections: number; byCategory: Map<string, number> } {
  const total = state.lines.filter(l => isTranslated(l) && !l._hidden).length;
  const checked = state.lines.filter(l => l._ai_checked && !l._hidden).length;
  const corrections = state.aiCheckCorrections.length;
  const byCategory = new Map<string, number>();
  for (const c of state.aiCheckCorrections) {
    byCategory.set(c.category, (byCategory.get(c.category) || 0) + 1);
  }
  return { total, checked, corrections, byCategory };
}
