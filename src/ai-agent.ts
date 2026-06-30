import { state, ui } from './state';
import { applyAgentTranslations, clearAgentTranslations, onUndoLastApply } from './translate';
import { stripThinkingTags, parseBackupKeys, shouldTryNextKey, shuffleArray } from './auto-translate';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ApiConfig {
  key: string;
  url: string;
  model: string;
}

const COMPACTION_THRESHOLD = 50000;
const WELCOME_MSG = '👋 Halo! Saya CSTL Agent. Saya bisa menjawab pertanyaan seputar proyek ini atau membantu mengeksekusi terjemahan layaknya Vibecoding Agent.';

// ------------------------------------------------------------------
// Chat History Persistence
// ------------------------------------------------------------------

function getChatStorageKey(): string {
  return state.currentProjectId
    ? `cstl_agent_chat_${state.currentProjectId}`
    : 'cstl_agent_chat_global';
}

export function saveChatHistory(): void {
  try {
    // Save only non-system messages (system prompt is rebuilt on load)
    const toSave = chatHistory.filter(m => m.role !== 'system');
    localStorage.setItem(getChatStorageKey(), JSON.stringify(toSave));
  } catch (e) {
    console.warn('Gagal menyimpan chat history:', e);
  }
}

export function loadChatHistory(): void {
  chatHistory.length = 0;
  chatHistory.push({ role: 'system', content: buildSystemPrompt() });
  try {
    const saved = localStorage.getItem(getChatStorageKey());
    if (saved) {
      const msgs = JSON.parse(saved) as ChatMessage[];
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          if (m.role && m.content) chatHistory.push({ role: m.role, content: m.content });
        }
      }
    }
  } catch (e) {
    console.warn('Gagal memuat chat history:', e);
  }
}

export function clearChatHistory(): void {
  chatHistory.length = 0;
  chatHistory.push({ role: 'system', content: buildSystemPrompt() });
  try { localStorage.removeItem(getChatStorageKey()); } catch {}
  // Reset UI
  const historyEl = ui.agentChatHistory as HTMLElement;
  if (historyEl) {
    historyEl.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'agent-msg system';
    welcome.textContent = WELCOME_MSG;
    historyEl.appendChild(welcome);
  }
}

export function renderChatHistory(): void {
  const historyEl = ui.agentChatHistory as HTMLElement;
  if (!historyEl) return;
  historyEl.innerHTML = '';
  let hasContent = false;
  for (const m of chatHistory) {
    if (m.role === 'system') continue;
    const div = document.createElement('div');
    div.className = `agent-msg ${m.role}`;
    let html = m.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
    div.innerHTML = html;
    historyEl.appendChild(div);
    hasContent = true;
  }
  if (!hasContent) {
    const welcome = document.createElement('div');
    welcome.className = 'agent-msg system';
    welcome.textContent = WELCOME_MSG;
    historyEl.appendChild(welcome);
  }
  historyEl.scrollTop = historyEl.scrollHeight;
}

