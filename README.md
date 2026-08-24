# CSTL — Copas Tool

<div align="center">

  [![Live](https://img.shields.io/badge/Live-atho64.github.io%2Fcstl-blue?style=for-the-badge)](https://atho64.github.io/cstl/)
  ![Version](https://img.shields.io/badge/Version-M15-purple?style=for-the-badge)

</div>

Tool bantu terjemahan visual novel yang jalan di browser. Dibuat karena capek bolak-balik copy-paste manual antara file script dan AI. Semua workflow dari impor, terjemah pakai AI, kelola nama karakter, sampai ekspor bisa dilakukan di satu tempat.

---

## Fitur

### Impor
- **File / Folder** — Impor file `.json` atau `.epub` satu-satu atau sekalian satu folder
- **ZIP** — Impor banyak file sekaligus dari arsip `.zip`
- **TXT LucaSystem** — Impor script dari game berbasis LucaSystem (format `.txt` khusus), bisa file tunggal maupun folder
- **Parser Custom (JS/Python)** — Buat parser sendiri untuk format game apa pun, dengan round-trip ekspor. Lihat detail di bawah.
- **File / Folder Terjemahan** — Merge hasil terjemahan ke proyek yang sudah ada

### Parser Custom (JavaScript / Python)
Format game tidak didukung bawaan? Tulis parser sendiri lewat menu **Impor → Format File Lainnya → Kelola Parser Custom…**. Parser tersimpan global di browser dan bisa dipakai lintas proyek; satu proyek terkunci ke satu parser.

Script parser jalan sandbox di Web Worker (JavaScript) atau pyodide (Python — unduhan pertama ~10MB dari CDN, butuh internet sekali; setelah itu ikut cache browser). Ada tombol **Uji Parser** untuk mencoba `parse()` ke file lokal langsung dari editor.

Definisi parser bisa diekspor/impor sebagai file JSON (**Ekspor Semua Parser**, tombol **Ekspor** per parser, atau **Impor Parser…**) — dan otomatis ikut dalam backup proyek, jadi restore backup di browser lain tetap bisa round-trip. Impor tersedia lewat menu khusus atau **Impor Folder Parser Custom** untuk memproses satu folder sekaligus. Catatan: impor via **ZIP** belum dirouting ke parser custom — gunakan File/Folder.

**`parse(ctx)` — impor.** `ctx = { fileName, text, bytes, startLineNum }`. Return array `[{ name?, message, raw? }]` — `message` wajib; `raw` (opsional) adalah potongan baris asli yang disimpan CSTL untuk dipatch saat ekspor.

```js
// JavaScript
async function parse(ctx) {
  const rows = [];
  for (const raw of ctx.text.split(/\r?\n/)) {
    const m = raw.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);  // "Nama: dialog"
    if (m) rows.push({ name: m[1], message: m[2], raw });
    else if (raw.trim()) rows.push({ message: raw, raw });
  }
  return rows;
}
```

```python
# Python
import re
def parse(ctx):  # ctx = {"fileName", "text", "bytes", "startLineNum"}
    rows = []
    for raw in ctx["text"].splitlines():
        m = re.match(r"^([A-Za-z0-9_]+)\s*:\s*(.+)$", raw)
        if m: rows.append({"name": m.group(1), "message": m.group(2), "raw": raw})
        elif raw.strip(): rows.append({"message": raw, "raw": raw})
    return rows
```

**`serialize(ctx)` — ekspor round-trip (opsional).** `ctx = { fileName, text, bytes, lines }` berisi file asli plus baris proyek (`name, message, trans_name, trans_message, is_translated, raw`). Return string (atau `bytes`/`Uint8Array` untuk format biner). Kalau parser tidak punya `serialize()`, ekspor jatuh ke JSON generik — dan hasil JSON tetap bisa di-merge balik lewat **Impor TL File**.

Impor bisa lewat menu khusus (**Impor Parser Custom**) atau otomatis: file yang ekstensinya cocok parser aktif dialihkan dari jalur impor biasa (termasuk Impor Folder). File asli tiap proyek disimpan di sidecar OPFS supaya ekspor bisa mem-patch teks asli, bukan membangun ulang dari nol.

#### Membuat parser dengan bantuan AI eksternal

Parser custom cukup sederhana untuk ditulis oleh AI chat (Claude, ChatGPT, dll) kalau diberi konteks yang tepat. Checklist yang perlu disertakan saat minta bantuan:

1. **Link/dokumentasi ini** — kontrak `parse(ctx)`/`serialize(ctx)` ada di atas.
2. **Contoh file asli** — paling menentukan. Untuk file teks langsung attach; untuk file biner, AI dengan fitur eksekusi kode bisa hexdump & analisis sendiri strukturnya (header, tabel offset, encoding), jadi upload 2–3 file contoh saja.
3. **Sandbox-nya** — beri tahu batasan runtime:
   - JavaScript: Web Worker polos, **tanpa import/library eksternal**, tanpa DOM; satu fungsi `parse(ctx)` + opsional `serialize(ctx)`; timeout 20 detik.
   - Python: pyodide (stdlib tersedia, termasuk `re`/`struct`/`textwrap`); timeout 30 detik.
4. Minta AI **menjelaskan asumsi strukturnya sebelum menulis kode**, lalu uji hasilnya dengan tombol **Uji Parser** ke file asli dan laporkan kembali error/pratinjau yang salah — biasanya 1–3 iterasi.

Catatan: file terenkripsi/kompresi (entropi tinggi, tidak ada string yang terbaca) tidak bisa diparse langsung — butuh reverse engineering algoritma dekripsinya dulu.

### Terjemahan AI
Alur kerjanya sederhana: pilih baris → copy → tempel ke AI → paste hasilnya → terapkan. CSTL yang urus parsing dan mapping ke baris yang benar.

- Copy teks yang dipilih ke format siap pakai untuk ChatGPT/Gemini/dll
- Paste hasil terjemahan dan terapkan otomatis
- **AI Check** — Copy terjemahan yang sudah ada ke AI untuk dicek ulang, lalu terapkan koreksinya
- Prompt terjemahan dan AI check bisa dikustomisasi sendiri
- Pilihan format output AI (numbered list, XML, dll.)

### API Global (AI)
Hubungkan aplikasi ke AI tanpa perlu copy-paste manual. Terjemahan, ekstrak glosarium, AI check, dan AI Agent berjalan otomatis dari dalam aplikasi.

- Dukung **OpenAI Compatible** (GPT, Claude via OpenRouter, DeepSeek, Local LLM) dan **Gemini API** (Google AI Studio)
- Ambil daftar model langsung dari API dengan tombol fetch
- **Thinking / Reasoning Mode** — Kontrol mode berpikir model untuk menghemat token atau meningkatkan akurasi:
  - *Matikan* — menonaktifkan reasoning bila provider yang dipilih mendukungnya
  - *Nyalakan* — kebalikannya, masing-masing provider pakai parameternya sendiri
- **Filter thinking output** — Blok `<think>...</think>` dari model seperti Gemma 4 atau QwQ dihapus otomatis sebelum terjemahan diterapkan, termasuk bagian `thought: true` dari respons Gemini API
- **Parameter generasi global** — Atur max output tokens, seed, frequency penalty, presence penalty, dan reasoning effort (minimal sampai extra-high) dari satu tempat. Konfigurasi ini dipakai konsisten oleh Auto Translate dan AI Agent untuk OpenAI-compatible, Anthropic, serta Gemini.
- **Gemma 4 via Gemini API** — Model `gemma-4-31b-it` dan `gemma-4-26b-a4b-it` dikenali otomatis; mode thinking off dikirim sebagai `thinkingLevel: "minimal"` sesuai API Gemma 4.
- Limit RPM dengan delay otomatis antar request

### AI Agent
Chat langsung dengan AI yang punya akses ke data proyek. Bisa tanya, analisis, dan modifikasi terjemahan lewat percakapan.

**Tool yang tersedia:**

| Tool | Fungsi |
|------|--------|
| `getProjectStats()` | Ringkasan progress, jumlah baris, daftar file |
| `getLines(start, end)` | Ambil teks asli + terjemahan untuk rentang baris tertentu |
| `getContext(line_num, radius)` | Lihat baris sekitar sebuah baris target (konteks atas-bawah) |
| `searchLines(query)` | Cari kata kunci di teks asli, terjemahan, atau nama karakter |
| `getCharacterNames()` | Daftar semua nama karakter + deteksi inkonsistensi otomatis |
| `analyzeQuality(limit)` | Cek baris belum diterjemahkan, terjemahan terlalu pendek, nama tidak konsisten |
| `getProgressReport()` | Laporan progress terjemahan per file dengan progress bar |
| `applyTranslations(updates)` | Terapkan terjemahan langsung ke proyek |
| `editLine(line_num, fields)` | Edit satu baris (semua field: message, name, trans_message, dll) |
| `editLines(updates)` | Edit beberapa baris sekaligus |
| `clearTranslations(line_nums)` | Hapus terjemahan untuk baris tertentu |
| `undoLastAction()` | Batalkan aksi terakhir |
| `redoLastAction()` | Kembalikan aksi yang dibatalkan |
| `getGlossary()` | Ambil daftar glosarium yang didefinisikan pengguna |
| `editPrompt(prompt_type, new_prompt)` | Edit prompt terjemahan/glosarium/AI check/agent |
| `editGlossary(new_glossary)` | Edit teks glosarium |
| `listSettings()` | Tampilkan daftar semua setting yang bisa diubah |
| `toggleSetting(setting_name, value)` | Ubah/toggle setting aplikasi |
| `getMemory(category?)` | Ambil memori agent (optional filter category) |
| `listMemory()` | Tampilkan semua memori agent |
| `saveMemory(key, value, category, scope?)` | Simpan/update memori (global/project) |
| `deleteMemory(key)` | Hapus memori by key |

### Glosarium
Kelola nama karakter, tempat, dan istilah khusus supaya terjemahan konsisten.

- Editor glosarium built-in
- Copy seleksi teks ke AI untuk ekstrak terminologi otomatis
- Import nama dari **VNDB** (pakai ID VN) atau **AniList** (pakai ID media)
- Ekstrak nama dari anotasi ruby di file EPUB
- Import/export glosarium ke file teks
- Preview glosarium aktif langsung di workspace

### Proofread & Pencarian
- Cari teks di semua baris — teks asli maupun terjemahan
- Support regex, case-sensitive, exact match
- Filter scope pencarian (semua baris, hanya yang dipilih, dll.)
- Replace All

### Editor Baris
Klik baris manapun untuk buka editor individual. Di sini bisa edit nama karakter, teks asli, terjemahan, dan tandai status terjemahan. Untuk proyek LucaSystem, referensi teks EN/ZH ditampilkan berdampingan.

### Seleksi
- Pilih semua, pilih range (baris X–Y), atau klik manual
- Shortcut keyboard untuk navigasi batch — bisa dikustomisasi di Setting
- Undo untuk batalkan penerapan terjemahan terakhir
- Progress bar real-time

### Pengaturan
- Bahasa sumber & target
- Jumlah baris per batch (terjemahan, glosarium, AI check)
- Jumlah baris konteks yang ikut di-copy ke AI
- Regex filter kustom
- Konfigurasi LucaSystem: profil game, nama MC, bahasa ekspor
- Tag HTML untuk parsing EPUB

### Penyimpanan
Semua proyek disimpan langsung di browser pakai **OPFS** (Origin Private File System) — tidak ada server, tidak ada akun. Proyek bisa di-backup dan dipulihkan lewat file `.cstl`. Di desktop Chrome/Edge ada juga **Backup ke Folder** yang menulis backup langsung ke folder lokal pilihan (bisa disinkronkan ke cloud — lihat [di bawah](#backup-ke-folder-desktop)).

Data biner besar (file mentah LucaSystem) disimpan di file OPFS terpisah supaya auto-save tetap ringan. Dashboard hanya memuat metadata proyek, bukan seluruh isi data — jadi tetap cepat meski proyek sudah banyak.

#### Backup ke Folder (Desktop)

> Hanya tersedia di **Chrome / Edge / Brave / Opera desktop**. Di HP atau Firefox/Safari tombolnya otomatis disembunyikan — pakai **Backup Semua ZIP** sebagai gantinya.

CSTL bisa menulis file backup **langsung ke satu folder di komputer kamu** yang kamu pilih sendiri — tanpa download, tanpa upload, tanpa login akun apa pun. Ini pakai izin bawaan browser (*File System Access API*): kamu memberi CSTL akses ke **satu folder itu saja**, bukan seluruh komputer, dan CSTL tidak pernah tahu apa yang terjadi pada folder itu selanjutnya.

**Cara pakai:**

1. Klik **Backup ke Folder** di dashboard → muncul dialog pemilih folder bawaan Windows → pilih foldernya (misal `D:\CSTL Backups`).
2. Semua proyek ditulis ke folder itu sebagai file `nama_proyek_backup.cstl` — isinya sama persis dengan backup download (termasuk data mentah Luca dan file EPUB asli). Klik tombol yang sama lain kali untuk menimpa dengan versi terbaru.
3. Klik **Pulihkan dari Folder** untuk melihat daftar file `.cstl` di folder itu beserta ukuran dan tanggalnya, lalu pulihkan yang kamu mau. Hasil pemulihan selalu jadi proyek baru — proyek yang sekarang tidak tertimpa.

**Soal izin "Allow":** selama browser masih jalan, izin diingat dan backup berjalan tanpa popup. Setelah browser ditutup dan dibuka lagi, klik backup pertama memunculkan satu popup kecil konfirmasi — pilih **Allow on every visit** supaya tidak ditanya lagi selamanya.

**Sinkron ke cloud (opsional):** folder itu folder biasa, jadi bisa diarahkan ke folder milik aplikasi sinkron supaya backup naik ke cloud otomatis:

- **Google Drive for Desktop** → saat memilih folder, arahkan ke folder di dalam `Drive saya`. File yang ditulis CSTL otomatis ikut naik ke Google Drive (dan bisa diakses dari HP).
- **rclone** (power user) → `rclone sync D:\CSTLBackups drive:CSTL` dijadwalkan lewat Task Scheduler. Bekerja juga untuk Dropbox, OneDrive, S3, dll.
- Dropbox / OneDrive / Syncthing juga sama saja — semua yang masuk ke folder itu ikut tersinkron.

Intinya: **CSTL cuma menulis file ke folder; program lain yang meng-upload.** Jadi tidak ada login Google, tidak ada setup Google Console, dan ganti layanan cloud tidak perlu mengubah apa-apa di CSTL.

**Catatan:** backup dengan nama sama menimpa file lama di folder. Kalau kamu pakai Drive/rclone, versi lama biasanya masih tersimpan di riwayat versi layanan cloud masing-masing.

---

## Tutorial

### 1. Mulai Proyek Baru

Buka [atho64.github.io/cstl](https://atho64.github.io/cstl/), klik **Buat Proyek Baru**, isi nama proyek dan pilih tipe file yang akan diimpor (JSON, EPUB, atau LucaSystem). Setelah proyek dibuat, klik **Buka** untuk masuk ke workspace.

### 2. Impor Script

Di dalam workspace, klik tombol **Impor** di toolbar atas. Pilih file atau folder yang ingin diimpor. Semua baris akan langsung muncul di tabel. Kalau file sudah pernah diimpor sebelumnya, duplikat akan diabaikan otomatis.

### 3. Terjemahan Manual (Copy-Paste)

Ini alur dasar tanpa API:

1. **Pilih baris** — klik baris satu-satu, atau pakai "Pilih Range" untuk pilih banyak sekaligus
2. **Copy ke AI** — klik tombol **Copy Terjemahan**, lalu paste ke ChatGPT / Gemini / AI apapun
3. **Paste hasil** — setelah AI selesai, copy seluruh responnya, paste ke kotak **Paste Hasil AI** di CSTL
4. **Terapkan** — klik **Terapkan**, CSTL parsing otomatis dan isi terjemahan ke baris yang sesuai

Kalau hasilnya tidak sesuai, klik **Undo** untuk batalkan.

### 4. Auto Translate (Langsung via API)

Kalau tidak mau copy-paste manual, hubungkan ke API:

1. Klik ikon 🤖 di pojok kanan bawah
2. Pilih **Tipe API** (OpenAI Compatible atau Gemini)
3. Isi **API Key** dan **Model** (bisa klik tombol ↻ untuk fetch daftar model otomatis)
4. Atur **RPM** sesuai limit akun, lalu klik **Simpan API**
5. Pilih baris yang ingin diterjemahkan, klik **Jalankan Auto Translate**

Untuk model thinking yang mengeluarkan blok `<think>...</think>`, aktifkan **Filter `<think>...</think>`** di pengaturan API supaya output terjemahan bersih dari teks reasoning.

### 5. Glosarium

Sebelum mulai terjemahan besar, disarankan isi glosarium dulu:

1. Buka tab **Glosarium** di workspace
2. Ketik nama karakter, tempat, atau istilah khusus di editor
3. Atau klik **Import VNDB/AniList** — masukkan ID VN/media, nama karakter otomatis terisi
4. Glosarium aktif akan otomatis ikut di-copy saat kamu copy teks ke AI

### 6. AI Agent

AI Agent bisa bantu langsung tanpa perlu manual:

1. Klik ikon 💬 di pojok kanan bawah untuk buka panel chat
2. Contoh yang bisa diminta:
   - *"Terjemahkan baris 1 sampai 10"* — agent ambil teksnya, terjemahkan, dan terapkan sendiri
   - *"Cek konsistensi nama karakter"* — agent analisis dan laporkan inkonsistensi
   - *"Baris mana yang belum diterjemahkan?"* — agent beri ringkasan progress
   - *"Cari baris yang ada kata 'sayonara'"* — agent search dan tampilkan hasilnya
3. Semua perubahan yang dilakukan agent bisa di-undo dengan berkata *"undo"* atau klik tombol Undo

### 7. AI Check

Setelah selesai menerjemahkan, bisa minta AI untuk cek ulang kualitasnya:

1. Pilih baris yang sudah diterjemahkan
2. Klik **Copy AI Check** — teks asli + terjemahan di-copy ke format khusus
3. Paste ke AI, minta koreksi
4. Copy hasilnya, paste ke kotak **Paste AI Check**, klik **Terapkan Koreksi**

### 8. Proofread & Replace

Gunakan tab **Proofread** untuk cari dan ganti teks secara massal:

- Aktifkan **Regex** kalau perlu pola matching yang lebih kompleks
- Centang **Case Sensitive** atau **Exact Match** sesuai kebutuhan
- Klik **Replace All** untuk ganti semua sekaligus

### 9. Ekspor

Kalau sudah selesai, klik **Ekspor** di toolbar. File hasil terjemahan akan didownload dalam format aslinya (`.json`, `.epub`, atau `.txt` LucaSystem).

Untuk backup proyek beserta semua datanya, klik **Backup** di halaman dashboard — file `.cstl` akan tersimpan dan bisa dipulihkan kapanpun lewat tombol **Pulihkan**.


## Format yang Didukung

| Format | Impor | Ekspor | Catatan |
|--------|:-----:|:------:|---------|
| `.json` | ✅ | ✅ | |
| `.epub` | ✅ | ✅ | |
| `.zip` | ✅ | — | Berisi banyak file |
| `.cstl` | ✅ | ✅ | Backup proyek |
| LucaSystem `.txt` | ✅ | ✅ | Format script khusus LucaSystem |

---

## Shortcut Keyboard

| Shortcut | Fungsi |
|----------|--------|
| `Alt + ↑` | Batch seleksi sebelumnya |
| `Alt + ↓` | Batch seleksi berikutnya |

Shortcut bisa diubah di **Setting → Shortcut Keyboard**.

---

## Stack

**TypeScript** + **Vite** — dicompile ke vanilla JS, tidak ada runtime framework. Dependencies:
- **JSZip** — parsing file `.zip`
- **Kuroshiro + Kuromoji** — konversi furigana (hiragana/romaji) untuk teks Jepang
- **Pako** — kompresi/dekompresi data (dipakai untuk format LucaSystem)
- **OPFS API** — penyimpanan lokal browser
- **vite-plugin-pwa** — PWA support (install ke homescreen, offline cache)

---

## Browser

Butuh browser yang support OPFS (`navigator.storage.getDirectory()`). Chrome/Edge 102+ dan Firefox 111+ sudah pasti jalan. Safari agak terbatas.

---

## Kredit

Original dibuat oleh [Atho64](https://github.com/atho64), di-fork oleh [LuKazuu](https://github.com/LuKazuu), lalu di-fork balik dan dikembangkan lagi oleh [Atho64](https://github.com/atho64).
