// @module import-source.js — Import source files: JSON, EPUB, ZIP, LucaTxt

import { state, ui, getOpfsRoot } from './state.js';
import { normalizeLineDict } from './state.js';
import { decodeArrayBuffer, arrayBufferToBase64, splitBufferToLines } from './binary-utils.js';
import { parseLucaTxt, getLucaProfile, getActiveLucaProfile, normalizeLucaHeavyQuoteFields, parseJsonEntries, parseJsonFromFileObject, clearLucaFileLineBytesCache } from './luca-engine.js';
import { WINDOWS_FILE_ORDER_COLLATOR } from './constants.js';
import { normalizeFileBaseName, windowsFileOrderCompare, getFileOrderPath } from './string-utils.js';
import { refreshAll, flashHint } from './render.js';
import { queueAutoSave } from './project.js';
import { resetSelectionHistory } from './selection.js';

export async function handleImportLucaTxtLogic(files) {
    flashHint("Memproses file TXT... Mohon tunggu.", true);
    document.body.style.cursor = "wait";
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      let cur = state.lines.length > 0 ? Math.max(...state.lines.map(l => l.line_num)) + 1 : 1;
      const existingFiles = new Set(state.importedFiles);
      const skippedFiles = [];
      const newLines = [];

      const selectedProfile = ui.settingsLucaProfileSelect
        ? (ui.settingsLucaProfileSelect.value || DEFAULT_LUCA_PROFILE)
        : (state.lucaProfile || DEFAULT_LUCA_PROFILE);
      if (state.lines.length === 0) {
        state.projectType = "luca";
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
        if (!f.name.toLowerCase().endsWith(".txt")) continue;
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
          newLines.push(...parsed);
          cur += parsed.length;
        }
        await new Promise(r => setTimeout(r, 0));
      }

      if (newLines.length > 0) {
        clearLucaFileLineBytesCache();
        state.lines = [...state.lines, ...newLines];
        state.importedFiles = Array.from(existingFiles);
        state.selectedLines.clear();
        resetSelectionHistory();
        refreshAll();
        queueAutoSave();
        let msg = `Berhasil impor ${newLines.length} baris (${getActiveLucaProfile().label}).`;
        if (skippedFiles.length > 0) msg += ` (${skippedFiles.length} file duplikat diabaikan)`;
        if (getActiveLucaProfile().id === "tomoyo-switch") {
          const withPrefix = newLines.filter((l) => l.luca_prefix_b64).length;
          if (withPrefix > 0) {
            msg += ` | Tomoyo: ${withPrefix} baris masih punya byte prefix di txt (dinormalisasi saat export).`;
          } else {
            msg += " | Tomoyo: format decompile bersih (payload saja — siap diterjemahkan).";
          }
        }
        flashHint(msg);
      } else if (skippedFiles.length > 0) {
        ui.copyStatus.classList.add("empty");
        setTimeout(() => alert(`Gagal impor: File duplikat.\n${skippedFiles.join('\n')}`), 10);
      } else {
        flashHint("Tidak ada MESSAGE atau SELECT yang ditemukan dalam file TXT.");
      }
    } catch (err) {
      ui.copyStatus.classList.add("empty");
      setTimeout(() => alert(`Terjadi kesalahan saat mengimpor TXT:\n${err.message}`), 10);
    } finally {
      document.body.style.cursor = "default";
    }
  }

