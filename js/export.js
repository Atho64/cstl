// @module export.js — Project export: JSON, EPUB, and LucaTxt formats

import { state, ui } from './state.js';
import { isTranslated } from './state.js';
import { unescapeStoredNewlines } from './string-utils.js';
import {
  buildLucaExportText, applyLucaMessageExport, applyLucaSelectExport,
  getLucaFileLineBytes, patchMessageQuotedArgBytes, normalizeTomoyoMessageLineBytes,
  splitLucaArgs, getActiveLucaProfile,
  countTomoyoBadEmbeddedPrefixes, buildTomoyoQuotedArgBytes, normalizeTomoyoMessageLinesInArray,
} from './luca-engine.js';
import { buildSafeFileName } from './glossary.js';
import { base64ToArrayBuffer, joinLinesToBuffer, arrayBufferToBase64, latin1BytesToString } from './binary-utils.js';
import { WINDOWS_FILE_ORDER_COLLATOR, APP_VERSION } from './constants.js';
import { flashHint } from './render.js';
import { getOpfsRoot } from './state.js';

export function onCopyForAi(ctxLines) {
  const ctxOut = [];
  for (const l of ctxLines) {
    const dN = l.name ? `${l.name}: ` : "";
    if (state.contextType === "raw") {
      ctxOut.push(`${dN}${l.message}`);
    } else if (state.contextType === "both") {
      ctxOut.push(`[Original] ${dN}${l.message}\n[Translated] ${dN}${l.trans_message || ""}`);
    } else {
      ctxOut.push(`${dN}${l.trans_message || l.message}`);
    }
  }
  navigator.clipboard.writeText(ctxOut.join("\n\n"));
  flashHint("Teks disalin ke clipboard!");
}

export function confirmExportWithUntranslatedReport() {
  const untranslated = state.lines.filter(l => !isTranslated(l));
  if (!untranslated.length) return true;

  const preview = untranslated.slice(0, 12).map(l => {
    const text = l.name ? `${l.name}: ${l.message}` : l.message;
    const shortText = text.length > 70 ? `${text.slice(0, 67)}...` : text;
    return `#${l.line_num} (${l.file}) ${shortText}`;
  }).join("\n");
  const rest = untranslated.length > 12 ? `\n...dan ${untranslated.length - 12} baris lainnya.` : "";
  return confirm(
    `Masih ada ${untranslated.length} baris yang belum diterjemahkan.\n\n${preview}${rest}\n\nLanjut ekspor tetap?`
  );
}

