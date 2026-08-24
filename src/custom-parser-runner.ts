// @module custom-parser-runner.ts — Eksekusi sandbox untuk parser custom.
// JS parser jalan di Web Worker blob (fresh per panggilan, diberhentikan pakai
// timeout). Python parser jalan di worker pyodide yang dimuat lazy dari CDN
// (bundle app & PWA precache tidak terpengaruh).

import type { CustomParser, CustomParsedEntry } from './types';

// Batas eksekusi 10 menit flat agar file besar / parser berat tidak kepangkas
// di tengah jalan; infinite loop tetap terhenti (hanya lebih sabar menunggu).
const JS_TIMEOUT_MS = 600000;
const PY_EXEC_TIMEOUT_MS = 600000;
/** Unduhan pertama pyodide ~10MB — ikut dilonggarkan untuk koneksi lambat. */
const PY_LOAD_TIMEOUT_MS = 600000;

const PYODIDE_VERSION = 'v314.0.5';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

export interface CustomParseCtx {
  fileName: string;
  text: string;
  bytes: Uint8Array;
  startLineNum: number;
}

export interface CustomSerializeCtx extends CustomParseCtx {
  lines: Record<string, any>[];
}

export type CustomSerializeResult =
  | { kind: 'text'; content: string }
  | { kind: 'bytes'; content: Uint8Array };

// ─── JavaScript runner (blob worker, fresh per panggilan) ─────────────────────

function buildJsWorkerSource(parser: CustomParser): string {
  // Script user dibungkus function scope agar deklarasi `function parse(){}`
  // terlihat; RPC sederhana via postMessage.
  return '"use strict";\n'
    + 'var __parse = null, __serialize = null;\n'
    + 'var __user = (function () {\n'
    + parser.parseScript + '\n\n'
    + parser.serializeScript + '\n'
    + '  return [\n'
    + '    (typeof parse === "function") ? parse : null,\n'
    + '    (typeof serialize === "function") ? serialize : null,\n'
    + '  ];\n'
    + '})();\n'
    + '__parse = (__user && __user[0]) || null;\n'
    + '__serialize = (__user && __user[1]) || null;\n'
    + 'self.onmessage = async function (e) {\n'
    + '  var msg = e.data || {};\n'
    + '  try {\n'
    + '    var fn = msg.op === "serialize" ? __serialize : __parse;\n'
    + '    if (typeof fn !== "function") {\n'
    + '      throw new Error("Fungsi " + msg.op + "(ctx) tidak ditemukan di script parser.");\n'
    + '    }\n'
    + '    var result = await fn(msg.ctx);\n'
    + '    self.postMessage({ callId: msg.callId, ok: true, result: result });\n'
    + '  } catch (err) {\n'
    + '    self.postMessage({ callId: msg.callId, ok: false, error: (err && err.message) ? String(err.message) : String(err) });\n'
    + '  }\n'
    + '};\n';
}

function runJsCall(parser: CustomParser, op: 'parse' | 'serialize', ctx: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    let url: string;
    try {
      const src = buildJsWorkerSource(parser);
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (e: any) {
      reject(new Error('Gagal menyiapkan worker parser: ' + (e?.message || e)));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(
        `Parser ${op}() melebihi batas ${JS_TIMEOUT_MS / 1000} detik — script dihentikan. ` +
        'Kemungkinan infinite loop di parser.'
      )));
    }, JS_TIMEOUT_MS);
    worker.onmessage = (ev: MessageEvent) => {
      const d: any = ev.data;
      if (!d || d.callId === undefined) return;
      finish(() => d.ok ? resolve(d.result) : reject(new Error(String(d.error))));
    };
    worker.onerror = (ev: ErrorEvent) => {
      finish(() => reject(new Error('Error di script parser: ' + (ev.message || 'syntax error'))));
    };
    worker.postMessage({ callId: 1, op, ctx });
  });
}

// ─── Python runner (pyodide worker singleton, lazy dari CDN) ─────────────────

