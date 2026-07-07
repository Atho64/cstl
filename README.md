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
- **File / Folder Terjemahan** — Merge hasil terjemahan ke proyek yang sudah ada

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
  - *Matikan* — Gemini 2.5 (`thinkingBudget: 0`), OpenRouter (`reasoning: none`), Ollama (`think: false`)
  - *Nyalakan* — kebalikannya, masing-masing provider pakai parameternya sendiri
- **Filter thinking output** — Blok `<think>...</think>` dari model seperti Gemma 4 atau QwQ dihapus otomatis sebelum terjemahan diterapkan, termasuk bagian `thought: true` dari respons Gemini API
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
Semua proyek disimpan langsung di browser pakai **OPFS** (Origin Private File System) — tidak ada server, tidak ada akun. Proyek bisa di-backup dan dipulihkan lewat file `.cstl`.

Data biner besar (file mentah LucaSystem) disimpan di file OPFS terpisah supaya auto-save tetap ringan. Dashboard hanya memuat metadata proyek, bukan seluruh isi data — jadi tetap cepat meski proyek sudah banyak.

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

Untuk model thinking seperti Gemma 4 atau Gemini 2.5, aktifkan **Filter `<think>...</think>`** di pengaturan API supaya output terjemahan bersih dari teks reasoning.

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