export async function onExport() {
  if (!state.lines.length) return;
  if (!confirmExportWithUntranslatedReport()) return;
  
  if (state.projectType === "epub" && state.epubSourceId) {
    try {
      flashHint("Membangun file EPUB...", true);
      document.body.style.cursor = "wait";
      const root = await getOpfsRoot();
      const fh = await root.getFileHandle(state.epubSourceId);
      const f = await fh.getFile();
      const zip = await window.JSZip.loadAsync(f);
      
      const linesByFile = {};
      state.lines.forEach(l => {
        if (!linesByFile[l.file]) linesByFile[l.file] = [];
        linesByFile[l.file].push(l);
      });

      const tagsSelector = state.epubTags || "p";

      for (const [href, fLines] of Object.entries(linesByFile)) {
        const zf = zip.file(href);
        if (!zf) continue;
        const html = await zf.async("text");
        const xmlMatch = html.match(/^<\?xml.*?\?>/i);
        const xmlHeader = xmlMatch ? xmlMatch[0] + "\n" : "";
        const doc = new DOMParser().parseFromString(html, href.endsWith('.xhtml') ? "application/xhtml+xml" : "text/html");
        const els = Array.from(doc.querySelectorAll(tagsSelector));
        
        let lineIdx = 0;
        for (const el of els) {
          if (el.textContent.replace(/\r?\n/g, " ").trim() === "") continue;
          const l = fLines[lineIdx++];
          if (l && isTranslated(l)) {
            el.textContent = l.trans_message || "";
          }
        }
        
        let newHtml = new XMLSerializer().serializeToString(doc);
        if (xmlHeader && !newHtml.startsWith("<?xml")) {
          newHtml = xmlHeader + newHtml;
        }
        zip.file(href, newHtml);
      }

      if (zip.file("mimetype")) {
        const mimeData = await zip.file("mimetype").async("text");
        zip.file("mimetype", mimeData, { compression: "STORE" });
      }

      const blob = await zip.generateAsync({
        type: "blob",
        mimeType: "application/epub+zip",
        compression: "DEFLATE",
        compressionOptions: { level: 9 }
      });

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const safeName = state.projectName.replace(/[<>:"\/\\|?*]/g, '_').trim() || 'export';
      a.download = `${safeName}_tl.epub`;
      a.click();
      flashHint("Berhasil mengekspor EPUB!");
    } catch (err) {
      alert("Gagal mengekspor EPUB: " + err.message);
    } finally {
      document.body.style.cursor = "default";
    }
  } else if (state.projectType === "luca") {
    // ─── LucaSystem TXT Export ────────────────────────────────────────────
    try {
      flashHint("Mengekspor TXT Luca...", true);
      document.body.style.cursor = "wait";
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const profile = getActiveLucaProfile();
      const exportLang = state.lucaExportLang || "en";
      if (profile.id === "tomoyo-switch") {
        const missingBuffers = state.importedFiles.filter((f) => !state.lucaRawBuffers[f]);
        if (missingBuffers.length > 0) {
          alert(
            "Tomoyo export butuh impor ulang folder decompile lucksystem (SCRIPT.PAK\\*.txt) " +
            "agar CSTL menyimpan raw buffer per file.\n\n" +
            `CSTL ${APP_VERSION} | raw buffer hilang: ${missingBuffers.length} file`
          );
          return;
        }
        const exportSlot = profile.messageExportSlot(exportLang);
        const badEmbeddedPrefix = countTomoyoBadEmbeddedPrefixes(exportSlot);
        if (badEmbeddedPrefix > 0) {
          const messageCount = state.lines.filter((l) => l.luca_command === "MESSAGE" || l.luca_command === "MESSAGE_WAIT").length;
          alert(
            "Tomoyo txt masih berisi byte prefix (c1 ff / U+FFFD) di dalam tanda kutip. " +
            "Itu format decompile lucksystem lama — bukan decompiled_clean yang sudah diperbaiki.\n\n" +
            `CSTL ${APP_VERSION} | baris bermasalah: ${badEmbeddedPrefix}/${messageCount}\n` +
            "Jalankan ulang script decompile dengan lucksystem terbaru, atau strip_tomoyo_prefix.py."
          );
          return;
        }
      }
      const g = new Map();
      for (const l of state.lines) {
        if (!g.has(l.file)) g.set(l.file, []);
        g.get(l.file).push(l);
      }
      const useBinaryTomoyo = profile.id === "tomoyo-switch";
      const entries = Array.from(g.entries());
      const res = [];
      for (let fileIdx = 0; fileIdx < entries.length; fileIdx++) {
        const [fileName, lns] = entries[fileIdx];
        const rawLines = state.lucaRawFiles[fileName] ? [...state.lucaRawFiles[fileName]] : [];
        const outLines = rawLines.length > 0 ? [...rawLines] : [];
        const hasRawLines = outLines.length > 0;
        const cachedLineBytes = useBinaryTomoyo ? getLucaFileLineBytes(fileName) : null;
        const rawLineBytes = cachedLineBytes
          ? cachedLineBytes.map((line) => new Uint8Array(line))
          : null;
        const outLineBytes = rawLineBytes ? rawLineBytes.map((line) => new Uint8Array(line)) : null;
        const handledSelectRows = new Set();

        for (const l of lns) {
          if (!l.luca_raw) continue;
          const sourceRawLine = (hasRawLines && l.luca_raw_index != null && rawLines[l.luca_raw_index])
            ? rawLines[l.luca_raw_index]
            : l.luca_raw;
          const parenStart = sourceRawLine.indexOf("(");
          const parenEnd = sourceRawLine.lastIndexOf(")");
          if (parenStart === -1 || parenEnd === -1) continue;
          const args = splitLucaArgs(sourceRawLine.slice(parenStart + 1, parenEnd));

          if (l.luca_command === "SELECT") {
            const selectKey = l.luca_raw_index != null ? l.luca_raw_index : l.luca_raw;
            if (handledSelectRows.has(selectKey)) continue;
            handledSelectRows.add(selectKey);
            const patched = applyLucaSelectExport(
              profile,
              args,
              lns.filter(row => row.luca_command === "SELECT" && row.luca_raw_index === l.luca_raw_index)
                .sort((a, b) => (a.luca_choice_index || 0) - (b.luca_choice_index || 0)),
              exportLang
            );
            if (!patched) continue;
            const newRaw = l.luca_raw.slice(0, parenStart + 1) + patched.join(", ") + l.luca_raw.slice(parenEnd);
            if (hasRawLines && l.luca_raw_index != null && l.luca_raw_index < outLines.length) {
              outLines[l.luca_raw_index] = newRaw;
            }
            continue;
          }

          if (!isTranslated(l)) continue;

          if (
            useBinaryTomoyo &&
            outLineBytes &&
            l.luca_command === "MESSAGE" &&
            l.luca_raw_index != null &&
            l.luca_raw_index < outLineBytes.length
          ) {
            const slot = profile.messageExportSlot(exportLang);
            outLineBytes[l.luca_raw_index] = patchMessageQuotedArgBytes(
              outLineBytes[l.luca_raw_index],
              slot,
              buildTomoyoQuotedArgBytes(l)
            );
            continue;
          }

          const patched = applyLucaMessageExport(profile, args, l, exportLang, sourceRawLine);
          if (!patched) continue;
          const newRaw = sourceRawLine.slice(0, parenStart + 1) + patched.join(", ") + sourceRawLine.slice(parenEnd);
          if (hasRawLines && l.luca_raw_index != null && l.luca_raw_index < outLines.length) {
            outLines[l.luca_raw_index] = newRaw;
          }
        }

        const exportSlot = profile.messageExportSlot(exportLang);
        if (useBinaryTomoyo) {
          normalizeTomoyoMessageLinesInArray(outLines, exportSlot);
        }

        if (useBinaryTomoyo && outLineBytes) {
          for (let i = 0; i < outLineBytes.length; i++) {
            if (/\bMESSAGE(?:_WAIT)?\s*\(/i.test(latin1BytesToString(outLineBytes[i]))) {
              outLineBytes[i] = normalizeTomoyoMessageLineBytes(outLineBytes[i], exportSlot);
            }
          }
          for (let i = 0; i < outLines.length; i++) {
            if (outLines[i] !== rawLines[i]) {
              outLineBytes[i] = new TextEncoder().encode(outLines[i]);
            }
          }
          res.push({
            fn: fileName,
            content: joinLinesToBuffer(outLineBytes),
            binary: true,
          });
        } else {
          res.push({
            fn: fileName,
            content: outLines.join("\n"),
            binary: false,
          });
        }
        if (fileIdx % 2 === 1) await new Promise((r) => setTimeout(r, 0));
      }
      if (window.JSZip && res.length > 1) {
        const zip = new window.JSZip();
        res.forEach(f => zip.file(`SCRIPT.PAK/${f.fn}`, f.content));
        const b = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        const safeName = state.projectName.replace(/[<>:"\/\\|?*]/g, '_').trim() || 'export';
        a.download = `${safeName}_luca_export.zip`;
        a.click();
        flashHint("Berhasil mengekspor ZIP Luca!");
      } else {
        res.forEach(f => {
          const b = new Blob([f.content], { type: f.binary ? "application/octet-stream" : "text/plain;charset=utf-8" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = f.fn;
          a.click();
        });
        flashHint("Berhasil mengekspor TXT Luca!");
      }
    } finally {
      document.body.style.cursor = "default";
    }
  } else {
    const g = new Map();
    for (const l of state.lines) {
      if (!g.has(l.file)) g.set(l.file, []);
      g.get(l.file).push(l);
    }
    const res = Array.from(g.entries()).map(([fn, lns]) => ({
      fn: `${fn.replace(/\.xhtml|\.html/g, '')}.json`,
      content: JSON.stringify(lns.map(l => {
        const e = {};
        e.name = isTranslated(l) ? (l.trans_name || l.name) : l.name;
        e.message = isTranslated(l) ? l.trans_message : l.message;
        if (e.name) {
          e.name = e.name.replace(/\\n/g, "\n");
        } else {
          delete e.name;
        }
        if (e.message) e.message = e.message.replace(/\\n/g, "\n");
        return e;
      }), null, 2)
    }));
    if (window.JSZip && res.length > 1) {
      const zip = new window.JSZip();
      res.forEach(f => zip.file(f.fn, f.content));
      const b = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      const safeName = state.projectName.replace(/[<>:"\/\\|?*]/g, '_').trim() || 'export';
      a.download = `${safeName}_export.zip`;
      a.click();
    } else {
      res.forEach(f => {
        const b = new Blob([f.content], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = f.fn;
        a.click();
      });
    }
  }
}
