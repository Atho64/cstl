// @module export.ts — Project export: JSON, EPUB, dan LucaTxt formats

import { state, ui } from './state';
import { isTranslated, isIlustrasiLine } from './state';
import { unescapeStoredNewlines } from './string-utils';
import {
  buildLucaExportText, applyLucaMessageExport, applyLucaSelectExport,
  getLucaFileLineBytes, patchMessageQuotedArgBytes, normalizeTomoyoMessageLineBytes,
  splitLucaArgs, getActiveLucaProfile,
  countTomoyoBadEmbeddedPrefixes, buildTomoyoQuotedArgBytes, normalizeTomoyoMessageLinesInArray,
} from './luca-engine';
import { buildSafeFileNameGlossary as buildSafeFileName } from './glossary';
import { base64ToArrayBuffer, joinLinesToBuffer, arrayBufferToBase64, latin1BytesToString } from './binary-utils';
import { WINDOWS_FILE_ORDER_COLLATOR, APP_VERSION } from './constants';
import { flashHint } from './render';
import { getOpfsRoot } from './state';
import { waitForLucaDataLoad, waitForCustomSourcesLoad } from './project';
import { getCustomParser } from './custom-parsers';
import { runCustomSerialize } from './custom-parser-runner';
import type { Line } from './types';

function writeTextNodeWithBreaks(node: Text, text: string): void {
  if (!text.includes('\n')) {
    node.data = text;
    return;
  }
  const fragment = document.createDocumentFragment();
  const parts = text.split('\n');
  parts.forEach((part, index) => {
    if (index > 0) fragment.appendChild(document.createElement('br'));
    fragment.appendChild(document.createTextNode(part));
  });
  node.parentNode?.replaceChild(fragment, node);
}

function replaceElementTextPreservingInlineStructure(el: Element, storedText: string): void {
  const text = unescapeStoredNewlines(storedText);

  // Ruby readings belong to the original language. Keeping them attached to
  // translated text produces incorrect annotations, so flatten ruby nodes to
  // their base text before distributing the translation.
  const rubyNodes = Array.from(el.querySelectorAll('ruby')).reverse();
  for (const ruby of rubyNodes) {
    const baseWalker = document.createTreeWalker(ruby, NodeFilter.SHOW_TEXT);
    const baseParts: string[] = [];
    let baseNode: Node | null;
    while ((baseNode = baseWalker.nextNode())) {
      const parent = (baseNode as Text).parentElement;
      if (!parent?.closest('rt, rp')) baseParts.push((baseNode as Text).data);
    }
    ruby.replaceWith(document.createTextNode(baseParts.join('')));
  }

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = (node as Text).parentElement;
    if (parent?.closest('rt, rp, script, style')) continue;
    textNodes.push(node as Text);
  }

  if (!textNodes.length) {
    el.textContent = text;
    return;
  }
  if (textNodes.length === 1) {
    writeTextNodeWithBreaks(textNodes[0], text);
    return;
  }

  // Keep the source's inline elements (em, ruby, links, etc.) and distribute
  // the translated text across their original text-node proportions. This is
  // only a best-effort mapping, but avoids flattening the inline structure.
  const sourceLength = textNodes.reduce((sum, textNode) => sum + textNode.data.length, 0);
  if (!sourceLength) {
    textNodes[0].data = text;
    for (let i = 1; i < textNodes.length; i++) textNodes[i].data = '';
    return;
  }
  let offset = 0;
  let sourceOffset = 0;
  for (let i = 0; i < textNodes.length; i++) {
    sourceOffset += textNodes[i].data.length;
    const end = i === textNodes.length - 1
      ? text.length
      : Math.round(text.length * sourceOffset / sourceLength);
    writeTextNodeWithBreaks(textNodes[i], text.slice(offset, end));
    offset = end;
  }
}

export function onCopyForAi(ctxLines: Line[]): void {
  const ctxOut: string[] = [];
  for (const l of ctxLines) {
    const dN = l.name ? `${l.name}: ` : '';
    if (state.contextType === 'raw') {
      ctxOut.push(`${dN}${l.message}`);
    } else if (state.contextType === 'both') {
      ctxOut.push(`[Original] ${dN}${l.message}\n[Translated] ${dN}${l.trans_message || ''}`);
    } else {
      ctxOut.push(`${dN}${l.trans_message || l.message}`);
    }
  }
  navigator.clipboard.writeText(ctxOut.join('\n\n'));
  flashHint('Teks disalin ke clipboard!');
}

