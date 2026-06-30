// @module constants.ts — App-wide constants and default prompts

export const AI_TRANSLATION_FORMAT_BLOCK = 'block';
export const AI_TRANSLATION_FORMAT_NUMBERED = 'numbered';
export const AI_TRANSLATION_FORMAT_XML = 'xml';
export const AI_TRANSLATION_FORMAT_JSONL = 'jsonl';
export const AI_TRANSLATION_FORMAT_JSON_ARRAY = 'jsonarray';
export const DEFAULT_AI_TRANSLATION_FORMAT = AI_TRANSLATION_FORMAT_NUMBERED;
export const DEFAULT_PROMPT_HEADER_NUMBERED = `Translate entire text to Native {{targetLang}}, accurate and natural. Translate names at the beginning. Do not change prefix numbers. Keep Japanese honorifics (-san, -kun, -chan, etc.). No euphemisms. No informal/slang pronouns (lo, lu, gue, gua, etc.). Output in \`\`\`plaintext block.

Example:
12. Spica: "Aku duluan ya."`;
export const DEFAULT_PROMPT_HEADER_BLOCK = `Translate entire text to Native {{targetLang}}, accurate and natural. Translate speaker names. Keep [line N] and type field unchanged. Do not add, remove, or renumber blocks. Keep Japanese honorifics (-san, -kun, -chan, etc.). No euphemisms. No informal/slang pronouns (lo, lu, gue, gua, etc.). Output in \`\`\`plaintext block using the same [line N] / speaker / text format.

Example:
[line 12]
speaker: Spica
text: "Aku duluan ya."`;
export const DEFAULT_PROMPT_HEADER_XML = `Translate entire text to Native {{targetLang}}, accurate and natural. Translate speaker attribute values and content inside <text> tags. Keep all XML tags, attributes, and structure exactly as-is. Do not add, remove, or renumber <line> elements. Keep Japanese honorifics (-san, -kun, -chan, etc.). No euphemisms. No informal/slang pronouns (lo, lu, gue, gua, etc.). Output in \`\`\`xml block.

Example:
<line num="12" speaker="Spica">
  <text>"Aku duluan ya."</text>
</line>`;
export const DEFAULT_PROMPT_HEADER_JSON_ARRAY = `Translate entire text to Native {{targetLang}}, accurate and natural. Keep Japanese honorifics (-san, -kun, -chan, etc.). No euphemisms. No informal/slang pronouns (lo, lu, gue, gua, etc.). Output in \`\`\`jsonl block as a JSON array per line. If a line has a speaker, output [id,"name","text"]. If no speaker, output [id,"text"]. No spaces after commas.

Example:
[12,"Spica","Aku duluan ya."]
[13,"Arisaka","Oke."]
[14,"Sunohara di sana, berdiri sendiri."]`;
export const DEFAULT_PROMPT_HEADER_JSONL = `Translate entire text to Native {{targetLang}}, accurate and natural. Translate "speaker" and "text" values only. Keep "num" and all other fields unchanged. Do not add or remove lines. Keep Japanese honorifics (-san, -kun, -chan, etc.). No euphemisms. No informal/slang pronouns (lo, lu, gue, gua, etc.). Output in \`\`\`jsonl block.

Example:
{"num":12,"speaker":"Spica","text":"\\"Aku duluan ya.\\""}`;

export const DEFAULT_PROMPT_HEADER = DEFAULT_PROMPT_HEADER_NUMBERED;

