// Prompt upgrade untuk Claude (per notifikasi atau per mesin). Tidak memuat rahasia.
const LARANGAN = [
  'WAJIB uji out-of-sample; DILARANG menyetel parameter ke data terbaru.',
  'DILARANG mengubah core mesin selama forward test berjalan tanpa memulai protokol baru: epoch/strategy_hash/versi baru, dan statistik lama tidak dicampur dengan yang baru.',
  'Berikan KODE LENGKAP siap pakai (tanpa potongan, tanpa placeholder) dan test dengan nilai yang bisa dihitung tangan.',
  'Semua klaim tentang kode harus menyebut file dan fungsi/baris, atau berlabel TIDAK TERVERIFIKASI.'
];

const satu = (n) => `- [${n.tingkat}] ${n.id} (${n.mesin}): ${n.judul}\n  Bukti: ${n.bukti}\n  Dampak: ${n.dampak}\n  Tindakan disarankan: ${n.tindakan}${n.doc?.length ? '\n  Doktrin: ' + n.doc.join(', ') : ''}`;

export function promptUpgrade({ notifs, mesin = null, definisiHash }) {
  const dipilih = mesin ? notifs.filter((n) => n.mesin === mesin) : notifs;
  const kepala = mesin ? `Tolong perbaiki mesin scalping "${mesin}" berdasarkan temuan monitor msc berikut.` : 'Tolong perbaiki temuan monitor msc berikut.';
  return [
    kepala,
    definisiHash ? `(definisi_hash monitor: ${definisiHash}; flag doktrin adalah hipotesis, bukan kebenaran.)` : '',
    '', 'TEMUAN:', dipilih.length ? dipilih.map(satu).join('\n') : '(tidak ada)',
    '', 'PERMINTAAN: analisis akar masalah tiap temuan, usulkan perbaikan, dan tulis kode lengkap file yang berubah.',
    '', 'ATURAN:', ...LARANGAN.map((x, i) => `${i + 1}. ${x}`)
  ].filter((x, i) => x !== '' || i > 0).join('\n');
}
