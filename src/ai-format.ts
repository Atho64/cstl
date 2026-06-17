// @module ai-format.ts — AI translation format helpers: export, parse, detect

import { state } from './state';
import {
  AI_TRANSLATION_FORMAT_BLOCK, AI_TRANSLATION_FORMAT_NUMBERED,
  AI_TRANSLATION_FORMAT_XML, AI_TRANSLATION_FORMAT_JSONL, AI_TRANSLATION_FORMAT_JSON_ARRAY,
  DEFAULT_PROMPT_HEADER_NUMBERED, DEFAULT_PROMPT_HEADER_BLOCK,
  DEFAULT_PROMPT_HEADER_XML, DEFAULT_PROMPT_HEADER_JSONL, DEFAULT_PROMPT_HEADER_JSON_ARRAY,
} from './constants';
import { unescapeStoredNewlines, escapeStoredNewlines, escapeXml, stripPlaintextFences } from './string-utils';
import { getLineDisplayName } from './luca-engine';
import { isTranslated } from './state';
import type { Line, ParsedTranslationItem } from './types';

export function applyPromptVariables(prompt: string): string {
  if (!prompt) return '';
  return prompt
    .replace(/\{\{sourceLang\}\}/g, state.sourceLang || 'Japanese')
    .replace(/\{\{targetLang\}\}/g, state.targetLang || 'Indonesian');
}

export function normalizeAiTranslationFormat(value: string): string {
  if (value === AI_TRANSLATION_FORMAT_NUMBERED) return AI_TRANSLATION_FORMAT_NUMBERED;
  if (value === AI_TRANSLATION_FORMAT_BLOCK)    return AI_TRANSLATION_FORMAT_BLOCK;
  if (value === AI_TRANSLATION_FORMAT_XML)      return AI_TRANSLATION_FORMAT_XML;
  if (value === AI_TRANSLATION_FORMAT_JSONL)    return AI_TRANSLATION_FORMAT_JSONL;
  if (value === AI_TRANSLATION_FORMAT_JSON_ARRAY)  return AI_TRANSLATION_FORMAT_JSON_ARRAY;
  return AI_TRANSLATION_FORMAT_NUMBERED;
}

export function getDefaultPromptHeaderForFormat(format: string): string {
  if (format === AI_TRANSLATION_FORMAT_BLOCK)  return DEFAULT_PROMPT_HEADER_BLOCK;
  if (format === AI_TRANSLATION_FORMAT_XML)    return DEFAULT_PROMPT_HEADER_XML;
  if (format === AI_TRANSLATION_FORMAT_JSONL)  return DEFAULT_PROMPT_HEADER_JSONL;
  if (format === AI_TRANSLATION_FORMAT_JSON_ARRAY) return DEFAULT_PROMPT_HEADER_JSON_ARRAY;
  return DEFAULT_PROMPT_HEADER_NUMBERED;
}

export function formatLineForAiExport(line: Line): string {
  const parts = [`[line ${line.line_num}]`];
  if (String(line.luca_command || '').toUpperCase() === 'SELECT') {
    parts.push('type: choice');
  }
  const speaker = String(line.name || '').trim();
  if (speaker) parts.push(`speaker: ${speaker}`);
  parts.push(`text: ${unescapeStoredNewlines(line.message)}`);
  return parts.join('\n');
}

export function formatLineForAiExportXml(line: Line): string {
  const attrs = [`num="${line.line_num}"`];
  if (String(line.luca_command || '').toUpperCase() === 'SELECT') {
    attrs.push('type="choice"');
  }
  const speaker = String(line.name || '').trim();
  if (speaker) attrs.push(`speaker="${escapeXml(speaker)}"`);
  const text = escapeXml(unescapeStoredNewlines(line.message));
  return `  <line ${attrs.join(' ')}>\n    <text>${text}</text>\n  </line>`;
}

