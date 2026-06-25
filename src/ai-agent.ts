import { state, ui } from './state';
import { applyAgentTranslations, clearAgentTranslations, onUndoLastApply } from './translate';
import { stripThinkingTags } from './auto-translate';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// ------------------------------------------------------------------
// API Wrappers for Chat (OpenAI & Gemini)
// ------------------------------------------------------------------

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  if (!state.aiApiKey) throw new Error("API Key belum diatur.");
  if (state.aiApiType === 'gemini') {
    return chatCompletionGemini(messages);
  } else {
    return chatCompletionOpenAI(messages);
  }
}

async function chatCompletionOpenAI(messages: ChatMessage[]): Promise<string> {
  let url = state.aiApiUrl || 'https://api.openai.com/v1/chat/completions';
  if (!url.includes('/chat/completions')) {
    if (!url.endsWith('/')) url += '/';
    url += 'chat/completions';
  }

  const body = {
    model: state.aiModel || 'gpt-4o-mini',
    messages: messages,
    temperature: state.aiTemperature ?? 1.0,
    top_p: state.aiTopP ?? 1.0,
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
  const rawText = data.choices?.[0]?.message?.content || '';
  return state.aiFilterThinkingOutput ? stripThinkingTags(rawText) : rawText;
}

async function chatCompletionGemini(messages: ChatMessage[]): Promise<string> {
  const model = state.aiModel || 'gemini-1.5-flash';
  let url = state.aiApiUrl;
  if (!url) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.aiApiKey}`;
  } else if (!url.includes('?key=')) {
    url += `?key=${state.aiApiKey}`;
  }

  // Gemini expects 'user' or 'model' roles. 'system' is handled via systemInstruction
  let systemInstruction: any = null;
  const contents: any[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
  }

  const body: any = {
    contents: contents,
    generationConfig: {
      temperature: state.aiTemperature ?? 1.0,
      topP: state.aiTopP ?? 1.0,
    }
  };
  
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

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
  // Gemini thinking models return thought parts separately with {thought: true}.
  // Skip those and only collect actual response text.
  const parts: any[] = data.candidates?.[0]?.content?.parts || [];
  const rawText = parts
    .filter((p: any) => !p.thought)
    .map((p: any) => p.text || '')
    .join('')
    .trim();
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
  if (!results.length) return `Tidak ada baris antara ${start}–${end}`;
  return results.map(l =>
    `[Baris ${l.line_num}] ${l.name ? `Karakter: ${l.name}` : '(Narasi)'}\nAsli: ${l.message}\nTerjemahan: ${l.trans_message || '(belum diterjemahkan)'}${l.trans_name ? `\nNama Terjemahan: ${l.trans_name}` : ''}`
  ).join('\n\n');
}

/** getContext: returns N lines before and after a target line for translation context */
function getContext(line_num: number, radius: number) {
  const r = Math.min(Math.max(radius || 3, 1), 20);
  const results = state.lines.filter(l => l.line_num >= line_num - r && l.line_num <= line_num + r);
  if (!results.length) return `Baris ${line_num} tidak ditemukan.`;
  return results.map(l => {
    const marker = l.line_num === line_num ? ' ◄ TARGET' : '';
    return `[Baris ${l.line_num}${marker}] ${l.name ? `(${l.name})` : '(Narasi)'}\nAsli: ${l.message}\nTerjemahan: ${l.trans_message || '(belum)'}`;
  }).join('\n\n');
}

/** getCharacterNames: returns all unique speaker names with their translated names */
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
    if (transArr.length === 0) {
      lines.push(`${orig} → (belum diterjemahkan)`);
    } else if (transArr.length === 1) {
      lines.push(`${orig} → ${transArr[0]}`);
    } else {
      // Multiple different translations = inconsistency
      lines.push(`${orig} → [INKONSISTEN: ${transArr.join(' / ')}]`);
    }
  }
  return lines.join('\n');
}

/** analyzeQuality: sample untranslated or short/suspicious lines for QA */
function analyzeQuality(limit: number) {
  const lim = Math.min(limit || 20, 50);
  const issues: string[] = [];

  // Untranslated lines
  const untrans = state.lines.filter(l => !l.is_translated).slice(0, lim);
  if (untrans.length) {
    issues.push(`--- Belum Diterjemahkan (${untrans.length} pertama dari ${state.lines.filter(l => !l.is_translated).length}) ---`);
    untrans.forEach(l => issues.push(`[Baris ${l.line_num}] ${l.name || 'Narasi'}: ${l.message}`));
  }

  // Suspiciously short translations
  const tooShort = state.lines.filter(l =>
    l.is_translated &&
    l.trans_message &&
    l.message.length > 10 &&
    l.trans_message.length < l.message.length * 0.2
  ).slice(0, 10);
  if (tooShort.length) {
    issues.push(`\n--- Terjemahan Terlalu Pendek (mencurigakan) ---`);
    tooShort.forEach(l => issues.push(`[Baris ${l.line_num}] Asli: "${l.message}" → Terjemahan: "${l.trans_message}"`));
  }

  // Inconsistent character names
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

/** getProgressReport: returns per-file translation progress */
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
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
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
3. getContext(line_num, radius) — Ambil baris sekitar sebuah baris target (konteks atas-bawah, radius 1–20).
4. searchLines(query) — Cari kata kunci di teks asli, terjemahan, atau nama karakter (maks 50 hasil).
5. getCharacterNames() — Daftar semua nama karakter beserta terjemahannya; inkonsistensi ditandai otomatis.
6. analyzeQuality(limit) — Analisis masalah kualitas: baris belum diterjemahkan, terjemahan terlalu pendek, nama karakter inkonsisten.
7. getProgressReport() — Laporan progress terjemahan per file.
8. applyTranslations(updates) — Terapkan terjemahan langsung ke proyek. updates adalah array: [{num, trans_message, trans_name (opsional)}].
9. clearTranslations(line_nums) — Hapus terjemahan untuk baris-baris tertentu. line_nums adalah array angka.
10. undoLastAction() — Batalkan aksi terakhir (apply atau clear).
11. getGlossary() — Ambil daftar glosarium yang didefinisikan pengguna.

CARA MEMANGGIL TOOL:
Tulis blok JSON markdown persis seperti ini, lalu BERHENTI mengenerate:
\`\`\`tool_call
{
  "tool": "getLines",
  "arguments": {
    "start": 100,
    "end": 105
  }
}
\`\`\`

ATURAN PENTING:
- Hanya panggil SATU tool per giliran. Tunggu hasilnya sebelum melanjutkan.
- JANGAN menebak hasil tool. Tunggu respons sistem.
- Jika diminta menerjemahkan, WAJIB ambil baris dulu dengan getLines atau getContext, baca teks aslinya, baru terjemahkan dan terapkan dengan applyTranslations.
- Saat menerjemahkan, perhatikan glosarium (getGlossary), konteks baris sekitar (getContext), dan konsistensi nama karakter (getCharacterNames).
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
  if (chatHistory.length === 0) {
    chatHistory.push({ role: 'system', content: buildSystemPrompt() });
  }

  chatHistory.push({ role: 'user', content: userMessage });

  let loopCount = 0;
  const maxLoops = 10;

  while (loopCount < maxLoops) {
    loopCount++;
    onUpdate("Memproses...", 'system');

    let responseText = '';
    try {
      responseText = await chatCompletion(chatHistory);
    } catch (e: any) {
      chatHistory.push({ role: 'assistant', content: `Error: ${e.message}` });
      throw e;
    }

    chatHistory.push({ role: 'assistant', content: responseText });

    // Check for tool call
    const toolCallMatch = responseText.match(/```tool_call\s*\n([\s\S]*?)\n```/i);
    if (toolCallMatch) {
      try {
        const callData = JSON.parse(toolCallMatch[1]);
        const toolName = callData.tool;
        const args = callData.arguments || {};

        onUpdate(`Menggunakan tool: ${toolName}...`, 'system');

        let toolResult = '';
        if (toolName === 'getProjectStats') {
          toolResult = getProjectStats();
        } else if (toolName === 'getLines') {
          toolResult = getLines(args.start, args.end);
        } else if (toolName === 'getContext') {
          toolResult = getContext(args.line_num, args.radius);
        } else if (toolName === 'searchLines') {
          toolResult = searchLines(args.query);
        } else if (toolName === 'getCharacterNames') {
          toolResult = getCharacterNames();
        } else if (toolName === 'analyzeQuality') {
          toolResult = analyzeQuality(args.limit);
        } else if (toolName === 'getProgressReport') {
          toolResult = getProgressReport();
        } else if (toolName === 'applyTranslations') {
          toolResult = applyTranslations(args.updates);
        } else if (toolName === 'clearTranslations') {
          const cleared = clearAgentTranslations(args.line_nums || []);
          toolResult = `Berhasil menghapus terjemahan untuk ${cleared} baris.`;
        } else if (toolName === 'undoLastAction') {
          onUndoLastApply();
          toolResult = 'Aksi terakhir berhasil dibatalkan.';
        } else if (toolName === 'getGlossary') {
          toolResult = state.glossaryText || 'Glosarium belum didefinisikan.';
        } else {
          toolResult = `Error: Tool tidak dikenal — "${toolName}"`;
        }

        chatHistory.push({ role: 'user', content: `Tool Result:\n\`\`\`\n${toolResult}\n\`\`\`` });
        // Loop continues
      } catch (e: any) {
        chatHistory.push({ role: 'user', content: `Tool Call Error: Gagal mem-parse atau menjalankan tool. ${e.message}` });
      }
    } else {
      // No tool call, conversation turn ended
      onUpdate(responseText, 'assistant');
      break;
    }
  }
}
