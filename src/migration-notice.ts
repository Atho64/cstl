// @module migration-notice.ts — "Pindah ke CopasTool" notice untuk build web lama.
//
// Versi web (cstl-main, GitHub Pages) berhenti di vM15 dan tidak lagi
// dikembangkan. Lanjutan pengembangan ada di CopasTool — aplikasi native
// Tauri untuk Windows dan Android. Modul ini menampilkan pemberitahuan di
// dashboard versi web supaya pengguna tahu dan bisa pindah:
//   1. Banner di atas dashboard — bisa ditutup, dan penutupan itu diingat di
//      localStorage supaya tidak muncul lagi di kunjungan berikutnya.
//   2. Toast pengingat (notify.ts) setiap app dibuka sampai notice dimatikan.
//   3. Item menu "Pindah ke CopasTool" di dropdown Tools workspace, supaya
//      jalurnya tetap ada walau banner sudah ditutup.
//
// Modul ini hanya pemberitahuan — tidak memblokir atau mengubah perilaku
// aplikasi mana pun.

/** Halaman rilis aplikasi penerus (CopasTool). Dipakai semua tombol di sini. */
export const NEW_APP_URL = 'https://github.com/Atho64/copastool/releases/latest';

/** Repo aplikasi baru (untuk tombol sekunder). */
export const NEW_APP_REPO_URL = 'https://github.com/Atho64/copastool';

/**
 * Penutupan banner diingat per revisi notice. Naikkan angka akhirannya kalau
 * isi notice diperbarui supaya pengguna yang sudah menutup versi lama tetap
 * melihat pemberitahuan baru.
 */
const DISMISS_KEY = 'cstl_migration_notice_dismissed_v1';

const WARN_ICON = '<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const DOWNLOAD_ICON = '<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const EXTERNAL_ICON = '<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

import { notify } from './notify';

function isDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

function rememberDismissed(): void {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage penuh / private mode */ }
}

/** Banner tidak dirender ulang kalau markup-nya sudah ada (mis. HMR saat dev). */
function findBanner(): HTMLElement | null {
  return document.getElementById('migrationBanner');
}

function renderBanner(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'migrationBanner';
  el.className = 'migration-banner';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Pemberitahuan versi baru');
  el.innerHTML = `
    <div class="migration-inner">
      <span class="migration-icon" aria-hidden="true">${WARN_ICON}</span>
      <div class="migration-body">
        <div class="migration-title">
          CSTL versi web sudah tidak dikembangkan lagi
        </div>
        <div class="migration-text">
          Lanjutannya ada di <strong>CopasTool</strong> — aplikasi native Windows &amp; Android.
          Backup proyek <code>.cstl</code> kamu tetap bisa dibuka di versi baru.
        </div>
        <div class="migration-actions">
          <a class="btn btn-primary btn-sm migration-cta" href="${NEW_APP_URL}" target="_blank" rel="noopener noreferrer">
            ${DOWNLOAD_ICON}<span>Unduh CopasTool</span>
          </a>
          <a class="btn btn-outline btn-sm migration-secondary" href="${NEW_APP_REPO_URL}" target="_blank" rel="noopener noreferrer">
            ${EXTERNAL_ICON}<span>Repo baru</span>
          </a>
          <button type="button" class="btn btn-outline btn-sm migration-dismiss" title="Tutup pemberitahuan ini">
            <span>Nanti</span>
          </button>
        </div>
      </div>
      <button type="button" class="migration-close" aria-label="Tutup pemberitahuan" title="Tutup">&times;</button>
    </div>`;
  return el;
}

/** Sisipkan banner di atas dashboard (sebelum hero) dan pasang handler-nya. */
function mountBanner(): void {
  if (findBanner() || isDismissed()) return;
  const banner = renderBanner();
  const host = document.getElementById('dashboardView');
  if (host) host.insertBefore(banner, host.firstChild);
  else document.body.insertBefore(banner, document.body.firstChild);

  const dismiss = () => { rememberDismissed(); banner.remove(); };
  banner.querySelector('.migration-dismiss')?.addEventListener('click', dismiss);
  banner.querySelector('.migration-close')?.addEventListener('click', dismiss);
}

/**
 * Sisipkan item menu "Pindah ke CopasTool" di dropdown Tools workspace, di
 * atas "Daftar File". Menu ini tidak ikut ditutup, jadi jalur migrasi tetap
 * ada meski banner sudah ditutup.
 */
function mountToolsMenuItem(): void {
  const menu = document.getElementById('dropdownToolsMenu');
  if (!menu || menu.querySelector('.migration-menu-item')) return;
  const item = document.createElement('a');
  item.className = 'dropdown-item migration-menu-item';
  item.href = NEW_APP_URL;
  item.target = '_blank';
  item.rel = 'noopener noreferrer';
  item.setAttribute('role', 'menuitem');
  item.innerHTML = `${EXTERNAL_ICON}<span>Pindah ke CopasTool (baru)</span>`;
  menu.insertBefore(item, menu.firstChild);
}

/**
 * Panggil sekali saat bootstrap. Banner + menu Tools dipasang segera; toast
 * pengingat baru muncul kalau banner sudah pernah ditutup (supaya pengguna
 * yang menolak banner tetap diingatkan lewat toast, bukan dua-duanya sekaligus).
 */
export function initMigrationNotice(): void {
  mountBanner();
  mountToolsMenuItem();
  if (isDismissed()) {
    // Import statis: dynamic import saat bootstrap bisa kalah race dengan
    // inisialisasi PWA/service worker dan gagal diam-diam.
    notify('Versi web ini sudah tidak dikembangkan — CopasTool (Windows & Android) adalah versi terbaru. Backup .cstl tetap bisa dibuka di versi baru.', { kind: 'info', ms: 5200 });
  }
}
