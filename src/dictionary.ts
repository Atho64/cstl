import { state } from './state';
import { fetchApiResult } from './auto-translate';

function simpleParseMarkdown(text: string): string {
  if (!text) return '';
  let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.1);padding:2px 4px;border-radius:3px;">$1</code>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/- (.*?)<br>/g, '<li>$1</li>');
  html = html.replace(/<li>.*?<\/li>/g, match => `<ul>${match}</ul>`);
  html = html.replace(/<\/ul><ul>/g, ''); // merge lists
  return `<p>${html}</p>`;
}

let popupTimeout: any = null;
let currentWord = '';
let isPopupOpen = false;

let touchStartTime = 0;

// Initialize dictionary event listeners
export function initDictionary() {
  document.body.addEventListener('mousemove', handleHover);
  document.body.addEventListener('mouseup', handleMouseUp);
  
  document.body.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartTime = Date.now();
    }
  }, { passive: true });
  document.body.addEventListener('touchend', handleMouseUp);

  const closeBtn = document.getElementById('dictPopupClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', closePopup);
  }

  // Close popup if clicking outside
  document.addEventListener('mousedown', (e) => {
    const popup = document.getElementById('dictionaryPopup');
    if (popup && isPopupOpen && !popup.contains(e.target as Node)) {
      closePopup();
    }
  });
}

function handleHover(e: MouseEvent) {
  if (!state.enableDictionary || !e.shiftKey) return;
  if (isPopupOpen) return; // Don't trigger if already open and reading

  clearTimeout(popupTimeout);
  popupTimeout = setTimeout(() => {
    processEventPoint(e.clientX, e.clientY);
  }, 200);
}

function handleMouseUp(e: MouseEvent | TouchEvent) {
  if (!state.enableDictionary) return;
  
  const target = e.target as HTMLElement;
  const isOriginal = target.closest('.original') !== null;
  const isTranslated = target.closest('.translated') !== null;
  const isEditorOriginal = target.id === 'lineOriginalView';
  
  if (!isOriginal && !isTranslated && !isEditorOriginal) return;

  // Extract correct coordinates for Touch vs Mouse events
  let clientX = 0;
  let clientY = 0;
  let isTouch = false;
  if (window.TouchEvent && e instanceof TouchEvent) {
    isTouch = true;
    if (e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    }
  } else {
    clientX = (e as MouseEvent).clientX;
    clientY = (e as MouseEvent).clientY;
  }

  // 1. Check for text selection first
  let selectedText = '';
  if (target instanceof HTMLTextAreaElement) {
    if (target.selectionStart !== target.selectionEnd) {
      selectedText = target.value.substring(target.selectionStart, target.selectionEnd).trim();
    }
  } else {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      const frag = range.cloneContents();
      
      // Remove all <rt> and <rp> (Furigana reading and parentheses) elements from the cloned fragment
      const furiganaTags = frag.querySelectorAll('rt, rp');
      furiganaTags.forEach(tag => tag.remove());
      
      selectedText = frag.textContent?.trim() || sel.toString().trim();
    }
  }

  // If there's a selected text (max 100 chars to avoid translating whole paragraphs accidentally)
  if (selectedText.length > 0 && selectedText.length < 100) {
    const lang = isOriginal || isEditorOriginal ? 'ja-JP' : 'en-US';
    const container = target instanceof HTMLTextAreaElement ? target : target.closest('.original, .translated') as HTMLElement;
    const contextText = container instanceof HTMLTextAreaElement ? container.value : (container.textContent || '');
    
    // Fallback: don't extract word with Segmenter, just use the exact selected text!
    if (selectedText !== currentWord) {
      currentWord = selectedText;
      showPopup(clientX, clientY, selectedText, contextText, isOriginal || isEditorOriginal);
    }
    return;
  }
  
  // 2. If no selection, fallback to point extraction (click)
  // On mobile (touch), only trigger point extraction if it was a long press (> 400ms)
  // to avoid conflicting with short taps that open the line editor.
  if (isTouch && Date.now() - touchStartTime < 400) {
    return;
  }
  
  // Only trigger point extraction if it was a quick click, not a dragged selection that was empty
  if (target instanceof HTMLTextAreaElement) {
    processTextarea(target, clientX, clientY);
  } else {
    processEventPoint(clientX, clientY);
  }
}

