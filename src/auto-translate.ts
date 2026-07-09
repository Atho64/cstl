// @module auto-translate.ts — API Integration for Automated AI Translation

import { state, ui, isTranslated } from './state';
import { buildSelectedTranslationExport, applyPromptVariables } from './ai-format';
import { getGlossaryPrompt } from './glossary';
import { DEFAULT_PROMPT_HEADER, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT } from './constants';
import { flashHint } from './render';
import { openModal, closeModal } from './project';
import * as Translate from './translate';
import { TranslationApplyError } from './translate';
import { onSaveGlossary } from './glossary';
import { onApplyAiCheckCorrections } from './ai-check';

const API_STORAGE_KEY = 'cstl_api_settings';

export function loadApiSettings(): void {
  try {
    const saved = localStorage.getItem(API_STORAGE_KEY);
    if (saved) {
      const p = JSON.parse(saved);
      if (p.aiApiType) state.aiApiType = p.aiApiType;
      if (p.aiApiUrl) state.aiApiUrl = p.aiApiUrl;
      if (p.aiApiKey) state.aiApiKey = p.aiApiKey;
      if (p.aiModel) state.aiModel = p.aiModel;
      if (p.aiTemperature !== undefined) state.aiTemperature = Number(p.aiTemperature);
      if (p.aiTopP !== undefined) state.aiTopP = Number(p.aiTopP);
      if (p.aiRpm !== undefined) state.aiRpm = Number(p.aiRpm);
      if (p.aiThinkingMode) state.aiThinkingMode = p.aiThinkingMode;
      if (p.aiFilterThinkingOutput !== undefined) state.aiFilterThinkingOutput = !!p.aiFilterThinkingOutput;
      if (p.aiBackupKeys !== undefined) state.aiBackupKeys = p.aiBackupKeys;
      if (p.aiKeyStrategy) state.aiKeyStrategy = p.aiKeyStrategy;
      if (p.aiTranslateMode) state.aiTranslateMode = p.aiTranslateMode;
    }
  } catch (e) {
    console.error('Failed to load API settings', e);
  }
  const modeSelect = document.getElementById('aiTranslateModeSelect') as HTMLSelectElement;
  if (modeSelect) modeSelect.value = state.aiTranslateMode || 'auto';
}

export function saveApiSettings(): void {
  const d = {
    aiApiType: state.aiApiType,
    aiApiUrl: state.aiApiUrl,
    aiApiKey: state.aiApiKey,
    aiModel: state.aiModel,
    aiTemperature: state.aiTemperature,
    aiTopP: state.aiTopP,
    aiRpm: state.aiRpm,
    aiThinkingMode: state.aiThinkingMode,
    aiFilterThinkingOutput: state.aiFilterThinkingOutput,
    aiBackupKeys: state.aiBackupKeys,
    aiKeyStrategy: state.aiKeyStrategy, aiTranslateMode: state.aiTranslateMode,
  };
  localStorage.setItem(API_STORAGE_KEY, JSON.stringify(d));
}

export function onOpenApiSettings(): void {
  if (ui.apiTypeSelect) (ui.apiTypeSelect as HTMLSelectElement).value = state.aiApiType || 'openai';
  if (ui.apiUrlInput) (ui.apiUrlInput as HTMLInputElement).value = state.aiApiUrl || '';
  if (ui.apiKeyInput) (ui.apiKeyInput as HTMLInputElement).value = state.aiApiKey || '';
  if (ui.apiModelInput) (ui.apiModelInput as HTMLInputElement).value = state.aiModel || 'gpt-4o-mini';
  if (ui.apiModelSelect) (ui.apiModelSelect as HTMLSelectElement).style.display = 'none';
  if (ui.apiModelInput) (ui.apiModelInput as HTMLInputElement).style.display = '';
  if (ui.apiModelFetchStatus) (ui.apiModelFetchStatus as HTMLElement).style.display = 'none';
  if (ui.apiTemperatureInput) (ui.apiTemperatureInput as HTMLInputElement).value = String(state.aiTemperature ?? 1.0);
  if (ui.apiTopPInput) (ui.apiTopPInput as HTMLInputElement).value = String(state.aiTopP ?? 1.0);
  if (ui.apiRpmInput) (ui.apiRpmInput as HTMLInputElement).value = String(state.aiRpm ?? 10);
  if (ui.apiThinkingSelect) (ui.apiThinkingSelect as HTMLSelectElement).value = state.aiThinkingMode || 'default';
  if (ui.apiFilterThinkingCheck) (ui.apiFilterThinkingCheck as HTMLInputElement).checked = state.aiFilterThinkingOutput !== false;
  if (ui.apiBackupKeysInput) (ui.apiBackupKeysInput as HTMLTextAreaElement).value = state.aiBackupKeys || '';
  if (ui.apiKeyStrategySelect) (ui.apiKeyStrategySelect as HTMLSelectElement).value = state.aiKeyStrategy || 'fallback';
  if (ui.aiTranslateModeSelect) (ui.aiTranslateModeSelect as HTMLSelectElement).value = state.aiTranslateMode || 'auto';
  updateDelayPreview();
  if (ui.apiSettingsModal) openModal(ui.apiSettingsModal as HTMLElement);
}

