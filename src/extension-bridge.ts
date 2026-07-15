// @module extension-bridge.ts — Bridge CSTL page ↔ browser extension (Auto Copas)

import { state, ui, isTranslated } from './state';
import { flashHint, syncCheckboxUI, updateButtonStates } from './render';
import {
  buildCopyForAiPrompt,
  countSelectedUntranslated,
  onApplyTranslation,
  TranslationApplyError,
} from './translate';
import {
  getSelectedTranslationPlainText,
  applyPromptVariables,
} from './ai-format';
import { DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT } from './constants';
import {
  parseGlossaryToMap,
  serializeGlossaryMap,
  renderGlossaryPreview,
  buildExistingGlossaryHint,
} from './glossary';
import {
  getSelectedTranslatedLines,
  getLineForAiCheck,
  parseAiCheckBlocks,
  renderAiCheckCorrections,
  setAiCheckStatus,
  onApplyAiCheckCorrections,
} from './ai-check';
import { queueAutoSave } from './project';

const SOURCE_APP = 'cstl-app';
const SOURCE_EXT = 'cstl-extension';
const PROTOCOL = 1;

export type CopasTargetId = 'gemini' | 'deepseek' | 'meta' | 'chatgpt';
export type CopasMode = 'semi' | 'full';

type ExtMsg = {
  v?: number;
  type: string;
  requestId?: string;
  ok?: boolean;
  text?: string;
  error?: string;
  stage?: string;
  detail?: string;
  extensionVersion?: string;
  settings?: { target?: CopasTargetId; mode?: CopasMode; [key: string]: any };
  capabilities?: { targets?: string[]; modes?: string[] };
};

let available = false;
let extensionVersion = '';
let lastSettings: { target: CopasTargetId; mode: CopasMode } = {
  target: 'gemini',
  mode: 'semi',
};
let statusText = 'Extension: mengecek…';
let activeRequestId: string | null = null;
let isFullAutoRunning = false;
let isGlossaryAutoRunning = false;
let isAiCheckAutoRunning = false;
const pending = new Map<string, { resolve: (m: ExtMsg) => void; timer: number }>();

function rid(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function setStatus(text: string): void {
  statusText = text;
  const el = ui.autoCopasStatus as HTMLElement | undefined;
  if (el) el.textContent = text;
}

/** Auto Copas is an optional extension feature, so keep its controls out of
 * the CSTL UI until the bridge has completed a successful ping. */
function setAutoCopasVisible(show: boolean): void {
  const controls = ui.autoCopasControls as HTMLElement | undefined;
  if (controls) controls.hidden = !show;
  const gControls = ui.autoCopasGlossaryControls as HTMLElement | undefined;
  if (gControls) gControls.hidden = !show;
  const cControls = ui.autoCopasAiCheckControls as HTMLElement | undefined;
  if (cControls) cControls.hidden = !show;
  if (!show) {
    showCancelButton(false);
    showGlossaryCancelButton(false);
    showAiCheckCancelButton(false);
  }
}

function setGlossaryStatus(text: string): void {
  const el = ui.autoCopasGlossaryStatus as HTMLElement | undefined;
  if (el) el.textContent = text;
}

function setAiCheckExtStatus(text: string): void {
  const el = ui.autoCopasAiCheckStatus as HTMLElement | undefined;
  if (el) el.textContent = text;
}

function showGlossaryCancelButton(show: boolean): void {
  const btn = ui.btnAutoCopasGlossaryCancel as HTMLElement | undefined;
  if (btn) btn.style.display = show ? '' : 'none';
}

function showAiCheckCancelButton(show: boolean): void {
  const btn = ui.btnAutoCopasAiCheckCancel as HTMLElement | undefined;
  if (btn) btn.style.display = show ? '' : 'none';
}

function postToExt(msg: Record<string, unknown>): void {
  window.postMessage({ source: SOURCE_APP, msg }, '*');
}

function applyReceivedResult(text: string): void {
  const pasteArea = ui.pasteArea as HTMLTextAreaElement | undefined;
  if (!pasteArea) return;
  pasteArea.value = text;
  // Keep any listeners that react to manually pasted text in sync as well.
  pasteArea.dispatchEvent(new Event('input', { bubbles: true }));
  updateButtonStates();
}

/**
 * Full Auto follows the same batch setting as Auto Translate. It only makes a
 * selection when the user has not explicitly selected lines, preserving a
 * manual selection as the intended scope.
 */
function selectNextFullAutoBatch(scope: Set<number>): number {
  const batchSize = Math.max(1, state.selectionBatchSize || 100);
  const batch = state.lines
    .filter((line) => scope.has(line.line_num) && !isTranslated(line) && !line._hidden)
    .slice(0, batchSize);

  state.selectedLines.clear();
  for (const line of batch) state.selectedLines.add(line.line_num);
  syncCheckboxUI();
  return batch.length;
}

function request(msg: Record<string, unknown>, timeoutMs = 200000): Promise<ExtMsg> {
  const requestId = (msg.requestId as string) || rid();
  msg.requestId = requestId;
  msg.v = PROTOCOL;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      resolve({ type: 'TIMEOUT', requestId, ok: false, error: 'timeout' });
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
    postToExt(msg);
  });
}

function onWindowMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== SOURCE_EXT) return;
  const msg = data.msg as ExtMsg | undefined;
  if (!msg || !msg.type) return;

  if (msg.type === 'COPAS_BRIDGE_READY') {
    available = true;
    void pingExtension();
    return;
  }

  // Live status updates (non-terminal) — update UI but don't resolve promise
  if (msg.type === 'COPAS_STATUS' && msg.stage) {
    const detail = msg.detail ? ` — ${msg.detail}` : '';
    setStatus(`Auto Copas: ${msg.stage}${detail}`);

    // Show cancel button during active full-auto flow
    if (msg.stage === 'submitted' || msg.stage === 'waiting_response' || msg.stage === 'finding_tab') {
      showCancelButton(true);
    }
  }

  // Terminal statuses and results resolve the pending promise
  if (msg.requestId && pending.has(msg.requestId)) {
    const p = pending.get(msg.requestId)!;
    if (
      msg.type === 'COPAS_PONG' ||
      msg.type === 'COPAS_RESULT' ||
      msg.type === 'COPAS_SETTINGS' ||
      // "submitted" is only an intermediate full-auto update. Resolving here
      // previously caused sendAutoCopas() to finish before COPAS_RESULT arrived.
      (msg.type === 'COPAS_STATUS' && (msg.stage === 'pasted' || msg.stage === 'error' || msg.stage === 'cancelled' || msg.stage === 'done'))
    ) {
      window.clearTimeout(p.timer);
      pending.delete(msg.requestId);
      p.resolve(msg);
    }
  }

  if (msg.type === 'COPAS_RESULT') {
    showCancelButton(false);
    if (msg.ok && msg.text) {
      applyReceivedResult(msg.text);
      setStatus(`Auto Copas: hasil diterima (${msg.text.length} char)`);
    } else if (msg.error) {
      setStatus(`Auto Copas error: ${msg.error}`);
    }
    activeRequestId = null;
  }

  // Hide cancel on terminal status
  if (msg.type === 'COPAS_STATUS') {
    const terminalStages = ['pasted', 'done', 'error', 'cancelled'];
    if (terminalStages.includes(msg.stage || '')) {
      showCancelButton(false);
      activeRequestId = null;
    }
  }
}

function showCancelButton(show: boolean): void {
  const btnCancel = ui.btnAutoCopasCancel as HTMLElement | undefined;
  if (btnCancel) btnCancel.style.display = show ? '' : 'none';
}

export function isExtensionAvailable(): boolean {
  return available;
}

// flag for render.ts button state check without circular import
(window as any).__cstlExtAvailable = false;

export function getExtensionStatusText(): string {
  return statusText;
}

