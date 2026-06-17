// @module constants.js — App-wide constants and default prompts

export const AI_TRANSLATION_FORMAT_BLOCK = "block";
export const AI_TRANSLATION_FORMAT_NUMBERED = "numbered";
export const AI_TRANSLATION_FORMAT_XML = "xml";
export const AI_TRANSLATION_FORMAT_JSONL = "jsonl";
export const AI_TRANSLATION_FORMAT_JSON_ARRAY = "jsonarray";
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
{"num":12,"speaker":"Spica","text":"\"Aku duluan ya.\""}`;

export const DEFAULT_PROMPT_HEADER = DEFAULT_PROMPT_HEADER_NUMBERED;
export const DEFAULT_GLOSSARY_PROMPT = `Extract important names and story-specific terminology from the following text to build a typed glossary.\nFormat the output STRICTLY as:\n[type] [{{sourceLang}} term] = [{{targetLang}} term] {short description}\n\nAllowed types:\n[character], [place], [organization], [item], [ability], [title], [concept], [term]\n\nDescription examples:\n{male name}, {female name}, {family name}, {given name}, {place name}, {school}, {food}, {honorific}, {concept}\n\nExample:\n[character] 浅村 悠太 = Asamura Yuuta {male name}\n[character] 綾瀬 沙季 = Ayase Saki {female name}\n[place] 渋谷 = Shibuya {place name}\n[item] 炬燵 = Kotatsu {household item}\n[term] 義妹 = adik tiri perempuan {family term}\n\nRules:\n1. Do NOT translate the text itself.\n2. Only output the typed glossary list.\n3. Do NOT include common everyday words, ordinary verbs, generic adjectives, or basic nouns unless they are proper nouns, recurring key terms, culturally specific terms, or story-specific concepts.\n4. Prefer character names, family names, given names, place names, organization names, titles, unique items, abilities, honorifics, relationship terms, and recurring setting-specific terminology.\n5. Prefer specific types over [term].\n6. Include gender for character names when inferable from context; otherwise use {character name}.\n7. Put results inside \`\`\`plaintext block.`;
export const DEFAULT_AI_CHECK_PROMPT = `Check the existing {{targetLang}} translation against the original {{sourceLang}} text.\nOnly return lines that need correction. Do not return lines that are already good.\n\nUse this STRICT format for each correction:\n[line 12]\nreason: why this line needs correction\nname: corrected character name, or blank if unchanged/not applicable\ntext: corrected {{targetLang}} translation without the speaker name prefix\n\nRules:\n1. Keep the original line number exactly.\n2. Give a short, concrete reason.\n3. Use name only for corrected character names; leave it blank when unchanged.\n4. Put only the corrected message in text. Do NOT repeat the speaker name in text.\n5. Correct only the {{targetLang}} translation, not the {{sourceLang}} original.\n6. Respect provided glossary entries.\n7. Put results inside \`\`\`plaintext block.`;
export const DEFAULT_NAME_TRANSLATION_PROMPT = `Translate or romanize all character names from {{sourceLang}} into natural {{targetLang}} name forms.\nUse the dialogue context only to infer reading, gender, relationship, or naming style.\n\nFormat the output STRICTLY as:\n[character] [{{sourceLang}} name] = [{{targetLang}} name] {short description}\n\nRules:\n1. Keep every source name exactly as given.\n2. Return one line for every name.\n3. Do NOT translate dialogue context.\n4. Do NOT add commentary or markdown outside the result.\n5. Put results inside \`\`\`plaintext block.`;
export const APP_VERSION = "vM13";
export const DEFAULT_LUCA_MC_DISPLAY_NAME = "Tomoya";
export const DEFAULT_JSON_REF_LANG = ""; // e.g. "en" or "zh" - extra reference language for JSON VNTP projects
export const HTL_MODE = "htl"; // Human Translation Mode - hides AI features
export const AI_MODE = "ai"; // AI Translation Mode (default) - shows all features
export const CLANNAD_PROTAGONIST_TOKENS = new Set(["＊Ｂ", "＊B", "＊Ａ", "＊A", "*B", "*A"]);
export const MAX_UNDO_STEPS = 10;
export const DEFAULT_SELECTION_BATCH_SIZE = 100;
export const DEFAULT_GLOSSARY_BATCH_SIZE = 500;
export const DEFAULT_AI_CHECK_BATCH_SIZE = 250;
export const DEFAULT_SELECTION_BATCH_PREV_SHORTCUT = "Alt+ArrowUp";
export const DEFAULT_SELECTION_BATCH_NEXT_SHORTCUT = "Alt+ArrowDown";
export const PROJECT_EXT = ".cstl";
export const WINDOWS_FILE_ORDER_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
