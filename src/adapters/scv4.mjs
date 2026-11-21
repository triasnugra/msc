// Adapter scv4. Sumber: history.json di GitHub Pages {signals:[...]} (scalp/tracker.py add_signal, update_open_signals).
// Fill TIDAK diverifikasi (scalp/risk.py simulate_trade mulai dari waktu sinyal) => TIDAK_TERVERIFIKASI_FILL.
// R sudah net biaya (risk.py: SL = -1 - cost_r).
import { buatBaris, num, parseTs, baseKoin, arahDari, petaTrigger, periksaField } from '../core/schema.mjs';

const WAJIB = ['id', 'symbol', 'direction', 'trigger', 'time', 'entry', 'stop', 'status'];
const CLOSED = { SL: 'SL', TP2: 'TP', TP1_BE: 'BE', TIME: 'WAKTU', TP1_TIME: 'WAKTU' };

export function adaptScv4(raw, ctx) {
  const anomali = [], rows = [];
  const arr = raw && Array.isArray(raw.signals) ? raw.signals : null;
  if (!arr) return { rows, anomali: [{ kode: 'SKEMA_BERUBAH', tingkat: 'TINGGI', mesin: 'scv4', pesan: 'history.json tidak berbentuk {signals:[...]}', ids: [] }], meta: {} };
  const batas = ctx.mesin.pemotongan?.batas;
  const terpotong = Number.isFinite(batas) && arr.length >= batas;
  for (const j of arr) {
    anomali.push(...periksaField(j, WAJIB, 'scv4', j?.id ?? '?'));
    const st = String(j.status || '');
    let status, kelas = null, terisi = null;
    if (st === 'OPEN' || st === 'TP1_OPEN') { status = 'OPEN'; terisi = null; }
    else if (st === 'INVALID') { status = 'EXPIRED'; terisi = false; kelas = 'TIDAK_TERISI'; anomali.push({ kode: 'STATUS_INVALID', tingkat: 'SEDANG', mesin: 'scv4', pesan: `Baris ${j.id}: status INVALID (risk<=0); di scv4 closed_at=None sehingga terhitung open selamanya`, ids: [j.id] }); }
    else if (CLOSED[st]) { status = 'CLOSED'; kelas = CLOSED[st]; terisi = null; }
    else { status = 'PENDING'; anomali.push({ kode: 'STATUS_TAK_DIKENAL', tingkat: 'SEDANG', mesin: 'scv4', pesan: `Baris ${j.id}: status "${st}" tidak dikenal`, ids: [j.id] }); }
    const tr = petaTrigger(ctx.petaTrigger, j.trigger);
    rows.push(buatBaris({
      id: j.id, koin: baseKoin(j.symbol), arah: arahDari(j.direction), entry: j.entry, sl: j.stop, tp1: j.tp1, tp2: j.tp2,
      waktuUtc: parseTs(j.time), selesaiTs: parseTs(j.closed_at), status, terisi,
      hasilMesin: st, hasilKelas: kelas, R_mesin: status === 'CLOSED' ? num(j.r) : null,
      tipeTrigger: tr.tipe, triggerAsli: j.trigger, triggerStatus: tr.status, tf: '15m', skor: j.score,
      kualitasData: ['TIDAK_TERVERIFIKASI_FILL'].concat(terpotong ? ['TERPOTONG'] : [])
    }, ctx));
  }
  return { rows, anomali, meta: { selesaiTsJenis: 'candle', terpotong, lastUpdateMs: null } };
}
