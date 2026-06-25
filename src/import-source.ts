// @module import-source.ts — Import source files: JSON, EPUB, ZIP, LucaTxt

import { state, ui, getOpfsRoot } from './state';
import { normalizeLineDict } from './state';
import { decodeArrayBuffer, arrayBufferToBase64, splitBufferToLines } from './binary-utils';
import { parseLucaTxt, getLucaProfile, getActiveLucaProfile, normalizeLucaHeavyQuoteFields, parseJsonEntries, parseJsonFromFileObject, clearLucaFileLineBytesCache, DEFAULT_LUCA_PROFILE } from './luca-engine';
import { WINDOWS_FILE_ORDER_COLLATOR } from './constants';
import { normalizeFileBaseName, windowsFileOrderCompare, getFileOrderPath } from './string-utils';
import { refreshAll, flashHint } from './render';
import { queueAutoSave, saveLucaDataToOpfs } from './project';
import { resetSelectionHistory } from './selection';
import type { Line } from './types';

export async function handleImportLucaTxtLogic(files: FileList | File[]): Promise<void> {
  flashHint('Memproses file TXT... Mohon tunggu.', true);
  document.body.style.cursor = 'wait';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    let cur = state.lines.length > 0 ? state.lines.reduce((m, l) => l.line_num > m ? l.line_num : m, 0) + 1 : 1;
    const existingFiles = new Set(state.importedFiles);
    const skippedFiles: string[] = [];
    const newLines: Line[] = [];

    const selectedProfile = ui.settingsLucaProfileSelect
      ? ((ui.settingsLucaProfileSelect as HTMLSelectElement).value || DEFAULT_LUCA_PROFILE)
      : (state.lucaProfile || DEFAULT_LUCA_PROFILE);
    if (state.lines.length === 0) {
      state.projectType = 'luca';
      state.lucaProfile = selectedProfile;
    } else if (state.lucaProfile && state.lucaProfile !== selectedProfile) {
      throw new Error(
        `Profil aktif: ${getLucaProfile(state.lucaProfile).label}. ` +
        `Profil di Setting: ${getLucaProfile(selectedProfile).label}. ` +
        `Buat proyek baru atau samakan profil sebelum impor.`
      );
    }

    const sortedFiles = Array.from(files).sort((a, b) =>
      windowsFileOrderCompare(getFileOrderPath(a), getFileOrderPath(b))
    );
    for (const f of sortedFiles) {
      if (!f.name.toLowerCase().endsWith('.txt')) continue;
      const baseName = f.name;
      if (existingFiles.has(baseName)) { skippedFiles.push(baseName); continue; }
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const text = decodeArrayBuffer(bytes);
      if (!existingFiles.has(baseName)) {
        state.lucaRawFiles[baseName] = text.split(/\r?\n/);
        state.lucaRawBuffers[baseName] = arrayBufferToBase64(buf);
      }
      const parsed = parseLucaTxt(text, baseName, cur, state.lucaProfile, splitBufferToLines(bytes));
      if (parsed.length > 0) {
        existingFiles.add(baseName);
        for (let i = 0; i < parsed.length; i++) newLines.push(parsed[i]);
        cur += parsed.length;
      }
      await new Promise(r => setTimeout(r, 0));
    }

    if (newLines.length > 0) {
      clearLucaFileLineBytesCache();
      state.lines = state.lines.concat(newLines);
      state.importedFiles = Array.from(existingFiles);
      state.selectedLines.clear();
      resetSelectionHistory();
      refreshAll();
      if (state.currentProjectId) {
        saveLucaDataToOpfs(state.currentProjectId, { lucaRawFiles: state.lucaRawFiles, lucaRawBuffers: state.lucaRawBuffers }).then(() => {
          queueAutoSave();
        });
      } else {
        queueAutoSave();
      }
      let msg = `Berhasil impor ${newLines.length} baris (${getActiveLucaProfile().label}).`;
      if (skippedFiles.length > 0) msg += ` (${skippedFiles.length} file duplikat diabaikan)`;
      if (getActiveLucaProfile().id === 'tomoyo-switch') {
        const withPrefix = newLines.filter((l) => l.luca_prefix_b64).length;
        if (withPrefix > 0) {
          msg += ` | Tomoyo: ${withPrefix} baris masih punya byte prefix di txt (dinormalisasi saat export).`;
        } else {
          msg += ' | Tomoyo: format decompile bersih (payload saja — siap diterjemahkan).';
        }
      }
      flashHint(msg);
    } else if (skippedFiles.length > 0) {
      (ui.copyStatus as HTMLElement).classList.add('empty');
      setTimeout(() => alert(`Gagal impor: File duplikat.\n${skippedFiles.join('\n')}`), 10);
    } else {
      flashHint('Tidak ada MESSAGE atau SELECT yang ditemukan dalam file TXT.');
    }
  } catch (err: any) {
    (ui.copyStatus as HTMLElement).classList.add('empty');
    setTimeout(() => alert(`Terjadi kesalahan saat mengimpor TXT:\n${err.message}`), 10);
  } finally {
    document.body.style.cursor = 'default';
  }
}

