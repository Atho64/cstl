// @module agent-translate.ts — Autonomous multi-turn agent translation mode

import { state, ui, isTranslated } from './state';
import { chatCompletion, ChatMessage } from './ai-agent';
import { applyAgentTranslations } from './translate';
import { getGlossaryPrompt, formatGlossaryEntry } from './glossary';
import { applyPromptVariables } from './ai-format';
import { DEFAULT_AGENT_PROMPT } from './constants';
import { openModal, closeModal } from './project';
import { flashHint } from './render';
import { delay } from './auto-translate';
import type { Line } from './types';

// ─── Agent state ──────────────────────────────────────────────────────────────

let isAgentTranslating = false;
let rollingContext = '';
let fileNotes = new Map<string, string>();
let glossarySuggestions: { source: string; target: string; note: string; type: string }[] = [];

// ─── Read-only tools (return JSON strings) ───────────────────────────────────

function toolReadLines(start: number, count: number): string {
  const lines = state.lines.filter(l => l.line_num >= start && l.line_num < start + count).slice(0, 50);
  return JSON.stringify(lines.map(l => ({
    id: l.line_num, name: l.name, message: l.message,
    trans_name: l.trans_name, trans_message: l.trans_message,
    is_translated: l.is_translated
  })));
}

function toolSearchText(query: string): string {
  const lower = (query || '').toLowerCase();
  const results = state.lines.filter(l =>
    (l.message || '').toLowerCase().includes(lower) ||
    (l.trans_message || '').toLowerCase().includes(lower) ||
    (l.name || '').toLowerCase().includes(lower)
  ).slice(0, 50);
  return JSON.stringify(results.map(l => ({
    id: l.line_num, name: l.name, message: l.message, trans_message: l.trans_message
  })));
}

function toolGetContext(line_num: number, radius: number): string {
  const r = Math.min(Math.max(radius || 3, 1), 20);
  const results = state.lines.filter(l => l.line_num >= line_num - r && l.line_num <= line_num + r);
  return JSON.stringify(results.map(l => ({
    id: l.line_num, name: l.name, message: l.message, trans_message: l.trans_message
  })));
}

function toolGetGlossary(): string {
  return state.glossaryText || '(empty)';
}

