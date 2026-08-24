// @module custom-parser-modal.ts — UI kelola parser custom (list, editor, uji parser).

import { ui } from './state';
import { openModal, closeModal } from './project';
import { flashHint } from './render';
import {
  loadCustomParsers, upsertCustomParser, deleteCustomParser, setCustomParserEnabled,
  createCustomParserId, normalizeExtensions, getCustomImportAccept, isValidCustomParser,
} from './custom-parsers';
import { runCustomParse } from './custom-parser-runner';
import { decodeArrayBuffer } from './binary-utils';
import type { CustomParser, CustomParsedEntry } from './types';

let editingId: string | null | undefined = undefined; // undefined = list view, null = parser baru
let testFile: File | null = null;

// ─── Templates ────────────────────────────────────────────────────────────────

const JS_PARSE_TEMPLATE = `// Parser custom CSTL — JavaScript
// ctx = { fileName, text, bytes, startLineNum }
// Return: array of { name?, message, raw? } — message wajib.
async function parse(ctx) {
  const rows = [];
  for (const raw of ctx.text.split(/\\r?\\n/)) {
    // Contoh: baris "Nama: dialog", atau dialog polos.
    const m = raw.match(/^([A-Za-z0-9_]+)\\s*:\\s*(.+)$/);
    if (m) {
      rows.push({ name: m[1], message: m[2], raw: raw });
    } else if (raw.trim()) {
      rows.push({ message: raw, raw: raw });
    }
  }
  return rows;
}`;

const JS_SERIALIZE_TEMPLATE = `// serialize(ctx) — opsional, untuk ekspor round-trip.
// ctx = { fileName, text, bytes, lines } — setiap line punya field:
//   name, message, trans_name, trans_message, is_translated, raw
// Return: string (atau Uint8Array untuk file biner).
async function serialize(ctx) {
  const out = ctx.text.split(/\\r?\\n/);
  for (const line of ctx.lines) {
    if (!line.is_translated || !line.raw) continue;
    const translated =
      (line.trans_name ? line.trans_name + ': ' : '') + (line.trans_message || '');
    // lastIndexOf: baris asli yang identik dipatch dari belakang agar tidak
    // salib menimpa — cocokkan dengan urutan parse() yang mengambil dari depan.
    const idx = out.lastIndexOf(line.raw);
    if (idx >= 0) out[idx] = translated;
    else console.warn('serialize: raw tidak ditemukan di file asli:', line.raw.slice(0, 40));
  }
  return out.join('\\n');
}`;

const PY_PARSE_TEMPLATE = `# Parser custom CSTL — Python (jalan di pyodide)
# ctx = {"fileName": str, "text": str, "bytes": bytes, "startLineNum": int}
# Return: list of {"name": str, "message": str, "raw": str} — message wajib.
import re

def parse(ctx):
    rows = []
    for raw in ctx["text"].splitlines():
        m = re.match(r"^([A-Za-z0-9_]+)\\s*:\\s*(.+)$", raw)
        if m:
            rows.append({"name": m.group(1), "message": m.group(2), "raw": raw})
        elif raw.strip():
            rows.append({"message": raw, "raw": raw})
    return rows`;

const PY_SERIALIZE_TEMPLATE = `# serialize(ctx) — opsional, untuk ekspor round-trip.
# ctx = {"fileName", "text", "bytes", "lines"} — setiap line (dict) punya:
#   name, message, trans_name, trans_message, is_translated, raw
# Return: str (atau bytes untuk format biner).
def serialize(ctx):
    out = ctx["text"].splitlines()
    for line in ctx["lines"]:
        if not line["is_translated"] or not line.get("raw"):
            continue
        prefix = line["trans_name"] + ": " if line.get("trans_name") else ""
        translated = prefix + (line["trans_message"] or "")
        # rindex: baris asli yang identik dipatch dari belakang agar tidak
        # salib menimpa — cocokkan dengan urutan parse() yang mengambil dari depan.
        try:
            out[out.rindex(line["raw"])] = translated
        except ValueError:
            print("serialize: raw tidak ditemukan di file asli:", line["raw"][:40])
    return "\\n".join(out)`;

// ─── View helpers ─────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]);
}

export function updateCustomImportAccept(): void {
  const input = ui.importCustomInput as HTMLInputElement | undefined;
  if (!input) return;
  const accept = getCustomImportAccept();
  input.accept = accept; // kosong = semua tipe file boleh dipilih
}

export function openCustomParserModal(): void {
  showListView();
  (ui.customParserModal as HTMLElement) && openModal(ui.customParserModal as HTMLElement);
}

