# CSTL — Panduan Membuat Parser Custom

Dokumen ini khusus untuk **menulis parser custom** (JavaScript / Python) di CSTL:
kontrak fungsi `parse(ctx)` dan `serialize(ctx)`, field yang tersedia, pola yang benar,
dan batasan sandbox-nya. Untuk gambaran aplikasi secara umum, lihat `README.md`.

Parser custom dipakai saat game/format file **tidak didukung bawaan CSTL**
(JSON/EPUB/TXT). Kamu tulis dua fungsi — `parse(ctx)` untuk impor dan `serialize(ctx)`
untuk ekspor round-trip — lalu CSTL menangani sisanya (tabel terjemahan, AI translate,
QC, dsb).

> **v2 parser custom** menambahkan: strategi pencocokan magic bytes & nama file (§2),
> aset bundling `ctx.assets` (§5), setelan per-parser `ctx.options` (§6), dan progress
> `ctx.progress()` (§4.3). Semua field baru **opsional** — parser lama tetap valid.

---

## 1. Anatomi sebuah parser

Satu parser = objek dengan field berikut (dikelola lewat menu **Parser Custom**,
tersimpan global di `localStorage` key `cstl_custom_parsers` sehingga bisa dipakai
lintas proyek):

| Field             | Wajib | Keterangan                                                        |
|-------------------|-------|-------------------------------------------------------------------|
| `name`            | ✅    | Nama tampilan, bebas.                                             |
| `language`        | ✅    | `'js'` atau `'python'`.                                           |
| `extensions`      | ➖    | Ekstensi yang dicocokkan, mis. `['.mgs']`. Wajib jika strategi `extension` dipakai (default). |
| `parseScript`     | ✅    | Kode yang mendefinisikan `parse(ctx)`.                            |
| `serializeScript` | ➖    | Kode yang mendefinisikan `serialize(ctx)`. Kosong = ekspor jatuh ke JSON. |
| `enabled`         | —     | Parser nonaktif tidak ikut pencocokan impor maupun ekspor.        |
| `matchStrategy`   | ➖    | `['extension', 'magic', 'filename']` (subset bebas). Default/tidak-ada = `['extension']`. Lihat §2. |
| `magic`           | ➖    | Wajib jika strategi `magic`: `[{ offset: 0, hex: '4d41474553' }]`. |
| `filenameRegex`   | ➖    | Wajib jika strategi `filename`: string regex JS (case-insensitive). |
| `assets`          | ➖    | File pendamping: `[{ name: 'tbl.bin', dataBase64: '...' }]` → dibaca via `ctx.assets`. Lihat §5. |
| `settings`        | ➖    | Spec form otomatis → nilai dikirim via `ctx.options`. Lihat §6.   |

**Cara kerja pencocokan:** saat impor, CSTL mengevaluasi tiap parser aktif terhadap
file sesuai strateginya (bisa kombinasi — cukup SATU strategi cocok):

- `extension` — akhiran nama file (`script.dat`, `SCRIPT.DAT`, dan `a.b.dat` cocok `.dat`).
- `magic` — byte sampel (64 byte pertama file) dibandingkan pattern `{offset, hex}`.
- `filename` — regex terhadap nama file (case-insensitive).

Parser pertama dalam urutan daftar yang cocok **menang**. File tanpa ekstensi tetap
bisa diimpor lewat *Impor Folder dengan Parser* atau jalur impor generik.
Strategi sengaja tidak menyediakan mode "cocok semua file" — rawan tabrakan antar parser.

---

## 2. Strategi pencocokan file (`matchStrategy`)

### 2.1 Magic bytes — untuk file biner / tanpa ekstensi

Cek signature byte pada posisi tertentu. Ambil dari hex dump file asli:

```json
{
  "matchStrategy": ["magic"],
  "magic": [
    { "offset": 0, "hex": "4d41474553" },
    { "offset": 4, "hex": "00 01" }
  ]
}
```

- `hex` — digit heksadesimal berpasangan genap, spasi/underscore/koma boleh sebagai pemisah.
- `offset` — integer ≥ 0, posisi byte pertama yang dibandingkan.
- Beberapa pattern = cocok jika SALAH SATU pattern lolos.
- Sampel hanya 64 byte pertama — pastikan pattern berada di rentang itu.

### 2.2 Filename regex — untuk pola nama tanpa ekstensi

```json
{
  "matchStrategy": ["filename"],
  "filenameRegex": "^scene_\\w+"
}
```

Dibatasi 200 karakter dan harus regex JS valid (divalidasi editor saat Simpan).

### 2.3 Kombinasi

```json
{ "matchStrategy": ["extension", "magic"], "extensions": [".ks"], "magic": [{ "offset": 0, "hex": "4b53" }] }
```

