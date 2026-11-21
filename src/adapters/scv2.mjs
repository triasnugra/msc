// Adapter scv2. Sumber: site/data/journal.json (Pages: /data/journal.json) atau branch "data": journal.json.
// Field dari scalp/journal.py make_signal + scalp/sim.py simulate: id, ts, symbol, side(long/short), trigger(T1-T4), tf, entry,
// entry_type, stop, tp1, tp2, stop_pct, cost_pct, rr_tp1, rr_tp2, score, leverage, status, outcome, r, fill_ts, exit_ts.
import { buatBaris, num, parseTs, baseKoin, arahDari, petaTrigger, periksaField } from '../core/schema.mjs';

const WAJIB = ['id', 'ts', 'symbol', 'side', 'entry', 'stop', 'status'];

export function adaptScv2(raw, ctx) {
  const anomali = [], rows = [];
  if (!Array.isArray(raw)) return { rows, anomali: [{ kode: 'SKEMA_BERUBAH', tingkat: 'TINGGI', mesin: 'scv2', pesan: 'journal.json bukan array', ids: [] }], meta: {} };
  const batas = ctx.mesin.pemotongan?.batas;
  const terpotong = Number.isFinite(batas) && raw.length >= batas;
  for (const j of raw) {
    anomali.push(...periksaField(j, WAJIB, 'scv2', j?.id ?? '?'));
    const st = String(j.status || '').toUpperCase();
    const status = st === 'PENDING' ? 'PENDING' : st === 'OPEN' ? 'OPEN' : st === 'CLOSED' ? 'CLOSED' : 'EXPIRED';
    const o = j.outcome ?? null;
    const kelas = o === 'SL' ? 'SL' : (o === 'TP2') ? 'TP' : o === 'TP1_BE' ? 'BE' : (o === 'TIME' || o === 'TIME2') ? 'WAKTU' : status === 'EXPIRED' ? 'TIDAK_TERISI' : null;
    const tr = petaTrigger(ctx.petaTrigger, j.trigger);
    const kual = [terpotong ? 'TERPOTONG' : 'LENGKAP'];
    if (o === 'DATA_HILANG') kual.push('REKONSTRUKSI');
    rows.push(buatBaris({
      id: j.id, koin: baseKoin(j.symbol), arah: arahDari(j.side), entry: j.entry, sl: j.stop, tp1: j.tp1, tp2: j.tp2,
      stopPct: j.stop_pct, waktuUtc: parseTs(j.ts), selesaiTs: parseTs(j.exit_ts), fillTs: parseTs(j.fill_ts), status,
      terisi: status === 'EXPIRED' ? false : (status === 'PENDING' ? null : true),
      hasilMesin: o, hasilKelas: kelas, R_mesin: status === 'CLOSED' ? num(j.r) : null, rrMesin: num(j.rr_tp1),
      tipeTrigger: tr.tipe, triggerAsli: j.trigger, triggerStatus: tr.status, tf: j.tf ?? null,
      leverageSaran: j.leverage, kualitasData: kual, skor: j.score
    }, ctx));
  }
  return { rows, anomali, meta: { selesaiTsJenis: 'candle', terpotong, lastUpdateMs: null } };
}