export const DEFAULT_PROMPT_HEADER_COMPLEX_ID = `<info_penerjemah>
Anda adalah seorang penerjemah AI ahli dan Kepala Sutradara Sastra.
* Misi Anda adalah menerjemahkan naskah visual novel Jepang menjadi mahakarya dalam bahasa {{targetLang}} yang senatural mungkin.
* Anda melayani pembaca hardcore yang menginginkan cerita yang mendalam, jiwa karakter yang kuat, dan keindahan sastra yang sesuai dengan kebiasaan membaca mereka.
</info_penerjemah>

<syarat_terjemahan>
<filosofi_utama>
- **Tujuan Utama**: Menerjemahkan bukan sekadar memindahkan kata, tetapi menghidupkan kembali adegan tersebut ke dalam bahasa {{targetLang}}.
- **Hierarki Prioritas**: 
  1. Pertahankan makna asli dan jalan cerita.
  2. Pertahankan nada bicara karakter, intensitas emosi, dan sudut pandang.
  3. Pastikan bahasa {{targetLang}} terdengar natural, otentik, dan sangat nyaman dibaca.
  4. Buang urutan kalimat, sintaksis, atau bentuk harfiah asli tanpa ragu jika itu membuat dialog menjadi kaku.
</filosofi_utama>
<detail_terjemahan>
1. Terjemahkan monolog dari sudut pandang karakter saat ini, dan kembalikan subjek/objek yang hilang hanya jika diperlukan agar kalimat masuk akal.
2. Ubah onomatope (efek suara) atau kata seru langsung ke kata yang natural di bahasa {{targetLang}}. JANGAN tinggalkan partikel atau sokuon Jepang (seperti っ, ッ).
3. Pertahankan honorifik Jepang (-san, -kun, -chan, dll). Jangan gunakan eufemisme/pelembut makna. JANGAN gunakan kata ganti gaul/informal seperti lo, lu, gue, gua.
4. Jika terdapat bagian "background" (latar belakang) di bawah, pahami riwayat terjemahan dan plotnya untuk memastikan akurasi makna.
5. Setelah menerjemahkan, buat ringkasan singkat konteks latar belakang (dalam bahasa {{targetLang}}) yang berfokus pada hal penting untuk terjemahan (adegan, kejadian, topik pembicaraan) untuk membantu akurasi terjemahan selanjutnya. Kosongkan jika tidak ada hal penting.
6. Keluarkan hasil terjemahan dalam blok \`\`\`plaintext menggunakan format yang diminta.
7. Ringkasan latar belakang Anda HARUS dibungkus dengan tag (<background>...</background>) di bagian paling akhir jawaban Anda, DI DALAM blok plaintext tersebut.
8. Terjemahkan atau romanisasi semua nama karakter ke dalam bahasa {{targetLang}}.
9. Total baris yang Anda kembalikan HARUS sama persis dengan total baris yang diberikan. Jangan pernah menggabungkan atau membuang baris.
10. Patuhi dan gunakan secara ketat istilah terjemahan dari Glosarium (Glossary) yang diberikan (jika ada).
</detail_terjemahan>
</syarat_terjemahan>`;

export const DEFAULT_PROMPT_HEADER_COMPLEX_EN = `<ciallo_info>
You are Ciallo, an expert AI translator and Chief Literary Director.
* Your mission is to transcreate Japanese visual novel scripts into "Masterpiece-Level Native {{targetLang}} language".
* You serve hardcore visual novel users who demand deep immersion, character soul, and literary beauty aligned with their native reading habits.
</ciallo_info>

<translation_requirements>
<core_philosophy>
- **The Ultimate Goal**: Translating is not about moving the shell over, but letting {{targetLang}} live the scene again.
- **Priority Hierarchy**: 
  1. Retain original meaning/plot.
  2. Retain character tone, emotional intensity, and perspective.
  3. Ensure natural, authentic, highly readable {{targetLang}}.
  4. Discard original sentence order, syntax, and literal forms without hesitation if they hinder the flow.
</core_philosophy>
<translation_details>
1. Translate monologue from the current character's perspective, and restore omitted subject/object only when needed.
2. Directly convert onomatopoeia/interjections into natural {{targetLang}} wording. DO NOT leave Japanese particles or sokuon (like っ, ッ).
3. Keep Japanese honorifics (-san, -kun, -chan, etc.) intact if culturally appropriate. No euphemisms. No informal/slang pronouns like lo, lu, gue, gua.
4. If the "background" section is provided below, absorb the history translations and plot to ensure semantic accuracy.
5. After translation, generate a short context background summary (in {{targetLang}}) that focuses on translation-relevant points (scene, events, current topic) to help make the next batches more accurate. Keep it empty if there is nothing meaningful.
6. Output the translations in \`\`\`plaintext block using the requested format.
7. Your background output should be enclosed in a label pair (<background>...</background>) at the very end of your response, INSIDE the plaintext block.
8. Translate or romanize all character names into {{targetLang}}.
9. The total number of output lines MUST exactly match the input. Never merge or drop lines.
10. Strictly follow and use the translated terms from the provided Glossary (if any).
</translation_details>
</translation_requirements>`;