File `scene.ks` lolos lewat ekstensi; file `archive` (tanpa ekstensi) lolos lewat magic.

---

## 3. Kontrak `parse(ctx)` — impor

### 3.1 Isi `ctx`

| Field          | Tipe         | Isi                                                                 |
|----------------|--------------|----------------------------------------------------------------------|
| `ctx.fileName` | `string`     | Nama file (tanpa path).                                              |
| `ctx.text`     | `string`     | Seluruh isi file sebagai teks. Decoding otomatis: **UTF-8 → Shift_JIS → Windows-31J**, fallback UTF-8 non-strict. |
| `ctx.bytes`    | `Uint8Array` / `bytes` | Byte mentah file. Wajib dipakai untuk format biner.         |
| `ctx.startLineNum` | `number` | Nomor baris CSTL tempat file ini mulai (berguna saat multi-file).    |
| `ctx.options`  | `object`     | Nilai setelan per-parser (§6). Selalu ada (objek kosong jika tak ada spec). |
| `ctx.assets`   | `object`     | Peta `{ nama: Uint8Array/bytes }` — hanya ada jika parser punya aset (§5). |
| `ctx.progress` | `function`   | `(done, total, label?) => void` untuk laporan progres (§4.3).        |

### 3.2 Nilai kembalian

`parse(ctx)` **wajib mengembalikan array** berisi entri:

```js
{ name?: string|null, message: string, raw?: string|null, index?: number|null }
```

- `message` — **wajib dan tidak boleh kosong/whitespace**. Entri tanpa `message`
  diabaikan diam-diam oleh CSTL. Ini cara idiomatis untuk skip baris komentar,
  header, atau dekorasi: cukup jangan masukkan ke array.
- `name` — nama pembicara, atau `null` untuk narasi.
- `raw` — teks asli baris/entri. Dipakai sebagai anchor patch saat ekspor (lihat §3).
- `index` — angka bebas buatan kamu (offset byte, nomor entri, indeks array…).
  Diteruskan utuh kembali ke `serialize(ctx)` sebagai `line.index`.
  **Wajib angka finite** kalau diisi — nilai lain jadi `null`.

CSTL menerima semua bentuk ini: sinkron atau `async`, dan di JS deklarasi
`function parse(ctx) {}` biasa sudah cukup.

### 3.3 Contoh JS — format teks `Nama: dialog`

```js
// ctx = { fileName, text, bytes, startLineNum, options, ... }
// Return: array of { name?, message, raw?, index? } — message wajib.
async function parse(ctx) {
  const rows = [];
  let i = 0;
  for (const raw of ctx.text.split(/\r?\n/)) {
    // Baris "Nama: dialog", atau dialog polos.
    const m = raw.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (m) rows.push({ name: m[1], message: m[2], raw, index: i });
    else if (raw.trim()) rows.push({ message: raw, raw, index: i });
    i++;
  }
  return rows;
}
```

### 3.4 Contoh Python — sama saja, jalan di pyodide

```python
# ctx = {"fileName": str, "text": str, "bytes": bytes, "startLineNum": int, ...}
# Return: list of {"name", "message", "raw", "index"} — message wajib.
import re

def parse(ctx):
    rows = []
    for i, raw in enumerate(ctx["text"].splitlines()):
        m = re.match(r"^([A-Za-z0-9_]+)\s*:\s*(.+)$", raw)
        if m:
            rows.append({"name": m.group(1), "message": m.group(2), "raw": raw, "index": i})
        elif raw.strip():
            rows.append({"message": raw, "raw": raw, "index": i})
    return rows
```

Di Python, `ctx["bytes"]` dan isi `ctx["assets"]` dijamin sudah `bytes` sungguhan
(runner mengonversinya), dan boleh mengembalikan `list`/`dict` Python biasa —
dikonversi otomatis ke JS.

### 3.5 Pola: dialog multi-baris (word wrap) & file multibahasa

**Word wrap** — dialog yang sengaja dipatahkan beberapa baris fisik agar muat layar:

```js
// parse(): gabungkan baris lanjutan jadi SATU entri; index = baris AWAL.
// Deteksi "lanjutan" spesifik format (mis. bukan command/komentar/kosong,
// atau diawali karakter indentasi tertentu).
if (isContinuation(raw)) { cur.message += ' ' + raw.trim(); continue; } // jangan push

// serialize(): tulis balik dgn pembagian baris konsisten.
const width = ctx.options.wrapWidth || 40;
function rewrap(t) {
  const words = t.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width && cur) { lines.push(cur); cur = w; }
    else cur = (cur ? cur + ' ' : '') + w;
  }
  if (cur) lines.push(cur);
  return lines;
}
```