export function formatLineForAiExportJsonArray(line: Line): string {
  const speaker = (line.name || '').trim();
  const text = line.message || '';
  if (speaker) {
    return `[${line.line_num},${JSON.stringify(speaker)},${JSON.stringify(text)}]`;
  } else {
    return `[${line.line_num},${JSON.stringify(text)}]`;
  }
}

export function formatLineForAiExportJsonl(line: Line): string {
  const obj: Record<string, any> = { num: line.line_num };
  if (String(line.luca_command || '').toUpperCase() === 'SELECT') {
    obj.type = 'choice';
  }
  const speaker = String(line.name || '').trim();
  if (speaker) obj.speaker = speaker;
  obj.text = unescapeStoredNewlines(line.message);
  return JSON.stringify(obj);
}

export function getSelectedTranslationText(includeTranslated = true): string {
  const sel = state.lines.filter(l => state.selectedLines.has(l.line_num) && (includeTranslated || !isTranslated(l)));
  const fmt = normalizeAiTranslationFormat(state.aiTranslationFormat);
  if (fmt === AI_TRANSLATION_FORMAT_BLOCK)  return sel.map(formatLineForAiExport).join('\n\n');
  if (fmt === AI_TRANSLATION_FORMAT_XML)    return sel.map(formatLineForAiExportXml).join('\n');
  if (fmt === AI_TRANSLATION_FORMAT_JSONL)  return sel.map(formatLineForAiExportJsonl).join('\n');
  if (fmt === AI_TRANSLATION_FORMAT_JSON_ARRAY) return sel.map(formatLineForAiExportJsonArray).join('\n');
  return getSelectedTranslationPlainText(includeTranslated);
}

export function getSelectedTranslationPlainText(includeTranslated = true): string {
  const sel = state.lines.filter(l => state.selectedLines.has(l.line_num) && (includeTranslated || !isTranslated(l)));
  return sel.map(l => {
    const dN = l.name || '';
    return dN ? `${l.line_num}. ${dN}: ${l.message}` : `${l.line_num}. ${l.message}`;
  }).join('\n');
}

export function buildSelectedTranslationExport(includeTranslated = true): string {
  const body = getSelectedTranslationText(includeTranslated);
  if (!body) return '';
  const fmt = normalizeAiTranslationFormat(state.aiTranslationFormat);
  if (fmt === AI_TRANSLATION_FORMAT_XML) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<lines>\n${body}\n</lines>`;
  }
  if (fmt === AI_TRANSLATION_FORMAT_JSONL) {
    return body;
  }
  return `<lines>\n${body}\n</lines>`;
}

export function getTranslationPastePlaceholder(): string {
  const fmt = normalizeAiTranslationFormat(state.aiTranslationFormat);
  if (fmt === AI_TRANSLATION_FORMAT_BLOCK) {
    return `[line 12]\nspeaker: Spica\ntext: Selamat pagi\n\n[line 13]\nspeaker: Mugi\ntext: Mau ngapain hari ini?`;
  }
  if (fmt === AI_TRANSLATION_FORMAT_XML) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<lines>\n  <line num="12" speaker="Spica">\n    <text>Selamat pagi</text>\n  </line>\n  <line num="13">\n    <text>Mau ngapain hari ini?</text>\n  </line>\n</lines>`;
  }
  if (fmt === AI_TRANSLATION_FORMAT_JSONL) {
    return `{"num":12,"speaker":"Spica","text":"Selamat pagi"}\n{"num":13,"text":"Mau ngapain hari ini?"}`;
  }
  if (fmt === AI_TRANSLATION_FORMAT_JSON_ARRAY) {
    return `[12,"Spica","Selamat pagi"]\n[13,"Mau ngapain hari ini?"]`;
  }
  return `12. Spica: Selamat pagi\n13. Mugi: Mau ngapain hari ini?`;
}

