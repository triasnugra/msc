// Adapter sc. Sumber: data/journal.json (array datar). Bukti skema: scripts/scan.mjs, trade-sim.mjs gradeTrade.
// Field: id, agen, aset, arah, entry, sl, tp, hasil(menunggu/TP/SL/kedaluwarsa/tidak terisi), R, waktu, t0, tx, setup, regime, skor, alasan.
import { buatBaris, num, parseTs, baseKoin, arahDari, petaTrigger, periksaField } from '../core/schema.mjs';

const WAJIB = ['id', 'aset', 'arah', 'entry', 'sl', 'tp', 'hasil', 't0'];

export function adaptSc(raw, ctx) {
  const anomali = [], rows = [];
  if (!Array.isArray(raw)) return { rows, anomali: [{ kode: 'SKEMA_BERUBAH', tingkat: 'TINGGI', mesin: 'sc', pesan: 'journal.json bukan array', ids: [] }], meta: {} };
  for (const j of raw) {
    anomali.push(...periksaField(j, WAJIB, 'sc', j?.id ?? '?'));
    const hasil = j.hasil;
    const status = hasil === 'menunggu' ? 'PENDING' : hasil === 'tidak terisi' ? 'EXPIRED' : ['TP', 'SL', 'kedaluwarsa'].includes(hasil) ? 'CLOSED' : 'PENDING';
    const kelas = hasil === 'TP' ? 'TP' : hasil === 'SL' ? 'SL' : hasil === 'kedaluwarsa' ? 'WAKTU' : hasil === 'tidak terisi' ? 'TIDAK_TERISI' : null;
    const tr = petaTrigger(ctx.petaTrigger, j.setup);
    rows.push(buatBaris({
      id: j.id, koin: baseKoin(j.aset), arah: arahDari(j.arah), entry: j.entry, sl: j.sl, tp1: j.tp, tp2: null,
      waktuUtc: parseTs(j.t0), selesaiTs: parseTs(j.tx), status,
      terisi: hasil === 'tidak terisi' ? false : (hasil === 'menunggu' ? null : true),
      hasilMesin: hasil, hasilKelas: kelas, R_mesin: status === 'CLOSED' ? num(j.R) : null, rrMesin: 1.8,
      tipeTrigger: tr.tipe, triggerAsli: j.setup, triggerStatus: tr.status, tf: '15m', skor: j.skor,
      kualitasData: ['LENGKAP'] // fill dinilai dari candle 5m (trade-sim.mjs), SL didahulukan
    }, ctx));
  }
  return { rows, anomali, meta: { selesaiTsJenis: 'candle', terpotong: false, lastUpdateMs: null } };
}