Jadikan lebar wrap sebagai *setting angka* (`wrapWidth`, default ±40; **0 = tanpa
pembagian**, satu baris utuh). Kalau format aslinya TIDAK memakai wrap (satu dialog =
satu baris fisik), jangan buat logika ini.

**Multibahasa** — satu entri berisi teks dalam beberapa bahasa (pemisah apa pun:
`␂`, `|`, blok terpisah):

- Parse: ekstrak SEMUA bahasa, tapi yang jadi `message` mengikuti setting pilihan
  user (`ctx.options.sourceSegment`, default bahasa utama). Simpan baris asli utuh
  di `raw` + posisi di `index`.
- Serialize: timpa HANYA segmen target yang dipilih user (`ctx.options.writeTarget`),
  segmen bahasa lain tetap byte-per-byte utuh; prefix nama dibangun ulang dan pakai
  `trans_name` bila ada.

---

## 4. Fitur runtime di dalam ctx

### 4.1 Membaca aset — `ctx.assets`

Aset = file pendamping yang dibundle bersama parser (tabel karakter, skema, model
kompresi kecil, dll.). Kelola di editor (section *Aset Parser*) atau biarkan ikut
dalam paket zip (§8).

```js
async function parse(ctx) {
  const tbl = ctx.assets && ctx.assets['tbl.bin'];
  if (!tbl) throw new Error('Aset tbl.bin tidak ditemukan — pasang di editor parser.');
  // tbl adalah Uint8Array (JS) / bytes (Python)
}
```

- Nama aset = path relatif (`data/nested.txt` didukung; `..` diblokir).
- Aset disimpan base64 di localStorage bersama parser — jaga total tetap kecil
  (< 2MB; editor memperingatkan bila lebih).
- Jika parser tidak punya aset, `ctx.assets` **tidak ada** — selalu cek sebelum pakai.

### 4.2 Membaca setelan — `ctx.options`

Nilai form *Setelan* per-parser (lihat §6), sudah di-merge dengan default oleh host:

```js
async function parse(ctx) {
  const enc = ctx.options.encoding || 'auto';
  const skipComments = ctx.options.skipComments === true;
  ...
}
```

### 4.3 Melaporkan progres — `ctx.progress(done, total, label?)`

Untuk file besar, laporkan progres agar user melihat pergerakan (muncul di status
bar impor dan di Uji Parser):

```js
async function parse(ctx) {
  const rows = [];
  const lines = ctx.text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (i % 1000 === 0) ctx.progress(i, lines.length, 'mem-parsing');
    // ... logika parsing ...
  }
  ctx.progress(lines.length, lines.length, 'selesai');
  return rows;
}
```

Python: `ctx["progress"](i, total, "mem-parsing")`. Panggilan tidak wajib —
parser tanpa progres tetap normal.

---

## 5. Pola untuk format biner

Untuk format biner, abaikan `ctx.text` dan kerjakan `ctx.bytes`:

```js
async function parse(ctx) {
  const b = ctx.bytes;
  const dec = new TextDecoder('shift_jis'); // sesuaikan encoding game
  const rows = [];
  let off = 4; // mis. header 4 byte
  while (off < b.length) {
    const len = b[off];
    const msg = dec.decode(b.subarray(off + 1, off + 1 + len));
    if (msg.trim()) rows.push({ message: msg, index: off }); // offset = anchor
    off += 1 + len;
  }
  return rows;
}

async function serialize(ctx) {
  const out = ctx.bytes.slice();
  const enc = new TextEncoder(); // ganti dengan encoder Shift_JIS jika perlu
  for (const line of ctx.lines) {
    if (!line.is_translated || line.index == null) continue;
    const nb = enc.encode(line.trans_message || '');
    if (nb.length !== /* panjang slot asli */ 0) {
      throw new Error('Panjang berubah — format fixed-slot butuh padding/manual.');
    }
    out.set(nb, line.index + 1);
  }
  return out; // Uint8Array → diekspor sebagai file biner
}
```

Catatan penting format biner:

- Simpan **offset byte sebagai `index`** saat `parse()` — itu satu-satunya jalan
  aman untuk menulis balik ke posisi yang persis sama.
- Kalau formatnya fixed-length slot, terjemahan yang lebih panjang tidak muat:
  putuskan strategi sejak awal (padding, pointer tabel, atau tolak dengan `throw`
  agar user tahu).
- Di Python, `ctx["bytes"]` adalah `bytes` immutable — salin dulu (`bytearray(...)`)
  sebelum dimodifikasi.