function executeTool(name: string, args: any): string {
  try {
    switch (name) {
      case 'read_lines': return toolReadLines(args.start || 0, args.count || 10);
      case 'search_text': return toolSearchText(args.query || '');
      case 'get_context': return toolGetContext(args.line_num || 0, args.radius || 3);
      case 'get_glossary': return toolGetGlossary();
      default: return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

// ─── Prompt building ──────────────────────────────────────────────────────────

function buildAgentSystemPrompt(): string {
  let prompt = applyPromptVariables((state.agentPrompt || DEFAULT_AGENT_PROMPT).trim());
  if (state.enableUncertainMarking) {
    prompt += '\n\nIf you are uncertain about a translation, prefix it with [?].';
  }
  return prompt;
}

function buildAgentUserMessage(batch: Line[], glossaryBlock: string, contextBlock: string): string {
  const lines = batch.map(l => {
    const name = l.name || '';
    const msg = l.message || '';
    return `${l.line_num}\t${name}\t${msg}`;
  }).join('\n');

  const parts: string[] = [];
  parts.push(`Target language: ${state.targetLang}`);

  if (glossaryBlock) parts.push(`Glossary:\n${glossaryBlock}`);
  if (contextBlock) parts.push(`Context (preceding lines, do NOT translate these):\n${contextBlock}`);
  if (rollingContext) parts.push(`Rolling context from previous chunks:\n${rollingContext}`);

  const currentFile = batch[0]?.file || '';
  if (currentFile && fileNotes.has(currentFile)) {
    parts.push(`File notes for ${currentFile}:\n${fileNotes.get(currentFile)}`);
  }

  parts.push(`Lines to translate (ID\tNAME\tMESSAGE). Translate BOTH the NAME and MESSAGE columns. Include trans_name for any line where NAME is not empty:\n${lines}`);
  parts.push(`Respond with JSON. Call tools for context first, then commit translations for ALL lines above.`);

  return parts.join('\n\n');
}

// ─── Response parsing ─────────────────────────────────────────────────────────

interface AgentResponse {
  action: string;
  tool_calls?: { name: string; arguments: any }[];
  translations?: { id: number; trans_message: string; trans_name?: string }[];
  glossary_suggestions?: { source: string; target: string; note?: string; type?: string }[];
  rolling_context?: string;
  file_note?: any;
}

function parseAgentResponse(text: string): AgentResponse {
  let jsonStr = text.trim();

  // Strip markdown code fences
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try direct parse
  try {
    return JSON.parse(jsonStr);
  } catch { /* fall through */ }

  // Try to find a JSON object in the text
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch { /* fall through */ }
  }

  throw new Error('Response is not valid JSON.');
}

// ─── Main agent translate loop ───────────────────────────────────────────────

export async function onAgentTranslate(): Promise<void> {
  const btn = ui.btnAutoTranslate as HTMLButtonElement;

  if (isAgentTranslating) {
    isAgentTranslating = false;
    btn.textContent = 'Menghentikan...';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    return;
  }

  if (!state.aiApiKey) {
    alert('API Key belum diisi! Klik tombol robot di pojok kanan bawah untuk mengatur.');
    openModal(ui.apiSettingsModal as HTMLElement);
    return;
  }

  isAgentTranslating = true;
  btn.classList.remove('btn-success');
  btn.classList.add('btn-danger');
  btn.textContent = 'Hentikan Agent Translate';

  rollingContext = '';
  fileNotes.clear();
  glossarySuggestions = [];

  let targetLines = Array.from(state.selectedLines)
    .map(num => state.lines.find(l => l.line_num === num))
    .filter(l => l && !isTranslated(l) && !l._hidden) as typeof state.lines;

  if (targetLines.length === 0) {
    targetLines = state.lines.filter(l => !isTranslated(l) && !l._hidden);
  } else {
    targetLines.sort((a, b) => a.line_num - b.line_num);
  }

  const maxTurns = state.agentMaxTurns || 10;
  const batchSize = state.selectionBatchSize || 100;
  let chunkIndex = 0;
  const totalChunks = Math.ceil(targetLines.length / batchSize);

  try {
    while (isAgentTranslating) {
      const untranslatedLines = targetLines.filter(l => !isTranslated(l) && !l._hidden);
      if (untranslatedLines.length === 0) {
        if (glossarySuggestions.length > 0) {
          const suggestionsText = glossarySuggestions.map(s =>
            formatGlossaryEntry(s.source, { target: s.target, type: s.type || 'term', desc: s.note })
          ).join('\n');
          (ui.pasteGlossaryArea as HTMLTextAreaElement).value = suggestionsText;
          flashHint(`Agent menyarankan ${glossarySuggestions.length} istilah glosarium — periksa di tab Glosarium.`);
        }
        alert('Selesai! Semua baris target telah diterjemahkan oleh Agent.');
        break;
      }

      chunkIndex++;
      const batch = untranslatedLines.slice(0, batchSize);

      state.selectedLines.clear();
      for (const l of batch) state.selectedLines.add(l.line_num);
      import('./render').then(m => m.syncCheckboxUI());
      import('./selection').then(m => m.scrollPreviewToLine(batch[0].line_num));

      // Build context block (same as auto-translate)
      let contextBlock = '';
      if (state.contextLines > 0) {
        const firstSelLineNum = batch[0].line_num;
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
          if (ctxOut.length > 0) contextBlock = ctxOut.join('\n');
        }
      }

      // Build glossary block
      const joinedText = batch.map(l => `${l.name || ''}\t${l.message || ''}`).join('\n');
      const glossaryBlock = getGlossaryPrompt(joinedText);

      // Build messages
      const messages: ChatMessage[] = [
        { role: 'system', content: buildAgentSystemPrompt() },
        { role: 'user', content: buildAgentUserMessage(batch, glossaryBlock, contextBlock) }
      ];

      // Multi-turn loop
      let committed = false;
      for (let turn = 0; turn < maxTurns && isAgentTranslating; turn++) {
        btn.textContent = `Agent: chunk ${chunkIndex}/${totalChunks}, turn ${turn + 1}/${maxTurns}... (Klik Stop)`;

        let responseText = '';
        try {
          responseText = await chatCompletion(messages);
        } catch (e: any) {
          throw new Error(`Agent API error: ${e.message}`);
        }

        let response: AgentResponse;
        try {
          response = parseAgentResponse(responseText);
        } catch {
          messages.push({ role: 'assistant', content: responseText });
          messages.push({ role: 'user', content: 'Error: Your response was not valid JSON. Please respond with ONLY a JSON object following the protocol.' });
          continue;
        }

        if (response.action === 'tool_calls' && response.tool_calls) {
          messages.push({ role: 'assistant', content: responseText });
          const toolResults: string[] = [];
          for (const call of response.tool_calls) {
            const result = executeTool(call.name, call.arguments || {});
            toolResults.push(`Tool "${call.name}" result:\n${result}`);
          }
          messages.push({ role: 'user', content: toolResults.join('\n\n') });
          continue;
        }

        if (response.action === 'commit') {
          if (response.translations && response.translations.length > 0) {
            const updates = response.translations.map(t => ({
              num: t.id,
              trans_message: t.trans_message,
              trans_name: t.trans_name
            }));
            const applied = applyAgentTranslations(updates);
            console.log(`Agent chunk ${chunkIndex}: committed ${applied} translations`);
          }

          if (response.glossary_suggestions) {
            for (const s of response.glossary_suggestions) {
              if (s.source && s.target) {
                glossarySuggestions.push({ source: s.source, target: s.target, note: s.note || '', type: s.type || 'term' });
              }
            }
          }

          if (response.rolling_context) {
            rollingContext = response.rolling_context;
          }

          if (response.file_note) {
            const currentFile = batch[0]?.file || '';
            if (currentFile) {
              fileNotes.set(currentFile, JSON.stringify(response.file_note));
            }
          }

          committed = true;
          break;
        }

        // Unknown action
        messages.push({ role: 'assistant', content: responseText });
        messages.push({ role: 'user', content: `Error: Unknown action "${response.action}". Use "tool_calls" or "commit".` });
      }

      if (!committed) {
        console.warn(`Agent chunk ${chunkIndex} did not commit after ${maxTurns} turns, moving to next batch.`);
      }

      // RPM delay
      if (isAgentTranslating && state.aiRpm > 0) {
        const waitMs = Math.round(60000 / state.aiRpm);
        btn.textContent = `Menunggu delay (${Math.round(waitMs / 1000)}s)... (Klik Stop)`;
        await delay(waitMs, () => !isAgentTranslating);
      }
    }
  } catch (err: any) {
    if (isAgentTranslating) {
      alert('Agent Translate berhenti karena error:\n\n' + err.message);
    }
  } finally {
    isAgentTranslating = false;
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-success');
    btn.textContent = 'Jalankan Auto Translate';
  }
}