function showListView(): void {
  editingId = undefined;
  testFile = null;
  (ui.cpEditView as HTMLElement).style.display = 'none';
  (ui.cpListView as HTMLElement).style.display = '';
  (ui.btnCpSave as HTMLElement).style.display = '';
  (ui.btnCpSave as HTMLButtonElement).disabled = true;
  (ui.btnCpCancel as HTMLElement).textContent = 'Tutup';
  renderParserList();
}

function showEditView(parser: CustomParser | null): void {
  editingId = parser ? parser.id : null;
  (ui.cpListView as HTMLElement).style.display = 'none';
  (ui.cpEditView as HTMLElement).style.display = '';
  (ui.btnCpSave as HTMLElement).style.display = '';
  (ui.btnCpSave as HTMLButtonElement).disabled = false;
  (ui.btnCpCancel as HTMLElement).textContent = 'Batal';
  (ui.cpNameInput as HTMLInputElement).value = parser?.name || '';
  (ui.cpLanguageSelect as HTMLSelectElement).value = parser?.language || 'js';
  (ui.cpExtensionsInput as HTMLInputElement).value = (parser?.extensions || []).join(', ');
  (ui.cpParseInput as HTMLTextAreaElement).value = parser?.parseScript || '';
  (ui.cpSerializeInput as HTMLTextAreaElement).value = parser?.serializeScript || '';
  setTestFile(null);
  renderTestResult(null);
}

function renderParserList(): void {
  const container = ui.cpParserList as HTMLElement;
  if (!container) return;
  const parsers = loadCustomParsers();
  if (parsers.length === 0) {
    container.innerHTML =
      '<div class="cp-empty">Belum ada parser custom. Klik <b>+ Parser Baru</b> untuk membuat parser ' +
      'JavaScript/Python untuk format file game apa pun — atau salin template contoh yang tersedia.</div>';
    return;
  }
  container.innerHTML = parsers.map(p => `
    <div class="cp-card" data-id="${escapeHtml(p.id)}">
      <div class="cp-card-info">
        <div class="cp-card-name">${escapeHtml(p.name)}
          <span class="cp-badge ${p.language === 'python' ? 'cp-badge-py' : 'cp-badge-js'}">${p.language === 'python' ? 'Python' : 'JS'}</span>
          <span class="cp-badge ${p.enabled ? 'cp-badge-on' : 'cp-badge-off'}">${p.enabled ? 'Aktif' : 'Nonaktif'}</span>
        </div>
        <div class="cp-card-ext">${escapeHtml(p.extensions.join(', '))}</div>
      </div>
      <div class="cp-card-actions">
        <button class="btn btn-sm btn-outline" data-action="toggle" type="button">${p.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button>
        <button class="btn btn-sm btn-outline" data-action="edit" type="button">Edit</button>
        <button class="btn btn-sm btn-outline" data-action="export" type="button" title="Unduh parser ini sebagai file JSON">Ekspor</button>
        <button class="btn btn-sm btn-danger" data-action="delete" type="button">Hapus</button>
      </div>
    </div>
  `).join('');
}

// ─── Editor read/validate ─────────────────────────────────────────────────────