- Cocokkan file lewat **magic bytes** (§2.1), bukan ekstensi, kalau extensinya generik.
- Tabel karakter/dekompresi eksternal → masukkan sebagai **aset** (§4.1), bukan
  string literal raksasa di script.

### WebAssembly dari aset

API `WebAssembly` tersedia langsung di dalam worker — bundle `.wasm` sebagai aset,
lalu instantiate sendiri:

```js
async function parse(ctx) {
  const bytes = ctx.assets && ctx.assets['parser.wasm'];
  if (!bytes) throw new Error('Aset parser.wasm tidak ditemukan.');
  const { instance } = await WebAssembly.instantiate(bytes);
  // panggil fungsi export milik modul, mis. decoder/dekompresor custom
  const value = instance.exports.answer();
  ...
}
```

Catatan: worker JS fresh per panggilan — instance WASM tidak bisa di-cache antar
panggilan impor. Decode/dekompresi seluruh isi file di dalam SATU panggilan
`parse()` agar kerja WASM-nya sekali jalan.

---

## 6. Setelan per-parser (`settings` + `ctx.options`)

Deklarasikan spec di field `settings`; CSTL membuat form otomatis (tombol *Setelan*
di kartu parser) dan mengirim nilai ter-merge sebagai `ctx.options`.

Spec (array):

```json
[
  { "key": "encoding", "label": "Encoding", "type": "select", "default": "auto",
    "options": [
      { "value": "auto", "label": "Auto (UTF-8 → SJIS)" },
      { "value": "sjis", "label": "Force Shift_JIS" },
      { "value": "utf8",  "label": "Force UTF-8" }
    ],
    "description": "Encoding pembacaan file." },
  { "key": "skipComments", "label": "Lewati komentar #", "type": "boolean", "default": true },
  { "key": "maxLen", "label": "Panjang maks", "type": "number", "default": 200, "min": 1 },
  { "key": "prefix", "label": "Prefiks nama", "type": "string", "placeholder": "OP-" }
]
```

Aturan spec:

| Field       | Aturan                                                                 |
|-------------|------------------------------------------------------------------------|
| `key`       | Wajib, unik, cocok `[a-zA-Z_$][a-zA-Z0-9_$]*` — dipakai sebagai field `ctx.options.<key>`. |
| `label`     | Wajib, non-kosong.                                                     |
| `type`      | `string` (default), `number`, `boolean`, `select`, `textarea`.          |
| `default`   | Untuk `select` harus salah satu `options[].value`.                      |
| `options`   | Wajib untuk `select`: `[{value, label}]`.                               |
| `min/max/step` | Untuk `number`.                                                      |

Perilaku nilai:

- Nilai tersimpan **global per parser-id** (key `cstl_custom_parser_settings`) —
  berlaku untuk semua proyek yang memakai parser itu.
- Host merge: nilai user → fallback `default` → coerce tipe (string `'17'` jadi
  angka, `'true'` jadi boolean; angka invalid kembali ke default).
- Ganti spesifikasi setting (mis. ubah pilihan select) tidak otomatis mengubah
  nilai user yang sudah tersimpan.

Di dalam script, **jangan hardcode konstanta yang mungkin perlu diganti user** —
jadikan setting.

---

## 7. Kontrak `serialize(ctx)` — ekspor round-trip

`serializeScript` bersifat **opsional**, tapi tanpa dia ekspor proyek jatuh ke JSON
biasa (tidak ada round-trip ke format asli).

### 7.1 Isi `ctx`

Semua field §3.1 (termasuk `options`/`assets`/`progress`), plus:

```js
ctx.lines = [
  {
    line_num,       // nomor baris internal CSTL
    name,           // nama asli hasil parse()
    message,        // teks asli hasil parse()
    trans_name,     // terjemahan nama (null jika belum)
    trans_message,  // terjemahan dialog (null jika belum)
    is_translated,  // bool — pakai ini sebagai kondisi patch
    raw,            // nilai raw dari parse() (null jika tak diberikan)
    index,          // nilai index dari parse() (null jika tak diberikan)
  }, ...
]
```

`ctx.lines` hanya berisi baris milik file itu (`ctx.fileName`) — CSTL memanggil
`serialize()` sekali per file sumber. `ctx.text` / `ctx.bytes` adalah **file asli
yang utuh** (disimpan CSTL di sidecar OPFS sejak impor), jadi kamu tidak perlu
merekonstruksi bagian non-dialog.

### 7.2 Nilai kembalian

Tepat satu dari:

- `string` — file teks yang sudah dipatch; **atau**
- `Uint8Array` / `bytes` — untuk format biner (struktur file direkonstruksi ulang).

### 7.3 Contoh JS — patch by-index (paling aman)