export async function handleImportLogic(filesObj: FileList | File[] | File, isZip = false): Promise<void> {
  flashHint('Memproses file... Mohon tunggu.', true);
  document.body.style.cursor = 'wait';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    let cur = 1, lines: Line[] = [];
    let maxExistingLineNum = state.lines.length > 0 ? state.lines.reduce((m, l) => l.line_num > m ? l.line_num : m, 0) : 0;
    cur = maxExistingLineNum + 1;
    const existingFiles = new Set(state.importedFiles);
    const skippedFiles: string[] = [];

    if (isZip && filesObj instanceof File && (window as any).JSZip) {
      const zip = await (window as any).JSZip.loadAsync(filesObj);
      const names = Object.keys(zip.files).filter(n => n.endsWith('.json')).sort(windowsFileOrderCompare);
      for (const n of names) {
        const baseName = normalizeFileBaseName(n);
        if (existingFiles.has(baseName)) {
          skippedFiles.push(baseName);
          continue;
        }
        const jsonContent = JSON.parse(decodeArrayBuffer(await zip.file(n).async('uint8array')));
        const p = parseJsonEntries(jsonContent, baseName, cur);
        if (p.length) {
          existingFiles.add(baseName);
          for (let i = 0; i < p.length; i++) lines.push(p[i]);
          cur += p.length;
        }
        await new Promise(r => setTimeout(r, 0));
      }
    } else {
      const files = Array.from(filesObj as FileList | File[]).sort((a, b) => windowsFileOrderCompare(getFileOrderPath(a), getFileOrderPath(b)));
      for (const f of files) {
        const isEpub = f.name.toLowerCase().endsWith('.epub');
        const isJson = f.name.toLowerCase().endsWith('.json');

        if (isEpub) {
          if (state.lines.length > 0 && state.projectType === 'epub') {
            alert('Proyek ini sudah memuat file EPUB. Buat proyek baru untuk mengimpor EPUB lain.');
            continue;
          }
          if (state.lines.length === 0) {
            state.projectType = 'epub';
            state.epubSourceId = 'epub_' + Date.now() + '.epub';
          }

          const root = await getOpfsRoot();
          const fh = await (root as any).getFileHandle(state.epubSourceId, { create: true });
          const writable = await fh.createWritable();
          await writable.write(f);
          await writable.close();

          const zip = await (window as any).JSZip.loadAsync(f);
          const containerXml = await zip.file('META-INF/container.xml').async('text');
          const rootfile = new DOMParser().parseFromString(containerXml, 'application/xml').querySelector('rootfile');
          if (!rootfile) continue;
          const opfPath = decodeURIComponent(rootfile.getAttribute('full-path') || '');
          const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) + '/' : '';

          const opfXml = await zip.file(opfPath).async('text');
          const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

          const manifest: Record<string, string> = {};
          Array.from(opfDoc.querySelectorAll('manifest > item')).forEach(item => {
            manifest[item.getAttribute('id') || ''] = decodeURIComponent(item.getAttribute('href') || '');
          });

          const spineHrefs = Array.from(opfDoc.querySelectorAll('spine > itemref')).map(ref => {
            const idref = ref.getAttribute('idref') || '';
            return manifest[idref] ? opfDir + manifest[idref] : null;
          }).filter(Boolean) as string[];

          const tagsSelector = state.epubTags || 'p';

          for (const href of spineHrefs) {
            if (existingFiles.has(href)) {
              skippedFiles.push(href);
              continue;
            }
            const fileEntry = zip.file(href);
            if (!fileEntry) continue;

            const html = await fileEntry.async('text');
            const doc = new DOMParser().parseFromString(html, href.endsWith('.xhtml') ? 'application/xhtml+xml' : 'text/html');
            const els = Array.from(doc.querySelectorAll(tagsSelector));

            let fileHasContent = false;
            for (const el of els) {
              const text = (el.textContent || '').replace(/\r?\n/g, ' ').trim();
              if (text) {
                lines.push({
                  line_num: cur++,
                  file: href,
                  name: null,
                  message: text,
                  trans_name: null,
                  trans_message: null,
                  is_translated: false
                });
                fileHasContent = true;
              }
            }
            if (fileHasContent) {
              existingFiles.add(href);
            }
            await new Promise(r => setTimeout(r, 0));
          }
        } else if (isJson) {
          const baseName = normalizeFileBaseName(f.name);
          if (existingFiles.has(baseName)) {
            skippedFiles.push(baseName);
            continue;
          }
          const p = parseJsonEntries(await parseJsonFromFileObject(f), baseName, cur);
          if (p.length) {
            existingFiles.add(baseName);
            for (let i = 0; i < p.length; i++) lines.push(p[i]);
            cur += p.length;
          }
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    if (lines.length > 0) {
      state.lines = state.lines.concat(lines);
      state.importedFiles = Array.from(existingFiles);
      state.selectedLines.clear();
      resetSelectionHistory();
      refreshAll();
      queueAutoSave();
      let msg = `Berhasil impor ${lines.length} baris.`;
      if (skippedFiles.length > 0) {
        msg += ` (${skippedFiles.length} file duplikat diabaikan)`;
      }
      flashHint(msg);
    } else if (skippedFiles.length > 0) {
      (ui.copyStatus as HTMLElement).classList.add('empty');
      setTimeout(() => {
        alert(`Gagal impor: File yang dipilih sudah ada di dalam proyek.\n\nFile duplikat:\n- ${skippedFiles.slice(0, 5).join('\n- ')}${skippedFiles.length > 5 ? '\n...dan lainnya' : ''}`);
      }, 10);
    } else {
      flashHint('Tidak ada data valid yang diimpor.', false);
    }
  } catch (err: any) {
    (ui.copyStatus as HTMLElement).classList.add('empty');
    setTimeout(() => alert(`Terjadi kesalahan saat mengimpor:\n${err.message}`), 10);
  } finally {
    document.body.style.cursor = 'default';
  }
}

export async function onImportFileChange(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  if (!target.files?.length) return;
  await handleImportLogic(target.files);
  target.value = '';
}

export async function onImportFolderChange(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  if (!target.files?.length) return;
  await handleImportLogic(target.files);
  target.value = '';
}

export async function onImportZipChange(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  if (!target.files?.length) return;
  await handleImportLogic(target.files[0], true);
  target.value = '';
}

export async function onImportLucaTxtChange(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  if (!target.files?.length) return;
  await handleImportLucaTxtLogic(target.files);
  target.value = '';
}

export async function onImportLucaTxtFolderChange(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  if (!target.files?.length) return;
  await handleImportLucaTxtLogic(target.files);
  target.value = '';
}