export function detectTranslationPasteFormat(text: string): string {
  const clean = stripPlaintextFences(text).trim();
  if (!clean) return normalizeAiTranslationFormat(state.aiTranslationFormat);
  if (/^\s*\[line\s+\d+\]\s*$/im.test(clean)) return AI_TRANSLATION_FORMAT_BLOCK;
  if (/^\s*\d+\s*[.)]\s*/m.test(clean)) return AI_TRANSLATION_FORMAT_NUMBERED;
  if (/(?:<\?xml\b|<lines\b|<line\s+num=)/i.test(clean)) return AI_TRANSLATION_FORMAT_XML;
  if (/^\s*\{"num"\s*:\s*\d+/m.test(clean)) return AI_TRANSLATION_FORMAT_JSONL;
  if (/^\s*\[\s*\d+\s*,/m.test(clean)) return AI_TRANSLATION_FORMAT_JSON_ARRAY;
  return normalizeAiTranslationFormat(state.aiTranslationFormat);
}

export function parseTranslationXml(text: string): ParsedTranslationItem[] {
  // Hanya strip baris code fence (```xml, ```), jangan hapus <lines> atau <?xml?>
  // karena DOMParser butuh root element yang utuh.
  const stripped = String(text || '')
    .split(/\r?\n/)
    .filter(line => !/^\s*```(?:xml)?\s*$/i.test(line.trim()))
    .join('\n')
    .trim();
  const parser = new DOMParser();
  const doc = parser.parseFromString(stripped, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('XML tidak valid: ' + parseErr.textContent!.slice(0, 100));
  const lineEls = doc.querySelectorAll('line');
  if (!lineEls.length) throw new Error('Tidak ada elemen <line> yang valid di XML.');
  const result: ParsedTranslationItem[] = [];
  for (const el of lineEls) {
    const num = parseInt(el.getAttribute('num')!, 10);
    if (isNaN(num)) throw new Error(`Elemen <line> tanpa atribut num yang valid.`);
    const speaker = (el.getAttribute('speaker') || '').trim() || null;
    const textEl = el.querySelector('text');
    if (!textEl) throw new Error(`[#${num}] Tidak ada elemen <text>.`);
    const rawMsg = textEl.textContent!;
    result.push({ num, name: speaker, msg: escapeStoredNewlines(rawMsg), rawMsg });
  }
  return result;
}

export function parseTranslationJsonArray(text: string): { parsed: ParsedTranslationItem[]; errors: string[] } {
  const parsed: ParsedTranslationItem[] = [];
  const errors: string[] = [];
  const clean = stripPlaintextFences(text).trim();
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    try {
      const arr = JSON.parse(rawLine);
      if (Array.isArray(arr) && arr.length === 3) {
        // [id, "name", "text"]
        parsed.push({ num: parseInt(arr[0]), name: String(arr[1]), msg: escapeStoredNewlines(String(arr[2])), rawMsg: String(arr[2]) });
      } else if (Array.isArray(arr) && arr.length === 2) {
        // [id, "text"] — no speaker name
        parsed.push({ num: parseInt(arr[0]), name: '', msg: escapeStoredNewlines(String(arr[1])), rawMsg: String(arr[1]) });
      } else {
        errors.push(`Baris ${i + 1}: Format array tidak valid.`);
      }
    } catch (e: any) {
      errors.push(`Baris ${i + 1}: Gagal parse JSON (${e.message}).`);
    }
  }
  return { parsed, errors };
}

export function parseTranslationJsonl(text: string): { parsed: ParsedTranslationItem[]; errors: string[] } {
  const stripped = stripPlaintextFences(text).trim();
  const rawLines = stripped.split(/\r?\n/);
  const parsed: ParsedTranslationItem[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const txt = rawLines[i].trim();
    if (!txt) continue;
    let obj: any;
    try {
      obj = JSON.parse(txt);
    } catch (e: any) {
      errors.push(`[Baris ${i + 1}] JSON tidak valid: "${txt.substring(0, 40)}"`);
      continue;
    }
    if (typeof obj.num !== 'number' || isNaN(obj.num)) {
      errors.push(`[Baris ${i + 1}] Field "num" tidak ada atau bukan angka.`);
      continue;
    }
    if (typeof obj.text !== 'string') {
      errors.push(`[Baris ${i + 1} / #${obj.num}] Field "text" tidak ada.`);
      continue;
    }
    const speaker = (obj.speaker || '').trim() || null;
    const rawMsg = obj.text;
    parsed.push({ num: obj.num, name: speaker, msg: escapeStoredNewlines(rawMsg), rawMsg });
  }
  return { parsed, errors };
}

export function parseTranslationBlocks(text: string): ParsedTranslationItem[] {
  const lines = stripPlaintextFences(text).split(/\r?\n/);
  const blocks: { num: number; name: string | null; msg: string }[] = [];
  let current: { num: number; name: string | null; msg: string } | null = null;
  let inText = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed === '```' || trimmed === '```plaintext' || trimmed === '```text') continue;
    const header = trimmed.match(/^\[line\s+(\d+)\]$/i);
    if (header) {
      if (current) blocks.push(current);
      current = { num: Number(header[1]), name: null, msg: '' };
      inText = false;
      continue;
    }
    if (!current) throw new Error(`Baris tanpa header [line N]: "${trimmed.slice(0, 50)}"`);
    const speakerMatch = trimmed.match(/^speaker\s*:\s*(.*)$/i);
    if (speakerMatch) {
      inText = false;
      current.name = speakerMatch[1].trim() || null;
      continue;
    }
    const textMatch = trimmed.match(/^text\s*:\s*(.*)$/i);
    if (textMatch) {
      inText = true;
      current.msg = textMatch[1];
      continue;
    }
    if (/^type\s*:/i.test(trimmed)) {
      inText = false;
      continue;
    }
    if (inText) {
      current.msg = current.msg ? `${current.msg}\n${rawLine}` : rawLine;
      continue;
    }
    throw new Error(`Format field rusak pada line ${current.num}: "${trimmed.slice(0, 50)}"`);
  }
  if (current) blocks.push(current);
  if (!blocks.length) throw new Error('Tidak ada blok [line N] yang valid.');
  return blocks.map(item => ({
    num: item.num,
    name: item.name,
    msg: escapeStoredNewlines(item.msg),
    rawMsg: item.msg,
  }));
}