function readEditorIntoParser(existing: CustomParser | null): CustomParser {
  const name = (ui.cpNameInput as HTMLInputElement).value.trim();
  const language = (ui.cpLanguageSelect as HTMLSelectElement).value === 'python' ? 'python' : 'js';
  const extensions = normalizeExtensions((ui.cpExtensionsInput as HTMLInputElement).value);
  const parseScript = (ui.cpParseInput as HTMLTextAreaElement).value;
  const serializeScript = (ui.cpSerializeInput as HTMLTextAreaElement).value;
  if (!name) throw new Error('Nama parser wajib diisi.');
  if (extensions.length === 0) throw new Error('Minimal satu ekstensi file (mis. .mgs).');
  if (!parseScript.trim()) throw new Error('Script parse(ctx) wajib diisi.');
  const now = Date.now();
  return {
    id: existing ? existing.id : createCustomParserId(),
    name, language, extensions, parseScript, serializeScript,
    enabled: existing ? existing.enabled : true,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
}

/** Parser dari isi editor saat ini (tanpa menyimpan) — untuk Uji Parser. */
function parserFromEditorUnchecked(): CustomParser {
  const language = (ui.cpLanguageSelect as HTMLSelectElement).value === 'python' ? 'python' : 'js';
  return {
    id: editingId || createCustomParserId(),
    name: (ui.cpNameInput as HTMLInputElement).value.trim() || '(tanpa nama)',
    language,
    extensions: normalizeExtensions((ui.cpExtensionsInput as HTMLInputElement).value),
    parseScript: (ui.cpParseInput as HTMLTextAreaElement).value,
    serializeScript: (ui.cpSerializeInput as HTMLTextAreaElement).value,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── Test run ─────────────────────────────────────────────────────────────────

function setTestFile(f: File | null): void {
  testFile = f;
  (ui.cpTestFileName as HTMLElement).textContent = f ? f.name : '';
  (ui.btnCpTestRun as HTMLButtonElement).disabled = !f;
}

function renderTestResult(result: { entries: CustomParsedEntry[]; error?: string } | null): void {
  const el = ui.cpTestResult as HTMLElement;
  if (!el) return;
  if (!result) { el.innerHTML = ''; el.classList.remove('cp-test-error'); return; }
  if (result.error) {
    el.classList.add('cp-test-error');
    el.textContent = 'Error: ' + result.error;
    return;
  }
  el.classList.remove('cp-test-error');
  const entries = result.entries;
  if (entries.length === 0) {
    el.innerHTML = '<em>parse() tidak mengembalikan baris dengan message — cek script.</em>';
    return;
  }
  const rows = entries.slice(0, 30).map((e, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(e.name || '')}</td><td>${escapeHtml(e.message)}</td></tr>
  `).join('');
  const more = entries.length > 30 ? `<tr><td colspan="3"><em>...dan ${entries.length - 30} baris lainnya (total ${entries.length})</em></td></tr>` : '';
  el.innerHTML = `<div class="cp-test-count">${entries.length} baris terdeteksi — pratinjau 30 pertama:</div>
    <table class="cp-test-table"><thead><tr><th>#</th><th>Nama</th><th>Message</th></tr></thead><tbody>${rows}${more}</tbody></table>`;
}

async function runTestParse(): Promise<void> {
  if (!testFile) return;
  const parser = parserFromEditorUnchecked();
  if (!parser.parseScript.trim()) {
    renderTestResult({ entries: [], error: 'Script parse(ctx) masih kosong.' });
    return;
  }
  (ui.btnCpTestRun as HTMLButtonElement).disabled = true;
  renderTestResult(null);
  flashHint('Menjalankan uji parser...', true);
  try {
    const buf = await testFile.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const entries = await runCustomParse(parser, {
      fileName: testFile.name,
      text: decodeArrayBuffer(bytes),
      bytes,
      startLineNum: 1,
    });
    renderTestResult({ entries });
    flashHint(`Uji parser OK: ${entries.length} baris.`);
  } catch (err: any) {
    renderTestResult({ entries: [], error: err?.message || String(err) });
    flashHint('Uji parser gagal.', false);
  } finally {
    (ui.btnCpTestRun as HTMLButtonElement).disabled = false;
  }
}

// ─── Export / import parser sebagai file JSON ─────────────────────────────────

/** Unduh satu parser (atau semua) sebagai file .json — bisa diimpor lagi di
 *  browser/perangkat lain lewat tombol Impor Parser. */
function exportParsersToJson(id?: string): void {
  const parsers = id ? loadCustomParsers().filter(p => p.id === id) : loadCustomParsers();
  if (parsers.length === 0) return;
  const payload = {
    type: 'cstl_custom_parsers',
    version: 1,
    exportedAt: new Date().toISOString(),
    parsers,
  };
  const b = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = parsers.length === 1
    ? `cstl-parser-${parsers[0].name.replace(/[<>:"\\/\\|?*]/g, '_').trim() || 'custom'}.json`
    : 'cstl-parsers-semua.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importParsersFromJson(file: File): Promise<void> {
  let parsed: any;
  try {
    parsed = JSON.parse(await file.text());
  } catch (_) {
    alert('File bukan JSON yang valid.');
    return;
  }
  const arr = Array.isArray(parsed?.parsers) ? parsed.parsers : (Array.isArray(parsed) ? parsed : null);
  if (!arr) {
    alert('Format tidak dikenali. Gunakan file hasil "Ekspor Parser" CSTL.');
    return;
  }
  const valid = arr.filter(isValidCustomParser);
  const skipped = arr.length - valid.length;
  if (valid.length === 0) {
    alert('Tidak ada parser valid di file tersebut.');
    return;
  }
  // Cek keberadaan SEBELUM upsert agar jumlah baru/diperbarui akurat.
  const knownIds = new Set(loadCustomParsers().map(x => x.id));
  let added = 0, updated = 0;
  for (const p of valid) {
    if (knownIds.has(p.id)) updated++; else added++;
    upsertCustomParser(p);
  }
  updateCustomImportAccept();
  renderParserList();
  flashHint(`Impor parser: ${added} baru, ${updated} diperbarui${skipped > 0 ? `, ${skipped} dilewati (tidak valid)` : ''}.`);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initCustomParserModal(): void {
  ui.btnCustomParsers?.addEventListener('click', openCustomParserModal);

  ui.btnCpExportAll?.addEventListener('click', () => {
    if (loadCustomParsers().length === 0) {
      alert('Belum ada parser untuk diekspor.');
      return;
    }
    exportParsersToJson();
  });

  ui.btnCpImportParsers?.addEventListener('click', () => (ui.cpParserImportInput as HTMLInputElement).click());
  ui.cpParserImportInput?.addEventListener('change', async (ev: Event) => {
    const target = ev.target as HTMLInputElement;
    const f = target.files?.[0];
    if (f) await importParsersFromJson(f);
    target.value = '';
  });

  ui.btnCpNew?.addEventListener('click', () => showEditView(null));

  ui.btnCpImportNow?.addEventListener('click', () => {
    closeModal(ui.customParserModal as HTMLElement);
    updateCustomImportAccept();
    (ui.importCustomInput as HTMLInputElement).click();
  });

  ui.btnCpImportFolderNow?.addEventListener('click', () => {
    closeModal(ui.customParserModal as HTMLElement);
    updateCustomImportAccept();
    (ui.importCustomFolderInput as HTMLInputElement).click();
  });

  ui.cpParserList?.addEventListener('click', (ev: Event) => {
    const target = ev.target as HTMLElement;
    const card = target.closest?.('.cp-card') as HTMLElement | null;
    if (!card) return;
    const id = card.getAttribute('data-id') || '';
    const action = (target.closest?.('[data-action]') as HTMLElement | null)?.getAttribute('data-action');
    const parser = loadCustomParsers().find(p => p.id === id);
    if (!parser) return;
    if (action === 'edit') {
      showEditView(parser);
    } else if (action === 'export') {
      exportParsersToJson(id);
    } else if (action === 'toggle') {
      setCustomParserEnabled(id, !parser.enabled);
      updateCustomImportAccept();
      renderParserList();
    } else if (action === 'delete') {
      if (confirm(`Hapus parser "${parser.name}"?\n\nProyek yang memakai parser ini tetap bisa dibuka, tapi ekspornya jatuh ke JSON.`)) {
        deleteCustomParser(id);
        updateCustomImportAccept();
        renderParserList();
        flashHint(`Parser "${parser.name}" dihapus.`);
      }
    }
  });

  ui.btnCpParseTemplate?.addEventListener('click', () => {
    const lang = (ui.cpLanguageSelect as HTMLSelectElement).value;
    if ((ui.cpParseInput as HTMLTextAreaElement).value.trim() && !confirm('Ganti isi parse(ctx) dengan template contoh?')) return;
    (ui.cpParseInput as HTMLTextAreaElement).value = lang === 'python' ? PY_PARSE_TEMPLATE : JS_PARSE_TEMPLATE;
  });

  ui.btnCpSerializeTemplate?.addEventListener('click', () => {
    const lang = (ui.cpLanguageSelect as HTMLSelectElement).value;
    if ((ui.cpSerializeInput as HTMLTextAreaElement).value.trim() && !confirm('Ganti isi serialize(ctx) dengan template contoh?')) return;
    (ui.cpSerializeInput as HTMLTextAreaElement).value = lang === 'python' ? PY_SERIALIZE_TEMPLATE : JS_SERIALIZE_TEMPLATE;
  });

  ui.btnCpTestFile?.addEventListener('click', () => (ui.cpTestFileInput as HTMLInputElement).click());
  ui.cpTestFileInput?.addEventListener('change', (ev: Event) => {
    const target = ev.target as HTMLInputElement;
    setTestFile(target.files?.[0] || null);
    target.value = '';
  });
  ui.btnCpTestRun?.addEventListener('click', runTestParse);

  ui.btnCpCancel?.addEventListener('click', () => {
    if (editingId !== undefined) {
      showListView();
    } else {
      closeModal(ui.customParserModal as HTMLElement);
    }
  });

  ui.btnCpSave?.addEventListener('click', () => {
    const existing = editingId != null ? (loadCustomParsers().find(p => p.id === editingId) || null) : null;
    let parser: CustomParser;
    try {
      parser = readEditorIntoParser(existing);
    } catch (err: any) {
      alert(err.message);
      return;
    }
    const builtinOverlap = parser.extensions.filter(ext => ['.json', '.epub', '.txt'].includes(ext));
    if (builtinOverlap.length > 0) {
      const ok = confirm(
        `Parser ini mendaftarkan ekstensi bawaan CSTL: ${builtinOverlap.join(', ')}.\n` +
        'Parser custom akan MENGALAHKAN impor built-in untuk ekstensi tersebut.\n\nTetap simpan?'
      );
      if (!ok) return;
    }
    const dupe = loadCustomParsers().find(p => p.id !== parser.id && p.name.toLowerCase() === parser.name.toLowerCase());
    if (dupe && !confirm(`Sudah ada parser bernama "${dupe.name}". Simpan dengan nama yang sama?`)) return;
    upsertCustomParser(parser);
    updateCustomImportAccept();
    flashHint(`Parser "${parser.name}" disimpan.`);
    showListView();
  });
}