export async function pingExtension(): Promise<boolean> {
  const res = await request({ type: 'COPAS_PING', requestId: rid() }, 800);
  if (res.type === 'COPAS_PONG' && res.ok) {
    available = true;
    (window as any).__cstlExtAvailable = true;
    document.documentElement.dataset.cstlExt = '1';
    extensionVersion = res.extensionVersion || '';
    if (res.settings?.target === 'gemini' || res.settings?.target === 'deepseek' || res.settings?.target === 'meta' || res.settings?.target === 'chatgpt') {
      lastSettings.target = res.settings.target;
    }
    if (res.settings?.mode === 'semi' || res.settings?.mode === 'full') {
      lastSettings.mode = res.settings.mode;
    }
    syncSettingsUi();
    setAutoCopasVisible(true);
    const connectedMsg = `Terhubung v${extensionVersion || '?'} · ${lastSettings.target}/${lastSettings.mode}`;
    setStatus(`Extension ${connectedMsg}`);
    setGlossaryStatus(connectedMsg);
    setAiCheckExtStatus(connectedMsg);
    updateButtonStates();
    return true;
  }
  available = false;
  (window as any).__cstlExtAvailable = false;
  delete document.documentElement.dataset.cstlExt;
  setAutoCopasVisible(false);
  setStatus('Extension belum terpasang / bridge tidak aktif');
  setGlossaryStatus('Extension belum terpasang');
  setAiCheckExtStatus('Extension belum terpasang');
  updateButtonStates();
  return false;
}

function syncSettingsUi(): void {
  // Settings are now managed via the extension popup — nothing to sync on the page.
}

export async function applyLocalSettingsToExtension(): Promise<void> {
  if (!available) return;
  await request({
    type: 'COPAS_SET_SETTINGS',
    requestId: rid(),
    settings: { target: lastSettings.target, mode: lastSettings.mode },
  }, 2000);
}

let tempRestoreNewTabEvery: number | undefined;

async function triggerExtensionNewChat(): Promise<void> {
  if (!available) return;
  try {
    const cur = await request({ type: 'COPAS_GET_SETTINGS', requestId: rid() }, 2000);
    if (cur.type === 'COPAS_SETTINGS' && cur.settings) {
      tempRestoreNewTabEvery = cur.settings.newTabEvery;
    }
    await request({
      type: 'COPAS_SET_SETTINGS',
      requestId: rid(),
      settings: {
        newTabEvery: 1,
        sendCounts: { [lastSettings.target]: 0 } as any
      }
    }, 2000);
  } catch {}
}

async function restoreExtensionNewTabSetting(): Promise<void> {
  if (tempRestoreNewTabEvery !== undefined && available) {
    const val = tempRestoreNewTabEvery;
    tempRestoreNewTabEvery = undefined;
    try {
      await request({
        type: 'COPAS_SET_SETTINGS',
        requestId: rid(),
        settings: { newTabEvery: val }
      }, 2000);
    } catch {}
  }
}

async function runFullAutoBatches(): Promise<void> {
  const manuallySelected = state.lines
    .filter((line) => state.selectedLines.has(line.line_num) && !isTranslated(line) && !line._hidden)
    .map((line) => line.line_num);
  const scope = new Set(manuallySelected.length
    ? manuallySelected
    : state.lines.filter((line) => !isTranslated(line) && !line._hidden).map((line) => line.line_num));
  if (!scope.size) {
    flashHint('Tidak ada baris belum diterjemahkan.');
    return;
  }

  if (!available) {
    const ok = await pingExtension();
    if (!ok) {
      flashHint('Extension CSTL Auto Copas belum terpasang. Load unpacked dari folder cstl-extension/dist.');
      return;
    }
  }
  await applyLocalSettingsToExtension();
  isFullAutoRunning = true;
  let appliedCount = 0;
  let retryCount = 0;
  try {
    while (isFullAutoRunning) {
      const n = selectNextFullAutoBatch(scope);
      if (!n) break;

      const payload = buildCopyForAiPrompt();
      if (!payload) break;
      const reqId = rid();
      activeRequestId = reqId;
      setStatus(`Full auto: mengirim ${n} baris ke ${lastSettings.target}${retryCount ? ' (retry #1 new chat)' : ''}…`);
      flashHint(`Full auto → ${lastSettings.target}: batch ${appliedCount + 1}–${appliedCount + n}${retryCount ? ' (retry new chat)' : ''}`);
      showCancelButton(true);

      const res = await request({
        type: 'COPAS_SEND', requestId: reqId, target: lastSettings.target,
        mode: 'full', payload, meta: { lineCount: n },
      }, 240000);

      await restoreExtensionNewTabSetting();
      if (!isFullAutoRunning) break;
      if (res.type !== 'COPAS_RESULT' || !res.ok || !res.text) {
        if (retryCount < 1) {
          retryCount++;
          const detail = res.error || res.detail || 'timeout/error';
          flashHint(`Batch gagal (${detail}). Mencoba ulang 1x di obrolan baru (New Chat)…`);
          setStatus(`Mencoba ulang batch di obrolan baru (New Chat)…`);
          await triggerExtensionNewChat();
          continue;
        }
        const detail = res.error || res.detail || (res.type === 'TIMEOUT' ? 'timeout' : 'respons tidak lengkap');
        flashHint(`Full auto berhenti (gagal setelah retry): ${detail}`);
        setStatus(`Full auto berhenti: ${detail}`);
        return;
      }

      applyReceivedResult(res.text);
      try {
        onApplyTranslation({ suppressAlerts: true });
        appliedCount += n;
        retryCount = 0;
      } catch (err) {
        if (retryCount < 1) {
          retryCount++;
          const detail = err instanceof TranslationApplyError
            ? `${err.message}${err.details[0] ? ` — ${err.details[0]}` : ''}`
            : 'gagal menerapkan hasil';
          flashHint(`Format AI keliru (${detail}). Mencoba ulang 1x di obrolan baru (New Chat)…`);
          setStatus(`Format AI keliru — mengulang batch di obrolan baru…`);
          await triggerExtensionNewChat();
          continue;
        }
        const detail = err instanceof TranslationApplyError
          ? `${err.message}${err.details[0] ? ` — ${err.details[0]}` : ''}`
          : 'gagal menerapkan hasil';
        flashHint(`Hasil diterima, tapi format masih keliru setelah retry: ${detail}. Periksa kotak hasil.`);
        setStatus(`Full auto perlu ditinjau: ${detail}`);
        return;
      }
    }
    if (isFullAutoRunning) {
      flashHint(`Full auto selesai: ${appliedCount} baris diterapkan.`);
      setStatus(`Full auto selesai — ${appliedCount} baris diterapkan`);
    }
  } finally {
    isFullAutoRunning = false;
    activeRequestId = null;
    showCancelButton(false);
    updateButtonStates();
  }
}

