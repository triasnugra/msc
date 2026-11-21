# msc - Monitor 6 mesin scalping (sc, scv2, scv4, scv5, scv6, sctn)

Monitor ini hanya MEMBACA jurnal keenam mesin. Tidak mengubah mesin apa pun, tidak mengirim order, dan bukan nasihat finansial.
Setiap 15 menit GitHub Actions mengambil jurnal, menyeragamkan skema, menghitung statistik, flag doktrin, keputusan monitor,
audit, dan notifikasi, lalu menerbitkan dashboard Bahasa Indonesia ke GitHub Pages.

## Langkah setelah upload
1. Buat repo **msc** (root repo = isi folder ini) lalu upload semua file, termasuk folder `.github`.
2. **Settings > Pages > Build and deployment > Source: GitHub Actions.**
3. **Settings > Actions > General > Workflow permissions: Read and write permissions.**
4. Secret (Settings > Secrets and variables > Actions), semuanya opsional:
   - `MONITOR_TOKEN`: token baca untuk repo mesin yang PRIVAT (fine-grained, Contents: Read). Tidak perlu bila repo mesin publik.
   - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, atau `DISCORD_WEBHOOK_URL`: push notifikasi baru/naik tingkat dan ringkasan harian.
5. Cek `config/config.json`: nama repo tiap mesin (`repo`) dan `sumber.baseUrlPages` adalah ASUMSI (`triasnugra/<id>`). Sesuaikan bila berbeda.
6. **Run pertama:** tab Actions > workflow `monitor` > Run workflow. Setelah hijau, buka `https://<user>.github.io/msc/`.
7. Isi `data/events.json` dengan jadwal FOMC/CPI dari sumber resmi (federalreserve.gov, bls.gov) sebagai cadangan. Monitor tidak mengarang tanggal.
8. Bila ada profil SPOT, isi `modeSpotHashes` di `config/config.json` dengan strategy_hash-nya (DOC-24).

## Bila gagal
- Actions > run merah > langkah "Uji (gerbang)": ada test gagal; baca pesan test.
- Langkah "Commit state dan arsip": gagal setelah 5 percobaan = run sengaja dihentikan agar data basi tidak terbit. Jalankan ulang.
- Dashboard berbanner "Data X gagal diambil": mesin tersebut tidak terjangkau (repo privat tanpa MONITOR_TOKEN, nama repo salah, Pages mesin mati). Tampilan memakai arsip.
- Banner "Konteks pasar tidak tersedia": semua sumber harga gagal/diblokir (HTTP 451). Keputusan maksimal TUNGGU.
- Lokal: `npm test` (Node 22) dan `npm run build`.

## Aturan penting
- Definisi operasional di `config/definitions.json` terkunci dengan hash. Mengubahnya memulai epoch baru; statistik audit tidak dicampur lintas epoch.
- Semua ambang ada di `config/thresholds.json` dan berstatus HIPOTESIS (bukan hasil optimasi).
- Keputusan monitor dicatat saat sinyal pertama terlihat (`data/archive/keputusan.jsonl`), tanpa backfill dan tanpa ditulis ulang.
- `data/archive/*.jsonl` append-only. Jangan diedit manual.
- Status notifikasi (BARU/DILIHAT/SELESAI/DITUNDA) diubah di `data/state/notif.json`.