// ─── Model Fetcher ────────────────────────────────────────────────────────────

export async function onFetchModels(): Promise<void> {
  const apiType = (ui.apiTypeSelect as HTMLSelectElement)?.value || state.aiApiType || 'openai';
  const apiKey = (ui.apiKeyInput as HTMLInputElement)?.value?.trim() || state.aiApiKey;
  const apiUrl = (ui.apiUrlInput as HTMLInputElement)?.value?.trim() || state.aiApiUrl;
  const btn = ui.btnFetchModels as HTMLButtonElement;
  const select = ui.apiModelSelect as HTMLSelectElement;
  const statusEl = ui.apiModelFetchStatus as HTMLElement;
  const modelInput = ui.apiModelInput as HTMLInputElement;

  if (!apiKey) {
    statusEl.style.display = 'block';
    statusEl.textContent = 'API Key belum diisi.';
    return;
  }

  btn.disabled = true;
  statusEl.style.display = 'block';
  statusEl.textContent = 'Mengambil daftar model...';

  try {
    let models: string[] = [];

    if (apiType === 'gemini') {
      const baseUrl = apiUrl || 'https://generativelanguage.googleapis.com/v1beta/models';
      const url = baseUrl + '?key=' + apiKey;
      const res = await fetch(url);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error('Gemini API error ' + res.status + (detail ? ': ' + detail.slice(0, 200) : ''));
      }
      const data = await res.json();
      const rawModels = Array.isArray(data.models) ? data.models : [];
      models = rawModels
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => (m.name?.replace('models/', '') || m.name))
        .filter(Boolean)
        .sort();
    } else {
      let url = apiUrl || 'https://api.openai.com/v1/models';
      url = url.replace(/\/chat\/completions\/?$/, '');
      if (!url.endsWith('/models')) {
        if (!url.endsWith('/')) url += '/';
        url += 'models';
      }
      const res = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + apiKey },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error('API error ' + res.status + (detail ? ': ' + detail.slice(0, 200) : ''));
      }
      const data = await res.json();
      const rawModels = Array.isArray(data.data) ? data.data : [];
      models = rawModels
        .map((m: any) => (m.id || m.name))
        .filter(Boolean)
        .sort();
    }

    if (!models.length) {
      statusEl.textContent = 'Tidak ada model yang ditemukan.';
      select.style.display = 'none';
      modelInput.style.display = '';
      return;
    }

    // Populate the select dropdown
    select.textContent = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- Pilih model --';
    select.appendChild(defaultOpt);
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === (modelInput.value || state.aiModel)) opt.selected = true;
      select.appendChild(opt);
    }

    // Show dropdown, hide text input
    select.style.display = '';
    modelInput.style.display = 'none';

    // Sync selected model back to the text input
    select.onchange = () => {
      modelInput.value = select.value;
    };

    statusEl.textContent = String(models.length) + ' model ditemukan.';
  } catch (err: any) {
    statusEl.textContent = 'Gagal: ' + err.message;
    select.style.display = 'none';
    modelInput.style.display = '';
  } finally {
    btn.disabled = false;
  }
}

export function updateDelayPreview(): void {
  if (!ui.apiRpmInput || !ui.apiDelayPreview) return;
  let rpm = parseInt((ui.apiRpmInput as HTMLInputElement).value) || 10;
  if (rpm < 1) rpm = 1;
  const delay = Math.round(60000 / rpm);
  (ui.apiDelayPreview as HTMLElement).textContent = String(delay);
}

