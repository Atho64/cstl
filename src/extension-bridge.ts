// @module extension-bridge.ts — Bridge CSTL page ↔ browser extension (Auto Copas)

import { state, ui, isTranslated } from './state';
import { flashHint, syncCheckboxUI, updateButtonStates } from './render';
import {
  buildCopyForAiPrompt,
  countSelectedUntranslated,
  onApplyTranslation,
  TranslationApplyError,
} from './translate';

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
  settings?: { target?: CopasTargetId; mode?: CopasMode };
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
  if (!show) showCancelButton(false);
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
  if (btnCancel) {
    btnCancel.style.display = show ? '' : 'none';
  }
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
    setStatus(`Extension terhubung v${extensionVersion || '?'} · ${lastSettings.target}/${lastSettings.mode}`);
    updateButtonStates();
    return true;
  }
  available = false;
  (window as any).__cstlExtAvailable = false;
  delete document.documentElement.dataset.cstlExt;
  setAutoCopasVisible(false);
  setStatus('Extension belum terpasang / bridge tidak aktif');
  updateButtonStates();
  return false;
}

function syncSettingsUi(): void {
  const t = ui.autoCopasTarget as HTMLSelectElement | undefined;
  const m = ui.autoCopasMode as HTMLSelectElement | undefined;
  if (t && (lastSettings.target === 'gemini' || lastSettings.target === 'deepseek' || lastSettings.target === 'meta' || lastSettings.target === 'chatgpt')) {
    t.value = lastSettings.target;
  }
  if (m && (lastSettings.mode === 'semi' || lastSettings.mode === 'full')) {
    m.value = lastSettings.mode;
  }
}

export async function applyLocalSettingsToExtension(): Promise<void> {
  const t = (ui.autoCopasTarget as HTMLSelectElement | undefined)?.value as CopasTargetId | undefined;
  const m = (ui.autoCopasMode as HTMLSelectElement | undefined)?.value as CopasMode | undefined;
  if (t === 'gemini' || t === 'deepseek' || t === 'meta' || t === 'chatgpt') lastSettings.target = t;
  if (m === 'semi' || m === 'full') lastSettings.mode = m;
  if (!available) return;
  await request({
    type: 'COPAS_SET_SETTINGS',
    requestId: rid(),
    settings: { target: lastSettings.target, mode: lastSettings.mode },
  }, 2000);
  setStatus(`Extension: ${lastSettings.target} / ${lastSettings.mode}`);
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
  try {
    while (isFullAutoRunning) {
      const n = selectNextFullAutoBatch(scope);
      if (!n) break;

      const payload = buildCopyForAiPrompt();
      if (!payload) break;
      const reqId = rid();
      activeRequestId = reqId;
      setStatus(`Full auto: mengirim ${n} baris ke ${lastSettings.target}…`);
      flashHint(`Full auto → ${lastSettings.target}: batch ${appliedCount + 1}–${appliedCount + n}`);
      showCancelButton(true);

      const res = await request({
        type: 'COPAS_SEND', requestId: reqId, target: lastSettings.target,
        mode: 'full', payload, meta: { lineCount: n },
      }, 240000);

      if (!isFullAutoRunning) break;
      if (res.type !== 'COPAS_RESULT' || !res.ok || !res.text) {
        const detail = res.error || res.detail || (res.type === 'TIMEOUT' ? 'timeout' : 'respons tidak lengkap');
        flashHint(`Full auto berhenti: ${detail}`);
        setStatus(`Full auto berhenti: ${detail}`);
        return;
      }

      applyReceivedResult(res.text);
      try {
        onApplyTranslation({ suppressAlerts: true });
        appliedCount += n;
      } catch (err) {
        const detail = err instanceof TranslationApplyError
          ? `${err.message}${err.details[0] ? ` — ${err.details[0]}` : ''}`
          : 'gagal menerapkan hasil';
        flashHint(`Hasil diterima, tapi tidak diterapkan: ${detail}. Periksa kotak hasil.`);
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

export async function sendAutoCopas(): Promise<void> {
  const requestedMode = (ui.autoCopasMode as HTMLSelectElement | undefined)?.value === 'full'
    ? 'full'
    : lastSettings.mode;
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
  // delayed ping in case content script already injected
  window.setTimeout(() => {
    void pingExtension();
  }, 400);
  window.setTimeout(() => {
    if (!available) void pingExtension();
  }, 1500);

  ui.btnAutoCopas?.addEventListener('click', () => {
    void sendAutoCopas();
  });
  ui.btnFetchCopasResult?.addEventListener('click', () => {
    void requestFetchResult();
  });
  ui.autoCopasTarget?.addEventListener('change', () => {
    void applyLocalSettingsToExtension();
  });
  ui.autoCopasMode?.addEventListener('change', () => {
    void applyLocalSettingsToExtension();
  });
  ui.btnAutoCopasCancel?.addEventListener('click', () => {
    void cancelAutoCopas();
  });
}