function processTextarea(textarea: HTMLTextAreaElement, x: number, y: number) {
  const textContent = textarea.value || '';
  if (!textContent) return;
  
  // Only extract if cursor is just a caret (no selection)
  if (textarea.selectionStart !== textarea.selectionEnd) return;
  
  const offset = textarea.selectionStart;
  const isOriginal = textarea.id === 'lineOriginalView';
  const lang = isOriginal ? 'ja-JP' : 'en-US';
  
  extractAndShowWord(textContent, offset, lang, x, y, isOriginal, textContent);
}

function getTextNodeAt(x: number, y: number): { node: Text, offset: number } | null {
  // @ts-ignore
  if (document.caretPositionFromPoint) {
    // @ts-ignore
    const pos = document.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
      return { node: pos.offsetNode as Text, offset: pos.offset };
    }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      return { node: range.startContainer as Text, offset: range.startOffset };
    }
  }
  return null;
}

function getGlobalOffsetAndText(container: HTMLElement, targetNode: Node, targetOffset: number) {
  let globalOffset = 0;
  let fullText = '';
  let found = false;

  function traverse(currentNode: Node) {
    // Ignore <rt> (furigana reading) tags so they don't pollute the plain text
    if (currentNode.nodeName.toLowerCase() === 'rt') return;
    
    if (currentNode.nodeType === Node.TEXT_NODE) {
      const text = currentNode.textContent || '';
      if (currentNode === targetNode) {
        globalOffset = fullText.length + targetOffset;
        found = true;
      }
      fullText += text;
    } else {
      for (const child of Array.from(currentNode.childNodes)) {
        traverse(child);
      }
    }
  }
  
  traverse(container);
  return { globalOffset: found ? globalOffset : targetOffset, fullText };
}

function processEventPoint(x: number, y: number) {
  const result = getTextNodeAt(x, y);
  if (!result) return;

  const { node, offset } = result;
  
  // Find which container it's in to determine language logic
  const container = node.parentElement?.closest('.original, .translated') as HTMLElement;
  if (!container) return;
  
  const isOriginal = container.classList.contains('original');
  const lang = isOriginal ? 'ja-JP' : 'en-US';
  
  // Use our robust traverser to build clean text (ignoring ruby <rt>) and calculate precise offset
  const { globalOffset, fullText } = getGlobalOffsetAndText(container, node, offset);
  
  extractAndShowWord(fullText, globalOffset, lang, x, y, isOriginal, fullText);
}

function extractAndShowWord(textContent: string, offset: number, lang: string, x: number, y: number, isOriginal: boolean, contextText: string) {
  // @ts-ignore
  if (!Intl.Segmenter) return;
  
  // @ts-ignore
  const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
  const segments = segmenter.segment(textContent);
  
  let selectedSegment = null;
  for (const seg of segments) {
    if (offset >= seg.index && offset < seg.index + seg.segment.length) {
      selectedSegment = seg;
      break;
    }
  }

  if (selectedSegment && selectedSegment.isWordLike) {
    const word = selectedSegment.segment.trim();
    if (word.length > 0 && word !== currentWord) {
      currentWord = word;
      showPopup(x, y, word, contextText, isOriginal);
    }
  }
}

async function showPopup(x: number, y: number, word: string, context: string, isOriginal: boolean) {
  const popup = document.getElementById('dictionaryPopup') as HTMLElement;
  const wordEl = document.getElementById('dictPopupWord') as HTMLElement;
  const contentEl = document.getElementById('dictPopupContent') as HTMLElement;
  
  if (!popup || !wordEl || !contentEl) return;

  wordEl.textContent = word;
  contentEl.innerHTML = '<div class="dict-loading">Memuat penjelasan...</div>';
  
  isPopupOpen = true;
  popup.style.display = 'flex';
  
  // Positioning logic
  const popupWidth = 350;
  let left = x + 15;
  if (left + popupWidth > window.innerWidth) {
    left = window.innerWidth - popupWidth - 10;
  }
  let top = y + 20;
  if (top + 300 > window.innerHeight) {
    top = window.innerHeight - 300;
  }
  
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  try {
    if (state.dictionaryEngine === 'llm') {
      await fetchLLMDictionary(word, context);
    } else {
      await fetchTraditionalDictionary(word, isOriginal);
    }
  } catch (error: any) {
    contentEl.innerHTML = `<div style="color:var(--danger)">Gagal memuat: ${error.message}</div>`;
  }
}

