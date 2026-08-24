// @module custom-parsers.ts — Store untuk parser buatan user (JavaScript/Python).
// Disimpan global di localStorage agar bisa dipakai lintas proyek,
// mengikuti pola cstl_api_settings di auto-translate.ts.

import type { CustomParser } from './types';

const CP_STORAGE_KEY = 'cstl_custom_parsers';

export function loadCustomParsers(): CustomParser[] {
  try {
    const raw = localStorage.getItem(CP_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidCustomParser);
  } catch (_) {
    return [];
  }
}

export function saveCustomParsers(parsers: CustomParser[]): void {
  localStorage.setItem(CP_STORAGE_KEY, JSON.stringify(parsers));
}

export function getCustomParser(id: string | null | undefined): CustomParser | null {
  if (!id) return null;
  return loadCustomParsers().find(p => p.id === id) || null;
}

export function upsertCustomParser(parser: CustomParser): void {
  const parsers = loadCustomParsers();
  const idx = parsers.findIndex(p => p.id === parser.id);
  if (idx >= 0) parsers[idx] = parser;
  else parsers.push(parser);
  saveCustomParsers(parsers);
}

export function deleteCustomParser(id: string): void {
  saveCustomParsers(loadCustomParsers().filter(p => p.id !== id));
}

export function setCustomParserEnabled(id: string, enabled: boolean): void {
  const parsers = loadCustomParsers();
  const p = parsers.find(x => x.id === id);
  if (p) {
    p.enabled = enabled;
    p.updatedAt = Date.now();
    saveCustomParsers(parsers);
  }
}

/** Parser aktif (enabled) yang cocok untuk ekstensi file ini, atau null. */
export function findCustomParserForFile(fileName: string): CustomParser | null {
  const lower = fileName.toLowerCase();
  return loadCustomParsers().find(p => p.enabled && p.extensions.some(ext => lower.endsWith(ext))) || null;
}

/** Nilai atribut accept untuk input file, dibangun dari ekstensi semua parser aktif. */
export function getCustomImportAccept(): string {
  const exts = new Set<string>();
  for (const p of loadCustomParsers()) {
    if (!p.enabled) continue;
    for (const ext of p.extensions) exts.add(ext);
  }
  return Array.from(exts).join(',');
}

export function createCustomParserId(): string {
  return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** Normalisasi input ekstensi user: "xyz, .Dat, .a.b" → ['.xyz', '.dat', '.a.b'] */
export function normalizeExtensions(input: string): string[] {
  const seen = new Set<string>();
  for (const part of String(input || '').split(/[,\s]+/)) {
    const ext = ('.' + part.trim().toLowerCase().replace(/^\.+/, '')).replace(/\.+$/, '');
    if (ext.length > 1) seen.add(ext);
  }
  return Array.from(seen);
}

/** Validasi bentuk objek CustomParser (mis. definisi dari file backup). */
export function isValidCustomParser(p: any): p is CustomParser {
  return !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string'
    && (p.language === 'js' || p.language === 'python')
    && typeof p.parseScript === 'string' && Array.isArray(p.extensions);
}