// ------------------------------------------------------------------
// API Wrappers for Chat (OpenAI & Gemini) — multi-key
// ------------------------------------------------------------------

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const configs = parseBackupKeys();
  if (configs.length === 0) throw new Error("API Key belum diatur.");
  let ordered = configs;
  if (state.aiKeyStrategy === 'random') ordered = shuffleArray(configs);
  let lastError: Error | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const config = ordered[i];
    try {
      if (state.aiApiType === 'gemini') {
        return await chatCompletionGemini(messages, config);
      }
      return await chatCompletionOpenAI(messages, config);
    } catch (err: any) {
      lastError = err;
      if (i < ordered.length - 1 && shouldTryNextKey(err)) {
        console.warn(`Chat API key ${i + 1} failed (${err.message}), trying next key...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('Semua API key gagal.');
}

async function chatCompletionOpenAI(messages: ChatMessage[], config: ApiConfig): Promise<string> {
  let url = config.url || 'https://api.openai.com/v1/chat/completions';
  if (!url.includes('/chat/completions')) {
    if (!url.endsWith('/')) url += '/';
    url += 'chat/completions';
  }
  const body: any = {
    model: config.model || 'gpt-4o-mini',
    messages: messages,
    temperature: state.aiTemperature ?? 1.0,
    top_p: state.aiTopP ?? 1.0,
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` },
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

async function chatCompletionGemini(messages: ChatMessage[], config: ApiConfig): Promise<string> {
  const model = config.model || 'gemini-1.5-flash';
  let url = config.url;
  if (!url) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.key}`;
  } else if (!url.includes('?key=')) {
    url += `?key=${config.key}`;
  }
  let systemInstruction: any = null;
  const contents: any[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    }
  }
  const genConfig: any = { temperature: state.aiTemperature ?? 1.0, topP: state.aiTopP ?? 1.0 };

  const thinkMode = state.aiThinkingMode;
  if (thinkMode !== 'default') {
    genConfig.thinkingConfig = { thinkingBudget: thinkMode === 'off' ? 0 : -1 };
  }

  const body: any = {
    contents: contents,
    generationConfig: genConfig,
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;
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
  const rawText = parts.filter((p: any) => !p.thought).map((p: any) => p.text || '').join('').trim();
  return state.aiFilterThinkingOutput ? stripThinkingTags(rawText) : rawText;
}

// ------------------------------------------------------------------
// Tools Logic
// ------------------------------------------------------------------

function getProjectStats() {
  const total = state.lines.length;
  const translated = state.lines.filter(l => l.is_translated).length;
  const untranslated = total - translated;
  const percent = total ? Math.round((translated / total) * 100) : 0;
  const files = [...new Set(state.lines.map(l => l.file).filter(Boolean))];
  return [
    `=== RINGKASAN PROYEK ===`,
    `Total Baris: ${total}`,
    `Sudah Diterjemahkan: ${translated} (${percent}%)`,
    `Belum Diterjemahkan: ${untranslated}`,
    `Bahasa Sumber: ${state.sourceLang}`,
    `Bahasa Target: ${state.targetLang}`,
    `Jumlah File: ${files.length}`,
    files.length ? `Daftar File: ${files.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function searchLines(query: string) {
  const lower = query.toLowerCase();
  const results = state.lines.filter(l =>
    (l.message || '').toLowerCase().includes(lower) ||
    (l.trans_message || '').toLowerCase().includes(lower) ||
    (l.name || '').toLowerCase().includes(lower) ||
    (l.trans_name || '').toLowerCase().includes(lower)
  ).slice(0, 50);
  if (!results.length) return `Tidak ditemukan baris yang mengandung: "${query}"`;
  return results.map(l =>
    `[Baris ${l.line_num}] ${l.name ? `(${l.name})` : ''}\nAsli: ${l.message}\nTerjemahan: ${l.trans_message || '(belum diterjemahkan)'}`
  ).join('\n\n');
}

function getLines(start: number, end: number) {
  const results = state.lines.filter(l => l.line_num >= start && l.line_num <= end);
  if (!results.length) return `Tidak ada baris antara ${start}-${end}`;
  return results.map(l =>
    `[Baris ${l.line_num}] ${l.name ? `Karakter: ${l.name}` : '(Narasi)'}\nAsli: ${l.message}\nTerjemahan: ${l.trans_message || '(belum diterjemahkan)'}${l.trans_name ? `\nNama Terjemahan: ${l.trans_name}` : ''}`
  ).join('\n\n');
}

function getContext(line_num: number, radius: number) {
  const r = Math.min(Math.max(radius || 3, 1), 20);
  const results = state.lines.filter(l => l.line_num >= line_num - r && l.line_num <= line_num + r);
  if (!results.length) return `Baris ${line_num} tidak ditemukan.`;
  return results.map(l => {
    const marker = l.line_num === line_num ? ' <<< TARGET' : '';
    return `[Baris ${l.line_num}${marker}] ${l.name ? `(${l.name})` : '(Narasi)'}\nAsli: ${l.message}\nTerjemahan: ${l.trans_message || '(belum)'}`;
  }).join('\n\n');
}

function getCharacterNames() {
  const map = new Map<string, Set<string>>();
  for (const l of state.lines) {
    if (!l.name) continue;
    if (!map.has(l.name)) map.set(l.name, new Set());
    if (l.trans_name) map.get(l.name)!.add(l.trans_name);
  }
  if (!map.size) return 'Tidak ada karakter dengan nama speaker dalam proyek ini.';
  const lines: string[] = ['=== DAFTAR KARAKTER ==='];
  for (const [orig, transSet] of map.entries()) {
    const transArr = [...transSet];
    if (transArr.length === 0) lines.push(`${orig} -> (belum diterjemahkan)`);
    else if (transArr.length === 1) lines.push(`${orig} -> ${transArr[0]}`);
    else lines.push(`${orig} -> [INKONSISTEN: ${transArr.join(' / ')}]`);
  }
  return lines.join('\n');
}

function analyzeQuality(limit: number) {
  const lim = Math.min(limit || 20, 50);
  const issues: string[] = [];
  const untrans = state.lines.filter(l => !l.is_translated).slice(0, lim);
  if (untrans.length) {
    issues.push(`--- Belum Diterjemahkan (${untrans.length} pertama dari ${state.lines.filter(l => !l.is_translated).length}) ---`);
    untrans.forEach(l => issues.push(`[Baris ${l.line_num}] ${l.name || 'Narasi'}: ${l.message}`));
  }
  const tooShort = state.lines.filter(l =>
    l.is_translated && l.trans_message && l.message.length > 10 && l.trans_message.length < l.message.length * 0.2
  ).slice(0, 10);
  if (tooShort.length) {
    issues.push(`\n--- Terjemahan Terlalu Pendek (mencurigakan) ---`);
    tooShort.forEach(l => issues.push(`[Baris ${l.line_num}] Asli: "${l.message}" -> Terjemahan: "${l.trans_message}"`));
  }
  const nameMap = new Map<string, Set<string>>();
  for (const l of state.lines) {
    if (!l.name || !l.trans_name) continue;
    if (!nameMap.has(l.name)) nameMap.set(l.name, new Set());
    nameMap.get(l.name)!.add(l.trans_name);
  }
  const inconsistentNames = [...nameMap.entries()].filter(([, s]) => s.size > 1);
  if (inconsistentNames.length) {
    issues.push(`\n--- Nama Karakter Tidak Konsisten ---`);
    inconsistentNames.forEach(([orig, transSet]) =>
      issues.push(`"${orig}" diterjemahkan sebagai: ${[...transSet].join(', ')}`)
    );
  }
  return issues.length ? issues.join('\n') : 'Tidak ditemukan masalah kualitas yang signifikan.';
}

function getProgressReport() {
  const fileMap = new Map<string, { total: number; translated: number }>();
  for (const l of state.lines) {
    const f = l.file || '(tidak diketahui)';
    if (!fileMap.has(f)) fileMap.set(f, { total: 0, translated: 0 });
    const entry = fileMap.get(f)!;
    entry.total++;
    if (l.is_translated) entry.translated++;
  }
  const lines = ['=== LAPORAN PROGRESS PER FILE ==='];
  for (const [file, { total, translated }] of fileMap.entries()) {
    const pct = Math.round((translated / total) * 100);
    const bar = '#'.repeat(Math.round(pct / 10)) + '-'.repeat(10 - Math.round(pct / 10));
    lines.push(`${file}\n  [${bar}] ${translated}/${total} (${pct}%)`);
  }
  return lines.join('\n');
}

function applyTranslations(updates: {num: number, trans_message: string, trans_name?: string}[]) {
  try {
    const applied = applyAgentTranslations(updates);
    return `Berhasil menerapkan terjemahan ke ${applied} baris.`;
  } catch (e: any) {
    return `Gagal menerapkan terjemahan: ${e.message}`;
  }
}

function executeTool(name: string, args: any): string {
  switch (name) {
    case 'getProjectStats': return getProjectStats();
    case 'getLines': return getLines(args.start, args.end);
    case 'getContext': return getContext(args.line_num, args.radius);
    case 'searchLines': return searchLines(args.query);
    case 'getCharacterNames': return getCharacterNames();
    case 'analyzeQuality': return analyzeQuality(args.limit);
    case 'getProgressReport': return getProgressReport();
    case 'applyTranslations': return applyTranslations(args.updates);
    case 'clearTranslations': {
      const cleared = clearAgentTranslations(args.line_nums || []);
      return `Berhasil menghapus terjemahan untuk ${cleared} baris.`;
    }
    case 'undoLastAction':
      onUndoLastApply();
      return 'Aksi terakhir berhasil dibatalkan.';
    case 'getGlossary':
      return state.glossaryText || 'Glosarium belum didefinisikan.';
    default:
      return `Error: Tool tidak dikenal — "${name}"`;
  }
}

// ------------------------------------------------------------------
// Response Parser — JSON with fallback
// ------------------------------------------------------------------

interface ParsedToolCalls {
  calls: { name: string; arguments: any }[];
  raw: string;
}

function parseToolCalls(text: string): ParsedToolCalls | null {
  let jsonStr = text.trim();

  // Strategy 1: Try direct JSON parse
  try {
    const obj = JSON.parse(jsonStr);
    return extractCallsFromObject(obj, text);
  } catch { /* fall through */ }

  // Strategy 2: Extract JSON object from text
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0]);
      return extractCallsFromObject(obj, text);
    } catch { /* fall through */ }
  }

  // Strategy 3: Old ```tool_call format (backward compat)
  const toolCallMatch = jsonStr.match(/```tool_call\s*\n([\s\S]*?)\n```/i);
  if (toolCallMatch) {
    try {
      const obj = JSON.parse(toolCallMatch[1]);
      return extractCallsFromObject(obj, text);
    } catch { /* fall through */ }
  }

  return null;
}

