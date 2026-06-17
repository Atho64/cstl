// @module auto-translate.ts — API Integration for Automated AI Translation

import { state, ui, isTranslated } from './state';
import { buildSelectedTranslationExport, applyPromptVariables } from './ai-format';
import { getGlossaryPrompt } from './glossary';
import { DEFAULT_PROMPT_HEADER, DEFAULT_GLOSSARY_PROMPT, DEFAULT_AI_CHECK_PROMPT } from './constants';
import { flashHint } from './render';
import { openModal, closeModal } from './project';
import * as Translate from './translate';
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
    }
  } catch (e) {
    console.error('Failed to load API settings', e);
  }
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
  };
  localStorage.setItem(API_STORAGE_KEY, JSON.stringify(d));
}

export function onOpenApiSettings(): void {
  if (ui.apiTypeSelect) (ui.apiTypeSelect as HTMLSelectElement).value = state.aiApiType || 'openai';
  if (ui.apiUrlInput) (ui.apiUrlInput as HTMLInputElement).value = state.aiApiUrl || '';
  if (ui.apiKeyInput) (ui.apiKeyInput as HTMLInputElement).value = state.aiApiKey || '';
  if (ui.apiModelInput) (ui.apiModelInput as HTMLInputElement).value = state.aiModel || 'gpt-4o-mini';
  if (ui.apiTemperatureInput) (ui.apiTemperatureInput as HTMLInputElement).value = String(state.aiTemperature ?? 1.0);
  if (ui.apiTopPInput) (ui.apiTopPInput as HTMLInputElement).value = String(state.aiTopP ?? 1.0);
  if (ui.apiRpmInput) (ui.apiRpmInput as HTMLInputElement).value = String(state.aiRpm ?? 10);
  updateDelayPreview();
  if (ui.apiSettingsModal) openModal(ui.apiSettingsModal as HTMLElement);
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
  if (ui.apiModelInput) state.aiModel = (ui.apiModelInput as HTMLInputElement).value.trim();
  if (ui.apiTemperatureInput) state.aiTemperature = parseFloat((ui.apiTemperatureInput as HTMLInputElement).value) || 1.0;
  if (ui.apiTopPInput) state.aiTopP = parseFloat((ui.apiTopPInput as HTMLInputElement).value) || 1.0;
  if (ui.apiRpmInput) state.aiRpm = parseInt((ui.apiRpmInput as HTMLInputElement).value) || 10;
  saveApiSettings();
  if (ui.apiSettingsModal) closeModal(ui.apiSettingsModal as HTMLElement);
  flashHint('Pengaturan API disimpan.');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let isAutoTranslating = false;

export async function onAutoTranslate(): Promise<void> {
  const btn = ui.btnAutoTranslate as HTMLButtonElement;

  if (isAutoTranslating) {
    isAutoTranslating = false;
    btn.textContent = 'Menghentikan...';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    return;
  }

  if (!state.aiApiKey) {
    alert('API Key belum diisi! Klik tombol 🤖 di pojok kanan bawah untuk mengatur.');
    onOpenApiSettings();
    return;
  }

  isAutoTranslating = true;
  btn.classList.remove('btn-success');
  btn.classList.add('btn-danger');
  btn.textContent = 'Hentikan Auto Translate';

  try {
    while (isAutoTranslating) {
      // Find untranslated lines from top
      const untranslatedLines = state.lines.filter(l => !isTranslated(l) && !l._hidden);
      if (untranslatedLines.length === 0) {
        alert('Selesai! Semua baris telah diterjemahkan.');
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
      sections.push(joinedText.trim());
      const prompt = sections.join('\n\n');

      let rawResult = await fetchWithRetry(prompt, (attempt) => {
        btn.textContent = `Gagal! Mencoba ulang (${attempt}/3)... (Klik Stop)`;
      });

      if (!rawResult || !rawResult.trim()) {
        throw new Error('Respons dari API kosong.');
      }

      (ui.pasteArea as HTMLTextAreaElement).value = rawResult;
      Translate.onApplyTranslation(); 

      if (isAutoTranslating && state.aiRpm > 0) {
        const waitMs = Math.round(60000 / state.aiRpm);
        btn.textContent = `Menunggu delay (${Math.round(waitMs/1000)}s)... (Klik untuk Stop)`;
        await delay(waitMs);
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

async function fetchOpenAI(prompt: string): Promise<string> {
  let url = state.aiApiUrl || 'https://api.openai.com/v1/chat/completions';
  if (!url.includes('/chat/completions')) {
    if (!url.endsWith('/')) url += '/';
    url += 'chat/completions';
  }

  const temp = state.aiTemperature;
  const body: any = {
    model: state.aiModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: temp,
    top_p: state.aiTopP,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.aiApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function fetchGemini(prompt: string): Promise<string> {
  const model = state.aiModel || 'gemini-1.5-flash';
  let url = state.aiApiUrl;
  if (!url) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.aiApiKey}`;
  } else if (!url.includes('?key=')) {
    url += `?key=${state.aiApiKey}`;
  }

  const temp = state.aiTemperature;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temp,
      topP: state.aiTopP,
    }
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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
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
    alert('API Key belum diisi! Klik tombol 🤖 di pojok kanan bawah untuk mengatur.');
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
      
      // Select them in UI to follow along
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

      let rawResult = await fetchWithRetry(prompt, (attempt) => {
        btn.textContent = `Gagal! Mencoba ulang (${attempt}/3)... (Klik Stop)`;
      });

      if (!rawResult || !rawResult.trim()) {
        throw new Error('Respons dari API kosong.');
      }

      (ui.pasteGlossaryArea as HTMLTextAreaElement).value = rawResult;
      onSaveGlossary(); 
      
      for (const l of batchLines) l._glossary_extracted = true;

      if (isAutoGlossary && state.aiRpm > 0) {
        const waitMs = Math.round(60000 / state.aiRpm);
        btn.textContent = `Menunggu delay (${Math.round(waitMs/1000)}s)... (Klik untuk Stop)`;
        await delay(waitMs);
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
    alert('API Key belum diisi! Klik tombol 🤖 di pojok kanan bawah untuk mengatur.');
    onOpenApiSettings();
    return;
  }

  const targetLines = state.lines.filter(l => isTranslated(l) && !l._ai_checked && !l._hidden);
  if (targetLines.length === 0) {
    alert('Selesai! Semua baris terjemahan telah di-cek AI.');
    return;
  }

  isAutoAiCheck = true;
  btn.classList.remove('btn-success');
  btn.classList.add('btn-danger');

  try {
    while (isAutoAiCheck) {
      const uncheckedLines = state.lines.filter(l => isTranslated(l) && !l._ai_checked && !l._hidden);
      if (uncheckedLines.length === 0) {
        alert('Selesai! Semua baris terjemahan telah di-cek AI.');
        break;
      }

      const batchSize = state.aiCheckBatchSize || 100;
      const batchLines = uncheckedLines.slice(0, batchSize);
      
      // Select them in UI to follow along
      state.selectedLines.clear();
      for (const l of batchLines) {
        state.selectedLines.add(l.line_num);
      }
      import('./render').then(m => m.syncCheckboxUI());
      import('./selection').then(m => m.scrollPreviewToLine(batchLines[0].line_num));

      btn.textContent = `Cek Batch (${batchLines.length} baris)... (Klik Stop)`;
      
      const out = batchLines.map(l => {
        let namePart = '';
        if (l.name) namePart = l.trans_name ? `${l.trans_name}: ` : `${l.name}: `;
        return `#${l.line_num}\n[Original] ${namePart}${l.message}\n[Translated] ${namePart}${l.trans_message || ''}`;
      });
      
      const { applyPromptVariables } = await import('./ai-format');
      const basePrompt = applyPromptVariables((state.aiCheckPrompt || DEFAULT_AI_CHECK_PROMPT).trim());
      const prompt = `${basePrompt}\n\n${out.join('\n\n')}\n`;

      let rawResult = await fetchWithRetry(prompt, (attempt) => {
        btn.textContent = `Gagal! Mencoba ulang (${attempt}/3)... (Klik Stop)`;
      });

      if (!rawResult || !rawResult.trim()) {
        throw new Error('Respons dari API kosong.');
      }

      (ui.pasteAiCheckArea as HTMLTextAreaElement).value = rawResult;
      
      // Auto parse and apply
      const { onParseAiCheck } = await import('./ai-check');
      onParseAiCheck();
      onApplyAiCheckCorrections();

      for (const l of batchLines) l._ai_checked = true;

      if (isAutoAiCheck && state.aiRpm > 0) {
        const waitMs = Math.round(60000 / state.aiRpm);
        btn.textContent = `Menunggu delay (${Math.round(waitMs/1000)}s)... (Klik untuk Stop)`;
        await delay(waitMs);
      }
    }
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

async function fetchWithRetry(prompt: string, onRetry: (attempt: number) => void): Promise<string> {
  let attempt = 0;
  const maxRetries = 3;
  while (attempt < maxRetries) {
    try {
      if (state.aiApiType === 'gemini') {
        return await fetchGemini(prompt);
      } else {
        return await fetchOpenAI(prompt);
      }
    } catch (err: any) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      onRetry(attempt);
      await delay(3000);
    }
  }
  return '';
}
