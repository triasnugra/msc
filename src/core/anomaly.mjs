// Deteksi anomali umum. Menerima baris kanonik + meta adapter. Tidak melempar error.
const A = (kode, tingkat, mesin, pesan, ids = [], bukti = null) => ({ kode, tingkat, mesin, pesan, ids, bukti });

export function deteksiAnomali(rows, meta, mesinCfg, nowMs, th) {
  const out = [];
  const id = mesinCfg.id;
  const naik = (r) => r.arah === 'LONG';

  for (const r of rows) {
    if (!Number.isFinite(r.waktuUtc)) out.push(A('WAKTU_TIDAK_VALID', 'SEDANG', id, `Baris ${r.id}: waktu sinyal tidak valid`, [r.id]));
    if (r.entryTerbalik) out.push(A('ENTRY_TERBALIK', 'TINGGI', id, `Baris ${r.id}: zona entry terbalik (low>high)`, [r.id], { entryLow: r.entryLow, entryHigh: r.entryHigh }));
    if (Number.isFinite(r.entry) && Number.isFinite(r.sl)) {
      const slOk = naik(r) ? r.sl < r.entry : r.sl > r.entry;
      const tpOk = !Number.isFinite(r.tp1) || (naik(r) ? r.tp1 > r.entry : r.tp1 < r.entry);
      if (!slOk || !tpOk) out.push(A('LEVEL_TIDAK_KONSISTEN', 'TINGGI', id, `Baris ${r.id}: urutan SL/entry/TP1 tidak masuk akal untuk ${r.arah}`, [r.id]));
    }
    if (r.status === 'CLOSED' && Number.isFinite(r.R_mesin)) {
      if (r.hasilKelas === 'SL' && r.R_mesin > 0) out.push(A('R_TIDAK_KONSISTEN', 'TINGGI', id, `Baris ${r.id}: hasil SL tetapi R positif (${r.R_mesin})`, [r.id]));
      if (r.hasilKelas === 'TP' && r.R_mesin < 0) out.push(A('R_TIDAK_KONSISTEN', 'TINGGI', id, `Baris ${r.id}: hasil TP tetapi R negatif (${r.R_mesin})`, [r.id]));
    }
  }

  const seen = new Map();
  for (const r of rows) seen.set(r.id, (seen.get(r.id) || 0) + 1);
  const dup = [...seen].filter(([, c]) => c > 1).map(([k]) => k);
  if (dup.length) out.push(A('ID_KEMBAR', 'SEDANG', id, `${dup.length} ID muncul lebih dari sekali`, dup));

  if (meta.selesaiTsJenis === 'jam_dinding') {
    const g = new Map();
    for (const r of rows) if (r.status === 'CLOSED' && Number.isFinite(r.selesaiTs)) { const k = r.selesaiTs; if (!g.has(k)) g.set(k, []); g.get(k).push(r.id); }
    for (const [ts, ids] of g) if (ids.length >= (th?.anomali?.penutupanMassalMinSinyal ?? 2)) {
      out.push(A('PENUTUPAN_MASSAL', 'SEDANG', id, `${ids.length} sinyal ditutup pada timestamp yang sama (${new Date(ts).toISOString()}); waktu hasil adalah jam run, bukan waktu candle`, ids));
    }
  }

  if (meta.terpotong) out.push(A('JURNAL_TERPOTONG', 'TINGGI', id, `Jurnal mesin sudah mencapai batas pemotongan (${mesinCfg.pemotongan?.batas}); riwayat lama di mesin hilang. Arsip monitor menjaga riwayat sejak monitor aktif.`, [], { bukti: mesinCfg.pemotongan?.bukti }));

  if (meta.chain && meta.chain.ok === false) out.push(A('RANTAI_HASH_PUTUS', 'KRITIS', id, `Rantai hash putus: ${meta.chain.pesan}`, [], meta.chain));

  if (Number.isFinite(meta.lastUpdateMs) && Number.isFinite(mesinCfg.kadensiMenit)) {
    const umur = (nowMs - meta.lastUpdateMs) / 60000;
    const batas = mesinCfg.kadensiMenit * (th?.anomali?.celahUpdateToleransiKali ?? 2);
    if (umur > batas) out.push(A('MESIN_BASI', 'TINGGI', id, `Update terakhir ${Math.round(umur)} menit lalu; batas ${batas} menit (kadensi ${mesinCfg.kadensiMenit} x toleransi)`, [], { umurMenit: umur }));
  }
  return out;
}