function extractCallsFromObject(obj: any, raw: string): ParsedToolCalls {
  const calls: { name: string; arguments: any }[] = [];
  // Multiple tools format
  if (Array.isArray(obj.tool_calls)) {
    for (const c of obj.tool_calls) {
      if (c.name) calls.push({ name: c.name, arguments: c.arguments || {} });
      else if (c.tool) calls.push({ name: c.tool, arguments: c.arguments || {} });
    }
  }
  // Single tool format (backward compat)
  else if (obj.tool) {
    calls.push({ name: obj.tool, arguments: obj.arguments || {} });
  }
  return { calls, raw };
}

// ------------------------------------------------------------------
// Context Compaction
// ------------------------------------------------------------------

async function compactContextIfNeeded(onUpdate: (msg: string, role: 'assistant' | 'system') => void): Promise<void> {
  const nonSystem = chatHistory.filter(m => m.role !== 'system');
  const totalChars = nonSystem.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= COMPACTION_THRESHOLD) return;

  onUpdate('Compacting context...', 'system');

  // Ask the AI to summarize everything so far
  const summaryMessages: ChatMessage[] = [
    { role: 'system', content: 'You are a conversation summarizer. Summarize the following conversation concisely. Include important context, decisions made, character names established, and any translations applied. Be concise but preserve key details.' },
    { role: 'user', content: nonSystem.map(m => `[${m.role}]: ${m.content}`).join('\n\n') }
  ];

  const summary = await chatCompletion(summaryMessages);

  // Replace all messages with: system prompt + summary
  chatHistory.length = 0;
  chatHistory.push({ role: 'system', content: buildSystemPrompt() });
  chatHistory.push({ role: 'assistant', content: `[Summary of previous conversation]\n${summary}` });
  saveChatHistory();
}

