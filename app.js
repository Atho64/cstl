(() => {
  "use strict";
  const DEFAULT_PROMPT_HEADER = `Rewrite entire text to Native Indonesian. Do not change prefix number. Euphemism prohibited. Use of "Bahasa Jakarta Selatan" is prohibited. Put results inside \`\`\`plaintext block.`;
  const DEFAULT_GLOSSARY_PROMPT = `Extract important names and story-specific terminology from the following text to build a typed glossary.\nFormat the output STRICTLY as:\n[type] [Japanese term] = [Indonesian term] {short description}\n\nAllowed types:\n[character], [place], [organization], [item], [ability], [title], [concept], [term]\n\nDescription examples:\n{male name}, {female name}, {family name}, {given name}, {place name}, {school}, {food}, {honorific}, {concept}\n\nExample:\n[character] 浅村 悠太 = Asamura Yuuta {male name}\n[character] 綾瀬 沙季 = Ayase Saki {female name}\n[place] 渋谷 = Shibuya {place name}\n[item] 炬燵 = Kotatsu {household item}\n[term] 義妹 = adik tiri perempuan {family term}\n\nRules:\n1. Do NOT translate the text itself.\n2. Only output the typed glossary list.\n3. Do NOT include common everyday words, ordinary verbs, generic adjectives, or basic nouns unless they are proper nouns, recurring key terms, culturally specific terms, or story-specific concepts.\n4. Prefer character names, family names, given names, place names, organization names, titles, unique items, abilities, honorifics, relationship terms, and recurring setting-specific terminology.\n5. Prefer specific types over [term].\n6. Include gender for character names when inferable from context; otherwise use {character name}.\n7. Put results inside \`\`\`plaintext block.`;
  const DEFAULT_AI_CHECK_PROMPT = `Check the existing Indonesian translation against the original Japanese text.\nOnly return lines that need correction. Do not return lines that are already good.\n\nUse this STRICT format for each correction:\n[line 12]\nreason: why this line needs correction\nname: corrected character name, or blank if unchanged/not applicable\ntext: corrected Indonesian translation without the speaker name prefix\n\nRules:\n1. Keep the original line number exactly.\n2. Give a short, concrete reason.\n3. Use name only for corrected character names; leave it blank when unchanged.\n4. Put only the corrected message in text. Do NOT repeat the speaker name in text.\n5. Correct only the Indonesian translation, not the Japanese original.\n6. Respect provided glossary entries.\n7. Put results inside \`\`\`plaintext block.`;
  const APP_VERSION = "vM2";
  const MAX_UNDO_STEPS = 10;
  const PROJECT_EXT = ".cstl";
  const WINDOWS_FILE_ORDER_COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  
  const state = {
    currentProjectId: null,
    projectName: "",
    projectType: "",
    epubTags: "p",
    epubSourceId: null,
    lines: [],
    importedFiles: [],
    aiInstructionHeader: DEFAULT_PROMPT_HEADER,
    glossaryPrompt: DEFAULT_GLOSSARY_PROMPT,
    aiCheckPrompt: DEFAULT_AI_CHECK_PROMPT,
    glossaryText: "",
    contextLines: 10,
    undoStack: [],
    selectedLines: new Set(),
    selectionHistory: [],
    selectionHistoryIndex: -1,
    activeWorkspaceTab: "translate",
    displayRows: [],
    lineByNum: new Map(),
    proofreadMatches: [],
    aiCheckCorrections: [],
    dashboardProjects: [],
  };
  
  const ui = {};
  let activeLineEditorLineNum = null;
  let saveTimeout = null;
  let mainScroller = null;
  let proofreadScroller = null;
  let hintToken = 0;

  class VirtualScroller {
    constructor(viewport, container, estimatedHeight, renderItem) {
      this.viewport = viewport;
      this.container = container;
      this.estimatedHeight = estimatedHeight;
      this.renderItem = renderItem;
      this.items = [];
      this.heights = [];
      this.positions = [];
      this.totalHeight = 0;
      this.scrollTop = 0;
      this.ticking = false;
      this.lastStart = -1;
      this.lastEnd = -1;
      
      this.onScroll = this.onScroll.bind(this);
      this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
      if (window.ResizeObserver) {
        new ResizeObserver(() => {
          if (this.viewport.clientHeight > 0) this.render(true);
        }).observe(this.viewport);
      }
    }

    setItems(items) {
      this.items = items;
      this.heights = new Array(items.length).fill(this.estimatedHeight);
      this.updatePositions();
      this.scrollTop = this.viewport.scrollTop = 0;
      this.lastStart = -1;
      this.lastEnd = -1;
      this.render(true);
    }

    updatePositions() {
      let top = 0;
      this.positions = new Array(this.items.length);
      for (let i = 0; i < this.items.length; i++) {
        this.positions[i] = top;
        top += this.heights[i];
      }
      this.totalHeight = top;
    }

    scrollToIndex(index) {
      if (index < 0 || index >= this.items.length) return;
      this.viewport.scrollTop = this.positions[index];
      this.scrollTop = this.viewport.scrollTop;
      this.render(true);
    }

    onScroll() {
      if (!this.ticking) {
        window.requestAnimationFrame(() => {
          this.scrollTop = this.viewport.scrollTop;
          this.render();
          this.ticking = false;
        });
        this.ticking = true;
      }
    }

    findStartIndex() {
      let low = 0;
      let high = this.items.length - 1;
      while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        let midTop = this.positions[mid];
        let midBottom = midTop + this.heights[mid];
        if (this.scrollTop >= midTop && this.scrollTop < midBottom) {
          return mid;
        } else if (this.scrollTop < midTop) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      return Math.max(0, Math.min(low, this.items.length - 1));
    }

    render(force = false) {
      const viewportHeight = this.viewport.clientHeight || 800;
      const total = this.items.length;
      if (!total) {
        this.container.innerHTML = "";
        return;
      }

      const buffer = 15; 
      let targetStart = this.findStartIndex() - Math.floor(buffer / 2);
      targetStart = Math.max(0, targetStart);

      let end = targetStart;
      let currentHeight = 0;
      while (end < total && currentHeight < viewportHeight + (buffer * this.estimatedHeight)) {
        currentHeight += this.heights[end];
        end++;
      }
      end = Math.min(total, end);

      if (!force && this.lastStart === targetStart && this.lastEnd === end) {
        return;
      }

      this.lastStart = targetStart;
      this.lastEnd = end;

      const topPad = this.positions[targetStart];
      const bottomPad = end < total ? this.totalHeight - this.positions[end] : 0;

      this.container.innerHTML = "";
      
      const topSpacer = document.createElement("div");
      topSpacer.style.height = `${topPad}px`;
      this.container.appendChild(topSpacer);

      const frag = document.createDocumentFragment();
      const rowElements = [];
      for (let i = targetStart; i < end; i++) {
        const el = this.renderItem(this.items[i]);
        el.dataset.vindex = i;
        frag.appendChild(el);
        rowElements.push(el);
      }
      this.container.appendChild(frag);

      const bottomSpacer = document.createElement("div");
      bottomSpacer.style.height = `${bottomPad}px`;
      this.container.appendChild(bottomSpacer);

      Promise.resolve().then(() => {
        let changed = false;
        for (const el of rowElements) {
          const idx = parseInt(el.dataset.vindex);
          const rect = el.getBoundingClientRect();
          if (rect.height > 0) {
            const actualHeight = rect.height + 8;
            if (Math.abs(actualHeight - this.heights[idx]) > 1) {
              this.heights[idx] = actualHeight;
              changed = true;
            }
          }
        }
        if (changed) {
          this.updatePositions();
          if (this.container.firstElementChild) {
             this.container.firstElementChild.style.height = `${this.positions[this.lastStart]}px`;
          }
          if (this.container.lastElementChild) {
             const updatedBottomPad = this.lastEnd < this.items.length ? this.totalHeight - this.positions[this.lastEnd] : 0;
             this.container.lastElementChild.style.height = `${updatedBottomPad}px`;
          }
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    cacheElements();
    initScrollers();
    bindEvents();
    
    if (!navigator.storage || !navigator.storage.getDirectory) {
      alert("Browser kamu tidak mendukung Sistem File OPFS. Beberapa fitur tidak akan berjalan optimal.");
      ui.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1; color: var(--danger);">Browser tidak mendukung OPFS. Sistem penyimpanan tidak dapat diakses.</p>`;
      return; 
    }
    
    await loadDashboardProjects();
  });

  function cacheElements() {
    const ids = [
      "dashboardView", "workspaceView", "projectList", "projectFilterInput", "btnNewProject", "btnRestoreProject",
      "btnBackToDashboard", "projectNameDisplay", "restoreProjectInput", "btnImportFile",
      "btnImportFolder", "btnImportZip", "btnImportTranslatedFile", "btnImportTranslatedFolder", "btnExport", "btnProofread", "btnSettings",
      "previewViewport", "previewContainer", "progressFill", "progressText", "btnSelectAll",
      "btnClearSelection", "copyCount", "btnCopyForAi", "copyStatus", "pasteArea", "btnApply",
      "btnUndo", "nameTableBody", "statusBar", "importFileInput", "importFolderInput", "importTranslatedFileInput", "importTranslatedFolderInput",
      "glossaryPreviewWrap", "glossaryPreviewText",
      "importZipInput", "glossaryFileInput", "settingsModal", "settingsPromptInput", "settingsGlossaryPromptInput", "settingsAiCheckPromptInput", "settingsEpubTagsInput",
      "settingsGlossaryInput", "settingsContextLinesInput", "btnSettingsReset", "btnSettingsGlossaryReset", "btnSettingsAiCheckReset", "btnSettingsCancel", "btnSettingsSave", "lineEditorModal", "lineEditorTitle",
      "tabTranslate", "tabGlossary", "viewTranslate", "viewGlossary", "btnCopyForGlossaryAi", "pasteGlossaryArea", "btnSaveGlossary", "btnImportGlossaryFile", "btnExportGlossaryFile", "copyGlossaryCount",
      "tabAiCheck", "viewAiCheck", "btnCopyForAiCheck", "copyAiCheckCount", "aiCheckStatus", "pasteAiCheckArea", "btnParseAiCheck", "btnApplyAiCheck", "btnClearAiCheck", "aiCheckResults",
      "vndbInput", "btnImportVndbNames", "vndbStatus",
      "btnExtractEpubRubyNames", "epubRubyStatus", "anilistInput", "btnImportAnilistNames", "anilistStatus",
      "lineOriginalView", "lineNameWrap", "lineNameInput", "lineMessageInput", "lineTranslatedCheck",
      "btnLineCancel", "btnLineSave", "proofreadModal", "proofreadSearchInput", "proofreadScope",
      "proofreadRegexCheck", "proofreadCaseCheck", "proofreadExactCheck", "proofreadTranslatedOnlyCheck",
      "btnProofreadReset", "proofreadStatus", "proofreadContainer", "btnProofreadClose",
      "proofreadReplaceInput", "btnProofreadReplaceAll", "rangeFromInput", "rangeToInput", "btnSelectRange"
    ];
    for (const id of ids) {
      ui[id] = document.getElementById(id);
    }
  }

  function initScrollers() {
    mainScroller = new VirtualScroller(ui.previewViewport, ui.previewContainer, 85, renderMainRow);
    const proofreadViewport = ui.proofreadContainer.closest('.proofread-results-wrap');
    proofreadScroller = new VirtualScroller(proofreadViewport, ui.proofreadContainer, 90, renderProofreadRow);
  }

  function bindEvents() {
    document.addEventListener("keydown", onSelectionHistoryKeydown);
    ui.btnNewProject.addEventListener("click", createNewProject);
    ui.projectFilterInput.addEventListener("input", () => renderDashboardProjects());
    ui.btnBackToDashboard.addEventListener("click", closeProject);
    ui.btnRestoreProject.addEventListener("click", () => ui.restoreProjectInput.click());
    ui.restoreProjectInput.addEventListener("change", onRestoreProject);
    ui.btnImportFile.addEventListener("click", () => ui.importFileInput.click());
    ui.btnImportFolder.addEventListener("click", () => ui.importFolderInput.click());
    ui.btnImportZip.addEventListener("click", () => ui.importZipInput.click());
    ui.btnImportTranslatedFile.addEventListener("click", () => ui.importTranslatedFileInput.click());
    ui.btnImportTranslatedFolder.addEventListener("click", () => ui.importTranslatedFolderInput.click());
    ui.importFileInput.addEventListener("change", onImportFileChange);
    ui.importFolderInput.addEventListener("change", onImportFolderChange);
    ui.importZipInput.addEventListener("change", onImportZipChange);
    ui.importTranslatedFileInput.addEventListener("change", onImportTranslatedFileChange);
    ui.importTranslatedFolderInput.addEventListener("change", onImportTranslatedFolderChange);
    ui.glossaryFileInput.addEventListener("change", onImportGlossaryFile);
    ui.btnExport.addEventListener("click", onExport);
    ui.btnCopyForAi.addEventListener("click", onCopyForAi);
    ui.btnCopyForGlossaryAi.addEventListener("click", onCopyForGlossaryAi);
    ui.btnApply.addEventListener("click", onApplyTranslation);
    ui.btnSaveGlossary.addEventListener("click", onSaveGlossary);
    ui.btnImportGlossaryFile.addEventListener("click", () => ui.glossaryFileInput.click());
    ui.btnExportGlossaryFile.addEventListener("click", onExportGlossaryFile);
    ui.btnImportVndbNames.addEventListener("click", onImportVndbNames);
    ui.btnExtractEpubRubyNames.addEventListener("click", onExtractEpubRubyNames);
    ui.btnImportAnilistNames.addEventListener("click", onImportAnilistNames);

    ui.tabTranslate.addEventListener("click", () => switchWorkspaceTab("translate"));
    
    ui.tabGlossary.addEventListener("click", () => switchWorkspaceTab("glossary"));
    ui.tabAiCheck.addEventListener("click", () => switchWorkspaceTab("aiCheck"));
    ui.btnCopyForAiCheck.addEventListener("click", onCopyForAiCheck);
    ui.btnParseAiCheck.addEventListener("click", onParseAiCheck);
    ui.btnApplyAiCheck.addEventListener("click", onApplyAiCheckCorrections);
    ui.btnClearAiCheck.addEventListener("click", onClearAiCheck);
    ui.pasteAiCheckArea.addEventListener("input", updateButtonStates);
    ui.btnUndo.addEventListener("click", onUndoLastApply);
    ui.btnProofread.addEventListener("click", onOpenProofread);
    ui.btnSelectAll.addEventListener("click", () => {
      state.selectedLines.clear();
      state.lines.forEach(l => {
        if (isSelectableForActiveTab(l)) state.selectedLines.add(l.line_num);
      });
      recordSelectionHistory();
      syncCheckboxUI();
    });
    ui.btnClearSelection.addEventListener("click", () => {
      state.selectedLines.clear();
      recordSelectionHistory();
      syncCheckboxUI();
    });
    ui.btnSelectRange.addEventListener("click", () => {
      const f = parseInt(ui.rangeFromInput.value);
      const t = parseInt(ui.rangeToInput.value);
      if (isNaN(f) || isNaN(t) || f > t) return alert("Range tidak valid.");
      state.selectedLines.clear();
      for (let i = f; i <= t; i++) {
        const l = state.lineByNum.get(i);
        if (l && isSelectableForActiveTab(l)) state.selectedLines.add(i);
      }
      recordSelectionHistory();
      syncCheckboxUI();
      const targetIndex = state.displayRows.findIndex(row => row.type === "line" && row.line.line_num === f);
      if (targetIndex !== -1) {
        mainScroller.scrollToIndex(targetIndex);
        setTimeout(() => {
          const targetEl = document.querySelector(`input[data-num="${f}"]`);
          if (targetEl) {
            const rowEl = targetEl.closest('.preview-row');
            rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
            const originalBg = rowEl.style.backgroundColor;
            rowEl.style.transition = "background-color 0.3s ease";
            rowEl.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
            setTimeout(() => { rowEl.style.backgroundColor = originalBg; }, 800);
          }
        }, 50);
      }
    });
    ui.btnSettings.addEventListener("click", onOpenSettings);
    ui.btnSettingsReset.addEventListener("click", () => {
      ui.settingsPromptInput.value = DEFAULT_PROMPT_HEADER;
      ui.settingsEpubTagsInput.value = "p";
    });
    ui.btnSettingsGlossaryReset.addEventListener("click", () => {
      ui.settingsGlossaryPromptInput.value = DEFAULT_GLOSSARY_PROMPT;
    });
    ui.btnSettingsAiCheckReset.addEventListener("click", () => {
      ui.settingsAiCheckPromptInput.value = DEFAULT_AI_CHECK_PROMPT;
    });
    ui.btnSettingsCancel.addEventListener("click", () => closeModal(ui.settingsModal));
    ui.btnSettingsSave.addEventListener("click", onSavePromptSettings);
    ui.btnLineCancel.addEventListener("click", () => closeModal(ui.lineEditorModal));
    ui.btnLineSave.addEventListener("click", onSaveLineEditor);
    ui.btnProofreadClose.addEventListener("click", () => closeModal(ui.proofreadModal));
    ui.btnProofreadReset.addEventListener("click", onResetProofread);
    ui.btnProofreadReplaceAll.addEventListener("click", onProofreadReplaceAll);
    const debouncedSearch = debounce(renderProofreadResults, 250);
    ui.proofreadSearchInput.addEventListener("input", debouncedSearch);
    ui.proofreadScope.addEventListener("change", renderProofreadResults);
    ui.proofreadRegexCheck.addEventListener("change", renderProofreadResults);
    ui.proofreadCaseCheck.addEventListener("change", renderProofreadResults);
    ui.proofreadExactCheck.addEventListener("change", renderProofreadResults);
    ui.proofreadTranslatedOnlyCheck.addEventListener("change", renderProofreadResults);
  }

  function switchWorkspaceTab(tabName) {
    state.activeWorkspaceTab = tabName;
    pruneSelectionForActiveTab();
    const tabs = [
      { name: "translate", tab: ui.tabTranslate, view: ui.viewTranslate },
      { name: "glossary", tab: ui.tabGlossary, view: ui.viewGlossary },
      { name: "aiCheck", tab: ui.tabAiCheck, view: ui.viewAiCheck },
    ];
    for (const item of tabs) {
      const active = item.name === tabName;
      item.tab.classList.toggle("btn-primary", active);
      item.tab.classList.toggle("btn-outline", !active);
      item.view.style.display = active ? "block" : "none";
    }
    renderPreviewRows();
    updateButtonStates();
  }

  function pruneSelectionForActiveTab() {
    for (const num of Array.from(state.selectedLines)) {
      const line = state.lineByNum.get(num);
      if (!isSelectableForActiveTab(line)) state.selectedLines.delete(num);
    }
  }

  function getSelectionHistorySnapshot() {
    return Array.from(state.selectedLines)
      .map(Number)
      .filter(num => Number.isFinite(num) && isSelectableForActiveTab(state.lineByNum.get(num)))
      .sort((a, b) => a - b);
  }

  function selectionSnapshotsEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((num, index) => num === b[index]);
  }

  function resetSelectionHistory() {
    state.selectionHistory = [];
    state.selectionHistoryIndex = -1;
    recordSelectionHistory();
  }

  function recordSelectionHistory() {
    const snapshot = getSelectionHistorySnapshot();
    const currentSnapshot = state.selectionHistory[state.selectionHistoryIndex];
    if (selectionSnapshotsEqual(snapshot, currentSnapshot)) return;
    if (state.selectionHistoryIndex < state.selectionHistory.length - 1) {
      state.selectionHistory.splice(state.selectionHistoryIndex + 1);
    }
    state.selectionHistory.push(snapshot);
    state.selectionHistoryIndex = state.selectionHistory.length - 1;
  }

  function restoreSelectionHistory(direction) {
    if (!state.currentProjectId || !state.lines.length) return false;
    const nextIndex = state.selectionHistoryIndex + direction;
    if (nextIndex < 0 || nextIndex >= state.selectionHistory.length) return false;

    state.selectionHistoryIndex = nextIndex;
    state.selectedLines.clear();
    for (const num of state.selectionHistory[nextIndex]) {
      const line = state.lineByNum.get(num);
      if (isSelectableForActiveTab(line)) state.selectedLines.add(num);
    }
    syncCheckboxUI();

    let firstSelected = null;
    for (const num of state.selectedLines) {
      if (firstSelected === null || num < firstSelected) firstSelected = num;
    }
    if (firstSelected !== null) scrollPreviewToLine(firstSelected);
    return true;
  }

  function scrollPreviewToLine(lineNum) {
    if (!mainScroller) return;
    const targetIndex = state.displayRows.findIndex(row => row.type === "line" && row.line.line_num === lineNum);
    if (targetIndex === -1) return;
    mainScroller.scrollToIndex(targetIndex);
    setTimeout(() => {
      const targetEl = document.querySelector(`input[data-num="${lineNum}"]`);
      const rowEl = targetEl?.closest(".preview-row");
      if (rowEl) rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function isEditableShortcutTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest("textarea, select, [contenteditable]")) return true;
    const input = target.closest("input");
    if (!input) return false;
    const type = (input.type || "text").toLowerCase();
    return !["button", "checkbox", "radio", "submit", "reset"].includes(type);
  }

  function onSelectionHistoryKeydown(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (isEditableShortcutTarget(event.target)) return;

    const direction = event.key === "ArrowUp" ? -1 : 1;
    if (restoreSelectionHistory(direction)) event.preventDefault();
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  async function getOpfsRoot() {
    return await navigator.storage.getDirectory();
  }

  async function loadDashboardProjects() {
    state.dashboardProjects = [];
    ui.projectList.textContent = "";
    try {
      const root = await getOpfsRoot();
      const projects = [];
      for await (const [name, handle] of root.entries()) {
        if (name.endsWith(PROJECT_EXT) && handle.kind === 'file') {
          const file = await handle.getFile();
          const text = await file.text();
          try {
            const data = JSON.parse(text);
            projects.push({
              id: name,
              name: data.projectName || name.replace(PROJECT_EXT, ''),
              updatedAt: data.updatedAt || file.lastModified,
              fileCount: data.imported_files?.length || 0,
              lineCount: data.lines?.length || 0,
              data: data
            });
          } catch(e) {}
        }
      }
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      state.dashboardProjects = projects;
      renderDashboardProjects();
    } catch (err) {
      renderDashboardMessage("Gagal mengakses storage browser.", true);
    }
  }

  function renderDashboardMessage(message, isError = false) {
    ui.projectList.textContent = "";
    const p = document.createElement("p");
    p.className = "hint";
    p.style.gridColumn = "1/-1";
    if (isError) p.style.color = "var(--danger)";
    p.textContent = message;
    ui.projectList.appendChild(p);
  }

  function createProjectButton(label, className, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderDashboardProjects() {
    const query = (ui.projectFilterInput.value || "").trim().toLowerCase();
    const projects = query
      ? state.dashboardProjects.filter(p => p.name.toLowerCase().includes(query))
      : state.dashboardProjects;

    ui.projectList.textContent = "";
    if (state.dashboardProjects.length === 0) {
      renderDashboardMessage('Belum ada proyek. Klik "Buat Proyek Baru" untuk memulai.');
      return;
    }
    if (projects.length === 0) {
      renderDashboardMessage("Tidak ada proyek yang cocok dengan filter.");
      return;
    }

    const frag = document.createDocumentFragment();
    for (const p of projects) {
      const card = document.createElement("div");
      card.className = "project-card";

      const info = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = p.name;
      info.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "project-meta mt-2";
      if (p.fileCount > 0 || p.lineCount > 0) {
        const badgeWrap = document.createElement("div");
        badgeWrap.style.marginBottom = "8px";
        const badge = document.createElement("span");
        badge.className = p.data.projectType === "epub" ? "badge badge-epub" : "badge badge-json";
        badge.textContent = p.data.projectType === "epub" ? "EPUB" : "JSON VNTP";
        badgeWrap.appendChild(badge);
        meta.appendChild(badgeWrap);
      }
      meta.append(
        document.createTextNode(`Terakhir diubah: ${new Date(p.updatedAt).toLocaleString("id-ID")}`),
        document.createElement("br"),
        document.createTextNode(`File: ${p.fileCount} | Baris: ${p.lineCount}`)
      );
      info.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "project-actions";
      actions.append(
        createProjectButton("Buka", "btn btn-primary btn-sm", () => openProject(p.id, p.data)),
        createProjectButton("Ubah Nama", "btn btn-outline btn-sm", () => renameDashboardProject(p.id, p.name, p.data)),
        createProjectButton("Backup", "btn btn-outline btn-sm", () => backupDashboardProject(p.name, p.data)),
        createProjectButton("Hapus", "btn btn-danger btn-sm", () => deleteProject(p.id, p.data))
      );

      card.append(info, actions);
      frag.appendChild(card);
    }
    ui.projectList.appendChild(frag);
  }

  async function createNewProject() {
    const name = prompt("Masukkan nama proyek baru:");
    if (!name || !name.trim()) return;
    const id = "proj_" + Date.now() + PROJECT_EXT;
    const initialData = {
      version: APP_VERSION,
      projectName: name.trim(),
      projectType: "json",
      epubTags: "p",
      epubSourceId: null,
      updatedAt: Date.now(),
      imported_files: [],
      lines: [],
      prompt_header: DEFAULT_PROMPT_HEADER,
      glossary_prompt: DEFAULT_GLOSSARY_PROMPT,
      ai_check_prompt: DEFAULT_AI_CHECK_PROMPT,
      glossary_text: "",
      context_lines: 10
    };
    try {
      const root = await getOpfsRoot();
      const fileHandle = await root.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(initialData));
      await writable.close();
      openProject(id, initialData);
    } catch (e) {
      alert("Gagal membuat proyek: " + e.message);
    }
  }

  async function deleteProject(id, data) {
    if (!confirm("Hapus proyek ini secara permanen?")) return;
    try {
      const root = await getOpfsRoot();
      if (data.epubSourceId) {
        try { await root.removeEntry(data.epubSourceId); } catch(e) {}
      }
      await root.removeEntry(id);
      loadDashboardProjects();
    } catch (e) {
      alert("Gagal menghapus: " + e.message);
    }
  }

  async function renameDashboardProject(id, oldName, data) {
    const newName = prompt("Masukkan nama baru untuk proyek:", oldName);
    if (!newName || newName.trim() === "" || newName === oldName) return;
    data.projectName = newName.trim();
    await saveProjectToOpfs(id, data);
    loadDashboardProjects();
  }

  async function backupDashboardProject(name, data) {
    const strData = JSON.stringify(data);
    const b = new Blob([strData], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `${safeName}_backup${PROJECT_EXT}`;
    a.click();
  }

  async function saveProjectToOpfs(id, dataObj) {
    try {
      dataObj.updatedAt = Date.now();
      const root = await getOpfsRoot();
      const fileHandle = await root.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(dataObj));
      await writable.close();
    } catch (e) {
      flashHint("Gagal menyimpan ke storage!");
    }
  }

  function queueAutoSave() {
    if (!state.currentProjectId) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      const data = {
        version: APP_VERSION,
        projectName: state.projectName,
        projectType: state.projectType,
        epubTags: state.epubTags,
        epubSourceId: state.epubSourceId,
        imported_files: state.importedFiles,
        lines: state.lines,
        prompt_header: state.aiInstructionHeader,
        glossary_prompt: state.glossaryPrompt,
        ai_check_prompt: state.aiCheckPrompt,
        glossary_text: state.glossaryText,
        context_lines: state.contextLines
      };
      await saveProjectToOpfs(state.currentProjectId, data);
      ui.statusBar.textContent = ui.statusBar.textContent.replace(" | Tersimpan!", "") + " | Tersimpan!";
      setTimeout(() => {
        updateStatusBar();
      }, 2000);
    }, 1000);
  }

  function openProject(id, data) {
    state.currentProjectId = id;
    state.projectName = data.projectName || "Unknown Project";
    state.projectType = data.projectType || "json";
    state.epubTags = data.epubTags || "p";
    state.epubSourceId = data.epubSourceId || null;
    state.lines = (data.lines || []).map(normalizeLineDict);
    state.importedFiles = data.imported_files || [];
    state.aiInstructionHeader = data.prompt_header || DEFAULT_PROMPT_HEADER;
    state.glossaryPrompt = data.glossary_prompt || DEFAULT_GLOSSARY_PROMPT;
    state.aiCheckPrompt = data.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT;
    state.glossaryText = data.glossary_text || "";
    state.contextLines = data.context_lines !== undefined ? data.context_lines : 10;
    state.selectedLines.clear();
    state.undoStack = [];
    state.aiCheckCorrections = [];
    state.activeWorkspaceTab = "translate";
    resetSelectionHistory();
    if (ui.pasteAiCheckArea) ui.pasteAiCheckArea.value = "";
    if (ui.aiCheckResults) ui.aiCheckResults.textContent = "";
    ui.projectNameDisplay.textContent = state.projectName;
    
    ui.dashboardView.classList.remove("open");
    ui.workspaceView.style.display = "flex";
    
    refreshAll();
    switchWorkspaceTab("translate");
  }

  function closeProject() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      const data = {
        version: APP_VERSION, projectName: state.projectName,
        projectType: state.projectType, epubTags: state.epubTags, epubSourceId: state.epubSourceId,
        imported_files: state.importedFiles, lines: state.lines,
        prompt_header: state.aiInstructionHeader,
        glossary_prompt: state.glossaryPrompt,
        ai_check_prompt: state.aiCheckPrompt,
        glossary_text: state.glossaryText,
        context_lines: state.contextLines
      };
      saveProjectToOpfs(state.currentProjectId, data).then(() => {
        finishClose();
      });
    } else {
      finishClose();
    }
  }

  function finishClose() {
    state.currentProjectId = null;
    state.lines = [];
    state.selectedLines.clear();
    resetSelectionHistory();
    ui.workspaceView.style.display = "none";
    ui.dashboardView.classList.add("open");
    loadDashboardProjects();
  }

  async function onRestoreProject(ev) {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      const name = p.projectName || f.name.replace(PROJECT_EXT, '');
      const id = "proj_" + Date.now() + PROJECT_EXT;
      const safeData = {
        version: APP_VERSION,
        projectName: name,
        projectType: p.projectType || "json",
        epubTags: p.epubTags || "p",
        epubSourceId: p.epubSourceId || null,
        updatedAt: Date.now(),
        imported_files: p.imported_files || [],
        lines: (p.lines || []).map(normalizeLineDict),
        prompt_header: p.prompt_header || DEFAULT_PROMPT_HEADER,
        glossary_prompt: p.glossary_prompt || DEFAULT_GLOSSARY_PROMPT,
        ai_check_prompt: p.ai_check_prompt || DEFAULT_AI_CHECK_PROMPT,
        glossary_text: p.glossary_text || "",
        context_lines: p.context_lines !== undefined ? p.context_lines : 10
      };
      await saveProjectToOpfs(id, safeData);
      loadDashboardProjects();
      alert(`Proyek "${name}" berhasil dipulihkan!`);
    } catch (e) {
      alert("File backup korup atau tidak valid: " + e.message);
    }
  }

  function updateButtonStates() {
    const hasData = state.lines.length > 0;
    const hasSelection = state.selectedLines.size > 0;
    const untranslatedSelectionCount = state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l)).length;
    const translatedSelectionCount = state.lines.filter(l => state.selectedLines.has(l.line_num) && isTranslated(l)).length;
    ui.btnExport.disabled = !hasData;
    ui.btnProofread.disabled = !hasData;
    ui.btnImportTranslatedFile.disabled = !hasData;
    ui.btnImportTranslatedFolder.disabled = !hasData;
    ui.btnSelectAll.disabled = !hasData;
    ui.btnClearSelection.disabled = !hasSelection;
    ui.btnCopyForAi.disabled = untranslatedSelectionCount === 0;
    ui.btnCopyForGlossaryAi.disabled = !hasSelection;
    ui.btnCopyForAiCheck.disabled = translatedSelectionCount === 0;
    ui.btnExtractEpubRubyNames.disabled = !(state.projectType === "epub" && state.epubSourceId);
    ui.pasteArea.disabled = !hasData;
    ui.pasteGlossaryArea.disabled = !hasData;
    ui.btnApply.disabled = !hasData;
    ui.btnSaveGlossary.disabled = !hasData;
    ui.btnParseAiCheck.disabled = !hasData;
    ui.pasteAiCheckArea.disabled = !hasData;
    ui.btnApplyAiCheck.disabled = state.aiCheckCorrections.filter(c => c.checked).length === 0;
    ui.btnClearAiCheck.disabled = !ui.pasteAiCheckArea.value.trim() && state.aiCheckCorrections.length === 0;
    ui.btnImportGlossaryFile.disabled = !state.currentProjectId;
    ui.btnExportGlossaryFile.disabled = !state.glossaryText.trim();
    ui.rangeFromInput.disabled = !hasData;
    ui.rangeToInput.disabled = !hasData;
    ui.btnSelectRange.disabled = !hasData;
    ui.copyCount.textContent = untranslatedSelectionCount;
    ui.copyGlossaryCount.textContent = state.selectedLines.size;
    ui.copyAiCheckCount.textContent = translatedSelectionCount;
    renderGlossaryPreview();
  }

  function isTranslated(line) {
    return !!line.is_translated && !!String(line.trans_message).trim();
  }

  function isSelectableForActiveTab(line) {
    if (!line) return false;
    if (state.activeWorkspaceTab === "aiCheck") return isTranslated(line);
    if (state.activeWorkspaceTab === "translate") return !isTranslated(line);
    return true;
  }

  function normalizeLineDict(line) {
    return {
      line_num: Number(line.line_num),
      file: String(line.file),
      name: line.name == null ? null : String(line.name).replace(/\r?\n/g, "\\n").trim(),
      message: String(line.message).replace(/\r?\n/g, "\\n").trim(),
      trans_name: line.trans_name == null ? null : String(line.trans_name).replace(/\r?\n/g, "\\n").trim(),
      trans_message: line.trans_message == null ? null : String(line.trans_message).replace(/\r?\n/g, "\\n").trim(),
      is_translated: Boolean(line.is_translated),
    };
  }

  function normalizeFileBaseName(pathOrName) {
    const normalized = String(pathOrName || "").replace(/\\/g, "/");
    return (normalized.split("/").pop() || normalized).replace(/\.json$/i, "");
  }

  function windowsFileOrderCompare(a, b) {
    return WINDOWS_FILE_ORDER_COLLATOR.compare(String(a || ""), String(b || ""));
  }

  function getFileOrderPath(file) {
    return file?.webkitRelativePath || file?.name || "";
  }

  function decodeArrayBuffer(buffer) {
    const encodings = ["utf-8", "shift_jis", "windows-31j"];
    for (const enc of encodings) {
      try { return new TextDecoder(enc, { fatal: true }).decode(buffer); }
      catch (_) {}
    }
    return new TextDecoder("utf-8").decode(buffer);
  }

  async function parseJsonFromFileObject(file) {
    return JSON.parse(decodeArrayBuffer(await file.arrayBuffer()));
  }

  function parseJsonEntries(jsonArray, fileName, startLineNum) {
    if (!Array.isArray(jsonArray)) throw new Error(`File ${fileName} bukan array JSON.`);
    const lines = [];
    let currentLine = startLineNum;
    for (const entry of jsonArray) {
      if (!entry || typeof entry !== "object" || !Object.hasOwn(entry, "message")) continue;
      lines.push({
        line_num: currentLine++,
        file: fileName,
        name: entry.name == null ? null : String(entry.name).replace(/\r?\n/g, "\\n").trim(),
        message: String(entry.message ?? "").replace(/\r?\n/g, "\\n").trim(),
        trans_name: null,
        trans_message: null,
        is_translated: false,
      });
    }
    return lines;
  }

  function rebuildDisplayState() {
    state.lineByNum.clear();
    const grouped = new Map(state.importedFiles.map(f => [f, []]));
    for (const line of state.lines) {
      state.lineByNum.set(line.line_num, line);
      if (!grouped.has(line.file)) grouped.set(line.file, []);
      grouped.get(line.file).push(line);
    }
    state.displayRows = [];
    for (const [fileName, rows] of grouped.entries()) {
      if (!rows.length) continue;
      state.displayRows.push({ type: "separator", file: fileName });
      for (const line of rows) {
        state.displayRows.push({ type: "line", line });
      }
    }
  }

  function renderPreviewRows() {
    if (mainScroller.items && mainScroller.items.length === state.displayRows.length && mainScroller.items.length > 0) {
      mainScroller.items = state.displayRows;
      mainScroller.render(true);
    } else {
      mainScroller.setItems(state.displayRows);
    }
    updateButtonStates();
  }

  function renderMainRow(rowData) {
    const row = document.createElement("div");
    row.className = "preview-row";
    if (rowData.type === "separator") {
      row.classList.add("separator");
      const fileLines = state.lines.filter(l => l.file === rowData.file && isSelectableForActiveTab(l));
      const isAllSelected = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.file = rowData.file;
      cb.checked = isAllSelected;
      cb.addEventListener("change", (e) => {
        const isChecked = e.target.checked;
        fileLines.forEach(l => {
          if (isChecked) state.selectedLines.add(l.line_num);
          else state.selectedLines.delete(l.line_num);
        });
        recordSelectionHistory();
        syncCheckboxUI();
      });
      const label = document.createElement("div");
      label.className = "mono grow";
      label.style.fontWeight = "700";
      label.style.color = "var(--primary)";
      label.textContent = `File: ${rowData.file}`;
      row.append(cb, label);
    } else {
      const line = rowData.line;
      if (isTranslated(line)) row.classList.add("row-translated");
      const isChecked = state.selectedLines.has(line.line_num);
      if (isChecked) row.classList.add('row-selected');
      const cbWrap = document.createElement("div");
      cbWrap.className = "checkbox-cell";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.num = line.line_num;
      cb.checked = isChecked;
      cb.disabled = !isSelectableForActiveTab(line);
      cb.addEventListener("change", (e) => {
        if (e.target.checked) state.selectedLines.add(line.line_num);
        else state.selectedLines.delete(line.line_num);
        recordSelectionHistory();
        syncCheckboxUI();
      });
      const contentWrap = document.createElement("div");
      contentWrap.className = "text-content";
      const origDiv = document.createElement("div");
      origDiv.className = "original";
      const dName = line.name || "";
      origDiv.textContent = dName ? `${line.line_num}. ${dName}: ${line.message}` : `${line.line_num}. ${line.message}`;
      const transDiv = document.createElement("div");
      transDiv.className = "translated";
      let tTxt = "——";
      if (isTranslated(line)) {
          const tName = line.trans_name || dName;
          tTxt = tName ? `${line.line_num}. ${tName}: ${line.trans_message}` : `${line.line_num}. ${line.trans_message}`;
      } else {
          transDiv.classList.add("cell-muted");
      }
      transDiv.textContent = tTxt;
      contentWrap.append(origDiv, transDiv);
      cbWrap.append(cb, contentWrap);
      row.appendChild(cbWrap);
      contentWrap.addEventListener("click", () => openLineEditor(line.line_num));
    }
    return row;
  }

  function syncCheckboxUI() {
    document.querySelectorAll('.preview-row.separator input[type="checkbox"]').forEach(cb => {
      const fileLines = state.lines.filter(l => l.file === cb.dataset.file && isSelectableForActiveTab(l));
      cb.checked = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
    });
    document.querySelectorAll('.preview-row:not(.separator) input[type="checkbox"]').forEach(cb => {
      const num = Number(cb.dataset.num);
      const isChecked = state.selectedLines.has(num);
      cb.checked = isChecked;
      const row = cb.closest('.preview-row');
      if (isChecked) row.classList.add('row-selected');
      else row.classList.remove('row-selected');
    });
    updateButtonStates();
  }

  function renderNameTable() {
    const autoDetectedNames = Array.from(new Set(state.lines.map(l => l.name).filter(Boolean))).sort();
    ui.nameTableBody.textContent = "";
    const frag = document.createDocumentFragment();
    for (const n of autoDetectedNames) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = n;
      td.className = "mono";
      td.title = "Klik untuk copy nama ke clipboard";
      td.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(n);
          flashHint(`Nama "${n}" disalin!`);
        } catch (e) {
          alert("Gagal menyalin teks.");
        }
      });
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    ui.nameTableBody.appendChild(frag);
  }

  function updateStatusBar() {
    const total = state.lines.length;
    const trans = state.lines.filter(isTranslated).length;
    const perc = total ? Math.floor((trans / total) * 100) : 0;
    
    let modeText = "-";
    if (state.importedFiles.length > 0) {
      modeText = state.projectType === "epub" ? "EPUB" : "JSON VNTP";
    }

    ui.statusBar.textContent = `Mode: ${modeText} | File: ${state.importedFiles.length > 1 ? state.importedFiles.length + ' file' : (state.importedFiles[0] || '-')} | Baris: ${total} | TL: ${trans}/${total} (${perc}%)`;
    ui.progressFill.style.width = `${perc}%`;
    ui.progressText.textContent = `${trans}/${total}`;
  }

  function refreshAll() {
    rebuildDisplayState();
    renderPreviewRows();
    renderNameTable();
    updateStatusBar();
    ui.btnUndo.disabled = state.undoStack.length === 0;
  }

  function pushUndoSnapshot() {
    state.undoStack.push({ lines: JSON.parse(JSON.stringify(state.lines)) });
    if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
    ui.btnUndo.disabled = false;
  }

  function flashHint(msg, keepAlive = false) {
    ui.copyStatus.textContent = msg;
    ui.copyStatus.classList.remove("empty");
    const currentToken = ++hintToken;
    if (!keepAlive) {
      setTimeout(() => {
        if (hintToken === currentToken) {
          ui.copyStatus.classList.add("empty");
        }
      }, 4000);
    }
  }

  async function handleImportLogic(filesObj, isZip = false) {
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

  async function onImportFileChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files);
    ev.target.value = "";
  }

  async function onImportFolderChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files);
    ev.target.value = "";
  }

  async function onImportZipChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files[0], true);
    ev.target.value = "";
  }

  function groupCurrentLinesByFile() {
    const grouped = new Map();
    for (const line of state.lines) {
      if (!grouped.has(line.file)) grouped.set(line.file, []);
      grouped.get(line.file).push(line);
    }
    return grouped;
  }

  function normalizeImportPathKey(pathOrName) {
    return String(pathOrName || "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
  }

  function stripImportFileExt(pathOrName) {
    return pathOrName.replace(/\.(json|xhtml|html)$/i, "");
  }

  function getImportPathBaseName(pathOrName) {
    const parts = pathOrName.split("/").filter(Boolean);
    return parts[parts.length - 1] || pathOrName;
  }

  function getImportPathWithoutRoot(pathOrName) {
    const parts = pathOrName.split("/").filter(Boolean);
    return parts.length > 1 ? parts.slice(1).join("/") : pathOrName;
  }

  function getImportFileMatchKeys(pathOrName) {
    const normalized = normalizeImportPathKey(pathOrName);
    const withoutRoot = getImportPathWithoutRoot(normalized);
    const baseName = getImportPathBaseName(normalized);
    const candidates = [
      normalized,
      stripImportFileExt(normalized),
      withoutRoot,
      stripImportFileExt(withoutRoot),
      baseName,
      stripImportFileExt(baseName),
    ];
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  function buildCurrentFileMatchMap(groupedLines) {
    const map = new Map();
    const addKey = (key, fileName) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, fileName);
      else if (map.get(key) !== fileName) map.set(key, null);
    };

    for (const fileName of groupedLines.keys()) {
      for (const key of getImportFileMatchKeys(fileName)) addKey(key, fileName);
    }
    return map;
  }

  function findTranslatedImportTarget(pathOrName, fileMatchMap, groupedLines) {
    let ambiguous = false;
    for (const key of getImportFileMatchKeys(pathOrName)) {
      if (!fileMatchMap.has(key)) continue;
      const fileName = fileMatchMap.get(key);
      if (fileName) return { fileName, lines: groupedLines.get(fileName) || [] };
      ambiguous = true;
    }
    return { ambiguous };
  }

  function normalizeTranslatedImportValue(value) {
    return String(value ?? "").replace(/\r?\n/g, "\\n").trim();
  }

  function collectTranslatedJsonUpdates(pathOrName, jsonArray, fileMatchMap, groupedLines, usedFiles) {
    if (!Array.isArray(jsonArray)) throw new Error(`${pathOrName} bukan array JSON.`);
    const target = findTranslatedImportTarget(pathOrName, fileMatchMap, groupedLines);
    if (target.ambiguous) return { status: "ambiguous", path: pathOrName, updates: [] };
    if (!target.fileName) return { status: "unmatched", path: pathOrName, updates: [] };
    if (usedFiles.has(target.fileName)) return { status: "duplicate", path: pathOrName, updates: [] };
    usedFiles.add(target.fileName);

    const limit = Math.min(jsonArray.length, target.lines.length);
    const updates = [];
    for (let i = 0; i < limit; i++) {
      const entry = jsonArray[i];
      if (!entry || typeof entry !== "object") continue;
      const message = normalizeTranslatedImportValue(entry.message ?? entry.trans_message ?? entry.text);
      if (!message) continue;
      const line = target.lines[i];
      const hasNameValue = Object.hasOwn(entry, "name") || Object.hasOwn(entry, "trans_name");
      const name = hasNameValue ? normalizeTranslatedImportValue(entry.name ?? entry.trans_name) : null;
      updates.push({ line, name, message, hasNameValue });
    }

    return {
      status: "matched",
      path: pathOrName,
      fileName: target.fileName,
      updates,
      importedRows: jsonArray.length,
      projectRows: target.lines.length,
    };
  }

  async function collectTranslatedEpubUpdates(file) {
    if (state.projectType !== "epub") return { status: "unsupported", path: file.name, updates: [] };
    if (!window.JSZip) throw new Error("JSZip tidak tersedia untuk membaca EPUB.");

    const zip = await window.JSZip.loadAsync(file);
    const groupedLines = groupCurrentLinesByFile();
    const tagsSelector = state.epubTags || "p";
    const updates = [];
    const missingFiles = [];

    for (const [href, lines] of groupedLines.entries()) {
      const zf = zip.file(href);
      if (!zf) {
        missingFiles.push(href);
        continue;
      }
      const html = await zf.async("text");
      const doc = new DOMParser().parseFromString(html, href.endsWith(".xhtml") ? "application/xhtml+xml" : "text/html");
      const els = Array.from(doc.querySelectorAll(tagsSelector)).filter(el => el.textContent.replace(/\r?\n/g, " ").trim());
      const limit = Math.min(els.length, lines.length);
      for (let i = 0; i < limit; i++) {
        const message = normalizeTranslatedImportValue(els[i].textContent.replace(/\r?\n/g, " ").trim());
        if (message) updates.push({ line: lines[i], name: null, message, hasNameValue: false });
      }
    }

    return { status: "matched", path: file.name, updates, missingFiles };
  }

  async function handleTranslatedImport(filesObj) {
    if (!state.lines.length) return alert("Impor file sumber dulu sebelum impor hasil terjemahan.");

    const files = Array.from(filesObj || []).sort((a, b) => windowsFileOrderCompare(getFileOrderPath(a), getFileOrderPath(b)));
    if (!files.length) return;

    flashHint("Memproses file terjemahan... Mohon tunggu.", true);
    document.body.style.cursor = "wait";
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const groupedLines = groupCurrentLinesByFile();
      const fileMatchMap = buildCurrentFileMatchMap(groupedLines);
      const usedFiles = new Set();
      const allUpdates = [];
      const warnings = [];
      let matchedFiles = 0;

      for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        const lowerName = file.name.toLowerCase();
        try {
          if (lowerName.endsWith(".zip")) {
            if (!window.JSZip) throw new Error("JSZip tidak tersedia untuk membaca ZIP.");
            const zip = await window.JSZip.loadAsync(file);
            const names = Object.keys(zip.files).filter(n => n.toLowerCase().endsWith(".json")).sort(windowsFileOrderCompare);
            for (const name of names) {
              const json = JSON.parse(decodeArrayBuffer(await zip.file(name).async("uint8array")));
              const result = collectTranslatedJsonUpdates(name, json, fileMatchMap, groupedLines, usedFiles);
              if (result.status === "matched") {
                matchedFiles++;
                allUpdates.push(...result.updates);
                if (result.importedRows !== result.projectRows) warnings.push(`${name}: jumlah baris ${result.importedRows}/${result.projectRows}.`);
              } else if (result.status === "ambiguous") warnings.push(`${name}: nama file ambigu, dilewati.`);
              else if (result.status === "duplicate") warnings.push(`${name}: target file sudah diimpor dari file lain, dilewati.`);
              else warnings.push(`${name}: tidak cocok dengan file proyek, dilewati.`);
            }
          } else if (lowerName.endsWith(".json")) {
            const json = await parseJsonFromFileObject(file);
            const result = collectTranslatedJsonUpdates(path, json, fileMatchMap, groupedLines, usedFiles);
            if (result.status === "matched") {
              matchedFiles++;
              allUpdates.push(...result.updates);
              if (result.importedRows !== result.projectRows) warnings.push(`${path}: jumlah baris ${result.importedRows}/${result.projectRows}.`);
            } else if (result.status === "ambiguous") warnings.push(`${path}: nama file ambigu, dilewati.`);
            else if (result.status === "duplicate") warnings.push(`${path}: target file sudah diimpor dari file lain, dilewati.`);
            else warnings.push(`${path}: tidak cocok dengan file proyek, dilewati.`);
          } else if (lowerName.endsWith(".epub")) {
            const result = await collectTranslatedEpubUpdates(file);
            if (result.status === "matched") {
              matchedFiles++;
              allUpdates.push(...result.updates);
              if (result.missingFiles?.length) warnings.push(`${path}: ${result.missingFiles.length} file EPUB proyek tidak ditemukan di EPUB terjemahan.`);
            } else {
              warnings.push(`${path}: hanya bisa diimpor ke proyek EPUB.`);
            }
          }
        } catch (err) {
          warnings.push(`${path}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 0));
      }

      if (!allUpdates.length) {
        flashHint("Tidak ada baris terjemahan yang bisa diimpor.", false);
        if (warnings.length) alert("Impor TL tidak menerapkan perubahan:\n\n" + warnings.slice(0, 12).join("\n"));
        return;
      }

      pushUndoSnapshot();
      for (const update of allUpdates) {
        update.line.trans_message = update.message;
        update.line.is_translated = true;
        if (update.line.name && update.hasNameValue) update.line.trans_name = update.name || null;
      }
      pruneSelectionForActiveTab();
      recordSelectionHistory();
      refreshAll();
      queueAutoSave();

      let msg = `Berhasil impor ${allUpdates.length} baris TL dari ${matchedFiles} file.`;
      if (warnings.length) msg += ` Ada ${warnings.length} catatan.`;
      flashHint(msg);
      if (warnings.length) alert("Catatan impor TL:\n\n" + warnings.slice(0, 12).join("\n") + (warnings.length > 12 ? `\n...dan ${warnings.length - 12} lainnya.` : ""));
    } finally {
      document.body.style.cursor = "default";
    }
  }

  async function onImportTranslatedFileChange(ev) {
    if (!ev.target.files.length) return;
    await handleTranslatedImport(ev.target.files);
    ev.target.value = "";
  }

  async function onImportTranslatedFolderChange(ev) {
    if (!ev.target.files.length) return;
    await handleTranslatedImport(ev.target.files);
    ev.target.value = "";
  }

  function getGlossaryMatches(copiedText) {
    const glossary = parseGlossaryToMap(state.glossaryText);
    const matched = [];
    const lowerText = copiedText.toLowerCase();

    for (const [source, entry] of glossary.entries()) {
      if (source && entry.target && lowerText.includes(source.toLowerCase())) {
        matched.push(formatGlossaryEntry(source, entry));
      }
    }

    return matched;
  }

  function getGlossaryPrompt(copiedText) {
    const matched = getGlossaryMatches(copiedText);
    if (matched.length > 0) {
      return `\n\n<Glossary>\n${matched.join("\n")}\n</Glossary>`;
    }
    return "";
  }

  function parseGlossaryToMap(text) {
    const m = new Map();
    if (!text) return m;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      let raw = line.trim();
      if (!raw) continue;
      let type = "term";
      const typeMatch = raw.match(/^\[([a-z ]+)\]\s*/i);
      if (typeMatch) {
        type = normalizeGlossaryType(typeMatch[1]);
        raw = raw.slice(typeMatch[0].length).trim();
      }
      let sepIdx = raw.indexOf("=");
      if (sepIdx === -1) sepIdx = raw.indexOf(":");
      if (sepIdx !== -1) {
        const source = raw.substring(0, sepIdx).trim();
        let target = raw.substring(sepIdx + 1).trim();
        let desc = "";
        const descMatch = target.match(/\s*\{([^{}]+)\}\s*$/);
        if (descMatch) {
          desc = descMatch[1].trim();
          target = target.slice(0, descMatch.index).trim();
        }
        if (source) m.set(source, { target, type, desc });
      }
    }
    return m;
  }

  function normalizeGlossaryType(type) {
    const clean = String(type || "").trim().toLowerCase().replace(/\s+/g, "-");
    const aliases = {
      char: "character",
      chars: "character",
      name: "character",
      names: "character",
      character: "character",
      characters: "character",
      place: "place",
      location: "place",
      locations: "place",
      organization: "organization",
      organisation: "organization",
      org: "organization",
      item: "item",
      object: "item",
      ability: "ability",
      skill: "ability",
      title: "title",
      concept: "concept",
      term: "term",
      other: "term",
    };
    return aliases[clean] || "term";
  }

  function formatGlossaryEntry(source, entry) {
    const type = normalizeGlossaryType(entry?.type || "term");
    const target = typeof entry === "string" ? entry : entry.target;
    const desc = typeof entry === "string" ? "" : String(entry.desc || "").trim();
    return `[${type}] ${source} = ${target}${desc ? ` {${desc}}` : ""}`;
  }

  function serializeGlossaryMap(map) {
    return Array.from(map.entries()).map(([k, v]) => formatGlossaryEntry(k, v)).join("\n");
  }

  function mergeGlossaryEntries(entries) {
    const current = parseGlossaryToMap(state.glossaryText);
    let added = 0;
    let updated = 0;
    for (const [source, value] of entries.entries()) {
      const entry = typeof value === "string" ? { target: value, type: "term" } : value;
      const target = entry.target;
      if (!source || !target) continue;
      if (current.has(source)) updated++;
      else added++;
      current.set(source, { target, type: normalizeGlossaryType(entry.type), desc: String(entry.desc || "").trim() });
    }
    state.glossaryText = serializeGlossaryMap(current);
    renderGlossaryPreview();
    queueAutoSave();
    return { added, updated };
  }

  function addNameGlossaryEntry(entries, source, target, type = "character", desc = "character name") {
    const cleanSource = String(source || "").replace(/\s+/g, " ").trim();
    const cleanTarget = String(target || "").replace(/\s+/g, " ").trim();
    if (!cleanSource || !cleanTarget || cleanSource === cleanTarget) return;

    entries.set(cleanSource, { target: cleanTarget, type, desc });

    const sourceParts = cleanSource.split(/[\s・･=＝]+/).filter(Boolean);
    const targetParts = cleanTarget.split(/\s+/).filter(Boolean);
    if (sourceParts.length >= 2 && sourceParts.length === targetParts.length) {
      for (let i = 0; i < sourceParts.length; i++) {
        if (sourceParts[i] && targetParts[i] && sourceParts[i] !== targetParts[i]) {
          entries.set(sourceParts[i], { target: targetParts[i], type, desc: i === 0 ? `family name${desc.includes("female") ? ", female" : desc.includes("male") ? ", male" : ""}` : `given name${desc.includes("female") ? ", female" : desc.includes("male") ? ", male" : ""}` });
        }
      }
    }
  }

  function genderToDescription(gender) {
    const raw = Array.isArray(gender) ? gender.find(Boolean) : gender;
    const clean = String(raw || "").trim().toLowerCase();
    if (["f", "female", "woman", "girl"].includes(clean)) return "female name";
    if (["m", "male", "man", "boy"].includes(clean)) return "male name";
    if (["n", "non-binary", "nonbinary"].includes(clean)) return "non-binary character name";
    return "character name";
  }

  function hasKanji(text) {
    return /[\u3400-\u9fff]/.test(text);
  }

  function isLikelyRubyNameCandidate(base, reading) {
    const cleanBase = String(base || "").replace(/\s+/g, "").trim();
    const cleanReading = normalizeKana(reading);
    if (!hasKanji(cleanBase) || !cleanReading) return false;
    if (cleanBase.length < 2 || cleanBase.length > 8) return false;
    if (cleanReading.length < 2 || cleanReading.length > 12) return false;
    if (/[\u3040-\u30ff]/.test(cleanBase)) return false;
    if (/[々〆ヶ]/.test(cleanBase)) return true;
    return /^[\u3400-\u9fff]{2,4}(?:[\s　・･][\u3400-\u9fff]{1,4})?$/.test(base.trim());
  }

  function getSelectedTranslationText(includeTranslated = true) {
    const sel = state.lines.filter(l => state.selectedLines.has(l.line_num) && (includeTranslated || !isTranslated(l)));
    return sel.map(l => {
      const dN = l.name || "";
      return dN ? `${l.line_num}. ${dN}: ${l.message}` : `${l.line_num}. ${l.message}`;
    }).join("\n");
  }

  function renderGlossaryPreview() {
    const selectedText = getSelectedTranslationText();
    const matches = selectedText ? getGlossaryMatches(selectedText) : [];
    if (!matches.length) {
      ui.glossaryPreviewWrap.hidden = true;
      ui.glossaryPreviewText.textContent = "";
      return;
    }
    ui.glossaryPreviewText.textContent = matches.join("\n");
    ui.glossaryPreviewWrap.hidden = false;
  }

  async function onCopyForGlossaryAi() {
    const sel = state.lines.filter(l => state.selectedLines.has(l.line_num));
    if (!sel.length) return;
    const out = getSelectedTranslationText().split("\n").filter(Boolean);
    const promptText = `${(state.glossaryPrompt || DEFAULT_GLOSSARY_PROMPT).trim()}\n\n${out.join("\n")}\n`;
    try {
      await navigator.clipboard.writeText(promptText);
      flashHint(`Disalin ${sel.length} baris untuk ekstraksi glossary.`);
    } catch (_) {
      ui.pasteGlossaryArea.value = promptText;
    }
  }

  function onSaveGlossary() {
    const val = ui.pasteGlossaryArea.value.trim();
    if (!val) return;
    
    const currentMap = parseGlossaryToMap(state.glossaryText);
    const newMap = parseGlossaryToMap(val);
    
    for (const [k, v] of newMap.entries()) {
      currentMap.set(k, v);
    }
    
    state.glossaryText = serializeGlossaryMap(currentMap);
    
    ui.pasteGlossaryArea.value = "";
    renderGlossaryPreview();
    queueAutoSave();
    flashHint("Glossary berhasil disimpan!");
  }

  function buildSafeFileName(name) {
    return String(name || "glossary").replace(/[<>:"\/\\|?*]/g, "_").trim() || "glossary";
  }

  function onExportGlossaryFile() {
    const glossary = serializeGlossaryMap(parseGlossaryToMap(state.glossaryText));
    if (!glossary.trim()) return alert("Smart Glossary masih kosong.");
    const blob = new Blob([glossary + "\n"], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${buildSafeFileName(state.projectName)}_glossary.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    flashHint("Glossary diekspor ke file.");
  }

  async function onImportGlossaryFile(ev) {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      const imported = parseGlossaryToMap(text);
      if (!imported.size) return alert("File glossary kosong atau formatnya tidak valid.");
      const current = parseGlossaryToMap(state.glossaryText);
      let added = 0;
      let updated = 0;
      for (const [source, entry] of imported.entries()) {
        if (current.has(source)) updated++;
        else added++;
        current.set(source, entry);
      }
      state.glossaryText = serializeGlossaryMap(current);
      renderGlossaryPreview();
      updateButtonStates();
      queueAutoSave();
      flashHint(`Glossary file diimpor: ${added} baru, ${updated} diperbarui.`);
    } catch (err) {
      alert("Gagal impor file glossary: " + err.message);
    }
  }

  function extractVndbId(input) {
    const match = String(input || "").trim().match(/(?:^|\/)(v\d+)(?:[/?#].*)?$/i);
    return match ? match[1].toLowerCase() : null;
  }

  function collectVndbGlossaryEntries(characters) {
    const entries = new Map();
    for (const ch of characters) {
      const target = String(ch.name || "").trim();
      if (!target) continue;
      const desc = genderToDescription(ch.gender);
      const sources = [ch.original, ...(Array.isArray(ch.aliases) ? ch.aliases : [])]
        .map(v => String(v || "").trim())
        .filter(v => v && v !== target && containsJapanese(v));
      for (const source of sources) addNameGlossaryEntry(entries, source, target, "character", desc);
    }
    return entries;
  }

  async function fetchVndbCharacters(vnId) {
    const all = [];
    let page = 1;
    let more = true;
    while (more) {
      const res = await fetch("https://api.vndb.org/kana/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: ["vn", "=", ["id", "=", vnId]],
          fields: "id,name,original,aliases,gender",
          sort: "id",
          results: 100,
          page,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`VNDB API error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
      }
      const data = await res.json();
      all.push(...(Array.isArray(data.results) ? data.results : []));
      more = !!data.more;
      page++;
      if (page > 20) throw new Error("VNDB mengembalikan terlalu banyak halaman.");
    }
    return all;
  }

  async function onImportVndbNames() {
    const vnId = extractVndbId(ui.vndbInput.value);
    if (!vnId) {
      ui.vndbStatus.textContent = "Masukkan VNDB ID/URL yang valid, contoh: v17.";
      return;
    }

    ui.btnImportVndbNames.disabled = true;
    ui.vndbStatus.textContent = `Mengambil nama karakter dari VNDB ${vnId}...`;
    try {
      const characters = await fetchVndbCharacters(vnId);
      const imported = collectVndbGlossaryEntries(characters);
      if (!imported.size) {
        ui.vndbStatus.textContent = "Tidak ada nama Jepang yang bisa diimpor dari VNDB.";
        return;
      }

      const { added, updated } = mergeGlossaryEntries(imported);
      ui.vndbStatus.textContent = `Import selesai: ${added} nama baru, ${updated} diperbarui dari ${characters.length} karakter.`;
    } catch (err) {
      ui.vndbStatus.textContent = `Gagal import VNDB: ${err.message}`;
    } finally {
      ui.btnImportVndbNames.disabled = false;
    }
  }

  function getRubyBaseText(rubyEl) {
    const clone = rubyEl.cloneNode(true);
    clone.querySelectorAll("rt, rp, rtc").forEach(el => el.remove());
    return clone.textContent.replace(/\s+/g, "").trim();
  }

  function collectKnownNameKeys() {
    const keys = new Set();
    for (const line of state.lines) {
      if (line.name) keys.add(line.name.replace(/\s+/g, "").trim());
      if (line.trans_name) keys.add(line.trans_name.replace(/\s+/g, "").trim());
    }
    for (const [source, entry] of parseGlossaryToMap(state.glossaryText).entries()) {
      keys.add(source.replace(/\s+/g, "").trim());
      keys.add(entry.target.replace(/\s+/g, "").trim());
    }
    return keys;
  }

  function collectRubyGlossaryEntriesFromHtml(html, href, knownNameKeys) {
    const doc = new DOMParser().parseFromString(html, href.endsWith(".xhtml") ? "application/xhtml+xml" : "text/html");
    const autoEntries = new Map();
    const candidateEntries = new Map();
    for (const ruby of Array.from(doc.querySelectorAll("ruby"))) {
      const base = getRubyBaseText(ruby);
      const reading = Array.from(ruby.querySelectorAll("rt")).map(rt => rt.textContent.trim()).join("");
      const normalizedReading = normalizeKana(reading);
      if (!base || !normalizedReading || base === normalizedReading) continue;
      if (!isLikelyRubyNameCandidate(base, normalizedReading)) continue;
      const romaji = kanaToRomaji(normalizedReading);
      if (!romaji || romaji === normalizedReading) continue;
      const targetMap = knownNameKeys.has(base.replace(/\s+/g, "").trim()) || knownNameKeys.has(romaji.replace(/\s+/g, "").trim())
        ? autoEntries
        : candidateEntries;
      addNameGlossaryEntry(targetMap, base, romaji);
    }
    return { autoEntries, candidateEntries };
  }

  async function onExtractEpubRubyNames() {
    if (state.projectType !== "epub" || !state.epubSourceId) {
      ui.epubRubyStatus.textContent = "Fitur ini hanya tersedia untuk proyek EPUB.";
      return;
    }

    ui.btnExtractEpubRubyNames.disabled = true;
    ui.epubRubyStatus.textContent = "Membaca ruby text dari EPUB...";
    try {
      const root = await getOpfsRoot();
      const fh = await root.getFileHandle(state.epubSourceId);
      const f = await fh.getFile();
      const zip = await window.JSZip.loadAsync(f);
      const files = state.importedFiles.length
        ? state.importedFiles
        : Object.keys(zip.files).filter(name => /\.(xhtml|html?)$/i.test(name));
      const knownNameKeys = collectKnownNameKeys();
      const entries = new Map();
      const candidates = new Map();
      for (const href of files) {
        const zf = zip.file(href);
        if (!zf) continue;
        const html = await zf.async("text");
        const extracted = collectRubyGlossaryEntriesFromHtml(html, href, knownNameKeys);
        for (const [source, target] of extracted.autoEntries.entries()) {
          if (!entries.has(source)) entries.set(source, target);
        }
        for (const [source, target] of extracted.candidateEntries.entries()) {
          if (!candidates.has(source)) candidates.set(source, target);
        }
        await new Promise(r => setTimeout(r, 0));
      }
      if (!entries.size && !candidates.size) {
        ui.epubRubyStatus.textContent = "Tidak ada kandidat ruby name yang ditemukan.";
        return;
      }
      let status = "";
      if (entries.size) {
        const { added, updated } = mergeGlossaryEntries(entries);
        status = `${added} entri cocok otomatis, ${updated} diperbarui.`;
      } else {
        status = "0 entri cocok otomatis.";
      }
      if (candidates.size) {
        ui.pasteGlossaryArea.value = serializeGlossaryMap(candidates);
        status += ` ${candidates.size} kandidat lain dikirim ke kotak review.`;
      }
      ui.epubRubyStatus.textContent = status;
    } catch (err) {
      ui.epubRubyStatus.textContent = `Gagal extract ruby EPUB: ${err.message}`;
    } finally {
      updateButtonStates();
    }
  }

  function extractAnilistId(input) {
    const trimmed = String(input || "").trim();
    const urlMatch = trimmed.match(/anilist\.co\/manga\/(\d+)(?:\/|$)/i);
    if (urlMatch) return Number(urlMatch[1]);
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    return null;
  }

  function collectAnilistGlossaryEntries(media) {
    const entries = new Map();
    const edges = media?.characters?.edges || [];
    for (const edge of edges) {
      const name = edge?.node?.name || {};
      const target = String(name.full || "").trim();
      if (!target) continue;
      const desc = genderToDescription(edge?.node?.gender);
      const sources = [name.native, ...(Array.isArray(name.alternative) ? name.alternative : [])]
        .map(v => String(v || "").trim())
        .filter(v => v && v !== target && containsJapanese(v));
      for (const source of sources) addNameGlossaryEntry(entries, source, target, "character", desc);
    }
    return entries;
  }

  async function fetchAnilistMediaCharacters(input) {
    const id = extractAnilistId(input);
    if (!id) throw new Error("Masukkan link lengkap AniList manga/novel atau ID angka.");
    const allEdges = [];
    let mediaInfo = null;
    let page = 1;
    let hasNextPage = true;
    const query = `
      query ($id: Int, $page: Int) {
        Media(id: $id, type: MANGA) {
          id
          title { romaji english native }
          format
          characters(page: $page, perPage: 50, sort: [ROLE, ID]) {
            pageInfo { hasNextPage }
            edges { node { gender name { full native alternative } } }
          }
        }
      }
    `;
    while (hasNextPage) {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { id, page } }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`AniList API error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
      }
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message || "AniList query gagal.");
      const media = json.data?.Media;
      if (!media) throw new Error("Judul tidak ditemukan di AniList.");
      if (!mediaInfo) mediaInfo = media;
      allEdges.push(...(media.characters?.edges || []));
      hasNextPage = !!media.characters?.pageInfo?.hasNextPage;
      page++;
      if (page > 20) throw new Error("AniList mengembalikan terlalu banyak halaman.");
    }
    mediaInfo.characters = { edges: allEdges };
    return mediaInfo;
  }

  async function onImportAnilistNames() {
    const input = ui.anilistInput.value.trim();
    if (!input) {
      ui.anilistStatus.textContent = "Masukkan link lengkap AniList manga/novel atau ID angka.";
      return;
    }

    ui.btnImportAnilistNames.disabled = true;
    ui.anilistStatus.textContent = "Mengambil nama karakter dari AniList...";
    try {
      const media = await fetchAnilistMediaCharacters(input);
      const imported = collectAnilistGlossaryEntries(media);
      const title = media.title?.romaji || media.title?.english || media.title?.native || `AniList ${media.id}`;
      if (!imported.size) {
        ui.anilistStatus.textContent = `Tidak ada nama Jepang yang bisa diimpor dari ${title}.`;
        return;
      }
      const { added, updated } = mergeGlossaryEntries(imported);
      ui.anilistStatus.textContent = `Import selesai dari ${title}: ${added} nama baru, ${updated} diperbarui.`;
    } catch (err) {
      ui.anilistStatus.textContent = `Gagal import AniList: ${err.message}`;
    } finally {
      ui.btnImportAnilistNames.disabled = false;
    }
  }

  async function onCopyForAi() {
    const sel = state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l));
    if (!sel.length) return;

    let contextBlock = "";
    if (state.contextLines > 0) {
      const firstSelLineNum = sel[0].line_num;
      const firstSelIdx = state.lines.findIndex(l => l.line_num === firstSelLineNum);
      if (firstSelIdx > 0) {
        const startIdx = Math.max(0, firstSelIdx - state.contextLines);
        const ctxLines = state.lines.slice(startIdx, firstSelIdx);
        const ctxOut = [];
        for (const l of ctxLines) {
          const dN = l.name || "";
          ctxOut.push(dN ? `${dN}: ${l.message}` : `${l.message}`);
        }
        if (ctxOut.length > 0) {
          contextBlock = `\n\n<Context>\nThese lines are for context only. Do NOT translate them.\n${ctxOut.join("\n")}\n</Context>`;
        }
      }
    }

    const joinedText = getSelectedTranslationText(false);
    const glossaryBlock = getGlossaryPrompt(joinedText);
    const p = `${(state.aiInstructionHeader || DEFAULT_PROMPT_HEADER).trim()}${glossaryBlock}${contextBlock}\n\n${joinedText}\n`;
    try {
      await navigator.clipboard.writeText(p);
      flashHint(`Disalin ${sel.length} baris.`);
    } catch (_) {
      ui.pasteArea.value = p;
    }
  }

  function getSelectedTranslatedLines() {
    return state.lines.filter(l => state.selectedLines.has(l.line_num) && isTranslated(l));
  }

  function getLineForAiCheck(line) {
    const originalName = line.name || "";
    const translatedName = (line.trans_name || "").trim() || originalName;
    const originalText = originalName ? `${originalName}: ${line.message}` : line.message;
    const translatedText = translatedName ? `${translatedName}: ${line.trans_message}` : line.trans_message;
    const glossary = getGlossaryPrompt(`${originalText}\n${translatedText}`).trim();
    return [
      `[line ${line.line_num}]`,
      `original: ${originalText}`,
      `translation: ${translatedText}`,
      glossary ? glossary : "",
    ].filter(Boolean).join("\n");
  }

  function setAiCheckStatus(message, keepAlive = false) {
    ui.aiCheckStatus.textContent = message;
    ui.aiCheckStatus.classList.remove("empty");
    if (!keepAlive) {
      setTimeout(() => {
        if (ui.aiCheckStatus.textContent === message) ui.aiCheckStatus.classList.add("empty");
      }, 4000);
    }
  }

  async function onCopyForAiCheck() {
    const sel = getSelectedTranslatedLines();
    if (!sel.length) {
      setAiCheckStatus("Tidak ada baris terjemahan yang dipilih.");
      return;
    }
    const promptText = `${(state.aiCheckPrompt || DEFAULT_AI_CHECK_PROMPT).trim()}\n\n${sel.map(getLineForAiCheck).join("\n\n")}\n`;
    try {
      await navigator.clipboard.writeText(promptText);
      setAiCheckStatus(`Disalin ${sel.length} baris untuk AI Check.`);
    } catch (_) {
      ui.pasteAiCheckArea.value = promptText;
      setAiCheckStatus("Clipboard gagal, prompt dimasukkan ke kotak paste.");
    }
    updateButtonStates();
  }

  function parseAiCheckBlocks(text) {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    let current = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === "```" || line === "```plaintext" || line === "```text") continue;
      const header = line.match(/^\[line\s+(\d+)\]$/i);
      if (header) {
        if (current) blocks.push(current);
        current = { num: Number(header[1]), reason: "", name: "", text: "" };
        continue;
      }
      if (!current) throw new Error(`Baris tanpa header [line N]: "${line.slice(0, 50)}"`);
      const field = line.match(/^(reason|name|text)\s*:\s*(.*)$/i);
      if (!field) throw new Error(`Format field rusak pada line ${current.num}: "${line.slice(0, 50)}"`);
      const key = field[1].toLowerCase();
      current[key] = field[2].trim();
    }
    if (current) blocks.push(current);
    if (!blocks.length) throw new Error("Tidak ada blok [line N] yang valid.");
    return blocks;
  }

  function onParseAiCheck() {
    try {
      const parsed = parseAiCheckBlocks(ui.pasteAiCheckArea.value.trim());
      const selectedTranslated = new Set(getSelectedTranslatedLines().map(l => l.line_num));
      const corrections = [];
      const errors = [];
      const seen = new Set();
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
        return alert("AI CHECK DITOLAK:\n\n" + errors.slice(0, 12).join("\n") + (errors.length > 12 ? `\n\n... (+${errors.length - 12} error lain)` : ""));
      }
      state.aiCheckCorrections = corrections;
      renderAiCheckCorrections();
      setAiCheckStatus(`Parsed ${corrections.length} koreksi.`);
    } catch (err) {
      state.aiCheckCorrections = [];
      renderAiCheckCorrections();
      alert("Gagal parse AI Check:\n\n" + err.message);
    }
  }

  function renderAiCheckCorrections() {
    ui.aiCheckResults.textContent = "";
    const frag = document.createDocumentFragment();
    for (const correction of state.aiCheckCorrections) {
      const line = state.lineByNum.get(correction.num);
      if (!line) continue;
      const row = document.createElement("div");
      row.className = "ai-check-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = correction.checked;
      checkbox.addEventListener("change", () => {
        correction.checked = checkbox.checked;
        updateButtonStates();
      });

      const body = document.createElement("div");
      body.className = "ai-check-body";
      const title = document.createElement("div");
      title.className = "mono ai-check-title";
      title.textContent = `Line ${correction.num}`;
      const reason = document.createElement("div");
      reason.className = "ai-check-reason";
      reason.textContent = `Reason: ${correction.reason}`;
      const current = document.createElement("div");
      current.className = "original";
      const currentName = (line.trans_name || "").trim() || line.name || "";
      current.textContent = `Current: ${currentName ? `${currentName}: ` : ""}${line.trans_message}`;
      const proposed = document.createElement("div");
      proposed.className = "translated";
      proposed.textContent = `Proposed: ${correction.name ? `${correction.name}: ` : ""}${correction.text}`;
      body.append(title, reason, current, proposed);
      row.append(checkbox, body);
      frag.appendChild(row);
    }
    ui.aiCheckResults.appendChild(frag);
    updateButtonStates();
  }

  function stripDuplicateSpeakerPrefix(text, name) {
    const cleanName = String(name || "").trim();
    let cleanText = String(text || "").trim();
    if (!cleanName || !cleanText) return cleanText;
    const separators = [":", "："];
    for (const sep of separators) {
      const prefix = `${cleanName}${sep}`;
      if (cleanText.toLowerCase().startsWith(prefix.toLowerCase())) {
        cleanText = cleanText.slice(prefix.length).trim();
        break;
      }
    }
    return cleanText;
  }

  function onApplyAiCheckCorrections() {
    const corrections = state.aiCheckCorrections.filter(c => c.checked);
    if (!corrections.length) return;
    pushUndoSnapshot();
    let applied = 0;
    for (const correction of corrections) {
      const line = state.lineByNum.get(correction.num);
      if (!line || !isTranslated(line)) continue;
      const effectiveName = line.name && correction.name ? correction.name : ((line.trans_name || "").trim() || line.name || "");
      if (line.name && correction.name) line.trans_name = correction.name;
      line.trans_message = line.name ? stripDuplicateSpeakerPrefix(correction.text, effectiveName) : correction.text;
      line.is_translated = true;
      applied++;
    }
    state.aiCheckCorrections = state.aiCheckCorrections.filter(c => !c.checked);
    renderAiCheckCorrections();
    refreshAll();
    queueAutoSave();
    setAiCheckStatus(`Diterapkan ${applied} koreksi.`);
  }

  function onClearAiCheck() {
    state.aiCheckCorrections = [];
    ui.pasteAiCheckArea.value = "";
    ui.aiCheckResults.textContent = "";
    setAiCheckStatus("AI Check dibersihkan.");
    updateButtonStates();
  }

  function onApplyTranslation() {
    if (!state.lines.length) return;
    const rawLines = ui.pasteArea.value.split(/\r?\n/);
    const parsed = [], errors = [], seen = new Set();
    const selectedUntranslated = new Set(state.lines.filter(l => state.selectedLines.has(l.line_num) && !isTranslated(l)).map(l => l.line_num));
    const expectedCount = selectedUntranslated.size;
    for (let i = 0; i < rawLines.length; i++) {
      const txt = rawLines[i].trim();
      if (!txt) continue;
      const match = txt.match(/^\s*(\d+)\s*[.)]\s*(.*)$/);
      if (!match) {
        errors.push(`[Baris ${i+1}] Format rusak (Harus "Angka. Teks") -> "${txt.substring(0,25)}..."`);
        continue;
      }
      const num = Number(match[1]);
      if (seen.has(num)) errors.push(`[#${num}] Duplikat nomor baris.`);
      seen.add(num);
      let name = null;
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
      parsed.push({ num, name, msg, rawMsg });
    }
    if (!parsed.length && !errors.length) return alert("Teks di kotak kosong atau tidak valid.");
    if (parsed.length > 0) {
      if (parsed.length !== expectedCount) {
        errors.push(`[Validasi Checkbox] Copy ${expectedCount} baris, tapi yang di-paste ${parsed.length} baris.`);
      }
      for (const num of selectedUntranslated) {
        if (!seen.has(num) && state.lineByNum.has(num)) errors.push(`[#${num}] Hilang dari hasil paste.`);
      }
      for (const num of seen) {
        if (!selectedUntranslated.has(num)) errors.push(`[#${num}] Nyasar, baris ini tidak kamu centang sebelumnya.`);
      }
    }
    const updates = [];
    for (const it of parsed) {
      const l = state.lineByNum.get(it.num);
      if (!l) { errors.push(`[#${it.num}] Tidak ada di JSON asli.`); continue; }
      const oN = !!(l.name || "").trim();
      let tN = !!(it.name || "").trim();
      if (!oN && tN) { it.msg = it.rawMsg; it.name = null; tN = false; }
      if (oN && !tN) errors.push(`[#${it.num}] Nama karakter hilang.`);
      else if (!oN && tN) errors.push(`[#${it.num}] Tiba-tiba ada nama karakter.`);
      else if (!it.msg) errors.push(`[#${it.num}] Pesannya kosong.`);
      else updates.push({ l, it });
    }
    if (errors.length) {
      return alert("TRANSLASI DITOLAK:\n\n" + errors.slice(0, 10).join("\n") + (errors.length > 10 ? `\n\n... (+${errors.length-10} error lain)` : ""));
    }
    pushUndoSnapshot();
    for (const {l, it} of updates) {
      l.trans_message = it.msg;
      l.is_translated = true;
      if (it.name) l.trans_name = it.name;
      state.selectedLines.delete(l.line_num);
    }
    ui.pasteArea.value = "";
    refreshAll();
    queueAutoSave();
    flashHint(`${updates.length} baris sukses diterapkan.`);
  }

  function onUndoLastApply() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) return;
    state.lines = snapshot.lines.map(normalizeLineDict);
    refreshAll();
    queueAutoSave();
  }

  function openLineEditor(num) {
    const l = state.lineByNum.get(num);
    if (!l) return;
    activeLineEditorLineNum = num;
    ui.lineEditorTitle.textContent = `Edit Baris ${num}`;
    ui.lineOriginalView.value = l.name ? `${l.name}: ${l.message}` : `${l.message}`;
    ui.lineNameWrap.style.display = l.name ? "block" : "none";
    ui.lineNameInput.value = l.name ? (l.trans_name || "") : "";
    if (l.name) ui.lineNameInput.placeholder = l.name;
    ui.lineMessageInput.value = (l.trans_message || "").trim();
    ui.lineTranslatedCheck.checked = isTranslated(l);
    openModal(ui.lineEditorModal);
  }

  function onSaveLineEditor() {
    const l = state.lineByNum.get(activeLineEditorLineNum);
    if (!l) return;
    const m = ui.lineMessageInput.value.trim().replace(/\r?\n/g, "\\n");
    if (ui.lineTranslatedCheck.checked && !m) return alert("Gagal: Pesan terjemahan kosong.");
    let n = null;
    if (l.name) n = ui.lineNameInput.value.trim().replace(/\r?\n/g, "\\n");
    pushUndoSnapshot();
    l.trans_message = m || null;
    l.is_translated = !!(ui.lineTranslatedCheck.checked && m);
    if (l.name) l.trans_name = n || null;
    closeModal(ui.lineEditorModal);
    refreshAll();
    if (ui.proofreadModal.classList.contains("open")) renderProofreadResults();
    queueAutoSave();
  }

  function onOpenProofread() { openModal(ui.proofreadModal); renderProofreadResults(); }
  function onResetProofread() {
    ui.proofreadSearchInput.value = ""; ui.proofreadReplaceInput.value = "";
    ui.proofreadScope.value = "all"; ui.proofreadRegexCheck.checked = false;
    ui.proofreadCaseCheck.checked = false; ui.proofreadExactCheck.checked = false;
    ui.proofreadTranslatedOnlyCheck.checked = true;
    renderProofreadResults();
  }

  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function containsJapanese(text) {
    return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
  }

  function normalizeKana(text) {
    return String(text || "")
      .normalize("NFKC")
      .replace(/[\s・･=＝~〜～、，,]/g, "")
      .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  function kanaToRomaji(text) {
    const kana = normalizeKana(text);
    const digraphs = {
      きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho",
      ちゃ: "cha", ちゅ: "chu", ちょ: "cho", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
      ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
      りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
      じゃ: "ja", じゅ: "ju", じょ: "jo", びゃ: "bya", びゅ: "byu", びょ: "byo",
      ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo", ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
      てぃ: "ti", でぃ: "di", うぃ: "wi", うぇ: "we", うぉ: "wo", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
    };
    const singles = {
      あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
      さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
      な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
      ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo",
      ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "o", ん: "n",
      が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
      だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
      ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ゔ: "vu", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
    };
    let out = "";
    let doubleNext = false;
    for (let i = 0; i < kana.length; i++) {
      const ch = kana[i];
      if (ch === "っ") {
        doubleNext = true;
        continue;
      }
      if (ch === "ー") {
        const vowel = out.match(/[aeiou]$/)?.[0] || "";
        out += vowel;
        continue;
      }
      const pair = kana.slice(i, i + 2);
      let romaji = digraphs[pair];
      if (romaji) i++;
      else romaji = singles[ch] || ch;
      if (doubleNext && /^[bcdfghjklmnpqrstvwxyz]/.test(romaji)) {
        out += romaji[0];
      }
      out += romaji;
      doubleNext = false;
    }
    return out.replace(/n([bmp])/g, "m$1").replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function buildSearchRegex(query, isRegex, isCase, isExact, capture = false) {
    let regexStr = isRegex ? query : escapeRegex(query);
    if (isExact && !containsJapanese(query)) regexStr = `\\b(?:${regexStr})\\b`;
    if (capture) regexStr = `(${regexStr})`;
    return new RegExp(regexStr, isCase ? "gu" : "giu");
  }

  function createHighlightedNodes(text, query, isRegex, isCase, isExact) {
    if (!query) return document.createTextNode(text);
    let regex;
    try {
      regex = buildSearchRegex(query, isRegex, isCase, isExact, true);
    } catch(e) { return document.createTextNode(text); }
    const frag = document.createDocumentFragment();
    const parts = text.split(regex);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const mark = document.createElement("mark");
        mark.className = "highlight"; mark.textContent = parts[i];
        frag.appendChild(mark);
      } else if (parts[i]) {
        frag.appendChild(document.createTextNode(parts[i]));
      }
    }
    return frag;
  }

  function renderProofreadResults() {
    if (!ui.proofreadModal.classList.contains("open")) return;
    const query = ui.proofreadSearchInput.value;
    const isRegex = ui.proofreadRegexCheck.checked;
    const isCase = ui.proofreadCaseCheck.checked;
    const isExact = ui.proofreadExactCheck.checked;
    const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
    const scope = ui.proofreadScope.value;
    let regex = null;
    if (query) {
      try {
        regex = buildSearchRegex(query, isRegex, isCase, isExact);
      }
      catch (e) { return; }
    }
    state.proofreadMatches = [];
    for (const line of state.lines) {
      if (onlyTrans && !isTranslated(line)) continue;
      const dName = line.name || "";
      let fName = null;
      if (isTranslated(line)) fName = (line.trans_name || "").trim() || line.name;
      const targetMsg = onlyTrans ? line.trans_message : line.message;
      const targetName = onlyTrans ? fName : dName;
      if (query && regex) {
        let isMatch = false;
        regex.lastIndex = 0;
        if ((scope === 'all' || scope === 'message') && targetMsg && regex.test(targetMsg)) isMatch = true;
        regex.lastIndex = 0;
        if (!isMatch && (scope === 'all' || scope === 'name') && targetName && regex.test(targetName)) isMatch = true;
        if (!isMatch) continue;
      }
      state.proofreadMatches.push({
        num: line.line_num, file: line.file, origName: dName, origMsg: line.message,
        transName: fName, transMsg: line.trans_message, isTrans: isTranslated(line)
      });
    }
    ui.proofreadStatus.textContent = `Ditemukan ${state.proofreadMatches.length} baris.`;
    proofreadScroller.setItems(state.proofreadMatches);
  }

  function renderProofreadRow(r) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const contentWrap = document.createElement("div");
    contentWrap.className = "text-content";
    const query = ui.proofreadSearchInput.value;
    const isRegex = ui.proofreadRegexCheck.checked;
    const isCase = ui.proofreadCaseCheck.checked;
    const isExact = ui.proofreadExactCheck.checked;
    const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
    const scope = ui.proofreadScope.value;
    const highlightName = scope === 'all' || scope === 'name';
    const highlightMsg = scope === 'all' || scope === 'message';
    const buildNodes = (name, msg, shouldHighlightAll) => {
      const wrap = document.createDocumentFragment();
      if (name) {
        if (shouldHighlightAll && highlightName) wrap.appendChild(createHighlightedNodes(name, query, isRegex, isCase, isExact));
        else wrap.appendChild(document.createTextNode(name));
        wrap.appendChild(document.createTextNode(": "));
      }
      if (shouldHighlightAll && highlightMsg) wrap.appendChild(createHighlightedNodes(msg, query, isRegex, isCase, isExact));
      else wrap.appendChild(document.createTextNode(msg));
      return wrap;
    };
    const fileMeta = document.createElement("div");
    fileMeta.className = "file-meta";
    fileMeta.textContent = `File: ${r.file} | Baris: ${r.num}`;
    const origDiv = document.createElement("div");
    origDiv.className = "original";
    const transDiv = document.createElement("div");
    transDiv.className = "translated";
    if (!r.isTrans) transDiv.classList.add("cell-muted");
    if (onlyTrans) {
      origDiv.textContent = r.origName ? `${r.origName}: ${r.origMsg}` : r.origMsg;
      if (r.isTrans) transDiv.appendChild(buildNodes(r.transName, r.transMsg, true));
      else transDiv.textContent = "——";
    } else {
      origDiv.appendChild(buildNodes(r.origName, r.origMsg, true));
      if (r.isTrans) transDiv.textContent = r.transName ? `${r.transName}: ${r.transMsg}` : r.transMsg;
      else transDiv.textContent = "——";
    }
    contentWrap.append(fileMeta, origDiv, transDiv);
    row.appendChild(contentWrap);
    contentWrap.addEventListener("click", () => openLineEditor(r.num));
    return row;
  }

  function onProofreadReplaceAll() {
    const query = ui.proofreadSearchInput.value;
    if (!query) return alert("Pencarian masih kosong!");
    const rep = ui.proofreadReplaceInput.value;
    const isRegex = ui.proofreadRegexCheck.checked;
    const isCase = ui.proofreadCaseCheck.checked;
    const isExact = ui.proofreadExactCheck.checked;
    const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
    const scope = ui.proofreadScope.value;
    let regex;
    try {
      regex = buildSearchRegex(query, isRegex, isCase, isExact);
    } catch(e) { return alert("Format Regex tidak valid."); }
    let count = 0;
    const undoSnapshot = { lines: JSON.parse(JSON.stringify(state.lines)) };
    for (const line of state.lines) {
      if (onlyTrans) {
        if (!isTranslated(line)) continue;
        let replaced = false;
        if ((scope === 'all' || scope === 'message') && line.trans_message) {
            regex.lastIndex = 0;
            if (regex.test(line.trans_message)) { line.trans_message = line.trans_message.replace(regex, rep); replaced = true; }
        }
        if ((scope === 'all' || scope === 'name') && line.trans_name) {
            regex.lastIndex = 0;
            if (regex.test(line.trans_name)) { line.trans_name = line.trans_name.replace(regex, rep); replaced = true; }
        }
        if (replaced) count++;
      } else {
        let replaced = false;
        if ((scope === 'all' || scope === 'message') && line.message) {
            regex.lastIndex = 0;
            if (regex.test(line.message)) { line.message = line.message.replace(regex, rep); replaced = true; }
        }
        if ((scope === 'all' || scope === 'name') && line.name) {
            regex.lastIndex = 0;
            if (regex.test(line.name)) { line.name = line.name.replace(regex, rep); replaced = true; }
        }
        if (replaced) count++;
      }
    }
    if (count > 0) {
      state.undoStack.push(undoSnapshot);
      if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
      refreshAll(); renderProofreadResults(); queueAutoSave();
      alert(`Berhasil melakukan Replace All pada ${count} baris teks.`);
    } else alert(`Tidak ada kata yang cocok dengan pencarian.`);
  }

  function onOpenSettings() {
    ui.settingsPromptInput.value = state.aiInstructionHeader;
    ui.settingsGlossaryPromptInput.value = state.glossaryPrompt;
    ui.settingsAiCheckPromptInput.value = state.aiCheckPrompt;
    ui.settingsEpubTagsInput.value = state.epubTags || "p";
    ui.settingsGlossaryInput.value = state.glossaryText || "";
    ui.settingsContextLinesInput.value = state.contextLines;
    openModal(ui.settingsModal);
  }

  function onSavePromptSettings() {
    state.aiInstructionHeader = ui.settingsPromptInput.value.trim();
    state.glossaryPrompt = ui.settingsGlossaryPromptInput.value.trim();
    state.aiCheckPrompt = ui.settingsAiCheckPromptInput.value.trim();
    state.epubTags = ui.settingsEpubTagsInput.value.trim() || "p";
    state.glossaryText = ui.settingsGlossaryInput.value.trim();
    state.contextLines = parseInt(ui.settingsContextLinesInput.value) || 0;
    closeModal(ui.settingsModal);
    renderGlossaryPreview();
    queueAutoSave();
  }

  function confirmExportWithUntranslatedReport() {
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

  async function onExport() {
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
            if (l && l.is_translated && l.trans_message) {
              el.textContent = l.trans_message;
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

  function openModal(el) { el.classList.add("open"); }
  function closeModal(el) { el.classList.remove("open"); }
})();