```js
// ctx = { fileName, text, bytes, lines, options, ... }
async function serialize(ctx) {
  const out = ctx.text.split(/\r?\n/);
  for (const line of ctx.lines) {
    if (!line.is_translated || line.index == null) continue;
    out[line.index] =
      (line.trans_name ? line.trans_name + ': ' : '') + (line.trans_message || '');
  }
  return out.join('\n');
}
```

Karena `index` kamu sendiri yang set saat `parse()`, patch tidak mungkin salah
sasaran meski banyak baris identik.

### 7.4 Contoh Python — patch by-raw (fallback klasik)

```python
def serialize(ctx):
    out = ctx["text"].splitlines()
    for line in ctx["lines"]:
        if not line["is_translated"] or not line.get("raw"):
            continue
        prefix = line["trans_name"] + ": " if line.get("trans_name") else ""
        try:
            out[out.rindex(line["raw"])] = prefix + (line["trans_message"] or "")
        except ValueError:
            print("serialize: raw tidak ditemukan:", line["raw"][:40])
    return "\n".join(out)
```

> ⚠️ Patch by-raw (`lastIndexOf` / `rindex`) dipatch **dari belakang** sengaja:
> `parse()` membaca dari depan, jadi pengambilan dari belakang membuat baris
> duplikat tetap terpetakan 1:1 selama urutannya konsisten. Tetap saja, by-index
> lebih aman — pakai raw hanya saat struktur file tidak memberimu posisi stabil.

---

## 8. Sandbox & batasan yang perlu kamu tahu

| Hal              | JS                                  | Python                              |
|------------------|-------------------------------------|-------------------------------------|
| Tempat jalan     | Web Worker blob, **fresh per panggilan** | Worker pyodide **singleton** (di-load lazy) |
| Timeout          | 10 menit flat                       | 10 menit eksekusi; 10 menit load runtime pertama |
| Internet         | Tidak perlu                         | Perlu saat pemakaian pertama (~10MB pyodide dari CDN, lalu cache browser) |
| State global     | Hilang tiap panggilan               | Bertahan antar panggilan dalam satu sesi (globals pyodide) |
| Antrean          | Paralel bebas                       | Otomatis diantrekan (satu instance) |

- **Tidak ada DOM / API halaman** di dalam worker. Murni logika + standar library
  (`TextDecoder`, `TextEncoder`, `RegExp`, dsb.).
- **Console forwarding**: `console.log/warn/error` (JS) dan `print()` (Python)
  diteruskan ke UI — tampil di hasil *Uji Parser*. Gunakan untuk debugging; hindari
  spam log per-baris pada file besar (batasi mis. per 1000 baris).
- Script JS dibungkus function scope — `function parse(){}` hoisted dan bisa
  dipanggil; boleh juga `async`.
- ⚠️ **`parseScript` dan `serializeScript` berbagi SATU function scope.** Variabel
  top-level dengan nama sama di kedua script (mis. dua `const SEP`) = SyntaxError
  saat parser dimuat. Pakai nama beda (`SEPS`, `SEP2`) atau bungkus tiap script
  dalam blok `{ ... }` sendiri.
- Error apa pun yang dilempar (`throw new Error('pesan')`) muncul utuh ke user
  lewat dialog error impor/ekspor — **gunakan `throw` untuk pesan yang jelas**
  alih-alih mengembalikan hasil salah.
- Hasil divalidasi ketat: `parse()` harus array (entri tanpa `message` dibuang),
  `serialize()` harus string atau typed-array. Melanggar = error dengan pesan tipe.

---

## 9. Aturan impor/ekspor yang memengaruhi desain parser

1. **Satu impor = satu parser.** File yang cocok ke dua parser berbeda dalam satu
   impor ditolak. Rancang ekstensi/magic agar tidak tumpang tindih antar parser —
   ingat: parser pertama di daftar yang cocok menang.
2. **Ekstensi bawaan** (`.json`, `.epub`, `.txt`) bisa didaftarkan parser custom,
   tapi akan menimpa jalur built-in — editor memperingatkan sebelum menyimpan.
3. **Satu proyek = satu parser** (`projectType: 'custom'`). Impor parser lain ke
   proyek yang sama ditolak; buat proyek baru.
4. **Saat ekspor**, parser harus masih ada **dan aktif**; kalau terhapus/nonaktif/
   tanpa `serialize()`, ekspor otomatis jatuh ke JSON (dengan pemberitahuan).
5. File asli (teks + byte base64) disimpan di sidecar OPFS per proyek dan ikut
   backup `.cstl` — termasuk **definisi parser-nya** — sehingga restore di
   browser lain tetap bisa round-trip.