export async function handleImportLogic(filesObj, isZip = false) {
    flashHint("Memproses file... Mohon tunggu.", true);
    document.body.style.cursor = "wait";
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      let cur = 1, lines = [];
      let maxExistingLineNum = state.lines.length > 0 ? Math.max(...state.lines.map(l => l.line_num)) : 0;
      cur = maxExistingLineNum + 1;
      const existingFiles = new Set(state.importedFiles);
      const skippedFiles = [];

      if (isZip && filesObj instanceof File && window.JSZip) {
        const zip = await window.JSZip.loadAsync(filesObj);
        const names = Object.keys(zip.files).filter(n => n.endsWith(".json")).sort(windowsFileOrderCompare);
        for (const n of names) {
          const baseName = normalizeFileBaseName(n);
          if (existingFiles.has(baseName)) {
            skippedFiles.push(baseName);
            continue;
          }
          const jsonContent = JSON.parse(decodeArrayBuffer(await zip.file(n).async("uint8array")));
          const p = parseJsonEntries(jsonContent, baseName, cur);
          if (p.length) {
            existingFiles.add(baseName);
            lines.push(...p);
            cur += p.length;
          }
          await new Promise(r => setTimeout(r, 0));
        }
      } else {
        const files = Array.from(filesObj).sort((a, b) => windowsFileOrderCompare(getFileOrderPath(a), getFileOrderPath(b)));
        for (const f of files) {
          const isEpub = f.name.toLowerCase().endsWith(".epub");
          const isJson = f.name.toLowerCase().endsWith(".json");

          if (isEpub) {
            if (state.lines.length > 0 && state.projectType === "epub") {
              alert("Proyek ini sudah memuat file EPUB. Buat proyek baru untuk mengimpor EPUB lain.");
              continue;
            }
            if (state.lines.length === 0) {
              state.projectType = "epub";
              state.epubSourceId = "epub_" + Date.now() + ".epub";
            }

            const root = await getOpfsRoot();
            const fh = await root.getFileHandle(state.epubSourceId, { create: true });
            const writable = await fh.createWritable();
            await writable.write(f);
            await writable.close();

            const zip = await window.JSZip.loadAsync(f);
            const containerXml = await zip.file("META-INF/container.xml").async("text");
            const rootfile = new DOMParser().parseFromString(containerXml, "application/xml").querySelector("rootfile");
            const opfPath = decodeURIComponent(rootfile.getAttribute("full-path"));
            const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/")) + "/" : "";

            const opfXml = await zip.file(opfPath).async("text");
            const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");

            const manifest = {};
            Array.from(opfDoc.querySelectorAll("manifest > item")).forEach(item => {
              manifest[item.getAttribute("id")] = decodeURIComponent(item.getAttribute("href"));
            });

            const spineHrefs = Array.from(opfDoc.querySelectorAll("spine > itemref")).map(ref => {
              const idref = ref.getAttribute("idref");
              return manifest[idref] ? opfDir + manifest[idref] : null;
            }).filter(Boolean);

            const tagsSelector = state.epubTags || "p";

            for (const href of spineHrefs) {
              if (existingFiles.has(href)) {
                skippedFiles.push(href);
                continue;
              }
              const fileEntry = zip.file(href);
              if (!fileEntry) continue;

              const html = await fileEntry.async("text");
              const doc = new DOMParser().parseFromString(html, href.endsWith('.xhtml') ? "application/xhtml+xml" : "text/html");
              const els = Array.from(doc.querySelectorAll(tagsSelector));

              let fileHasContent = false;
              for (const el of els) {
                const text = el.textContent.replace(/\r?\n/g, " ").trim();
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
              lines.push(...p);
              cur += p.length;
            }
            await new Promise(r => setTimeout(r, 0));
          }
        }
      }

      if (lines.length > 0) {
        state.lines = [...state.lines, ...lines];
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
        ui.copyStatus.classList.add("empty");
        setTimeout(() => {
          alert(`Gagal impor: File yang dipilih sudah ada di dalam proyek.\n\nFile duplikat:\n- ${skippedFiles.slice(0, 5).join('\n- ')}${skippedFiles.length > 5 ? '\n...dan lainnya' : ''}`);
        }, 10);
      } else {
        flashHint("Tidak ada data valid yang diimpor.", false);
      }
    } catch (err) {
      ui.copyStatus.classList.add("empty");
      setTimeout(() => alert(`Terjadi kesalahan saat mengimpor:\n${err.message}`), 10);
    } finally {
      document.body.style.cursor = "default";
    }
  }

export async function onImportFileChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files);
    ev.target.value = "";
  }

export async function onImportFolderChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files);
    ev.target.value = "";
  }

export async function onImportZipChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files[0], true);
    ev.target.value = "";
  }

export async function onImportLucaTxtChange(ev) {
    if (!ev.target.files.length) return;
    await handleImportLucaTxtLogic(ev.target.files);
    ev.target.value = "";
  }

export async function onImportLucaTxtFolderChange(ev) {
    if (!ev.target.files.length) return;
    await handleImportLucaTxtLogic(ev.target.files);
    ev.target.value = "";
  }