export function onSaveApiSettings(): void {
  if (ui.apiTypeSelect) state.aiApiType = (ui.apiTypeSelect as HTMLSelectElement).value as any;
  if (ui.apiUrlInput) state.aiApiUrl = (ui.apiUrlInput as HTMLInputElement).value.trim();
  if (ui.apiKeyInput) state.aiApiKey = (ui.apiKeyInput as HTMLInputElement).value.trim();
  if (ui.apiModelSelect && ui.apiModelInput) {
    const select = ui.apiModelSelect as HTMLSelectElement;
    const input = ui.apiModelInput as HTMLInputElement;
    if (select.style.display !== 'none' && select.value) {
      input.value = select.value;
    }
  }
  if (ui.apiModelInput) state.aiModel = (ui.apiModelInput as HTMLInputElement).value.trim();
  if (ui.apiTemperatureInput) state.aiTemperature = parseFloat((ui.apiTemperatureInput as HTMLInputElement).value) || 1.0;
  if (ui.apiTopPInput) state.aiTopP = parseFloat((ui.apiTopPInput as HTMLInputElement).value) || 1.0;
  if (ui.apiRpmInput) state.aiRpm = parseInt((ui.apiRpmInput as HTMLInputElement).value) || 10;
  if (ui.apiThinkingSelect) state.aiThinkingMode = (ui.apiThinkingSelect as HTMLSelectElement).value as any;
  if (ui.apiFilterThinkingCheck) state.aiFilterThinkingOutput = (ui.apiFilterThinkingCheck as HTMLInputElement).checked;
  if (ui.apiBackupKeysInput) state.aiBackupKeys = (ui.apiBackupKeysInput as HTMLTextAreaElement).value;
  if (ui.apiKeyStrategySelect) state.aiKeyStrategy = (ui.apiKeyStrategySelect as HTMLSelectElement).value as any;
  if (ui.aiTranslateModeSelect) state.aiTranslateMode = (ui.aiTranslateModeSelect as HTMLSelectElement).value as any;
  saveApiSettings();
  if (ui.apiSettingsModal) closeModal(ui.apiSettingsModal as HTMLElement);
  flashHint('Pengaturan API disimpan.');
}

