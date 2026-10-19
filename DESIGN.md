# DESIGN.md · GIK Production

Desain hub (`/`), viewer (`viewer.html`) dan app (`app.html`). Satu sumber untuk warna, tipografi dan pola.
Dipakai di tablet dapur dan HP gudang, sering dengan tangan basah atau bersarung: **besar, tenang, jelas**.

## Prinsip
1. **Target sentuh ≥ 44 px.** Tombol utama 50 px. Jarak antar target minimal 6 px.
2. **Satu aksi utama per layar.** Tombol biru penuh (`--accent`) hanya untuk Submit/Simpan/Print; sisanya ghost atau chip.
3. **Angka rata kanan, tabular** (`font-variant-numeric: tabular-nums`), format `id-ID` (1.500 / 1,5).
4. **Warna punya arti**, bukan hiasan: biru = aksi, hijau = berhasil, oranye = perlu dicek, merah = salah/kurang.
5. **Terang dan gelap** selalu didukung lewat token `prefers-color-scheme`.

## Warna: aturan 60-30-10
| Porsi | Peran | Token | Terang | Gelap | Dipakai di |
|---|---|---|---|---|---|
| **60%** | Netral (ruang kerja) | `--bg`, `--panel`, `--soft`, `--line` | `#f5f6f8`, `#fff`, `#eef0f3`, `#dde1e6` | `#12171d`, `#1a2129`, `#222a33`, `#2c3540` | latar, kartu, input, garis |
| **30%** | Slate (struktur) | `--ink`, `--muted`, `--chrome` | `#1f2933`, `#5b6673`, `#1f2933` | `#e6eaef`, `#97a3b0`, `#0d1217` | teks, bar atas, tab bar bawah, chip terpilih, ikon |
| **10%** | Biru (aksi) | `--accent`, `--accent-soft` | `#1a66d9`, `#e6effc` | `#5b9cf5`, `#1c2c44` | tombol utama (Submit/Simpan/Print), tab aktif, baris terisi, fokus input |

Warna status **bukan** bagian dari 10% dan hanya untuk arti data, tidak untuk tombol:
hijau `--ok-*` = berhasil, oranye `--warn-*` = perlu dicek, merah `--bad` = salah / kurang / yield di luar 70–130%.
Biru dipilih untuk aksi supaya tidak tertukar dengan hijau "berhasil".

Ikon aplikasi boleh berwarna (bagian dari 10%, hanya glyph kecil + latar tipis), satu warna per grup:
biru `--i-input` = Input harian · ungu `--i-monitor` = Pantau & cetak · teal `--i-base` = Lark Base.

## Istilah input
- **Produksi**: Std batches · Output (satuan) · **Labels** = jumlah label dicetak (kosong/0 = tidak cetak). Disimpan ke "Containers (labels)".
- **Packing**: **Pack size** (isi per pack) × **Packs** (jumlah pack, kosong = 1) = **Total** (dihitung, tidak diketik). Satu label per pack. Ukuran berbeda = satu baris per ukuran. Disimpan ke Split / Labels / Qty.

## Tipografi
- Font sistem: `"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif`. Tidak memuat font web (hemat data HP).
- Ukuran: dasar 15 px · judul halaman 24 px (21 px di HP) · judul tile 16 px · label kolom 12 px huruf besar `letter-spacing .04–.06em`.
- Tebal: 700 untuk judul dan angka KPI, 600 untuk tombol dan tab.

## Bentuk dan ruang
- Radius: kartu/tile 12–14 px, input 8–10 px, chip 18 px (pil).
- Gutter halaman 16 px (ikut `safe-area-inset`). Lebar maksimal konten: hub 980 px, app 1100 px.
- Bayangan hanya tipis di tile hub (mode terang); mode gelap tanpa bayangan.

## Ikon
Ikon garis 24 px, `stroke-width 1.8`, `currentColor`, didefinisikan di `src/hubShared.js`.
Satu ikon per aplikasi: `pot` Produksi · `box` Packing · `warehouse` Gudang · `chart` Hari Ini · `printer` Label · `layout` BaseApp · `table` Base.
Link keluar diberi ikon `external` kecil di pojok tile.

## Pola layar
- **Hub**: header (logo G, nama, akun) → sapaan + tanggal → grup tile. Tile = kotak ikon slate + judul + deskripsi 1 baris. Badge "Terakhir dibuka" pada app terakhir.
- **Viewer**: di dalam Lark di HP bar atas disembunyikan (bar Lark sudah punya kembali/refresh). Di browser: bar atas 52 px (kembali · ikon+judul · pemilih app · muat ulang · layar penuh). Di HP (≤ 720 px) pemilih app pindah ke **tab bar bawah** 58 px dengan ikon + label.
- **App di dalam viewer** (`html.embed`): header dan tab app disembunyikan; bar Submit menempel di bawah iframe.
- **Baris input di HP** (≤ 720 px): nama di atas, angka berdampingan dengan label di atas tiap kotak (bukan di dalam kotak), kotak 48 px, jarak 10–12 px. Satuan (Pcs, g) ditaruh di kanan dalam kotak, label tidak pernah.
- Status memuat: spinner + teks abu. Galat: teks tebal + tombol "Kembali ke menu".

## Bahasa
Hub dan viewer berbahasa Indonesia. Isi app masih campuran (label kolom Inggris); ganti bertahap, jangan setengah layar.
