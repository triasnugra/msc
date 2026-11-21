// Adapter scv6. Sumber: data/journal.json {updatedAt, stats, activeSignals, closedSignals}.
// Catatan kualitas (bukti di src/forward-tracker.mjs): realizedR hardcode; fill tidak diverifikasi; hasil dinilai dari candle 15m terakhir + harga.
import { buatBaris, num, parseTs, baseKoin, arahDari, petaTrigger, periksaField } from '../core/schema.mjs';

const WAJIB = ['id', 'createdAt', 'symbol', 'direction', 'setupCode', 'entryLow', 'entryHigh', 'initialStopLoss', 'tp1', 'tp2'];
const TUTUP = { TP2_FULL_WIN: ['CLOSED', 'TP'], TP1_BE_PROTECTED: ['CLOSED', 'BE'], STOPPED_OUT: ['CLOSED', 'SL'], TP1_EXPIRED_PROFIT: ['CLOSED', 'WAKTU'], EXPIRED_NO_FILL: ['EXPIRED', 'TIDAK_TERISI'] };

function satu(j, aktif, ctx, anomali) {
  anomali.push(...periksaField(j, WAJIB, 'scv6', j?.id ?? '?'));
  const lo = num(j.entryLow), hi = num(j.entryHigh);
  const terbalik = lo !== null && hi !== null && lo > hi;
  const mid = (lo !== null && hi !== null) ? (lo + hi) / 2 : null;
  let status, kelas = null;
  if (aktif) status = j.tp1Hit ? 'OPEN' : 'PENDING';
  else { const t = TUTUP[j.status]; status = t ? t[0] : 'PENDING'; kelas = t ? t[1] : null; if (!t) anomali.push({ kode: 'STATUS_TAK_DIKENAL', tingkat: 'SEDANG', mesin: 'scv6', pesan: `Baris ${j.id}: status "${j.status}" tidak dikenal`, ids: [j.id] }); }
  const tr = petaTrigger(ctx.petaTrigger, j.setupCode);
  const lev = /(\d+(?:\.\d+)?)\s*x/i.exec(j.sizing?.suggestedIsolatedLeverage ?? '');
  const kual = ['TIDAK_TERVERIFIKASI_FILL'];
  if (!aktif && status === 'CLOSED') kual.push('HASIL_HARDCODE');
  return buatBaris({
    id: j.id, koin: baseKoin(j.symbol ?? j.pair), arah: arahDari(j.direction), entry: mid, entryLow: lo !== null && hi !== null ? Math.min(lo, hi) : lo, entryHigh: lo !== null && hi !== null ? Math.max(lo, hi) : hi,
    entryTerbalik: terbalik, sl: j.initialStopLoss, tp1: j.tp1, tp2: j.tp2, stopPct: j.stopDistancePct,
    waktuUtc: parseTs(j.createdAt), selesaiTs: parseTs(j.closedAt), status, terisi: status === 'EXPIRED' ? false : null,
    hasilMesin: j.status ?? null, hasilKelas: kelas, R_mesin: status === 'CLOSED' ? num(j.realizedR) : null, rrMesin: j.rr,
    tipeTrigger: tr.tipe, triggerAsli: j.setupCode, triggerStatus: tr.status, tf: '15m', leverageSaran: lev ? Number(lev[1]) : null,
    kualitasData: kual
  }, ctx);
}

export function adaptScv6(raw, ctx) {
  const anomali = [], rows = [];
  if (!raw || !Array.isArray(raw.activeSignals) || !Array.isArray(raw.closedSignals)) {
    return { rows, anomali: [{ kode: 'SKEMA_BERUBAH', tingkat: 'TINGGI', mesin: 'scv6', pesan: 'journal.json tidak berbentuk {activeSignals, closedSignals}', ids: [] }], meta: {} };
  }
  for (const j of raw.closedSignals) rows.push(satu(j, false, ctx, anomali));
  for (const j of raw.activeSignals) rows.push(satu(j, true, ctx, anomali));
  const bC = ctx.mesin.pemotongan?.batas;
  const terpotong = Number.isFinite(bC) && raw.closedSignals.length >= bC;
  return { rows, anomali, meta: { selesaiTsJenis: 'jam_dinding', terpotong, lastUpdateMs: parseTs(raw.updatedAt) } };
}