export function confirmExportWithUntranslatedReport(): boolean {
  const untranslated = state.lines.filter(l => !isTranslated(l));
  if (!untranslated.length) return true;

  const preview = untranslated.slice(0, 12).map(l => {
    const text = l.name ? `${l.name}: ${l.message}` : l.message;
    const shortText = text.length > 70 ? `${text.slice(0, 67)}...` : text;
    return `#${l.line_num} (${l.file}) ${shortText}`;
  }).join('\n');
  const rest = untranslated.length > 12 ? `\n...dan ${untranslated.length - 12} baris lainnya.` : '';
  return confirm(`Masih ada ${untranslated.length} baris yang belum diterjemahkan.\n\n${preview}${rest}\n\nLanjut ekspor tetap?`);
}

export async function onExport(): Promise<void> {
  if (!state.lines.length) return;
  if (!confirmExportWithUntranslatedReport()) return;
  const exportProjectId = state.currentProjectId;
  if (!exportProjectId) return;
  const exportStillActive = () => state.currentProjectId === exportProjectId;
  
  if (state.projectType === 'epub' && state.epubSourceId) {
    try {
      flashHint('Membangun file EPUB...', true);
      document.body.style.cursor = 'wait';
      const root = await getOpfsRoot();
      const fh = await (root as any).getFileHandle(state.epubSourceId);
      const f = await fh.getFile();
      const zip = await (window as any).JSZip.loadAsync(f);
      if (!exportStillActive()) return;
      
      const linesByFile: Record<string, Line[]> = {};
      state.lines.forEach(l => {
        // Illustration placeholder lines have no counterpart element in the XHTML —
        // they must not consume a slot in the element<->line pairing below.
        if (isIlustrasiLine(l)) return;
        if (!linesByFile[l.file]) linesByFile[l.file] = [];
        linesByFile[l.file].push(l);
      });

      const tagsSelector = state.epubTags || 'p';

      for (const [href, fLines] of Object.entries(linesByFile)) {
        if (!exportStillActive()) return;
        const zf = zip.file(href);
        if (!zf) continue;
        const html = await zf.async('text');
        const xmlMatch = html.match(/^<\?xml.*?\?>/i);
        const xmlHeader = xmlMatch ? xmlMatch[0] + '\n' : '';
        const doc = new DOMParser().parseFromString(html, href.endsWith('.xhtml') ? 'application/xhtml+xml' : 'text/html');
        const els = Array.from(doc.querySelectorAll(tagsSelector));
        
        let lineIdx = 0;
        for (const el of els) {
          if ((el.textContent || '').replace(/\r?\n/g, ' ').trim() === '') continue;
          const l = fLines[lineIdx++];
          if (l && isTranslated(l)) {
            replaceElementTextPreservingInlineStructure(el, l.trans_message || '');
          }
        }
        
        let newHtml = new XMLSerializer().serializeToString(doc);
        if (xmlHeader && !newHtml.startsWith('<?xml')) {
          newHtml = xmlHeader + newHtml;
        }
        zip.file(href, newHtml);
      }

      if (zip.file('mimetype')) {
        const mimeData = await zip.file('mimetype').async('text');
        zip.file('mimetype', mimeData, { compression: 'STORE' });
      }

      if (!exportStillActive()) return;
      const blob = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/epub+zip',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });

      if (!exportStillActive()) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const safeName = state.projectName.replace(/[<>:"\/\\|?*]/g, '_').trim() || 'export';
      a.download = `${safeName}_tl.epub`;
      a.click();
      flashHint('Berhasil mengekspor EPUB!');
    } catch (err: any) {
      alert('Gagal mengekspor EPUB: ' + err.message);
    } finally {
      document.body.style.cursor = 'default';
    }
  } else if (state.projectType === 'luca') {
    try {
      await waitForLucaDataLoad(exportProjectId);
      if (state.currentProjectId !== exportProjectId) return;
      flashHint('Mengekspor TXT Luca...', true);
      document.body.style.cursor = 'wait';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const profile = getActiveLucaProfile();
      const exportLang = state.lucaExportLang || 'en';
      if (profile.id === 'tomoyo-switch') {
        const missingBuffers = state.importedFiles.filter((f) => !state.lucaRawBuffers[f]);
        if (missingBuffers.length > 0) {
          alert(
            'Tomoyo export butuh impor ulang folder decompile lucksystem (SCRIPT.PAK\\*.txt) ' +
            'agar CSTL menyimpan raw buffer per file.\n\n' +
            `CSTL ${APP_VERSION} | raw buffer hilang: ${missingBuffers.length} file`
          );
          return;
        }
        const exportSlot = profile.messageExportSlot(exportLang);
        const badEmbeddedPrefix = countTomoyoBadEmbeddedPrefixes(exportSlot);
        if (badEmbeddedPrefix > 0) {
          const messageCount = state.lines.filter((l) => l.luca_command === 'MESSAGE' || l.luca_command === 'MESSAGE_WAIT').length;
          alert(
            'Tomoyo txt masih berisi byte prefix (c1 ff / U+FFFD) di dalam tanda kutip. ' +
            'Itu format decompile lucksystem lama — bukan decompiled_clean yang sudah diperbaiki.\n\n' +
            `CSTL ${APP_VERSION} | baris bermasalah: ${badEmbeddedPrefix}/${messageCount}\n` +
            'Jalankan ulang script decompile dengan lucksystem terbaru, atau strip_tomoyo_prefix.py.'
          );
          return;
        }
      }
      const g = new Map<string, Line[]>();
      for (const l of state.lines) {
        if (!g.has(l.file)) g.set(l.file, []);
        g.get(l.file)!.push(l);
      }
      const useBinaryTomoyo = profile.id === 'tomoyo-switch';
      const entries = Array.from(g.entries());
      const res: any[] = [];
      for (let fileIdx = 0; fileIdx < entries.length; fileIdx++) {
        if (!exportStillActive()) return;
        const [fileName, lns] = entries[fileIdx];
        const rawLines = state.lucaRawFiles[fileName] ? [...state.lucaRawFiles[fileName]] : [];
        const outLines = rawLines.length > 0 ? [...rawLines] : [];
        const hasRawLines = outLines.length > 0;
        const cachedLineBytes = useBinaryTomoyo ? getLucaFileLineBytes(fileName) : null;
        const rawLineBytes = cachedLineBytes ? cachedLineBytes.map(line => new Uint8Array(line.buffer as ArrayBuffer)) : null;
        const outLineBytes = rawLineBytes ? rawLineBytes.map(line => new Uint8Array(line.buffer as ArrayBuffer)) as any[] : null;
        const handledSelectRows = new Set<string | number>();

        for (const l of lns) {
          if (!l.luca_raw) continue;
          const sourceRawLine = (hasRawLines && l.luca_raw_index != null && rawLines[l.luca_raw_index])
            ? rawLines[l.luca_raw_index]
            : l.luca_raw;
          const parenStart = sourceRawLine.indexOf('(');
          const parenEnd = sourceRawLine.lastIndexOf(')');
          if (parenStart === -1 || parenEnd === -1) continue;
          const args = splitLucaArgs(sourceRawLine.slice(parenStart + 1, parenEnd));

          if (l.luca_command === 'SELECT') {
            const selectKey = l.luca_raw_index != null ? l.luca_raw_index : l.luca_raw;
            if (handledSelectRows.has(selectKey)) continue;
            handledSelectRows.add(selectKey);
            const patched = applyLucaSelectExport(
              profile,
              args,
              lns.filter(row => row.luca_command === 'SELECT' && row.luca_raw_index === l.luca_raw_index)
                .sort((a, b) => (a.luca_choice_index || 0) - (b.luca_choice_index || 0)),
              exportLang
            );
            if (!patched) continue;
            const newRaw = l.luca_raw.slice(0, parenStart + 1) + patched.join(', ') + l.luca_raw.slice(parenEnd);
            if (hasRawLines && l.luca_raw_index != null && l.luca_raw_index < outLines.length) {
              outLines[l.luca_raw_index] = newRaw;
            }
            continue;
          }

          if (!isTranslated(l)) continue;

          if (useBinaryTomoyo && outLineBytes && l.luca_command === 'MESSAGE' && l.luca_raw_index != null && l.luca_raw_index < outLineBytes.length) {
            const slot = profile.messageExportSlot(exportLang);
            outLineBytes[l.luca_raw_index] = patchMessageQuotedArgBytes(
              outLineBytes[l.luca_raw_index] as unknown as Uint8Array<ArrayBuffer>,
              slot,
              buildTomoyoQuotedArgBytes(l)
            ) as unknown as Uint8Array<ArrayBufferLike>;
            continue;
          }

          const patched = applyLucaMessageExport(profile, args, l, exportLang, sourceRawLine);
          if (!patched) continue;
          const newRaw = sourceRawLine.slice(0, parenStart + 1) + patched.join(', ') + sourceRawLine.slice(parenEnd);
          if (hasRawLines && l.luca_raw_index != null && l.luca_raw_index < outLines.length) {
            outLines[l.luca_raw_index] = newRaw;
          }
        }

        const exportSlot = profile.messageExportSlot(exportLang);
        if (useBinaryTomoyo) normalizeTomoyoMessageLinesInArray(outLines, exportSlot);

        if (useBinaryTomoyo && outLineBytes) {
          for (let i = 0; i < outLineBytes.length; i++) {
            if (/\bMESSAGE(?:_WAIT)?\s*\(/i.test(latin1BytesToString(outLineBytes[i]))) {
              outLineBytes[i] = normalizeTomoyoMessageLineBytes(outLineBytes[i] as unknown as Uint8Array<ArrayBuffer>, exportSlot) as unknown as Uint8Array<ArrayBufferLike>;
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
            content: outLines.join('\n'),
            binary: false,
          });
        }
        if (fileIdx % 2 === 1) await new Promise((r) => setTimeout(r, 0));
      }
      if (!exportStillActive()) return;
      if ((window as any).JSZip && res.length > 1) {
        const zip = new (window as any).JSZip();
        res.forEach(f => zip.file(`SCRIPT.PAK/${f.fn}`, f.content));
        const b = await zip.generateAsync({ type: 'blob' });
        if (!exportStillActive()) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        const safeName = state.projectName.replace(/[<>:"\/\\|?*]/g, '_').trim() || 'export';
        a.download = `${safeName}_luca_export.zip`;
        a.click();
        flashHint('Berhasil mengekspor ZIP Luca!');
      } else {
        for (const f of res) {
          if (!exportStillActive()) return;
          const b = new Blob([f.content], { type: f.binary ? 'application/octet-stream' : 'text/plain;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = f.fn;
          a.click();
        }
        flashHint('Berhasil mengekspor TXT Luca!');
      }
    } finally {
      document.body.style.cursor = 'default';
    }
  } else {
    // Fallback generik: satu baris JSON per file — dipakai proyek JSON, dan
    // proyek parser custom yang tidak punya serialize()/parser-nya hilang.
    const exportLinesAsJson = async (): Promise<void> => {
      const g = new Map<string, Line[]>();
      for (const l of state.lines) {
        if (!g.has(l.file)) g.set(l.file, []);
        g.get(l.file)!.push(l);
      }
      const res = Array.from(g.entries()).map(([fn, lns]) => ({
        fn: `${fn.replace(/\.xhtml|\.html/g, '')}.json`,
        content: JSON.stringify(lns.map(l => {
          const e: any = {};
          e.name = isTranslated(l) ? ((l.trans_name || l.name || '').replace(/^\[?\?\]?\s*/,'') || l.name) : l.name;
          e.message = isTranslated(l) ? (l.trans_message || '').replace(/^\[?\?\]?\s*/,'') : l.message;
          if (e.name) {
            e.name = e.name.replace(/\\n/g, '\n');
          } else {
            delete e.name;
          }
          if (e.message) e.message = e.message.replace(/\\n/g, '\n');
          return e;
        }), null, 2)
      }));
      if ((window as any).JSZip && res.length > 1) {
        const zip = new (window as any).JSZip();
        res.forEach(f => zip.file(f.fn, f.content));
        const b = await zip.generateAsync({ type: 'blob' });
        if (!exportStillActive()) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        const safeName = state.projectName.replace(/[<>:"\/\\|?*]/g, '_').trim() || 'export';
        a.download = `${safeName}_export.zip`;
        a.click();
      } else {
        for (const f of res) {
          if (!exportStillActive()) return;
          const b = new Blob([f.content], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = f.fn;
          a.click();
        }
      }
    };

    if (state.projectType === 'custom') {
      const parser = getCustomParser(state.customParserId);
      if (!parser) {
        alert('Parser custom untuk proyek ini sudah tidak ada (terhapus). Ekspor memakai format JSON.');
        await exportLinesAsJson();
        return;
      }
      if (!parser.enabled) {
        alert(`Parser "${parser.name}" sedang nonaktif. Ekspor memakai format JSON.\n\nAktifkan parser di menu Parser Custom untuk round-trip.`);
        await exportLinesAsJson();
        return;
      }
      if (!parser.serializeScript.trim()) {
        flashHint(`Parser "${parser.name}" tidak punya serialize() — ekspor memakai format JSON.`);
        await exportLinesAsJson();
        return;
      }
      try {
        flashHint(`Mengekspor dengan parser "${parser.name}"...`, true);
        document.body.style.cursor = 'wait';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await waitForCustomSourcesLoad(exportProjectId);
        if (!exportStillActive()) return;

        const g = new Map<string, Line[]>();
        for (const l of state.lines) {
          if (!g.has(l.file)) g.set(l.file, []);
          g.get(l.file)!.push(l);
        }
        const missingSources = Array.from(g.keys()).filter(fn => !state.customRawBuffers[fn] && !state.customRawFiles[fn]);
        if (missingSources.length > 0) {
          alert(
            'File asli untuk proyek ini tidak tersedia di sidecar (kemungkinan dipulihkan dari backup lama):\n' +
            `- ${missingSources.slice(0, 5).join('\n- ')}${missingSources.length > 5 ? '\n- ...' : ''}\n\n` +
            'serialize() menerima text/bytes kosong untuk file tersebut. Impor ulang file asli untuk round-trip penuh.'
          );
        }

        const entries = Array.from(g.entries());
        const res: { fn: string; content: string | Uint8Array }[] = [];
        for (let fileIdx = 0; fileIdx < entries.length; fileIdx++) {
          if (!exportStillActive()) return;
          const [fileName, lns] = entries[fileIdx];
          const rawB64 = state.customRawBuffers[fileName];
          const rawBytes = rawB64 ? new Uint8Array(base64ToArrayBuffer(rawB64)) : new Uint8Array(0);
          const rawText = state.customRawFiles[fileName] ?? '';
          const result = await runCustomSerialize(parser, {
            fileName,
            text: rawText,
            bytes: rawBytes,
            startLineNum: lns.length > 0 ? lns[0].line_num : 1,
            lines: lns.map(l => ({
              line_num: l.line_num,
              name: l.name,
              message: l.message,
              trans_name: l.trans_name,
              trans_message: l.trans_message,
              is_translated: isTranslated(l),
              raw: l.custom_raw ?? null,
              index: (l as any).custom_index ?? null,
            })),
          });
          res.push({ fn: fileName, content: result.content });
          if (fileIdx % 2 === 1) await new Promise((r) => setTimeout(r, 0));
        }
        if (!exportStillActive()) return;

        if ((window as any).JSZip && res.length > 1) {
          const zip = new (window as any).JSZip();
          for (const f of res) zip.file(f.fn, f.content);
          const b = await zip.generateAsync({ type: 'blob' });
          if (!exportStillActive()) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          const safeName = state.projectName.replace(/[<>:"\/\\|?*]/g, '_').trim() || 'export';
          a.download = `${safeName}_custom_export.zip`;
          a.click();
        } else {
          for (const f of res) {
            if (!exportStillActive()) return;
            const isBytes = f.content instanceof Uint8Array;
            const b = new Blob([f.content as unknown as BlobPart], { type: isBytes ? 'application/octet-stream' : 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = f.fn;
            a.click();
          }
        }
        flashHint(`Berhasil ekspor dengan parser "${parser.name}"!`);
      } catch (err: any) {
        alert(`Gagal ekspor parser custom: ${err.message}\n\nMencoba ekspor JSON sebagai fallback...`);
        await exportLinesAsJson();
      } finally {
        document.body.style.cursor = 'default';
      }
    } else {
      await exportLinesAsJson();
    }
  }
}