function closePopup() {
  const popup = document.getElementById('dictionaryPopup');
  if (popup) popup.style.display = 'none';
  isPopupOpen = false;
  currentWord = '';
}

async function fetchLLMDictionary(word: string, context: string) {
  const contentEl = document.getElementById('dictPopupContent') as HTMLElement;


  const promptTemplate = state.dictionaryPrompt || 'Jelaskan arti kata "{word}" dalam konteks kalimat "{context}". Berikan bentuk dasar, cara baca (hiragana/romaji), kelas kata, dan terjemahan/penjelasan singkat dalam bahasa Indonesia.';
  const finalPrompt = promptTemplate
    .replace(/{word}/g, word)
    .replace(/{context}/g, context);

  let explanation = await fetchApiResult(finalPrompt);

  contentEl.innerHTML = simpleParseMarkdown(explanation);
}

async function fetchTraditionalDictionary(word: string, isJapanese: boolean) {
  const contentEl = document.getElementById('dictPopupContent') as HTMLElement;
  
  if (isJapanese) {
    // Jisho API with fallback proxies
    const targetUrl = 'https://jisho.org/api/v1/search/words?keyword=' + word;
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      `https://cors-anywhere.herokuapp.com/${targetUrl}`
    ];
    
    let jisho = null;
    let lastError = null;

    for (const proxyUrl of proxies) {
      try {
        const res = await fetch(proxyUrl);
        if (!res.ok) continue;
        jisho = await res.json();
        if (jisho && jisho.data) break;
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    if (!jisho || !jisho.data) {
      throw new Error('Semua proxy Jisho gagal. Silakan gunakan mode AI/LLM atau coba lagi nanti.');
    }
    
    if (jisho.data.length === 0) {
      contentEl.innerHTML = `<div>Kata tidak ditemukan di Jisho.</div>`;
      return;
    }
    
    const entry = jisho.data[0];
    const jp = entry.japanese[0];
    let html = `<div style="font-size: 16px; font-weight: bold; margin-bottom: 6px;">${jp.word || jp.reading || word} ${jp.reading && jp.word ? `<span style="font-size:12px; color:var(--muted)">(${jp.reading})</span>` : ''}</div><ul style="padding-left: 20px; margin: 0; font-size: 13px;">`;
    
    for (let i = 0; i < Math.min(3, entry.senses.length); i++) {
      const sense = entry.senses[i];
      html += `<li style="margin-bottom:4px;">${sense.english_definitions.join(', ')} <span style="color:var(--primary); font-size:11px;">[${sense.parts_of_speech.join(', ')}]</span></li>`;
    }
    html += `</ul>`;
    contentEl.innerHTML = html;
  } else {
    // FreeDictionary API (English)
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) {
      contentEl.innerHTML = `<div>Kata tidak ditemukan di kamus Inggris.</div>`;
      return;
    }
    
    const data = await res.json();
    const entry = data[0];
    let html = `<div style="font-size: 16px; font-weight: bold; margin-bottom: 6px;">${entry.word} ${entry.phonetic ? `<span style="font-size:12px; color:var(--muted)">(${entry.phonetic})</span>` : ''}</div><ul style="padding-left: 20px; margin: 0; font-size: 13px;">`;
    
    const meanings = entry.meanings[0];
    if (meanings) {
      for (let i = 0; i < Math.min(3, meanings.definitions.length); i++) {
        html += `<li style="margin-bottom:4px;">${meanings.definitions[i].definition}</li>`;
      }
    }
    html += `</ul>`;
    contentEl.innerHTML = html;
  }
}