// ------------------------------------------------------------------
// System Prompt
// ------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `Kamu adalah CSTL AI Agent, asisten terjemahan visual novel yang terintegrasi langsung di dalam aplikasi CSTL Visual Novel Translation Editor.

Tugasmu adalah membantu pengguna menerjemahkan skrip visual novel, menjawab pertanyaan tentang skrip, menganalisis kualitas terjemahan, dan memodifikasi data terjemahan sesuai permintaan.

INFO PROYEK SAAT INI:
- Bahasa Sumber: ${state.sourceLang}
- Bahasa Target: ${state.targetLang}
- Total Baris: ${state.lines.length}
- Sudah Diterjemahkan: ${state.lines.filter(l => l.is_translated).length}

DAFTAR TOOL YANG TERSEDIA:
1. getProjectStats() — Ringkasan progress, jumlah baris, daftar file.
2. getLines(start, end) — Ambil teks asli + terjemahan untuk rentang baris tertentu.
3. getContext(line_num, radius) — Ambil baris sekitar sebuah baris target (konteks atas-bawah, radius 1-20).
4. searchLines(query) — Cari kata kunci di teks asli, terjemahan, atau nama karakter (maks 50 hasil).
5. getCharacterNames() — Daftar semua nama karakter beserta terjemahannya; inkonsistensi ditandai otomatis.
6. analyzeQuality(limit) — Analisis masalah kualitas: baris belum diterjemahkan, terjemahan terlalu pendek, nama karakter inkonsisten.
7. getProgressReport() — Laporan progress terjemahan per file.
8. applyTranslations(updates) — Terapkan terjemahan langsung ke proyek. updates adalah array: [{num, trans_message, trans_name (opsional)}].
9. clearTranslations(line_nums) — Hapus terjemahan untuk baris-baris tertentu. line_nums adalah array angka.
10. undoLastAction() — Batalkan aksi terakhir (apply atau clear).
11. getGlossary() — Ambil daftar glosarium yang didefinisikan pengguna.