6. **Uji dulu di editor**: tombol *Uji Parser* menjalankan `parse()` atas file
   contoh tanpa menyimpan/mengubah proyek, lalu menampilkan pratinjau 30 baris
   pertama, total jumlah baris, log console parser, dan progres real-time.

---

## 10. Format distribusi parser: ZIP dan JSON

Parser adalah data, bukan kode yang di-build — dia bisa **dibagikan sebagai file**
dan diimpor di browser/perangkat lain.

Dua format impor (terdeteksi otomatis dari ekstensi file):

### 10.1 ZIP — `cstl-parser-<nama>.zip` (hasil tombol *Ekspor* per parser)

```
my-parser.zip
├── parser.json        (bungkusan standar, sama seperti §10.3 — asset base64 di dalamnya)
└── assets/            (opsional — file asli, BUKAN base64; mudah diedit manusia)
    ├── tbl.bin
    └── data/nested.txt
```

- Saat impor, jika zip berisi **tepat satu parser**, folder `assets/` **menimpa**
  aset base64 di JSON (file asli lebih otoritatif).
- Zip berisi beberapa parser → aset dari folder `assets/` diabaikan (ambigu),
  base64 di `parser.json` yang dipakai.
- Manfaat: tabel karakter/wasm bisa diedit langsung di zip sebelum dibagikan.

### 10.2 Alur ekspor

- Tombol **Ekspor** pada kartu parser → **.zip** (parser.json + assets/ asli).
- Tombol **Ekspor Semua Parser** → **.json** tunggal (semua parser, asset base64) —
  format praktis untuk workflow AI karena gampang di-copy-paste.

### 10.3 Struktur JSON

Bentuk bungkusan hasil ekspor CSTL:

```json
{
  "type": "cstl_custom_parsers",
  "version": 1,
  "exportedAt": "2026-08-25T00:00:00.000Z",
  "parsers": [ { "...CustomParser": "" } ]
}
```

Impor **juga menerima array polos** tanpa bungkusan: `[ { ... }, { ... } ]`.

### 10.4 Field wajib & praktik terbaik per parser

Validator impor (`isValidCustomParser`) hanya mewajibkan:

| Field         | Syarat                                  |
|---------------|------------------------------------------|
| `id`          | string                                   |
| `name`        | string                                   |
| `language`    | `'js'` atau `'python'`                   |
| `parseScript` | string berisi kode pendefinisi `parse(ctx)` |
| `extensions`  | array, mis. `[".mgs"]` (boleh kosong jika matchStrategy non-extension) |

Field lain **sebaiknya tetap selalu diisi** saat membuat JSON manual/AI-generated:

- `serializeScript` — isi string kosong `""` kalau memang tidak ada.
- `enabled` — `true`/`false`.
- `createdAt` / `updatedAt` — angka epoch milidetik (`Date.now()`).
- Field v2 (`matchStrategy`, `magic`, `filenameRegex`, `assets`, `settings`) —
  opsional; sertakan sesuai kebutuhan format.

### 10.5 Semantik impor (upsert by id)

- `id` yang **belum ada** → parser baru ditambahkan.
- `id` yang **sudah ada** → parser lama **ditimpa** seluruhnya.

Jadi saat minta AI membuat parser baru, pastikan ia memakai `id` unik yang belum
terpakai — jangan sampai menimpa parser lama tanpa sengaja. Sebaliknya, ini juga
cara yang sah untuk *mendistribusikan versi baru* sebuah parser: sama id, isi baru.

Entri yang tidak lolos validasi dilewati diam-diam; ringkasan impor melapor jumlah
baru / diperbarui / dilewati.

### 10.6 Aturan menulis script di dalam JSON

`parseScript` / `serializeScript` adalah **string JSON biasa**, jadi:

- Setiap baris baru harus `\n` di dalam string JSON.
- Escape karakter khusus JSON: `\"` untuk kutip, `\\` untuk backslash — regex seperti
  `/\r?\n/` ditulis `/\\r?\\n/` di JSON.
- **Tips:** pakai kutip tunggal `'...'` di script JS untuk meminimalkan escape.
- Cara paling aman memverifikasi: tempel JSON-nya lewat *Impor Parser*, lalu buka
  parser di editor dan jalankan **Uji Parser** dengan file contoh.

### 10.7 Contoh JSON siap-impor (template untuk AI)

Contoh lengkap satu parser JS untuk format teks `Nama: dialog` dengan ekstensi buatan
`.example`, plus contoh field v2 — simpan sebagai file `.json` lalu Impor Parser:

```json
{
  "type": "cstl_custom_parsers",
  "version": 1,
  "exportedAt": "2026-08-25T00:00:00.000Z",
  "parsers": [
    {
      "id": "cp_contoh_named_dialog_001",
      "name": "Contoh: Nama - Dialog",
      "language": "js",
      "extensions": [".example"],
      "matchStrategy": ["extension"],
      "enabled": true,
      "createdAt": 1756080000000,
      "updatedAt": 1756080000000,
      "settings": [
        { "key": "skipEmptyNames", "label": "Lewati tanpa nama", "type": "boolean", "default": false },
        { "key": "speakerCase", "label": "Case nama", "type": "select", "default": "keep",
          "options": [ {"value": "keep", "label": "Apa adanya"}, {"value": "lower", "label": "huruf kecil"} ] }
      ],
      "parseScript": "async function parse(ctx) {\n  const rows = [];\n  let i = 0;\n  for (const raw of ctx.text.split(/\\r?\\n/)) {\n    const m = raw.match(/^([A-Za-z0-9_]+)\\s*:\\s*(.+)$/);\n    if (m) {\n      if (ctx.options.skipEmptyNames && !m[2].trim()) { i++; continue; }\n      const name = ctx.options.speakerCase === 'lower' ? m[1].toLowerCase() : m[1];\n      rows.push({ name, message: m[2], raw, index: i });\n    } else if (raw.trim()) {\n      rows.push({ message: raw, raw, index: i });\n    }\n    if (i % 500 === 0) ctx.progress(i, ctx.text.length, 'parsing');\n    i++;\n  }\n  return rows;\n}",
      "serializeScript": "async function serialize(ctx) {\n  const out = ctx.text.split(/\\r?\\n/);\n  for (const line of ctx.lines) {\n    if (!line.is_translated || line.index == null) continue;\n    out[line.index] = (line.trans_name ? line.trans_name + ': ' : '') + (line.trans_message || '');\n  }\n  return out.join('\\n');\n}"
    }
  ]
}
```

Contoh magic-only (file biner tanpa ekstensi berganti-ganti nama):

```json
{
  "id": "cp_demo_magic_only_001",
  "name": "Demo Magic-Only",
  "language": "js",
  "extensions": [],
  "matchStrategy": ["magic"],
  "magic": [{ "offset": 0, "hex": "4d41474553" }],
  "enabled": true,
  "createdAt": 1756080000000,
  "updatedAt": 1756080000000,
  "parseScript": "function parse(ctx) { /* kerjakan ctx.bytes */ return []; }",
  "serializeScript": ""
}
```

### 10.8 Prompt template untuk membuat parser (copy-paste ke AI)

Cara pakai: **lampirkan file contoh** (atau tempel potongan isinya), isi bagian
referensi bila ada, dan pastikan AI membaca dokumen tutorial ini. Jawaban yang
diharapkan berupa **paket zip** siap impor.

Panduan lengkap: **https://github.com/Atho64/cstl** — `CUSTOM_PARSER_GUIDE.md`
di root repo.

````text
Buatkan custom parser CSTL untuk format di bawah ini.

REFERENSI WAJIB — baca dulu panduannya:
CUSTOM_PARSER_GUIDE.md dari repo https://github.com/Atho64/cstl
(patuhi SEMUA kontrak & formatnya tanpa kecuali).

INPUT DARI SAYA:
1. File contoh   : <lampirkan file asli, atau tempel 10–30 baris pertamanya verbatim>
2. Tool referensi: <link repo/tool parser serupa untuk engine ini, boleh kosong>
3. File pendamping (key.bin / tabel karakter / dekompresor, kalau formatnya butuh):
   <lampirkan juga — JANGAN mengarang isinya>
4. Catatan khusus: <opsional — mis. "dialog bisa multi-baris">

OUTPUT YANG AKU MAU:
Satu paket ZIP distribusi parser (isi: parser.json sesuai §10 panduan + folder
assets/ HANYA kalau formatnya butuh file pendamping). Kalau kamu tak bisa
melampirkan file zip, berikan parser.json utuh + satu perintah terminal untuk
membungkusnya jadi zip.

SYARAT FITUR — parser WAJIB punya semuanya:
- matchStrategy yang tepat utk format ini (extension/magic/filename).
- Bahasa script: pakai "js" secara default (wajib kalau formatnya butuh WASM).
  "python" hanya kalau aku minta atau logikanya jauh lebih cocok di Python —
  catat bahwa pyodide butuh internet saat pemakaian pertama.
- Settings form (field "settings") untuk semua pilihan user, khususnya:
  • multilang selection — HANYA jika file contoh berisi lebih dari satu bahasa:
    bahasa sumber saat load (sourceSegment) dan bahasa target yang ditimpa saat
    ekspor (writeTarget) dipisah, boleh BEDA (mis. impor JP → ekspor EN).
    Kalau filenya SATU bahasa saja, JANGAN buat setting ini.
  • word wrap width — HANYA jika format memakai pembagian baris: setting angka
    (wrapWidth, default ±40); dialog multi-baris digabung saat parse() dan
    ditulis balik dipecah per <wrapWidth> huruf; 0 = tanpa pembagian.
    Kalau satu dialog = satu baris fisik, JANGAN buat logika ini.
