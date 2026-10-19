# DESIGN.md · GIK Production

Desain hub (`/`), viewer (`viewer.html`) dan app (`app.html`). Satu sumber untuk warna, tipografi dan pola.
Dipakai di tablet dapur dan HP gudang, sering dengan tangan basah atau bersarung: **besar, tenang, jelas**.

## Prinsip
1. **Target sentuh ≥ 44 px.** Tombol utama 50 px. Jarak antar target minimal 6 px.
2. **Satu aksi utama per layar.** Tombol hijau penuh hanya untuk Submit/Print; sisanya ghost atau chip.
3. **Angka rata kanan, tabular** (`font-variant-numeric: tabular-nums`), format `id-ID` (1.500 / 1,5).
4. **Warna punya arti**, bukan hiasan: hijau = aksi/berhasil, oranye = perlu dicek, merah = salah/kurang.
5. **Terang dan gelap** selalu didukung lewat token `prefers-color-scheme`.

## Token warna
| Token | Terang | Gelap | Pakai untuk |
|---|---|---|---|
| `--bg` | `#f4f6f3` | `#171c19` | latar halaman |
| `--panel` | `#fff` | `#20271f` | kartu, bar |
| `--ink` | `#1d2721` | `#e4eae5` | teks utama |
| `--muted` | `#66736a` | `#9aa79e` | teks pendukung, label kolom |
| `--line` | `#d9e0da` | `#334039` | garis, border |
| `--accent` | `#2f6f43` | `#7cc08d` | aksi utama, tab aktif |
| `--accent-soft` | `#e3efe6` | `#25382b` | latar tab aktif, badge |
| `--warn-bg / --warn-ink` | `#fff4e0 / #7a4b00` | `#3a2e17 / #f3cf8f` | catatan, peringatan |
| `--bad` | `#b3261e` | `#ff8a80` | yield rendah, galat |

Warna kelompok aplikasi di hub (ikon tile):
- **Input harian** (Produksi, Packing, Gudang): hijau `--t-input`
- **Pantau & cetak** (Hari Ini, Label): biru `--t-monitor` `#2b5d8a`
- **Lark Base** (link keluar): ungu `--t-base` `#6b4fa0`

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
- **Hub**: header (logo G, nama, akun) → sapaan + tanggal → grup tile. Tile = kotak ikon berwarna + judul + deskripsi 1 baris. Badge "Terakhir dibuka" pada app terakhir.
- **Viewer**: bar atas 52 px (kembali · ikon+judul · pemilih app · muat ulang · layar penuh). Di HP (≤ 720 px) pemilih app pindah ke **tab bar bawah** 58 px dengan ikon + label.
- **App di dalam viewer** (`html.embed`): header dan tab app disembunyikan; bar Submit menempel di bawah iframe.
- Status memuat: spinner + teks abu. Galat: teks tebal + tombol "Kembali ke menu".

## Bahasa
Hub dan viewer berbahasa Indonesia. Isi app masih campuran (label kolom Inggris); ganti bertahap, jangan setengah layar.