export function parseTranslationNumberedPaste(text: string): { parsed: ParsedTranslationItem[]; errors: string[] } {
  const rawLines = stripPlaintextFences(text).split(/\r?\n/);
  const parsed: ParsedTranslationItem[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const txt = rawLines[i].trim();
    if (!txt) continue;
    const match = txt.match(/^\s*(\d+)\s*[.)]\s*(.*)$/);
    if (!match) {
      errors.push(`[Baris ${i + 1}] Format rusak (Harus "Angka. Teks") -> "${txt.substring(0, 25)}..."`);
      continue;
    }
    const num = Number(match[1]);
    let name: string | null = null;
    let msg = match[2].trim();
    const rawMsg = msg;
    const colonIdx = msg.indexOf(':');
    const jpColonIdx = msg.indexOf('：');
    let splitIdx = -1;
    if (colonIdx !== -1 && jpColonIdx !== -1) splitIdx = Math.min(colonIdx, jpColonIdx);
    else if (colonIdx !== -1) splitIdx = colonIdx;
    else if (jpColonIdx !== -1) splitIdx = jpColonIdx;
    if (splitIdx !== -1) {
      name = msg.substring(0, splitIdx).trim();
      msg = msg.substring(splitIdx + 1).trim();
    }
    parsed.push({ num, name, msg: escapeStoredNewlines(msg), rawMsg });
  }
  return { parsed, errors };
}
