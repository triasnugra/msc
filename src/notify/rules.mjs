// Aturan notifikasi otomatis (6.F). ID stabil: OTO-<KODE>-<MESIN>[-<FLAG>]. Tingkat doktrin: SEDANG; naik TINGGI bila uji bukti
// (6.H.3) menunjukkan grup ber-flag lebih buruk (n>=30 kedua grup); turun INFO bila terbukti tidak berpengaruh (n>=30).
import { median, rKeTp1 } from '../core/levels.mjs';

const FLAG_DOKTRIN = ['MID_RANGE', 'STOP_LEBAR', 'STOP_SANGAT_LEBAR', 'LAWAN_TREN', 'LIKUIDITAS_RENDAH', 'NON_MAJOR_ASING', 'JENDELA_VOLUME_RENDAH', 'COOLDOWN_PASCA_SHOCK', 'OVERTRADING', 'KLASTER_SATU_ARAH', 'LEVERAGE_TINGGI', 'TANPA_KONFIRMASI'];
const DOC_FLAG = { MID_RANGE: 'DOC-01', STOP_LEBAR: 'DOC-04', STOP_SANGAT_LEBAR: 'DOC-04', LAWAN_TREN: 'DOC-06', LIKUIDITAS_RENDAH: 'DOC-08', NON_MAJOR_ASING: 'DOC-08', JENDELA_VOLUME_RENDAH: 'DOC-10', COOLDOWN_PASCA_SHOCK: 'DOC-12', OVERTRADING: 'DOC-11', KLASTER_SATU_ARAH: 'DOC-11', LEVERAGE_TINGGI: 'DOC-14', TANPA_KONFIRMASI: 'DOC-02' };
const TKT_ANOMALI = { RANTAI_HASH_PUTUS: 'KRITIS', MESIN_BASI: 'TINGGI', JURNAL_TERPOTONG: 'TINGGI', ENTRY_TERBALIK: 'TINGGI', LEVEL_TIDAK_KONSISTEN: 'TINGGI', R_TIDAK_KONSISTEN: 'TINGGI', ADAPTER_ERROR: 'TINGGI', SKEMA_BERUBAH: 'TINGGI', FIELD_HILANG: 'SEDANG', PENUTUPAN_MASSAL: 'SEDANG', ID_KEMBAR: 'SEDANG', STATUS_INVALID: 'INFO', STATUS_TAK_DIKENAL: 'SEDANG', WAKTU_TIDAK_VALID: 'SEDANG', SUMBER_GAGAL: 'TINGGI' };
const DOC_ANOMALI = { PENUTUPAN_MASSAL: ['DOC-26'], JURNAL_TERPOTONG: ['DOC-26'], ENTRY_TERBALIK: ['DOC-03'] };