- Progress: ctx.progress(i, total) tiap ±1000 iterasi.
- Round-trip by-index; CRLF, struktur baris & segmen bahasa lain tetap utuh.
- Nama pembicara dari format asli → kolom name; prefix/nama dijaga saat ekspor,
  pakai trans_name bila user menerjemahkannya.
- Kalau aku melampirkan file pendamping (key/tabel/wasm): JANGAN coba menebak
  atau menyalin isinya ke script — jadikan ASET parser (field "assets" di
  parser.json, atau folder assets/ di zip) dan baca lewat ctx.assets["<nama>"]
  di runtime. Script hanya berisi LOGIKA membacanya.
- WASM (kalau tool referensinya pakai .wasm / format butuh dekompresi native):
  bundle file .wasm sebagai ASET, lalu di script panggil
  WebAssembly.instantiate(ctx.assets["<nama>.wasm"]) dan akses instance.exports.
  Worker CSTL punya WebAssembly penuh. Ingat: worker JS fresh per panggilan —
  decode seluruh isi file dalam SATU panggilan parse().
- Kalau file pendamping TIDAK aku lampirkan tapi formatnya jelas butuh (script
  terenkripsi/dekompresi): STOP dan tanya aku dulu — sebutkan nama file apa yang
  harus kucari dari instalasi game. Jangan buat parser yang diam-diam memakai
  key hasil tebakan.
- Log seperlunya via console.log (debugging di Uji Parser).

SELF-CHECK diam-diam sebelum menjawab: JSON valid 100% (escape \n \" \\),
tidak ada deklarasi top-level bernama sama antara parseScript & serializeScript,
semua entri parse() punya index + message non-kosong, default tiap setting valid,
dan simulasikan 2–3 baris contohku (tulis hasil simulasinya setelah blok JSON).

ROUND-TRIP TEST — lakukan SIMULASI mental penuh pada 2 baris contohku sebelum
menjawab, dan tuliskan hasilnya setelah blok JSON:
1. parse()  : tampilkan entri hasil parse untuk baris itu.
2. translate: anggap trans_message = "<terjemahan fiktif>" (dan trans_name bila
   formatnya punya nama).
3. serialize(): tampilkan BARIS HASIL AKHIR persis karakter-per-karakter —
   segmen bahasa lain harus tetap identik dengan aslinya, prefix nama tak hilang,
   CRLF & jumlah baris tidak berubah.
Kalau ada satu saja bagian file yang berubah padahal seharusnya tidak, perbaiki
script-mu dulu — jangan serahkan versi yang rusak.

Kalau contoh file kurang untuk menentukan pola, tanya maksimal 3 pertanyaan
DULU — jangan menebak format.
````

> Tips: minta AI menyertakan simulasi 2–3 baris contoh (input → entri hasil parse)
> setelah JSON. Kalau simulasinya meleset dengan file aslimu, formatnya salah —
> perbaiki sebelum impor, bukan sesudah.

> Catatan: ini berbeda dari backup proyek `.cstl` (yang membawa definisi
> parser di field `customParserDef`). Format di bagian ini khusus berbagi/menyalin
> parser itu sendiri, terpisah dari proyek.

---

## 11. Checklist sebelum parser dipakai produksi

- [ ] `parse()` mengembalikan array; setiap entri punya `message` non-kosong.
- [ ] Baris yang memang bukan dialog **dilewatkan** (tidak masuk array), bukan
      dijadikan entri kosong.
- [ ] `raw` atau `index` selalu diisi — minimal salah satu — agar ekspor bisa patch.
- [ ] Format duplikat-baris → pakai `index`, jangan andalkan pencocokan `raw`.
- [ ] `serialize()` mengembalikan tepat `string` **atau** bytes, sesuai format asli
      (file teks tetap teks, file biner tetap biner).
- [ ] Encoding keluaran sama dengan aslinya (Shift_JIS tetap Shift_JIS, dst).
- [ ] Pattern magic diverifikasi dengan hex dump file asli (64 byte pertama).
- [ ] Setting punya `default` yang masuk akal; script membaca `ctx.options`, bukan
      konstanta hardcoded.
- [ ] Aset diakses defensive (`ctx.assets && ctx.assets['x']`) dengan pesan error jelas.
- [ ] Sudah diuji lewat *Uji Parser* dengan file asli berukuran penuh, bukan sampel.