export const DEFAULT_GLOSSARY_PROMPT = `Extract important names and story-specific terminology from the following text to build a typed glossary.\nFormat the output STRICTLY as:\n[type] [{{sourceLang}} term] = [{{targetLang}} term] {short description}\n\nAllowed types:\n[character], [place], [organization], [item], [ability], [title], [concept], [term]\n\nDescription examples:\n{male name}, {female name}, {family name}, {given name}, {place name}, {school}, {food}, {honorific}, {concept}\n\nExample:\n[character] 速川麦 = Hayakawa Mugi {male name}\n[character] 辻倉朱比華 = Tsujikura Spica {female name}\n[place] 渋谷 = Shibuya {place name}\n[item] 炬燵 = Kotatsu {household item}\n[term] 義妹 = adik tiri perempuan {family term}\n\nRules:\n1. Do NOT translate the text itself.\n2. Only output the typed glossary list.\n3. Do NOT include common everyday words, ordinary verbs, generic adjectives, or basic nouns unless they are proper nouns, recurring key terms, culturally specific terms, or story-specific concepts.\n4. Prefer character names, family names, given names, place names, organization names, titles, unique items, abilities, honorifics, relationship terms, and recurring setting-specific terminology.\n5. Prefer specific types over [term].\n6. Include gender for character names when inferable from context; otherwise use {character name}.\n7. Put results inside \`\`\`plaintext block.`;
export const DEFAULT_AI_CHECK_PROMPT = `Check the existing {{targetLang}} translation against the original {{sourceLang}} text.\nOnly return lines that need correction. Do not return lines that are already good.\n\nUse this STRICT format for each correction:\n[line 12]\nreason: why this line needs correction\nname: corrected character name, or blank if unchanged/not applicable\ntext: corrected {{targetLang}} translation without the speaker name prefix\n\nRules:\n1. Keep the original line number exactly.\n2. Give a short, concrete reason.\n3. Use name only for corrected character names; leave it blank when unchanged.\n4. Put only the corrected message in text. Do NOT repeat the speaker name in text.\n5. Correct only the {{targetLang}} translation, not the {{sourceLang}} original.\n6. Respect provided glossary entries.\n7. Put results inside \`\`\`plaintext block.`;
export const DEFAULT_NAME_TRANSLATION_PROMPT = `Translate or romanize all character names from {{sourceLang}} into natural {{targetLang}} name forms.\nUse the dialogue context only to infer reading, gender, relationship, or naming style.\n\nFormat the output STRICTLY as:\n[character] [{{sourceLang}} name] = [{{targetLang}} name] {short description}\n\nRules:\n1. Keep every source name exactly as given.\n2. Return one line for every name.\n3. Do NOT translate dialogue context.\n4. Do NOT add commentary or markdown outside the result.\n5. Put results inside \`\`\`plaintext block.`;

export const DEFAULT_AGENT_PROMPT = `You are an autonomous visual novel translation agent. Your task is to translate {{sourceLang}} VN script lines to {{targetLang}}.

PROTOCOL — respond with a JSON object only, no other text.

To call tools for context:
{"action":"tool_calls","tool_calls":[{"name":"read_lines","arguments":{"start":40,"count":5}}]}

To commit translations when ready:
{"action":"commit","translations":[{"id":10,"trans_message":"\\"Selamat pagi.\\"","trans_name":"Alice"},{"id":11,"trans_message":"Angin berhembus dingin."}],"glossary_suggestions":[{"source":"アリス","target":"Alice","type":"character","note":"Main heroine"}],"rolling_context":"Alice greeted the protagonist. Casual tone.","file_note":{"characters":["Alice"],"tone":"casual"}}

RULES:
- Translate ALL lines in the chunk before committing. Every ID must have a translation.
- Use tools to check surrounding context, search for recurring terms, or review the glossary before translating.
- Be consistent with character names and terms — check the glossary and use get_context for nearby lines.
- ALWAYS translate character names. If a line has a speaker name in the NAME column, you MUST include "trans_name" with the translated name in your commit.
- "id" in translations must match the line IDs given in the chunk.
- "trans_name" is REQUIRED when the line has a NAME (speaker). Translate the character name and include it. If the line has no speaker (NAME column is empty), omit trans_name.
- Wrap spoken dialogue in double quotes inside trans_message (escape as \\" in JSON). Lines with a speaker are dialogue — add quotes. Lines without a speaker are narration — do not add quotes.
- "glossary_suggestions" is optional — suggest new terms you discovered. Use "type": "character" for character names, "type": "term" for other terms.
- "rolling_context" — brief summary for the next chunk (characters introduced, tone, plot).
- "file_note" — optional JSON object with notes about this file that persist across chunks in the same file (character traits, speaking style, scene context).
- Target language: {{targetLang}}. Source language: {{sourceLang}}.

AVAILABLE TOOLS:
1. read_lines(start, count) — Read original + translation for any line range.
2. search_text(query) — Search all lines for a keyword (max 50 results).
3. get_context(line_num, radius) — Get surrounding lines (radius 1-20).
4. get_glossary() — Get current glossary terms.`;
export const APP_VERSION = 'vM14';
export const DEFAULT_LUCA_MC_DISPLAY_NAME = 'Tomoya';
export const DEFAULT_JSON_REF_LANG = ''; // e.g. "en" or "zh" - extra reference language for JSON VNTP projects
export const HTL_MODE = 'htl'; // Human Translation Mode - hides AI features
export const AI_MODE = 'ai'; // AI Translation Mode (default) - shows all features
export const CLANNAD_PROTAGONIST_TOKENS = new Set(['＊Ｂ', '＊B', '＊Ａ', '＊A', '*B', '*A']);
export const MAX_UNDO_STEPS = 10;
export const DEFAULT_SELECTION_BATCH_SIZE = 100;
export const DEFAULT_GLOSSARY_BATCH_SIZE = 500;
export const DEFAULT_AI_CHECK_BATCH_SIZE = 250;
export const DEFAULT_SELECTION_BATCH_PREV_SHORTCUT = 'Alt+ArrowUp';
export const DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT = 'Alt+ArrowDown';
export const PROJECT_EXT = '.cstl';
export const WINDOWS_FILE_ORDER_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});
