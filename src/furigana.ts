/// <reference types="vite/client" />
import Kuroshiro from 'kuroshiro';
// @ts-ignore
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji';

let kuroshiroInstance: Kuroshiro | null = null;
let isInitializing = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize Kuroshiro with Kuromoji Analyzer
 */
export async function initFurigana(): Promise<void> {
  if (kuroshiroInstance) return;
  if (isInitializing && initializationPromise) {
    return initializationPromise;
  }

  isInitializing = true;
  initializationPromise = (async () => {
    try {
      const kuroshiro = new Kuroshiro();
      // Use import.meta.env.BASE_URL for compatibility with GitHub Pages (e.g. /cstl-cloud/)
      const dictPath = import.meta.env.BASE_URL + 'dict';
      
      await kuroshiro.init(new KuromojiAnalyzer({ dictPath }));
      kuroshiroInstance = kuroshiro;
      console.log('[CSTL] Furigana engine initialized successfully');
    } catch (error) {
      console.error('[CSTL] Failed to initialize Furigana engine:', error);
      throw error;
    } finally {
      isInitializing = false;
    }
  })();

  return initializationPromise;
}

/**
 * Convert text to ruby HTML
 */
export async function convertToFurigana(text: string): Promise<string> {
  if (!text) return text;
  
  if (!kuroshiroInstance) {
    try {
      await initFurigana();
    } catch (e) {
      return text; // Fallback to raw text if initialization fails
    }
  }

  try {
    const result = await kuroshiroInstance!.convert(text, {
      mode: 'furigana',
      to: 'hiragana'
    });
    return result;
  } catch (error) {
    console.error('[CSTL] Furigana conversion error:', error);
    return text;
  }
}
