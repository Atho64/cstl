// @module vndb-anilist.ts — VNDB and AniList character name extractors

import { state, ui } from './state';
import { addNameGlossaryEntry, mergeGlossaryEntries, genderToDescription } from './glossary';
import { containsJapanese } from './string-utils';
import { flashHint } from './render';
import { queueAutoSave } from './project';

export function extractVndbId(input: string): string | null {
  const match = String(input || '').trim().match(/(?:^|\/)(v\d+)(?:[/?#].*)?$/i);
  return match ? match[1].toLowerCase() : null;
}

export function collectVndbGlossaryEntries(characters: any[]): Map<string, any> {
  const entries = new Map<string, any>();
  function processPair(jpFull: string, enFull: string, desc: string) {
    if (!jpFull || !enFull || !containsJapanese(jpFull)) return;
    const jpClean = jpFull.trim();
    const enClean = enFull.trim();
    if (!jpClean || !enClean) return;
    const jpNoSpace = jpClean.replace(/\s+/g, '');
    if (jpNoSpace && jpNoSpace !== enClean) addNameGlossaryEntry(entries, jpNoSpace, enClean, 'character', desc);
    const jpParts = jpClean.split(/\s+/).filter(Boolean);
    const enParts = enClean.split(/\s+/).filter(Boolean);
    if (jpParts.length === 2 && enParts.length === 2) {
      if (jpParts[0] !== enParts[0]) addNameGlossaryEntry(entries, jpParts[0], enParts[0], 'character', 'family name');
      if (jpParts[1] !== enParts[1]) addNameGlossaryEntry(entries, jpParts[1], enParts[1], 'character', desc);
    }
  }
  for (const ch of characters) {
    const target = String(ch.name || '').trim();
    if (!target) continue;
    const desc = genderToDescription(ch.gender);
    processPair(ch.original, target, desc);
    if (Array.isArray(ch.aliases) && ch.aliases.length > 0) {
      const jpAliases: string[] = [];
      const enAliases: string[] = [];
      for (const a of ch.aliases) {
        if (containsJapanese(a)) jpAliases.push(String(a));
        else enAliases.push(String(a));
      }
      if (jpAliases.length > 0 && jpAliases.length === enAliases.length) {
        for (let i = 0; i < jpAliases.length; i++) processPair(jpAliases[i], enAliases[i], desc);
      } else {
        for (const a of jpAliases) {
          const jpNoSpace = String(a).replace(/\s+/g, '');
          if (jpNoSpace && jpNoSpace !== target) addNameGlossaryEntry(entries, jpNoSpace, target, 'character', desc);
        }
      }
    }
  }
  return entries;
}

export async function fetchVndbCharacters(vnId: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  let more = true;
  while (more) {
    const res = await fetch('https://api.vndb.org/kana/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: ['vn', '=', ['id', '=', vnId]], fields: 'id,name,original,aliases,gender', sort: 'id', results: 100, page }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`VNDB API error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }
    const data = await res.json();
    all.push(...(Array.isArray(data.results) ? data.results : []));
    more = !!data.more;
    page++;
    if (page > 20) throw new Error('VNDB mengembalikan terlalu banyak halaman.');
  }
  return all;
}

export async function onImportVndbNames(): Promise<void> {
  const vnId = extractVndbId((ui.vndbInput as HTMLInputElement).value);
  if (!vnId) { (ui.vndbStatus as HTMLElement).textContent = 'Masukkan VNDB ID/URL yang valid, contoh: v17.'; return; }
  (ui.btnImportVndbNames as HTMLButtonElement).disabled = true;
  (ui.vndbStatus as HTMLElement).textContent = `Mengambil nama karakter dari VNDB ${vnId}...`;
  try {
    const characters = await fetchVndbCharacters(vnId);
    const imported = collectVndbGlossaryEntries(characters);
    if (!imported.size) { (ui.vndbStatus as HTMLElement).textContent = 'Tidak ada nama Jepang yang bisa diimpor dari VNDB.'; return; }
    const { added, updated } = mergeGlossaryEntries(imported);
    (ui.vndbStatus as HTMLElement).textContent = `Import selesai: ${added} nama baru, ${updated} diperbarui dari ${characters.length} karakter.`;
  } catch (err: any) {
    (ui.vndbStatus as HTMLElement).textContent = `Gagal import VNDB: ${err.message}`;
  } finally {
    (ui.btnImportVndbNames as HTMLButtonElement).disabled = false;
  }
}

export function extractAnilistId(input: string): number | null {
  const trimmed = String(input || '').trim();
  const urlMatch = trimmed.match(/anilist\.co\/manga\/(\d+)(?:\/|$)/i);
  if (urlMatch) return Number(urlMatch[1]);
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}

export function collectAnilistGlossaryEntries(media: any): Map<string, any> {
  const entries = new Map<string, any>();
  const edges = media?.characters?.edges || [];
  for (const edge of edges) {
    const name = edge?.node?.name || {};
    const target = String(name.full || '').trim();
    if (!target) continue;
    const desc = genderToDescription(edge?.node?.gender);
    const sources = [name.native, ...(Array.isArray(name.alternative) ? name.alternative : [])]
      .map(v => String(v || '').trim())
      .filter(v => v && v !== target && containsJapanese(v));
    for (const source of sources) addNameGlossaryEntry(entries, source, target, 'character', desc);
  }
  return entries;
}

export async function fetchAnilistMediaCharacters(input: string): Promise<any> {
  const id = extractAnilistId(input);
  if (!id) throw new Error('Masukkan link lengkap AniList manga/novel atau ID angka.');
  const allEdges: any[] = [];
  let mediaInfo: any = null;
  let page = 1;
  let hasNextPage = true;
  const query = `
    query ($id: Int, $page: Int) {
      Media(id: $id, type: MANGA) {
        id title { romaji english native } format
        characters(page: $page, perPage: 50, sort: [ROLE, ID]) {
          pageInfo { hasNextPage }
          edges { node { gender name { full native alternative } } }
        }
      }
    }
  `;
  while (hasNextPage) {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { id, page } }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`AniList API error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message || 'AniList query gagal.');
    const media = json.data?.Media;
    if (!media) throw new Error('Judul tidak ditemukan di AniList.');
    if (!mediaInfo) mediaInfo = media;
    allEdges.push(...(media.characters?.edges || []));
    hasNextPage = !!media.characters?.pageInfo?.hasNextPage;
    page++;
    if (page > 20) throw new Error('AniList mengembalikan terlalu banyak halaman.');
  }
  mediaInfo.characters = { edges: allEdges };
  return mediaInfo;
}

export async function onImportAnilistNames(): Promise<void> {
  const input = (ui.anilistInput as HTMLInputElement).value.trim();
  if (!input) { (ui.anilistStatus as HTMLElement).textContent = 'Masukkan link lengkap AniList manga/novel atau ID angka.'; return; }
  (ui.btnImportAnilistNames as HTMLButtonElement).disabled = true;
  (ui.anilistStatus as HTMLElement).textContent = 'Mengambil nama karakter dari AniList...';
  try {
    const media = await fetchAnilistMediaCharacters(input);
    const imported = collectAnilistGlossaryEntries(media);
    const title = media.title?.romaji || media.title?.english || media.title?.native || `AniList ${media.id}`;
    if (!imported.size) { (ui.anilistStatus as HTMLElement).textContent = `Tidak ada nama Jepang yang bisa diimpor dari ${title}.`; return; }
    const { added, updated } = mergeGlossaryEntries(imported);
    (ui.anilistStatus as HTMLElement).textContent = `Import selesai dari ${title}: ${added} nama baru, ${updated} diperbarui.`;
  } catch (err: any) {
    (ui.anilistStatus as HTMLElement).textContent = `Gagal import AniList: ${err.message}`;
  } finally {
    (ui.btnImportAnilistNames as HTMLButtonElement).disabled = false;
  }
}
