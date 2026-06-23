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
      // Use jsDelivr CDN to avoid GitHub Pages gzip double-decompression issues and save bandwidth
      const dictPath = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict';
      
      await kuroshiro.init(new KuromojiAnalyzer({ dictPath }));
      kuroshiroInstance = kuroshiro;
      console.log('[CSTL] Furigana engine initialized successfully');
    } catch (error) {
      console.error('[CSTL] Failed to initialize Furigana engine:', error);
      alert('Gagal memuat kamus Furigana. (Periksa koneksi atau console browser)');
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
      return text;
    }
  }

  try {
    const { state } = await import('./state');
    const fType = state.furiganaType || 'hiragana';
    
    let to = 'hiragana';
    if (fType === 'katakana') to = 'katakana';
    if (fType === 'romaji') to = 'romaji';
    
    const result = await kuroshiroInstance!.convert(text, {
      mode: 'furigana',
      to: to as any
    });
    return result;
  } catch (error: any) {
    console.error('[CSTL] Furigana conversion error:', error);
    alert('Furigana error: ' + (error?.message || error));
    return text;
  }
}
