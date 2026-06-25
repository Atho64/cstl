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
  return `Total Lines: ${total}\nTranslated Lines: ${translated}\nSource Language: ${state.sourceLang}\nTarget Language: ${state.targetLang}`;
}

function searchLines(query: string) {
  const lower = query.toLowerCase();
  const results = state.lines.filter(l => 
    (l.message || '').toLowerCase().includes(lower) || 
    (l.trans_message || '').toLowerCase().includes(lower) ||
    (l.name || '').toLowerCase().includes(lower) ||
    (l.trans_name || '').toLowerCase().includes(lower)
  ).slice(0, 50); // limit to 50
  
  if (!results.length) return `No lines found for query: "${query}"`;
  return results.map(l => 
    `[Line ${l.line_num}]\nSpeaker: ${l.name || ''}\nOriginal: ${l.message}\nTranslated Speaker: ${l.trans_name || ''}\nTranslated: ${l.trans_message || ''}`
  ).join('\n\n');
}

function getLines(start: number, end: number) {
  const results = state.lines.filter(l => l.line_num >= start && l.line_num <= end);
  if (!results.length) return `No lines found between ${start} and ${end}`;
  return results.map(l => 
    `[Line ${l.line_num}]\nSpeaker: ${l.name || ''}\nOriginal: ${l.message}\nTranslated Speaker: ${l.trans_name || ''}\nTranslated: ${l.trans_message || ''}`
  ).join('\n\n');
}

function applyTranslations(updates: {num: number, trans_message: string, trans_name?: string}[]) {
  try {
    const applied = applyAgentTranslations(updates);
    return `Successfully applied translations to ${applied} lines.`;
  } catch (e: any) {
    return `Error applying translations: ${e.message}`;
  }
}

// ------------------------------------------------------------------
// ReAct Agent Engine
// ------------------------------------------------------------------

const AGENT_SYSTEM_PROMPT = `You are CSTL AI Agent, an expert vibecoding assistant integrated directly into the CSTL Visual Novel Translation Editor.
Your job is to help the user translate the visual novel, answer questions about the script, and make modifications to the translation data when requested.

You have access to the following Tools:
1. getProjectStats(): Returns total lines and translation progress.
2. getLines(start: number, end: number): Returns the original and translated text for a range of line numbers.
3. searchLines(query: string): Searches for a keyword in the original text, translated text, or character names (returns max 50 lines).
4. applyTranslations(updates: array of objects {num: number, trans_message: string, trans_name: string (optional)}): Applies translations or edits directly to the project lines.
5. clearTranslations(line_nums: array of numbers): Deletes/clears the translations for the specified line numbers.
6. undoLastAction(): Undoes the last translation apply or clear action.
7. getGlossary(): Returns the user's defined glossary terms.

TO CALL A TOOL:
Output a markdown JSON block exactly like this:
\`\`\`tool_call
{
  "tool": "getLines",
  "arguments": {
    "start": 100,
    "end": 105
  }
}
\`\`\`

You can only call ONE tool at a time. After you output a tool_call block, stop generating. The system will run the tool and provide the result in the next message.
Do NOT attempt to guess the results of a tool call. Wait for the system's response.
If the user asks you to translate lines, you MUST first fetch the lines using \`getLines\`, read the original text, then use \`applyTranslations\` to save your translations to the project.
Make sure to apply the context and glossary properly when translating.
Respond in Indonesian language unless asked otherwise.`;

export const chatHistory: ChatMessage[] = [];

export async function sendAgentMessage(userMessage: string, onUpdate: (msg: string, role: 'assistant' | 'system') => void): Promise<void> {
  if (chatHistory.length === 0) {
    chatHistory.push({ role: 'system', content: AGENT_SYSTEM_PROMPT });
  }
  
  chatHistory.push({ role: 'user', content: userMessage });
  
  let loopCount = 0;
  const maxLoops = 10;
  
  while (loopCount < maxLoops) {
    loopCount++;
    onUpdate("Agent is thinking...", 'system');
    
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
        
        onUpdate(`Agent is using tool: ${toolName}...`, 'system');
        
        let toolResult = '';
        if (toolName === 'getProjectStats') {
          toolResult = getProjectStats();
        } else if (toolName === 'getLines') {
          toolResult = getLines(args.start, args.end);
        } else if (toolName === 'searchLines') {
          toolResult = searchLines(args.query);
        } else if (toolName === 'applyTranslations') {
          toolResult = applyTranslations(args.updates);
        } else if (toolName === 'clearTranslations') {
          const cleared = clearAgentTranslations(args.line_nums || []);
          toolResult = `Successfully cleared translations for ${cleared} lines.`;
        } else if (toolName === 'undoLastAction') {
          onUndoLastApply();
          toolResult = 'Successfully reverted the last apply/clear action via Undo.';
        } else if (toolName === 'getGlossary') {
          toolResult = state.glossaryText || 'No glossary defined.';
        } else {
          toolResult = `Error: Unknown tool "${toolName}"`;
        }
        
        chatHistory.push({ role: 'user', content: `Tool Result:\n\`\`\`\n${toolResult}\n\`\`\`` });
        // Loop continues
      } catch (e: any) {
        chatHistory.push({ role: 'user', content: `Tool Call Error: Failed to parse or execute tool. ${e.message}` });
      }
    } else {
      // No tool call, conversation turn ended
      onUpdate(responseText, 'assistant');
      break;
    }
  }
}