function buildPyodideWorkerSource(pyodideJs: string): string {
  // pyodide.js di-embed langsung ke blob worker (bukan importScripts) —
  // beberapa lingkungan browser memblokir importScripts lintas-origin di
  // worker, sementa fetch + embed tetap jalan. Aset berat (wasm/stdlib)
  // diambil sendiri oleh loadPyodide via fetch dari indexURL.
  return pyodideJs + '\n'
    + 'var __ready = globalThis.loadPyodide({ indexURL: "' + PYODIDE_BASE + '" });\n'
    + 'self.onmessage = async function (e) {\n'
    + '  var msg = e.data || {};\n'
    + '  try {\n'
    + '    var py = await __ready;\n'
    + '    py.runPython("def __cstl_tobytes(v):\\n'
    + '    if isinstance(v, (bytes, bytearray)):\\n'
    + '        return bytes(v)\\n'
    + '    if isinstance(v, memoryview):\\n'
    + '        return v.tobytes()\\n'
    + '    try:\\n'
    + '        return bytes(v)\\n'
    + '    except Exception:\\n'
    + '        return v\\n");\n'
    + '    if (msg.code) await py.runPythonAsync(msg.code);\n'
    + '    var fn = py.globals.get(msg.op);\n'
    + '    if (!fn || (typeof fn !== "function" && !fn.callable)) {\n'
    + '      var __names = [];\n'
    + '      try { __names = Array.from(py.globals.keys()).filter(function (k) { return /par|ser|ctx|def/i.test(String(k)); }); } catch (_) {}\n'
    + '      throw new Error("def " + msg.op + "(ctx) tidak ditemukan di script parser."\n'
    + '        + (__names.length ? " Nama mirip di globals: " + __names.join(", ") : ""));\n'
    + '    }\n'
    + '    var pyCtx = py.toPy(msg.ctx, { dict_converter: Object.fromEntries });\n'
    + '    var result;\n'
    + '    try {\n'
    + '      try {\n'
    + '        pyCtx.set("bytes", py.globals.get("__cstl_tobytes")(pyCtx.get("bytes")));\n'
    + '      } catch (_) {}\n'
    + '      result = await fn(pyCtx);\n'
    + '    } finally {\n'
    + '      try { pyCtx.destroy(); } catch (_) {}\n'
    + '    }\n'
    + '    var jsResult;\n'
    + '    if (result === null || result === undefined) jsResult = null;\n'
    + '    else if (typeof result === "string" || result instanceof Uint8Array) jsResult = result;\n'
    + '    else if (typeof result.toJs === "function") {\n'
    + '      jsResult = result.toJs({ dict_converter: Object.fromEntries });\n'
    + '      try { result.destroy(); } catch (_) {}\n'
    + '    } else jsResult = result;\n'
    + '    self.postMessage({ callId: msg.callId, ok: true, result: jsResult });\n'
    + '  } catch (err) {\n'
    + '    self.postMessage({ callId: msg.callId, ok: false, error: (err && err.message) ? String(err.message) : String(err) });\n'
    + '  }\n'
    + '};\n';
}

let pyWorker: Worker | null = null;
let pyWarm = false;
let pyActive: Promise<any> = Promise.resolve();
let pyOnColdStart: (() => void) | null = null;
let pyodideJsCache: string | null = null;

async function fetchPyodideJs(): Promise<string> {
  if (pyodideJsCache) return pyodideJsCache;
  const res = await fetch(PYODIDE_BASE + 'pyodide.js');
  if (!res.ok) {
    throw new Error(`Gagal mengunduh loader pyodide dari CDN (HTTP ${res.status}). Cek koneksi internet — Python parser butuh internet saat pemakaian pertama.`);
  }
  pyodideJsCache = await res.text();
  return pyodideJsCache;
}

/** Callback sekali untuk memberi tahu UI saat runtime Python mulai diunduh. */
export function setPyodideColdStartHint(hint: () => void): void {
  pyOnColdStart = hint;
}