// ─── Glossary helpers ─────────────────────────────────────────────────────────

function buildGlossaryPrompt(): string {
  const sel = state.lines.filter(l => state.selectedLines.has(l.line_num));
  if (!sel.length) return '';
  const out = getSelectedTranslationPlainText().split('\n').filter(Boolean);
  if (!out.length) return '';
  const basePrompt = applyPromptVariables((state.glossaryPrompt || DEFAULT_GLOSSARY_PROMPT).trim());
  const existingHint = buildExistingGlossaryHint(out.join('\n'));
  return `${basePrompt}${existingHint}\n\n${out.join('\n')}\n`;
}

function applyGlossaryResult(text: string): void {
  const area = ui.pasteGlossaryArea as HTMLTextAreaElement | undefined;
  if (area) {
    area.value = text;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function autoSaveGlossaryResult(text: string): void {
  // Parse dan merge langsung ke Smart Glossary tanpa melewati textarea
  const currentMap = parseGlossaryToMap(state.glossaryText);
  const newMap = parseGlossaryToMap(text);
  for (const [k, v] of newMap.entries()) currentMap.set(k, v);
  state.glossaryText = serializeGlossaryMap(currentMap);
  renderGlossaryPreview();
  queueAutoSave();
  flashHint(`Auto Glossary: ${newMap.size} entri disimpan ke Smart Glossary.`);
  setGlossaryStatus(`Selesai: ${newMap.size} entri disimpan.`);
}

async function runGlossaryFullAuto(): Promise<void> {
  if (!available) {
    const ok = await pingExtension();
    if (!ok) { flashHint('Extension belum terpasang.'); return; }
  }
  await applyLocalSettingsToExtension();

  const batchSize = Math.max(1, state.glossaryBatchSize || 50);
  const allLines = state.lines.filter(l =>
    state.selectedLines.size > 0
      ? state.selectedLines.has(l.line_num)
      : isTranslated(l) && !l._hidden
  );
  if (!allLines.length) { flashHint('Tidak ada baris untuk ekstrak glossary.'); return; }

  isGlossaryAutoRunning = true;
  let processed = 0;
  let retryCount = 0;
  try {
    while (isGlossaryAutoRunning && processed < allLines.length) {
      const batch = allLines.slice(processed, processed + batchSize);
      // Atur selection ke batch ini
      state.selectedLines.clear();
      for (const l of batch) state.selectedLines.add(l.line_num);
      syncCheckboxUI();

      const payload = buildGlossaryPrompt();
      if (!payload) break;

      const reqId = rid();
      activeRequestId = reqId;
      setGlossaryStatus(`Mengirim batch ${Math.floor(processed / batchSize) + 1}${retryCount ? ' (retry new chat)' : ''}…`);
      showGlossaryCancelButton(true);

      const res = await request({
        type: 'COPAS_SEND', requestId: reqId, target: lastSettings.target,
        mode: 'full', payload,
      }, 240000);

      await restoreExtensionNewTabSetting();
      if (!isGlossaryAutoRunning) break;
      if (res.type !== 'COPAS_RESULT' || !res.ok || !res.text) {
        if (retryCount < 1) {
          retryCount++;
          const detail = res.error || (res.type === 'TIMEOUT' ? 'timeout' : 'gagal');
          setGlossaryStatus(`Mengulang batch di obrolan baru (${detail})…`);
          await triggerExtensionNewChat();
          continue;
        }
        const detail = res.error || (res.type === 'TIMEOUT' ? 'timeout' : 'gagal');
        setGlossaryStatus(`Berhenti: ${detail}`);
        flashHint(`Auto Glossary berhenti: ${detail}`);
        return;
      }

      autoSaveGlossaryResult(res.text);
      processed += batch.length;
      retryCount = 0;
    }
    if (isGlossaryAutoRunning) {
      flashHint(`Auto Glossary selesai: ${processed} baris diproses.`);
      setGlossaryStatus(`Selesai — ${processed} baris diproses.`);
    }
  } finally {
    isGlossaryAutoRunning = false;
    activeRequestId = null;
    showGlossaryCancelButton(false);
  }
}

export async function sendGlossaryAutoCopas(): Promise<void> {
  const mode = lastSettings.mode;
  if (mode === 'full') {
    if (isGlossaryAutoRunning) return;
    await runGlossaryFullAuto();
    return;
  }
  const payload = buildGlossaryPrompt();
  if (!payload) { flashHint('Pilih baris dengan terjemahan dulu.'); return; }
  if (!available && !(await pingExtension())) {
    flashHint('Extension belum terpasang.');
    return;
  }
  await applyLocalSettingsToExtension();
  const reqId = rid();
  activeRequestId = reqId;
  setGlossaryStatus(`Mengirim ke ${lastSettings.target}…`);
  const res = await request({
    type: 'COPAS_SEND', requestId: reqId, target: lastSettings.target,
    mode: 'semi', payload,
  }, 240000);
  activeRequestId = null;
  if (res.type === 'COPAS_STATUS') {
    setGlossaryStatus(res.detail || `Status: ${res.stage}`);
  } else if (res.error) {
    setGlossaryStatus(`Error: ${res.error}`);
  }
}

export async function fetchGlossaryResult(): Promise<void> {
  if (!available && !(await pingExtension())) { flashHint('Extension belum terpasang.'); return; }
  await applyLocalSettingsToExtension();
  setGlossaryStatus('Mengambil hasil…');
  const res = await request({ type: 'COPAS_FETCH_RESULT', requestId: rid(), target: lastSettings.target }, 30000);
  if (res.type === 'COPAS_RESULT' && res.ok && res.text) {
    applyGlossaryResult(res.text);
    setGlossaryStatus(`Hasil diterima (${res.text.length} char). Klik Simpan ke Smart Glossary.`);
    updateButtonStates();
    return;
  }
  const err = res.error || 'gagal';
  setGlossaryStatus(`Gagal: ${err}`);
  flashHint(`Ambil glossary gagal: ${err}`);
}

export function cancelGlossaryAutoCopas(): void {
  isGlossaryAutoRunning = false;
  if (activeRequestId) {
    void request({ type: 'COPAS_CANCEL', requestId: activeRequestId }, 3000);
    activeRequestId = null;
  }
  showGlossaryCancelButton(false);
  setGlossaryStatus('Dibatalkan.');
  flashHint('Auto Glossary dibatalkan.');
}

// ─── AI Check helpers ─────────────────────────────────────────────────────────

function buildAiCheckPrompt(): string {
  const sel = getSelectedTranslatedLines();
  if (!sel.length) return '';
  const baseCheck = applyPromptVariables((state.aiCheckPrompt || DEFAULT_AI_CHECK_PROMPT).trim());
  return `${baseCheck}\n\n${sel.map(getLineForAiCheck).join('\n\n')}\n`;
}

function applyAiCheckResult(text: string): void {
  const area = ui.pasteAiCheckArea as HTMLTextAreaElement | undefined;
  if (area) {
    area.value = text;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
  updateButtonStates();
}

async function runAiCheckFullAuto(): Promise<void> {
  if (!available) {
    const ok = await pingExtension();
    if (!ok) { flashHint('Extension belum terpasang.'); return; }
  }
  await applyLocalSettingsToExtension();
  const reviewMode = (ui.settingsAiCheckReviewMode as HTMLInputElement | undefined)?.checked ?? false;

  const batchSize = Math.max(1, state.aiCheckBatchSize || 50);
  const allLines = state.lines.filter(l =>
    state.selectedLines.size > 0
      ? state.selectedLines.has(l.line_num) && isTranslated(l)
      : isTranslated(l) && !l._hidden && !l._ai_checked
  );
  if (!allLines.length) { flashHint('Tidak ada baris terjemahan untuk dicek.'); return; }

  isAiCheckAutoRunning = true;
  let processed = 0;
  let totalApplied = 0;
  let retryCount = 0;
  try {
    while (isAiCheckAutoRunning && processed < allLines.length) {
      const batch = allLines.slice(processed, processed + batchSize);
      state.selectedLines.clear();
      for (const l of batch) state.selectedLines.add(l.line_num);
      syncCheckboxUI();

      const payload = buildAiCheckPrompt();
      if (!payload) break;

      const reqId = rid();
      activeRequestId = reqId;
      setAiCheckExtStatus(`Mengirim batch ${Math.floor(processed / batchSize) + 1}${retryCount ? ' (retry new chat)' : ''}…`);
      setAiCheckStatus(`Auto Cek batch ${Math.floor(processed / batchSize) + 1}${retryCount ? ' (retry new chat)' : ''}…`);
      showAiCheckCancelButton(true);

      const res = await request({
        type: 'COPAS_SEND', requestId: reqId, target: lastSettings.target,
        mode: 'full', payload,
      }, 240000);

      await restoreExtensionNewTabSetting();
      if (!isAiCheckAutoRunning) break;
      if (res.type !== 'COPAS_RESULT' || !res.ok || !res.text) {
        if (retryCount < 1) {
          retryCount++;
          const detail = res.error || (res.type === 'TIMEOUT' ? 'timeout' : 'gagal');
          setAiCheckExtStatus(`Mengulang batch di obrolan baru (${detail})…`);
          setAiCheckStatus(`Mengulang di obrolan baru…`);
          await triggerExtensionNewChat();
          continue;
        }
        const detail = res.error || (res.type === 'TIMEOUT' ? 'timeout' : 'gagal');
        setAiCheckExtStatus(`Berhenti: ${detail}`);
        setAiCheckStatus(`Auto Cek berhenti: ${detail}`);
        flashHint(`Auto AI Check berhenti: ${detail}`);
        return;
      }

      // Paste hasil ke textarea
      applyAiCheckResult(res.text);

      // Parse koreksi
      try {
        const parsed = parseAiCheckBlocks(res.text);
        const selectedSet = new Set(batch.map(l => l.line_num));
        state.aiCheckCorrections = parsed
          .filter(p => selectedSet.has(p.num))
          .map(p => ({ ...p, category: p.category || 'Naturalness', checked: true }));
        renderAiCheckCorrections();
        retryCount = 0;
      } catch {
        if (retryCount < 1) {
          retryCount++;
          setAiCheckExtStatus('Parse gagal — mengulang batch di obrolan baru (New Chat)…');
          setAiCheckStatus('Parse gagal — mencoba ulang di obrolan baru…');
          await triggerExtensionNewChat();
          continue;
        }
        setAiCheckExtStatus('Parse gagal setelah retry — periksa kotak AI Check.');
        break;
      }

      if (reviewMode) {
        // Pause untuk review — tampilkan tombol Review Actions
        const reviewActions = ui.aiCheckReviewActions as HTMLElement | undefined;
        if (reviewActions) reviewActions.style.display = 'flex';
        setAiCheckExtStatus('Paused — review koreksi lalu Apply & Lanjut atau Skip.');
        // Tunggu resolusi dari tombol Apply/Skip
        await new Promise<void>(resolve => {
          const onResolve = () => {
            const reviewActions = ui.aiCheckReviewActions as HTMLElement | undefined;
            if (reviewActions) reviewActions.style.display = 'none';
            resolve();
          };
          // Gunakan event one-shot
          const applyBtn = ui.btnReviewApply as HTMLElement | undefined;
          const skipBtn = ui.btnReviewSkip as HTMLElement | undefined;
          const onApply = () => { onApplyAiCheckCorrections(); onResolve(); skipBtn?.removeEventListener('click', onSkip); };
          const onSkip = () => { onResolve(); applyBtn?.removeEventListener('click', onApply); };
          applyBtn?.addEventListener('click', onApply, { once: true });
          skipBtn?.addEventListener('click', onSkip, { once: true });
          // Fallback: jika auto dibatalkan
          const check = setInterval(() => { if (!isAiCheckAutoRunning) { clearInterval(check); onResolve(); } }, 500);
        });
        if (!isAiCheckAutoRunning) break;
      } else {
        // Auto apply langsung
        const result = onApplyAiCheckCorrections();
        totalApplied += result.applied;
      }

      // Tandai batch sebagai sudah dicek
      for (const l of batch) l._ai_checked = true;
      processed += batch.length;
    }
    if (isAiCheckAutoRunning) {
      const msg = reviewMode
        ? `Auto AI Check selesai: ${processed} baris diproses.`
        : `Auto AI Check selesai: ${processed} baris diproses, ${totalApplied} koreksi diterapkan.`;
      flashHint(msg);
      setAiCheckExtStatus(`Selesai.`);
      setAiCheckStatus(msg);
    }
  } finally {
    isAiCheckAutoRunning = false;
    activeRequestId = null;
    showAiCheckCancelButton(false);
    updateButtonStates();
  }
}

export async function sendAiCheckAutoCopas(): Promise<void> {
  const mode = lastSettings.mode;
  if (mode === 'full') {
    if (isAiCheckAutoRunning) return;
    await runAiCheckFullAuto();
    return;
  }
  const payload = buildAiCheckPrompt();
  if (!payload) { flashHint('Pilih baris terjemahan dulu.'); return; }
  if (!available && !(await pingExtension())) {
    flashHint('Extension belum terpasang.');
    return;
  }
  await applyLocalSettingsToExtension();
  const reqId = rid();
  activeRequestId = reqId;
  setAiCheckExtStatus(`Mengirim ke ${lastSettings.target}…`);
  const res = await request({
    type: 'COPAS_SEND', requestId: reqId, target: lastSettings.target,
    mode: 'semi', payload,
  }, 240000);
  activeRequestId = null;
  if (res.type === 'COPAS_STATUS') {
    setAiCheckExtStatus(res.detail || `Status: ${res.stage}`);
  } else if (res.error) {
    setAiCheckExtStatus(`Error: ${res.error}`);
  }
}

export async function fetchAiCheckResult(): Promise<void> {
  if (!available && !(await pingExtension())) { flashHint('Extension belum terpasang.'); return; }
  await applyLocalSettingsToExtension();
  setAiCheckExtStatus('Mengambil hasil…');
  const res = await request({ type: 'COPAS_FETCH_RESULT', requestId: rid(), target: lastSettings.target }, 30000);
  if (res.type === 'COPAS_RESULT' && res.ok && res.text) {
    applyAiCheckResult(res.text);
    setAiCheckExtStatus(`Hasil diterima. Klik Parse lalu Apply.`);
    updateButtonStates();
    return;
  }
  const err = res.error || 'gagal';
  setAiCheckExtStatus(`Gagal: ${err}`);
  flashHint(`Ambil AI Check gagal: ${err}`);
}

export function cancelAiCheckAutoCopas(): void {
  isAiCheckAutoRunning = false;
  if (activeRequestId) {
    void request({ type: 'COPAS_CANCEL', requestId: activeRequestId }, 3000);
    activeRequestId = null;
  }
  showAiCheckCancelButton(false);
  setAiCheckExtStatus('Dibatalkan.');
  flashHint('Auto AI Check dibatalkan.');
}

export async function sendAutoCopas(): Promise<void> {
  const requestedMode = lastSettings.mode;
  if (requestedMode === 'full') {
    if (isFullAutoRunning) return;
    await runFullAutoBatches();
    return;
  }

  const payload = buildCopyForAiPrompt();
  if (!payload) {
    flashHint('Pilih baris yang belum diterjemahkan dulu.');
    return;
  }
  if (!available && !(await pingExtension())) {
    flashHint('Extension CSTL Auto Copas belum terpasang. Load unpacked dari folder cstl-extension/dist.');
    return;
  }
  await applyLocalSettingsToExtension();
  const n = countSelectedUntranslated();
  const reqId = rid();
  activeRequestId = reqId;
  setStatus(`Mengirim ${n} baris ke ${lastSettings.target}…`);
  flashHint(`Auto Copas → ${lastSettings.target} (semi)…`);
  const res = await request({
    type: 'COPAS_SEND', requestId: reqId, target: lastSettings.target,
    mode: 'semi', payload, meta: { lineCount: n },
  }, 240000);
  activeRequestId = null;
  if (res.type === 'COPAS_STATUS') {
    flashHint(res.detail || `Status: ${res.stage}`);
    setStatus(`Auto Copas: ${res.stage}${res.detail ? ' — ' + res.detail : ''}`);
  } else if (res.error) {
    flashHint(`Auto Copas: ${res.error}`);
  }
}

export async function cancelAutoCopas(): Promise<void> {
  if (!activeRequestId && !isFullAutoRunning) return;
  isFullAutoRunning = false;
  if (!activeRequestId) {
    showCancelButton(false);
    flashHint('Auto Copas dibatalkan.');
    setStatus('Dibatalkan');
    return;
  }
  const reqId = activeRequestId;
  setStatus('Membatalkan…');
  await request({
    type: 'COPAS_CANCEL',
    requestId: reqId,
  }, 3000);
  showCancelButton(false);
  activeRequestId = null;
  flashHint('Auto Copas dibatalkan.');
  setStatus('Dibatalkan');
}

export async function requestFetchResult(): Promise<void> {
  if (!available) {
    const ok = await pingExtension();
    if (!ok) {
      flashHint('Extension belum terpasang.');
      return;
    }
  }
  await applyLocalSettingsToExtension();
  setStatus('Mengambil hasil dari tab LLM…');
  const res = await request({
    type: 'COPAS_FETCH_RESULT',
    requestId: rid(),
    target: lastSettings.target,
  }, 30000);

  if (res.type === 'COPAS_RESULT' && res.ok && res.text) {
    applyReceivedResult(res.text);
    flashHint(`Hasil diambil (${res.text.length} karakter). Cek lalu Terapkan.`);
    setStatus(`Hasil OK (${res.text.length} char) — siap Terapkan`);
    updateButtonStates();
    return;
  }
  const err = res.error || (res.type === 'TIMEOUT' ? 'timeout' : 'gagal ambil hasil');
  flashHint(`Ambil hasil gagal: ${err}`);
  setStatus(`Gagal: ${err}`);
}

export function initExtensionBridge(): void {
  window.addEventListener('message', onWindowMessage);
  window.setTimeout(() => { void pingExtension(); }, 400);
  window.setTimeout(() => { if (!available) void pingExtension(); }, 1500);

  // Translate Auto Copas
  ui.btnAutoCopas?.addEventListener('click', () => { void sendAutoCopas(); });
  ui.btnFetchCopasResult?.addEventListener('click', () => { void requestFetchResult(); });
  ui.btnAutoCopasCancel?.addEventListener('click', () => { void cancelAutoCopas(); });

  // Glossary Auto Copas
  ui.btnAutoCopasGlossary?.addEventListener('click', () => { void sendGlossaryAutoCopas(); });
  ui.btnFetchCopasGlossaryResult?.addEventListener('click', () => { void fetchGlossaryResult(); });
  ui.btnAutoCopasGlossaryCancel?.addEventListener('click', () => { cancelGlossaryAutoCopas(); });

  // AI Check Auto Copas
  ui.btnAutoCopasAiCheck?.addEventListener('click', () => { void sendAiCheckAutoCopas(); });
  ui.btnFetchCopasAiCheckResult?.addEventListener('click', () => { void fetchAiCheckResult(); });
  ui.btnAutoCopasAiCheckCancel?.addEventListener('click', () => { cancelAiCheckAutoCopas(); });
}