export function delay(ms: number, shouldCancel?: () => boolean): Promise<void> {
  if (!shouldCancel) return new Promise(resolve => setTimeout(resolve, ms));
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (shouldCancel() || Date.now() - start >= ms) {
        resolve();
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

type RetryState = {
  attempt: number;
  maxRetries: number;
  waitMs: number;
  reason: string;
};

type AutoTranslateAttemptError = Error & {
  retryable?: boolean;
};

function formatRetryLabel(retry: RetryState): string {
  return `Retry API ${retry.attempt}/${retry.maxRetries} (${retry.reason})`;
}

function createRetryableAiFormatError(err: TranslationApplyError): AutoTranslateAttemptError {
  const detail = err.details.length ? ` ${err.details.join(' ')}` : '';
  const retryableError = new Error(`Format respons AI tidak sesuai.${detail}`) as AutoTranslateAttemptError;
  retryableError.retryable = true;
  return retryableError;
}

let isAutoTranslating = false;

export async function onAutoTranslate(): Promise<void> {
  if (state.aiTranslateMode === 'agent') {
    const { onAgentTranslate } = await import('./agent-translate');
    return onAgentTranslate();
  }
  const btn = ui.btnAutoTranslate as HTMLButtonElement;

  if (isAutoTranslating) {
    isAutoTranslating = false;
    btn.textContent = 'Menghentikan...';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    return;
  }

  if (!state.aiApiKey) {
    alert('API Key belum diisi! Klik tombol robot di pojok kanan bawah untuk mengatur.');
    onOpenApiSettings();
    return;
  }

  isAutoTranslating = true;
  btn.classList.remove('btn-success');
  btn.classList.add('btn-danger');
  btn.textContent = 'Hentikan Auto Translate';

  let targetLines = Array.from(state.selectedLines)
    .map(num => state.lines.find(l => l.line_num === num))
    .filter(l => l && !isTranslated(l) && !l._hidden) as typeof state.lines;

  if (targetLines.length === 0) {
    targetLines = state.lines.filter(l => !isTranslated(l) && !l._hidden);
  } else {
    targetLines.sort((a, b) => a.line_num - b.line_num);
  }

  try {
    while (isAutoTranslating) {
      // Find untranslated lines from top
      const untranslatedLines = targetLines.filter(l => !isTranslated(l) && !l._hidden);
      if (untranslatedLines.length === 0) {
        alert('Selesai! Semua baris target telah diterjemahkan.');
        break;
      }

      // Take batch size from settings
      const batchSize = state.selectionBatchSize || 100;
      const batch = untranslatedLines.slice(0, batchSize);

      // Select them in UI
      state.selectedLines.clear();
      for (const l of batch) {
        state.selectedLines.add(l.line_num);
      }
      
      // Update UI selection
      import('./render').then(m => m.syncCheckboxUI());
      import('./selection').then(m => m.scrollPreviewToLine(batch[0].line_num));

      const sel = batch;
      
      const parallelSize = Math.max(1, Math.min(10, state.parallelBatchSize || 1));

      if (parallelSize === 1) {
        // Original sequential mode
        btn.textContent = `Menerjemahkan ${sel.length} baris... (Klik untuk Stop)`;

        let contextBlock = '';
        if (state.contextLines > 0) {
          const firstSelLineNum = sel[0].line_num;
          const firstSelIdx = state.lines.findIndex(l => l.line_num === firstSelLineNum);
          if (firstSelIdx > 0) {
            const startIdx = Math.max(0, firstSelIdx - state.contextLines);
            const ctxLines = state.lines.slice(startIdx, firstSelIdx);
            const ctxOut: string[] = [];
            for (const l of ctxLines) {
              const origNameStr = l.name ? `${l.name}: ` : '';
              const transNameStr = (l.trans_name || l.name) ? `${(l.trans_name || l.name)!.trim()}: ` : '';
              if (state.contextType === 'raw') {
                ctxOut.push(`${origNameStr}${l.message}`);
              } else if (state.contextType === 'both') {
                ctxOut.push(`[Original] ${origNameStr}${l.message}\n[Translated] ${transNameStr}${l.trans_message || ''}`);
              } else {
                ctxOut.push(`${transNameStr}${l.trans_message || l.message}`);
              }
            }
            if (ctxOut.length > 0) {
              contextBlock = `\n\n<Context>\nThese lines are for context only. Do NOT translate them.\n${ctxOut.join('\n')}\n</Context>`;
            }
          }
        }

        const joinedText = buildSelectedTranslationExport(false);
        const glossaryBlock = getGlossaryPrompt(joinedText);
        const baseHeader = applyPromptVariables((state.aiInstructionHeader || DEFAULT_PROMPT_HEADER).trim());
        
        const sections: string[] = [baseHeader];
        if (glossaryBlock) sections.push(glossaryBlock.trim());
        if (contextBlock) sections.push(contextBlock.trim());
        if (state.enableUncertainMarking) {
          sections.push('If you are uncertain about a translation, prefix it with [?].');
        }
        sections.push(joinedText.trim());
        const prompt = sections.join('\n\n');

        let rawResult = await fetchWithRetry(async () => {
          const result = await fetchApiResult(prompt);
          (ui.pasteArea as HTMLTextAreaElement).value = result;
          try {
            Translate.onApplyTranslation({ suppressAlerts: true });
          } catch (err: any) {
            if (err instanceof TranslationApplyError) {
              throw createRetryableAiFormatError(err);
            }
            throw err;
          }
          return result;
        }, (retry) => {
          btn.textContent = `${formatRetryLabel(retry)}... (Klik Stop)`;
        }, () => !isAutoTranslating);

        if (!rawResult || !rawResult.trim()) {
          throw new Error('Respons dari API kosong.');
        }

        if (isAutoTranslating && state.aiRpm > 0) {
          const waitMs = Math.round(60000 / state.aiRpm);
          btn.textContent = `Menunggu delay (${Math.round(waitMs/1000)}s)... (Klik untuk Stop)`;
          await delay(waitMs, () => !isAutoTranslating);
        }
      } else {
        // Parallel mode: split batch into sub-batches and send concurrently
        const subBatchSize = Math.ceil(sel.length / parallelSize);
        const subBatches: typeof sel[] = [];
        for (let i = 0; i < sel.length; i += subBatchSize) {
          subBatches.push(sel.slice(i, i + subBatchSize));
        }

        btn.textContent = `Menerjemahkan ${sel.length} baris (${subBatches.length}x paralel)... (Klik untuk Stop)`;

        const baseHeader = applyPromptVariables((state.aiInstructionHeader || DEFAULT_PROMPT_HEADER).trim());
        const glossaryBlock = getGlossaryPrompt('');

        const buildSubPrompt = (subBatch: typeof sel): string => {
          // Temporarily set selectedLines to just this sub-batch
          state.selectedLines.clear();
          for (const l of subBatch) state.selectedLines.add(l.line_num);
          const subText = buildSelectedTranslationExport(false);

          let contextBlock = '';
          if (state.contextLines > 0) {
            const firstSelLineNum = subBatch[0].line_num;
            const firstSelIdx = state.lines.findIndex(l => l.line_num === firstSelLineNum);
            if (firstSelIdx > 0) {
              const startIdx = Math.max(0, firstSelIdx - state.contextLines);
              const ctxLines = state.lines.slice(startIdx, firstSelIdx);
              const ctxOut: string[] = [];
              for (const l of ctxLines) {
                const origNameStr = l.name ? `${l.name}: ` : '';
                const transNameStr = (l.trans_name || l.name) ? `${(l.trans_name || l.name)!.trim()}: ` : '';
                if (state.contextType === 'raw') {
                  ctxOut.push(`${origNameStr}${l.message}`);
                } else if (state.contextType === 'both') {
                  ctxOut.push(`[Original] ${origNameStr}${l.message}\n[Translated] ${transNameStr}${l.trans_message || ''}`);
                } else {
                  ctxOut.push(`${transNameStr}${l.trans_message || l.message}`);
                }
              }
              if (ctxOut.length > 0) {
                contextBlock = `\n\n<Context>\nThese lines are for context only. Do NOT translate them.\n${ctxOut.join('\n')}\n</Context>`;
              }
            }
          }

          const sections: string[] = [baseHeader];
          if (glossaryBlock) sections.push(glossaryBlock.trim());
          if (contextBlock) sections.push(contextBlock.trim());
          if (state.enableUncertainMarking) {
            sections.push('If you are uncertain about a translation, prefix it with [?].');
          }
          sections.push(subText.trim());
          return sections.join('\n\n');
        };

        // Build all prompts first (while selectedLines is set per sub-batch)
        const subPrompts = subBatches.map(sb => ({ batch: sb, prompt: buildSubPrompt(sb) }));

        // Restore full selection for UI
        state.selectedLines.clear();
        for (const l of sel) state.selectedLines.add(l.line_num);

        // Send all sub-batches concurrently
        // NOTE: selectedLines adalah shared state. Karena sub-batch jalan paralel,
        // kita tidak boleh ubah selectedLines saat apply — onApplyTranslation baca
        // pasteArea (teks hasil) DAN selectedLines (baris target). Solusinya:
        // apply hasil sequential setelah semua fetch selesai, bukan di dalam paralel.
        const fetchResults = await Promise.allSettled(subPrompts.map(async (sp, idx) => {
          if (!isAutoTranslating) throw new Error('Dibatalkan oleh pengguna.');
          const result = await fetchWithRetry(async () => {
            return await fetchApiResult(sp.prompt);
          }, (retry) => {
            btn.textContent = `Paralel ${idx + 1}/${subPrompts.length}: ${formatRetryLabel(retry)}... (Klik Stop)`;
          }, () => !isAutoTranslating);
          return { sp, result };
        }));

        // Apply hasil sequential (tidak paralel) supaya selectedLines tidak race
        for (const r of fetchResults) {
          if (r.status !== 'fulfilled') continue;
          const { sp, result } = r.value;
          if (!isAutoTranslating) break;
          state.selectedLines.clear();
          for (const l of sp.batch) state.selectedLines.add(l.line_num);
          (ui.pasteArea as HTMLTextAreaElement).value = result;
          try {
            Translate.onApplyTranslation({ suppressAlerts: true });
          } catch (err: any) {
            if (err instanceof TranslationApplyError) {
              // skip, lanjut sub-batch berikutnya
              console.warn(`Sub-batch apply gagal: ${err.message}`);
            } else {
              throw err;
            }
          }
        }

        // Restore full selection
        state.selectedLines.clear();
        for (const l of sel) state.selectedLines.add(l.line_num);

        // Check results
        let successCount = 0;
        let lastErr: string = '';
        for (let i = 0; i < fetchResults.length; i++) {
          const r = fetchResults[i];
          if (r.status === 'fulfilled') successCount++;
          else lastErr = String((r as any).reason?.message || r);
        }
        if (successCount === 0) {
          throw new Error(`Semua ${subPrompts.length} request paralel gagal. ${lastErr}`);
        }

        if (isAutoTranslating && state.aiRpm > 0) {
          const waitMs = Math.round(60000 / state.aiRpm);
          btn.textContent = `Menunggu delay (${Math.round(waitMs/1000)}s)... (Klik untuk Stop)`;
          await delay(waitMs, () => !isAutoTranslating);
        }
      }
    }
  } catch (err: any) {
    if (isAutoTranslating) {
      alert('Auto Translate berhenti karena error:\n\n' + err.message);
    }
  } finally {
    isAutoTranslating = false;
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    btn.textContent = 'Jalankan Auto Translate';
  }
}

export interface ApiConfig {
  key: string;
  url: string;
  model: string;
}

export function parseBackupKeys(): ApiConfig[] {
  const configs: ApiConfig[] = [];
  // Primary key is always first
  if (state.aiApiKey) {
    configs.push({ key: state.aiApiKey, url: state.aiApiUrl, model: state.aiModel });
  }
  // Parse backup keys
  const lines = (state.aiBackupKeys || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length === 1) {
      // Just a key — use primary url and model
      configs.push({ key: parts[0], url: state.aiApiUrl, model: state.aiModel });
    } else if (parts.length >= 3) {
      // key|url|model
      configs.push({ key: parts[0], url: parts[1], model: parts[2] });
    } else if (parts.length === 2) {
      // key|url — use primary model
      configs.push({ key: parts[0], url: parts[1], model: state.aiModel });
    }
  }
  return configs;
}

export function shouldTryNextKey(err: any): boolean {
  const msg = String(err?.message || '');
  return msg.includes('HTTP 429') || msg.includes('HTTP 5') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch');
}

export function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function fetchOpenAIWithConfig(prompt: string, config: ApiConfig): Promise<string> {
  let url = config.url || 'https://api.openai.com/v1/chat/completions';
  if (!url.includes('/chat/completions')) {
    if (!url.endsWith('/')) url += '/';
    url += 'chat/completions';
  }

  const temp = state.aiTemperature;
  const body: any = {
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: temp,
    top_p: state.aiTopP,
  };

  const thinkMode = state.aiThinkingMode;
  if (thinkMode !== 'default') {
    const apiUrl = config.url || '';
    if (/localhost|127\.0\.0\.1|11434/.test(apiUrl)) {
      body.think = (thinkMode === 'on');
    } else if (apiUrl.includes('openrouter.ai')) {
      body.reasoning = thinkMode === 'on' ? { effort: 'high' } : { effort: 'none' };
    } else if (/o1|o3|o4/.test(config.model || '')) {
      body.reasoning_effort = thinkMode === 'on' ? 'high' : 'low';
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  return state.aiFilterThinkingOutput ? stripThinkingTags(rawText) : rawText;
}

async function fetchGeminiWithConfig(prompt: string, config: ApiConfig): Promise<string> {
  const model = config.model || 'gemini-1.5-flash';
  let url = config.url;
  if (!url) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.key}`;
  } else if (!url.includes('?key=')) {
    url += `?key=${config.key}`;
  }

  const temp = state.aiTemperature;
  const genConfig: any = {
    temperature: temp,
    topP: state.aiTopP,
  };

  const thinkMode = state.aiThinkingMode;
  if (thinkMode !== 'default') {
    genConfig.thinkingConfig = { thinkingBudget: thinkMode === 'off' ? 0 : -1 };
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  const parts: any[] = data.candidates?.[0]?.content?.parts || [];
  const rawText = parts
    .filter((p: any) => !p.thought)
    .map((p: any) => p.text || '')
    .join('')
    .trim();
  return state.aiFilterThinkingOutput ? stripThinkingTags(rawText) : rawText;
}

export async function fetchApiResult(prompt: string): Promise<string> {
  const configs = parseBackupKeys();
  if (configs.length === 0) {
    throw new Error('Tidak ada API key yang dikonfigurasi.');
  }

  let ordered = configs;
  if (state.aiKeyStrategy === 'random') {
    ordered = shuffleArray(configs);
  }

  let lastError: Error | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const config = ordered[i];
    try {
      if (state.aiApiType === 'gemini') {
        return await fetchGeminiWithConfig(prompt, config);
      }
      return await fetchOpenAIWithConfig(prompt, config);
    } catch (err: any) {
      lastError = err;
      // Only try next key on rate-limit, server, or network errors
      if (i < ordered.length - 1 && shouldTryNextKey(err)) {
        console.warn(`API key ${i + 1} failed (${err.message}), trying next key...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('Semua API key gagal.');
}

// ─── Strip Thinking Tags ──────────────────────────────────────────────────────
export function stripThinkingTags(text: string): string {
  return text
    .replace(/<\|think\|>[\s\S]*?<\/\|think\|>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

let isAutoGlossary = false;
export async function onAutoGlossary(): Promise<void> {
  const btn = ui.btnAutoGlossaryAi as HTMLButtonElement;
  if (isAutoGlossary) {
    isAutoGlossary = false;
    btn.textContent = 'Menghentikan...';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    return;
  }

  if (!state.aiApiKey) {
    alert('API Key belum diisi! Klik tombol robot di pojok kanan bawah untuk mengatur.');
    onOpenApiSettings();
    return;
  }

  const targetLines = state.lines.filter(l => !l._glossary_extracted && !l._hidden);
  if (targetLines.length === 0) {
    alert('Selesai! Semua baris telah diekstrak glossary-nya.');
    return;
  }

  isAutoGlossary = true;
  btn.classList.remove('btn-success');
  btn.classList.add('btn-danger');

  try {
    while (isAutoGlossary) {
      const untranslatedLines = state.lines.filter(l => !l._glossary_extracted && !l._hidden);
      if (untranslatedLines.length === 0) {
        alert('Selesai! Semua baris telah diekstrak glossary-nya.');
        break;
      }

      const batchSize = state.glossaryBatchSize || 100;
      const batchLines = untranslatedLines.slice(0, batchSize);

      state.selectedLines.clear();
      for (const l of batchLines) {
        state.selectedLines.add(l.line_num);
      }
      import('./render').then(m => m.syncCheckboxUI());
      import('./selection').then(m => m.scrollPreviewToLine(batchLines[0].line_num));

      btn.textContent = `Ekstrak Batch (${batchLines.length} baris)... (Klik Stop)`;

      const out = batchLines.map(l => {
        let namePart = '';
        if (l.name) namePart = l.trans_name ? `${l.trans_name}: ` : `${l.name}: `;
        return `${namePart}${l.trans_message || l.message}`;
      }).filter(Boolean);

      const { applyPromptVariables } = await import('./ai-format');
      const basePrompt = applyPromptVariables((state.glossaryPrompt || DEFAULT_GLOSSARY_PROMPT).trim());
      const prompt = `${basePrompt}\n\n${out.join('\n')}\n`;

      let rawResult = await fetchWithRetry(() => fetchApiResult(prompt), (retry) => {
        btn.textContent = `${formatRetryLabel(retry)}... (Klik Stop)`;
      }, () => !isAutoGlossary);

      if (!rawResult || !rawResult.trim()) {
        throw new Error('Respons dari API kosong.');
      }

      (ui.pasteGlossaryArea as HTMLTextAreaElement).value = rawResult;
      onSaveGlossary();

      for (const l of batchLines) l._glossary_extracted = true;

      if (isAutoGlossary && state.aiRpm > 0) {
        const waitMs = Math.round(60000 / state.aiRpm);
        btn.textContent = `Menunggu delay (${Math.round(waitMs/1000)}s)... (Klik untuk Stop)`;
        await delay(waitMs, () => !isAutoGlossary);
      }
    }
  } catch (err: any) {
    if (isAutoGlossary) {
      alert('Auto Ekstrak berhenti karena error:\n\n' + err.message);
    }
  } finally {
    isAutoGlossary = false;
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    btn.textContent = 'Jalankan Auto Ekstrak';
  }
}

let isAutoAiCheck = false;
let autoAiCheckStats = { totalChecked: 0, totalCorrections: 0, totalApplied: 0, byCategory: new Map<string, number>() };
export async function onAutoAiCheck(): Promise<void> {
  const btn = ui.btnAutoAiCheck as HTMLButtonElement;
  if (isAutoAiCheck) {
    isAutoAiCheck = false;
    btn.textContent = 'Menghentikan...';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    return;
  }

  if (!state.aiApiKey) {
    alert('API Key belum diisi! Klik tombol robot di pojok kanan bawah untuk mengatur.');
    onOpenApiSettings();
    return;
  }

  // Skip confirmed lines and QC-flagged lines (if QC results exist)
  const targetLines = state.lines.filter(l => isTranslated(l) && !l._ai_checked && !l._ai_confirmed && !l._hidden);
  if (targetLines.length === 0) {
    alert('Selesai! Semua baris terjemahan telah di-cek AI.');
    return;
  }

  // Check if review mode is enabled
  const reviewMode = (document.getElementById('settingsAiCheckReviewMode') as HTMLInputElement)?.checked ?? false;

  isAutoAiCheck = true;
  btn.classList.remove('btn-success');
  btn.classList.add('btn-danger');
  autoAiCheckStats = { totalChecked: 0, totalCorrections: 0, totalApplied: 0, byCategory: new Map<string, number>() };

  try {
    while (isAutoAiCheck) {
      const uncheckedLines = state.lines.filter(l => isTranslated(l) && !l._ai_checked && !l._ai_confirmed && !l._hidden);
      if (uncheckedLines.length === 0) {
        // Show summary
        const catSummary = Array.from(autoAiCheckStats.byCategory.entries()).map(([k, v]) => `${k}: ${v}`).join(', ');
        alert(`Selesai! AI Check selesai.\n\nTotal dicek: ${autoAiCheckStats.totalChecked}\nKoreksi ditemukan: ${autoAiCheckStats.totalCorrections}\nKoreksi diterapkan: ${autoAiCheckStats.totalApplied}${catSummary ? `\n\nKategori: ${catSummary}` : ''}`);
        break;
      }

      const batchSize = state.aiCheckBatchSize || 100;
      const batchLines = uncheckedLines.slice(0, batchSize);

      state.selectedLines.clear();
      for (const l of batchLines) {
        state.selectedLines.add(l.line_num);
      }
      import('./render').then(m => m.syncCheckboxUI());
      import('./selection').then(m => m.scrollPreviewToLine(batchLines[0].line_num));

      btn.textContent = `Cek Batch (${batchLines.length} baris)... (Klik Stop)`;

      // Build prompt with glossary and context (fix: previously missing glossary)
      const { applyPromptVariables } = await import('./ai-format');
      const { getGlossaryPrompt } = await import('./glossary');
      const { getLineForAiCheck } = await import('./ai-check');
      const basePrompt = applyPromptVariables((state.aiCheckPrompt || DEFAULT_AI_CHECK_PROMPT).trim());
      const out = batchLines.map(l => getLineForAiCheck(l));
      const prompt = `${basePrompt}\n\n${out.join('\n\n')}\n`;

      let rawResult = await fetchWithRetry(() => fetchApiResult(prompt), (retry) => {
        btn.textContent = `${formatRetryLabel(retry)}... (Klik Stop)`;
      }, () => !isAutoAiCheck);

      if (!rawResult || !rawResult.trim()) {
        throw new Error('Respons dari API kosong.');
      }

      (ui.pasteAiCheckArea as HTMLTextAreaElement).value = rawResult;

      const { onParseAiCheck, onApplyAiCheckCorrections, renderAiCheckCorrections } = await import('./ai-check');
      onParseAiCheck();
      autoAiCheckStats.totalCorrections += state.aiCheckCorrections.length;

      if (reviewMode && state.aiCheckCorrections.length > 0) {
        // Pause for review — show corrections, wait for user to apply or skip
        renderAiCheckCorrections();
        btn.textContent = `Review ${state.aiCheckCorrections.length} koreksi... (Klik Stop untuk batalkan)`;
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-success');

        // Wait for user action (apply or skip)
        const reviewResult = await waitForReviewAction();
        if (reviewResult === 'stop') {
          isAutoAiCheck = false;
          break;
        }
        if (reviewResult === 'apply') {
          const { applied, categories } = onApplyAiCheckCorrections();
          autoAiCheckStats.totalApplied += applied;
          for (const [cat, count] of categories) {
            autoAiCheckStats.byCategory.set(cat, (autoAiCheckStats.byCategory.get(cat) || 0) + count);
          }
        }
        btn.classList.remove('btn-success');
        btn.classList.add('btn-danger');
      } else {
        // Auto-apply (original behavior)
        const { applied, categories } = onApplyAiCheckCorrections();
        autoAiCheckStats.totalApplied += applied;
        for (const [cat, count] of categories) {
          autoAiCheckStats.byCategory.set(cat, (autoAiCheckStats.byCategory.get(cat) || 0) + count);
        }
      }

      for (const l of batchLines) l._ai_checked = true;
      autoAiCheckStats.totalChecked += batchLines.length;

      if (isAutoAiCheck && state.aiRpm > 0) {
        const waitMs = Math.round(60000 / state.aiRpm);
        btn.textContent = `Menunggu delay (${Math.round(waitMs/1000)}s)... (Klik untuk Stop)`;
        await delay(waitMs, () => !isAutoAiCheck);
      }
    }
    if (isAutoAiCheck) {
      const catSummary = Array.from(autoAiCheckStats.byCategory.entries()).map(([k, v]) => `${k}: ${v}`).join(', ');
      alert(`AI Check selesai.\n\nTotal dicek: ${autoAiCheckStats.totalChecked}\nKoreksi ditemukan: ${autoAiCheckStats.totalCorrections}\nKoreksi diterapkan: ${autoAiCheckStats.totalApplied}${catSummary ? `\n\nKategori: ${catSummary}` : ''}`);
    }
    isAutoAiCheck = false;
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    btn.textContent = 'Jalankan Auto Cek';
  } catch (err: any) {
    if (isAutoAiCheck) {
      alert('Auto Cek berhenti karena error:\n\n' + err.message);
    }
  } finally {
    isAutoAiCheck = false;
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    btn.textContent = 'Jalankan Auto Cek';
  }
}

// ─── Review mode helpers ───────────────────────────────────────────────────────

let reviewResolve: ((value: string) => void) | null = null;

function waitForReviewAction(): Promise<string> {
  return new Promise((resolve) => {
    reviewResolve = resolve;
    // Auto-resolve after 5 minutes (timeout safety)
    setTimeout(() => {
      if (reviewResolve === resolve) {
        reviewResolve = null;
        resolve('skip');
      }
    }, 300000);
  });
}

export function resolveReviewAction(action: 'apply' | 'skip' | 'stop'): void {
  if (reviewResolve) {
    const r = reviewResolve;
    reviewResolve = null;
    r(action);
  }
}
async function fetchWithRetry(runAttempt: () => Promise<string>, onRetry: (retry: RetryState) => void, shouldCancel?: () => boolean): Promise<string> {
  let attempt = 0;
  const maxRetries = 5;
  while (attempt < maxRetries) {
    if (shouldCancel?.()) throw new Error('Dibatalkan oleh pengguna.');
    try {
      return await runAttempt();
    } catch (err: any) {
      if (err?.retryable) {
        attempt++;
        if (attempt >= maxRetries) {
          throw new Error(`Gagal setelah ${maxRetries} percobaan karena format respons AI terus tidak cocok. ${String(err?.message || err || '')}`.trim());
        }
        onRetry({ attempt, maxRetries, waitMs: 2000, reason: 'format respons AI tidak cocok' });
        await delay(2000, shouldCancel);
        continue;
      }

      throw err;
    }
  }
  return '';
}