function runPythonCall(parser: CustomParser, op: 'parse' | 'serialize', ctx: any): Promise<any> {
  // pyodide single instance — antre panggilan agar tidak tumpang tindih.
  const run = pyActive.then(async () => {
    let worker: Worker;
    if (pyWorker) {
      worker = pyWorker;
    } else {
      try {
        if (pyOnColdStart && !pyWarm) pyOnColdStart();
        const pyodideJs = await fetchPyodideJs();
        // pyodide v314+ mensyaratkan module worker (classic worker ditolak).
        worker = pyWorker = new Worker(
          URL.createObjectURL(new Blob([buildPyodideWorkerSource(pyodideJs)], { type: 'text/javascript' })),
          { type: 'module' }
        );
      } catch (e: any) {
        throw new Error('Gagal menyiapkan worker Python: ' + (e?.message || e));
      }
    }
    return await new Promise<any>((resolve, reject) => {
      const timeoutMs = pyWarm ? PY_EXEC_TIMEOUT_MS : PY_LOAD_TIMEOUT_MS;
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Worker dibunuh — instance berikutnya dimuat ulang (cache browser bikin cepat).
        worker.terminate();
        pyWorker = null;
        pyWarm = false;
        reject(err);
      };
      const timer = setTimeout(() => {
        fail(new Error(
          pyWarm
            ? `Parser ${op}() melebihi batas ${PY_EXEC_TIMEOUT_MS / 1000} detik — script dihentikan.`
            : 'Memuat runtime Python (pyodide) terlalu lama — cek koneksi internet lalu coba lagi.'
        ));
      }, timeoutMs);
      worker.onmessage = (ev: MessageEvent) => {
        const d: any = ev.data;
        if (!d || d.callId === undefined) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pyWarm = true;
        if (d.ok) resolve(d.result);
        else reject(new Error(String(d.error)));
      };
      worker.onerror = (ev: ErrorEvent) => {
        fail(new Error('Error runtime Python: ' + (ev.message || 'gagal memuat pyodide dari CDN')));
      };
      worker.postMessage({
        callId: 1,
        op,
        ctx,
        code: parser.parseScript + '\n\n' + parser.serializeScript,
      });
    });
  });
  pyActive = run.then(() => undefined, () => undefined);
  return run;
}

// ─── API publik + validasi hasil ──────────────────────────────────────────────

function typeName(v: any): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Uint8Array) return 'bytes';
  return typeof v;
}

export async function runCustomParse(parser: CustomParser, ctx: CustomParseCtx): Promise<CustomParsedEntry[]> {
  const raw = parser.language === 'python'
    ? await runPythonCall(parser, 'parse', ctx)
    : await runJsCall(parser, 'parse', ctx);
  if (!Array.isArray(raw)) {
    throw new Error(`parse() harus mengembalikan array [{ name?, message, raw? }], yang diterima: ${typeName(raw)}.`);
  }
  const entries: CustomParsedEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (item.message == null || String(item.message).trim() === '') continue;
    entries.push({
      name: item.name == null ? null : String(item.name),
      message: String(item.message),
      raw: item.raw == null ? null : String(item.raw),
      // index opsional dari parser — angka saja yang diterima, sisanya null.
      index: item.index == null ? null : (Number.isFinite(Number(item.index)) ? Number(item.index) : null),
    });
  }
  return entries;
}

export async function runCustomSerialize(parser: CustomParser, ctx: CustomSerializeCtx): Promise<CustomSerializeResult> {
  const raw = parser.language === 'python'
    ? await runPythonCall(parser, 'serialize', ctx)
    : await runJsCall(parser, 'serialize', ctx);
  if (typeof raw === 'string') return { kind: 'text', content: raw };
  if (raw instanceof Uint8Array) return { kind: 'bytes', content: raw };
  if (raw && (raw as any).buffer instanceof ArrayBuffer && (raw as any).constructor?.name?.endsWith('Array')) {
    return { kind: 'bytes', content: new Uint8Array((raw as any).buffer as ArrayBuffer) };
  }
  throw new Error(`serialize() harus mengembalikan string atau bytes, yang diterima: ${typeName(raw)}.`);
}
