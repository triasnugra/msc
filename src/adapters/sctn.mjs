// Adapter sctn. Sumber forward: forward_test.json {trades:[...]} digabung signal_log.csv (stop_pct, status saat sinyal, config_hash).
// Pages: /data/forward_test.json dan /data/signal_log.csv. Repo: output/forward_test.json dan output/signal_log.csv.
// Status "ENTRY ZONE" dianggap langsung terisi di src/evaluate/simulator.py baris 33-34 => TIDAK_TERVERIFIKASI_FILL.
import { parseCsv } from '../core/csv.mjs';
import { buatBaris, num, parseTs, baseKoin, arahDari, petaTrigger, periksaField } from '../core/schema.mjs';

const WAJIB = ['signal_id', 'asof', 'symbol', 'direction', 'trigger', 'entry', 'stop', 'status'];
const STATUS = { WAITING: 'PENDING', OPEN: 'OPEN', CLOSED: 'CLOSED', CANCELLED: 'EXPIRED' };

function kelasDariOutcome(o, r) {
  const s = String(o || '').toUpperCase();
  if (!s) return null;
  if (s.includes('SL') && !s.includes('TP')) return 'SL';
  if (s.includes('BE')) return 'BE';
  if (s.includes('TP2')) return 'TP';
  if (s.includes('TIME') || s.includes('TIMEOUT')) return 'WAKTU';
  if (s.includes('TP')) return 'TP';
  return Number.isFinite(r) ? (r < 0 ? 'SL' : null) : null;
}

export function adaptSctn(raw, ctx) {
  const anomali = [], rows = [];
  const trades = raw?.forward?.trades;
  if (!Array.isArray(trades)) return { rows, anomali: [{ kode: 'SKEMA_BERUBAH', tingkat: 'TINGGI', mesin: 'sctn', pesan: 'forward_test.json tidak punya trades[]', ids: [] }], meta: {} };
  const log = new Map(parseCsv(raw.signalLogCsv ?? '').map((r) => [r.signal_id, r]));
  for (const t of trades) {
    anomali.push(...periksaField(t, WAJIB, 'sctn', t?.signal_id ?? '?'));
    const l = log.get(t.signal_id);
    const status = STATUS[t.status] ?? 'PENDING';
    const instan = l?.status === 'ENTRY ZONE';
    const tr = petaTrigger(ctx.petaTrigger, t.trigger);
    const R = status === 'CLOSED' || status === 'OPEN' ? num(t.r) : null;
    rows.push(buatBaris({
      id: t.signal_id, koin: baseKoin(t.symbol), arah: arahDari(t.direction), entry: t.entry, sl: t.stop, tp1: t.tp1, tp2: t.tp2,
      stopPct: l ? num(l.stop_pct) : null, waktuUtc: parseTs(t.asof), selesaiTs: parseTs(t.exit_time), fillTs: parseTs(t.fill_time), status,
      terisi: status === 'EXPIRED' ? false : (status === 'PENDING' ? null : true),
      hasilMesin: t.outcome || null, hasilKelas: status === 'EXPIRED' ? 'TIDAK_TERISI' : kelasDariOutcome(t.outcome, R),
      R_mesin: status === 'CLOSED' ? R : null, versi: null, hash: l?.config_hash ?? null,
      tipeTrigger: tr.tipe, triggerAsli: t.trigger, triggerStatus: tr.status, tf: t.tf ?? l?.trigger_tf ?? null, skor: t.score,
      kualitasData: instan ? ['TIDAK_TERVERIFIKASI_FILL'] : ['LENGKAP']
    }, ctx));
  }
  return { rows, anomali, meta: { selesaiTsJenis: 'candle', terpotong: false, lastUpdateMs: parseTs(raw.forward.updated) } };
}

// Backtest sctn (sumber 'backtest'): dipisah dari forward, tidak dicampur dalam statistik forward.
export function adaptSctnBacktest(raw, ctx) {
  const rows = [], anomali = [];
  const csv = parseCsv(raw?.tradesCsv ?? '');
  for (const t of csv) {
    const stRaw = t.status;
    const status = stRaw === 'CLOSED' ? 'CLOSED' : stRaw === 'CANCELLED' ? 'EXPIRED' : 'OPEN';
    const instan = t.status_at_signal === 'ENTRY ZONE';
    const tr = petaTrigger(ctx.petaTrigger, t.trigger);
    rows.push(buatBaris({
      id: 'BT-' + t.signal_id + '-' + t.asof, koin: baseKoin(t.symbol), arah: arahDari(t.direction), entry: t.entry, sl: t.stop, tp1: t.tp1, tp2: t.tp2,
      waktuUtc: parseTs(t.asof), selesaiTs: parseTs(t.exit_time), fillTs: parseTs(t.fill_time), status,
      terisi: status === 'EXPIRED' ? false : true, hasilMesin: t.outcome || null, hasilKelas: status === 'EXPIRED' ? 'TIDAK_TERISI' : kelasDariOutcome(t.outcome, num(t.r)),
      R_mesin: status === 'CLOSED' ? num(t.r) : null, tipeTrigger: tr.tipe, triggerAsli: t.trigger, triggerStatus: tr.status, tf: t.tf, skor: t.score,
      kualitasData: instan ? ['TIDAK_TERVERIFIKASI_FILL'] : ['LENGKAP'], sumber: 'backtest',
      hash: raw.summary?.config_hash ?? null
    }, ctx));
  }
  return { rows, anomali, meta: { sumber: 'backtest', klaimMesin: raw?.summary?.stats ?? null } };
}