export function aturanOtomatis({ mesin, gabungan, uji, profil, eventInfo, klaim, defHash, defHashLama, th, nowMs }) {
  const out = [];
  const N = (kode, m, tingkat, judul, bukti, dampak, tindakan, doc = [], suffix = '') => out.push({ id: `OTO-${kode}-${m}${suffix}`, mesin: m, tingkat, jenis: 'OTOMATIS', judul, bukti, dampak, tindakan, doc, status: 'BARU', sumber: 'aturan', tDeteksi: nowMs });
  const th_ = th.notifikasi, minN = th_.minNStatistik;
  const pct = (x) => (x * 100).toFixed(0) + '%';

  for (const m of mesin) {
    const id = m.cfg.id, ring = m.ring, rows = m.rows;
    if (ring.n >= minN) {
      if (ring.expectancy < 0) N('EXP-NEG', id, 'TINGGI', 'Ekspektasi bersih negatif', `n=${ring.n}, rata-rata R bersih ${ring.expectancy.toFixed(3)}`, 'Mesin rugi pada sampel ini', 'Evaluasi hipotesis; jangan setel ke data terbaru; uji out-of-sample', ['DOC-17']);
      if (ring.pf !== null && ring.pf < 1) N('PF-LT1', id, 'TINGGI', 'Profit factor di bawah 1', `n=${ring.n}, PF ${ring.pf.toFixed(2)}`, 'Total kalah lebih besar dari total menang', 'Evaluasi hipotesis dan biaya', ['DOC-17']);
      if (ring.ci && ring.ci.lo < 0) N('CI-NEG', id, 'SEDANG', 'CI95 bawah rata-rata R negatif', `n=${ring.n}, CI95 [${ring.ci.lo.toFixed(2)}, ${ring.ci.hi.toFixed(2)}]`, 'Edge belum terbukti berbeda dari nol', 'Kumpulkan sampel sesuai protokol', ['DOC-17']);
      if (ring.top3ShareWins !== null && ring.top3ShareWins * 100 > th_.konsentrasiTop3Persen) N('TOP3', id, 'SEDANG', 'Hasil bertumpu pada 3 trade teratas', `3 kemenangan terbesar = ${pct(ring.top3ShareWins)} dari total R menang`, 'Hasil rapuh terhadap outlier', 'Periksa distribusi R', ['DOC-26']);
      if (ring.maxDDvsTotal !== null && ring.maxDDvsTotal > th_.ddTerhadapTotalRasio) N('DD', id, 'SEDANG', 'Drawdown besar terhadap total R', `DD ${ring.maxDD.toFixed(1)}R vs total ${ring.totalR.toFixed(1)}R (${pct(ring.maxDDvsTotal)})`, 'Kurva ekuitas tidak stabil', 'Periksa ukuran posisi dan klaster', ['DOC-11']);
    }
    // fill rate (hanya yang statusnya diketahui)
    const terisi = rows.filter((r) => r.terisi === true).length, tak = rows.filter((r) => r.terisi === false).length;
    if (terisi + tak >= minN && tak / (terisi + tak) * 100 > th_.tidakTerisiPersenMaks) {
      const fr = terisi / (terisi + tak) * 100;
      N('FILL', id, fr < th_.fillRateRendahPersen ? 'TINGGI' : 'SEDANG', 'Banyak sinyal tidak terisi', `tidak terisi ${tak} dari ${terisi + tak} (${(100 - fr).toFixed(0)}%)`, 'Entry limit sering tidak tercapai', 'Tinjau jarak limit dan masa order', ['DOC-03']);
    }
    // arah dan hasil satu sisi (DOC-16)
    const dir = rows.filter((r) => r.arah);
    if (dir.length >= minN) {
      const L = dir.filter((r) => r.arah === 'LONG').length, mx = Math.max(L, dir.length - L) / dir.length * 100;
      if (mx > th_.satuArahPersen) N('ARAH', id, 'SEDANG', 'Sinyal bertumpu pada satu arah', `${mx.toFixed(0)}% dari ${dir.length} sinyal ${L >= dir.length - L ? 'LONG' : 'SHORT'}`, 'Bias arah permanen', 'Periksa filter arah dan rezim', ['DOC-16']);
    }
    if (ring.n >= minN && ring.wins / ring.n * 100 > th_.satuArahPersen) N('MENANG-TINGGI', id, 'SEDANG', 'Persentase menang tidak wajar tinggi', `${pct(ring.wins / ring.n)} menang dari ${ring.n}`, 'Curigai simulasi terlalu optimistis', 'Periksa fill dan hasil hardcode', ['DOC-16']);
    // integritas R:R (DOC-05)
    const pasang = rows.filter((r) => Number.isFinite(r.rrMesin) && Number.isFinite(rKeTp1(r.entry, r.sl, r.tp1)));
    if (pasang.length >= th_.rrMinPasang) {
      const a = median(pasang.map((r) => r.rrMesin)), b = median(pasang.map((r) => rKeTp1(r.entry, r.sl, r.tp1)));
      if (a / b > th_.rrMedianVsTp1Rasio) N('RR-TP2', id, 'TINGGI', 'R:R jurnal jauh di atas R ke TP1', `median rr jurnal ${a.toFixed(2)} vs median R ke TP1 ${b.toFixed(2)} (n=${pasang.length})`, 'rr dihitung ke TP2; gerbang minRR tidak menyaring', 'Hitung rr ke TP1 dari harga nyata', ['DOC-05']);
    }
    // kualitas data
    const closed = rows.filter((r) => r.status === 'CLOSED');
    const hardcode = closed.filter((r) => r.kualitasData.includes('HASIL_HARDCODE')).length, fillTak = closed.filter((r) => r.kualitasData.includes('TIDAK_TERVERIFIKASI_FILL')).length;
    if (hardcode) N('HARDCODE', id, 'TINGGI', 'Hasil R di-hardcode oleh mesin', `${hardcode} dari ${closed.length} trade selesai`, 'R tidak mencerminkan harga nyata', 'Hitung R dari harga exit dan biaya', ['DOC-13']);
    if (fillTak) N('FILL-TAK-TERVERIFIKASI', id, 'SEDANG', 'Fill entry tidak diverifikasi', `${fillTak} dari ${closed.length} trade selesai`, 'Hasil bisa meleset', 'Verifikasi fill lewat candle', ['DOC-03']);
    // anomali -> notifikasi (satu per kode per mesin)
    const per = new Map();
    for (const a of m.anomali) { const e = per.get(a.kode) ?? { n: 0, ids: [], pesan: a.pesan, bukti: a.bukti }; e.n++; e.ids.push(...(a.ids ?? [])); per.set(a.kode, e); }
    for (const [kode, e] of per) N(`ANOM-${kode}`, id, TKT_ANOMALI[kode] ?? 'SEDANG', `Anomali: ${kode}`, `${e.n}x. ${e.pesan}${e.ids.length ? ' [' + e.ids.slice(0, 4).join(', ') + (e.ids.length > 4 ? ', ...' : '') + ']' : ''}`, 'Integritas data mesin', 'Periksa sumber data mesin', DOC_ANOMALI[kode] ?? []);
    // klaim dokumen
    const k = klaim?.[id], versiTerakhir = [...rows].filter((r) => r.versi).sort((a, b) => b.waktuUtc - a.waktuUtc)[0]?.versi;
    if (k && versiTerakhir && versiTerakhir !== k.versi) N('KLAIM-VERSI', id, 'TINGGI', 'Versi config tidak sesuai klaim dokumen', `jurnal terbaru strategy_version ${versiTerakhir}; ${k.sumber} mengklaim ${k.versi}`, 'Dokumen menyatakan upgrade yang tidak berjalan', 'Selesaikan upgrade atau koreksi dokumen', ['DOC-25']);
    // doktrin
    const pr = profil?.[id]?.[defHash];
    if (pr) for (const f of FLAG_DOKTRIN) {
      const c = pr.flags[f] ?? 0, p = pr.persen?.[f] ?? 0;
      if (c < th_.doktrinMinBerFlag || p < th_.doktrinPersenMin) continue;
      const u = uji?.[id]?.[f];
      let tkt = th_.tingkatAwalDoktrin, ket = 'uji bukti: belum bermakna';
      if (u?.bermakna) { if (u.lebihBuruk) { tkt = 'TINGGI'; ket = `ber-flag lebih buruk (selisih ${u.selisih.toFixed(2)}R, n ${u.nA}/${u.nB})`; } else if (u.tidakTerbukti) { tkt = 'INFO'; ket = `tidak terbukti berpengaruh (n ${u.nA}/${u.nB})`; } else ket = 'uji bukti: bermakna, tidak ada keputusan'; }
      N('DOKTRIN', id, tkt, `Banyak sinyal ber-flag ${f}`, `${c} dari ${pr.n} sinyal (${p.toFixed(0)}%); ${ket}`, 'Sinyal menyalahi prinsip doktrin (hipotesis)', 'Tinjau filter terkait di mesin; uji out-of-sample', [DOC_FLAG[f]], '-' + f);
    }
  }
  // lintas mesin
  if (eventInfo && eventInfo.manualKosong && !eventInfo.resmiOk) N('EVENT-KOSONG', 'LINTAS', 'SEDANG', 'Jadwal FOMC/CPI belum terverifikasi', 'data/events.json kosong dan pengambilan resmi gagal. scv2 hanya punya FOMC 9 Des 2026 "verifikasi tanggal"; sctn event_blackouts kosong', 'Flag EVENT_DEKAT tidak bisa dihitung', 'Isi data/events.json dari federalreserve.gov dan bls.gov', ['DOC-10', 'DOC-20']);
  if (defHashLama && defHashLama !== defHash) N('DEFINISI', 'LINTAS', 'INFO', 'Definisi operasional berubah: epoch baru', `definisi_hash ${defHashLama} -> ${defHash}`, 'Statistik audit dihitung terpisah per epoch', 'Jangan mencampur statistik lama dan baru', ['DOC-25']);
  return out;
}