CARA MEMANGGIL TOOL:
Kirim respons JSON. Kamu bisa memanggil beberapa tool sekaligus dalam satu respons:

{"tool_calls": [{"name": "getLines", "arguments": {"start": 100, "end": 105}}, {"name": "getGlossary", "arguments": {}}]}

Atau single tool (format lama):
{"tool": "getLines", "arguments": {"start": 100, "end": 105}}

Untuk balasan biasa tanpa tool, tulis teks biasa (bukan JSON).

ATURAN PENTING:
- Kamu bisa memanggil beberapa tool dalam satu respons. Panggil semua tool yang kamu butuhkan, lalu tunggu hasilnya.
- JANGAN menebak hasil tool. Tunggu respons sistem.
- Jika diminta menerjemahkan, WAJIB ambil baris dulu dengan getLines atau getContext, baca teks aslinya, baru terjemahkan dan terapkan dengan applyTranslations.
- Saat menerjemahkan, perhatikan glosarium (getGlossary), konteks baris sekitar (getContext), dan konsistensi nama karakter (getCharacterNames).
- Saat menerjemahkan dengan applyTranslations, ALWAYS sertakan trans_name untuk baris yang punya nama karakter.
- Untuk analisis kualitas, gunakan analyzeQuality terlebih dahulu sebelum memberikan rekomendasi.
- Jika ada nama karakter yang inkonsisten, sarankan perbaikan dan minta konfirmasi sebelum menerapkan.
- Jawab dalam Bahasa Indonesia kecuali pengguna meminta sebaliknya.
- Jangan tampilkan proses berpikir internalmu. Langsung berikan jawaban atau panggil tool.`;
}

// ------------------------------------------------------------------
// ReAct Agent Engine
// ------------------------------------------------------------------

export const chatHistory: ChatMessage[] = [];

export async function sendAgentMessage(userMessage: string, onUpdate: (msg: string, role: 'assistant' | 'system') => void): Promise<void> {
  // Ensure system prompt is fresh
  if (chatHistory.length === 0 || chatHistory[0].role !== 'system') {
    chatHistory.unshift({ role: 'system', content: buildSystemPrompt() });
  } else {
    // Refresh system prompt with current stats
    chatHistory[0].content = buildSystemPrompt();
  }

  // Compact if needed
  await compactContextIfNeeded(onUpdate);

  chatHistory.push({ role: 'user', content: userMessage });
  saveChatHistory();

  let loopCount = 0;
  const maxLoops = 15;

  while (loopCount < maxLoops) {
    loopCount++;
    onUpdate('Memproses...', 'system');

    let responseText = '';
    try {
      responseText = await chatCompletion(chatHistory);
    } catch (e: any) {
      chatHistory.push({ role: 'assistant', content: `Error: ${e.message}` });
      saveChatHistory();
      throw e;
    }

    chatHistory.push({ role: 'assistant', content: responseText });
    saveChatHistory();

    // Try to parse tool calls
    const parsed = parseToolCalls(responseText);

    if (parsed && parsed.calls.length > 0) {
      const toolNames = parsed.calls.map(c => c.name).join(', ');
      onUpdate(`Menggunakan tool: ${toolNames}...`, 'system');

      // Execute all tools and collect results
      const toolResults: string[] = [];
      for (const call of parsed.calls) {
        const result = executeTool(call.name, call.arguments);
        toolResults.push(`Tool "${call.name}" result:\n${result}`);
      }

      chatHistory.push({ role: 'user', content: toolResults.join('\n\n') });
      saveChatHistory();
      // Loop continues — AI can call more tools or respond with text
    } else {
      // No tool call — plain text response, conversation turn ended
      onUpdate(responseText, 'assistant');
      break;
    }
  }
}