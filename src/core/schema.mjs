// Skema kanonik (6.B) + utilitas normalisasi. Tidak ada tebakan: nilai tak valid menjadi null.
import { rBersih } from './cost.mjs';
import { stopPctDari } from './levels.mjs';

export const ARAH = ['LONG', 'SHORT'];
export const STATUS = ['PENDING', 'OPEN', 'CLOSED', 'EXPIRED']; // EXPIRED = batal/kedaluwarsa/tidak terisi
export const KUALITAS = ['LENGKAP', 'TERPOTONG', 'TIDAK_TERVERIFIKASI_FILL', 'HASIL_HARDCODE', 'REKONSTRUKSI'];
export const TIPE_TRIGGER = ['DEVIATION_RECLAIM', 'BREAKOUT_RETEST', 'LEVEL_FLIP', 'TRENDLINE_BREAK_RETEST', 'THREE_TAP', 'FIB_PULLBACK', 'TANPA_KONFIRMASI', 'TIDAK_TERPETAKAN'];

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

// Waktu -> epoch ms. Menerima epoch (detik atau ms), ISO, "YYYY-MM-DD HH:MM:SS+00:00", "YYYY-MM-DD HH:MM UTC".
export function parseTs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : null;
  let s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseTs(Number(s));
  s = s.replace(/ UTC$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
  if (/T\d{2}:\d{2}Z$/.test(s)) s = s.replace('Z', ':00Z');
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// "ETH/USDT", "ETHUSDT", "ETH" -> "ETH"
export function baseKoin(sym) {
  if (!sym) return null;
  return String(sym).toUpperCase().replace('/', '').replace(/USDT$/, '') || null;
}

export const arahDari = (v) => { const s = String(v ?? '').toUpperCase(); return s === 'LONG' || s === 'SHORT' ? s : null; };

// Memetakan nama setup/trigger mesin ke tipe baku lewat definitions.petaTriggerMesin[mesin].
export function petaTrigger(peta, kunci) {
  const e = peta?.[kunci];
  if (!e) return { tipe: 'TIDAK_TERPETAKAN', status: 'TIDAK_TERVERIFIKASI', bukti: 'kunci trigger tidak ada di definitions.json' };
  return { tipe: e.tipeBaku ?? e.tipe, status: e.status, bukti: e.bukti };
}

// Membuat baris kanonik. p = field mentah yang sudah dinormalisasi adapter. ctx.costPct dipakai bila R belum net.
export function buatBaris(p, ctx) {
  const entry = num(p.entry), sl = num(p.sl);
  const stopPct = num(p.stopPct) ?? stopPctDari(entry, sl);
  const rMesin = num(p.R_mesin);
  const sudahNet = !!ctx.mesin.rSudahNet;
  const trade = p.status === 'CLOSED' && p.terisi !== false;
  const kualitas = Array.isArray(p.kualitasData) && p.kualitasData.length ? p.kualitasData : ['LENGKAP'];
  return {
    mesin: ctx.mesin.id,
    id: String(p.id),
    koin: p.koin,
    arah: p.arah,
    entry, entryLow: num(p.entryLow) ?? entry, entryHigh: num(p.entryHigh) ?? entry,
    entryTerbalik: !!p.entryTerbalik,
    sl, tp1: num(p.tp1), tp2: num(p.tp2),
    waktuUtc: p.waktuUtc ?? null,
    selesaiTs: p.selesaiTs ?? null,
    fillTs: p.fillTs ?? null,
    status: p.status,
    terisi: p.terisi === undefined ? null : p.terisi,
    hasilMesin: p.hasilMesin ?? null,
    hasilKelas: p.hasilKelas ?? null,
    R_mesin: rMesin,
    R_kotor: num(p.R_kotor),
    R_bersih: trade ? rBersih(rMesin, stopPct, ctx.mesin.biayaPct ?? ctx.costPctDefault, sudahNet) : null,
    R_sudah_net: sudahNet,
    rrMesin: num(p.rrMesin),
    versi: p.versi ?? null,
    hash: p.hash ?? null,
    tipeTrigger: p.tipeTrigger ?? 'TIDAK_TERPETAKAN',
    triggerAsli: p.triggerAsli ?? null,
    triggerStatus: p.triggerStatus ?? 'TIDAK_TERVERIFIKASI',
    tf: p.tf ?? null,
    stopPct,
    leverageSaran: num(p.leverageSaran),
    kualitasData: kualitas,
    mode: p.mode ?? 'SCALP',
    sumber: p.sumber ?? 'forward',
    skor: num(p.skor)
  };
}

// Pemeriksa field wajib: mengembalikan daftar anomali, TIDAK melempar.
export function periksaField(obj, wajib, mesin, idRef) {
  const hilang = wajib.filter((f) => obj?.[f] === undefined);
  return hilang.length ? [{ kode: 'FIELD_HILANG', tingkat: 'SEDANG', mesin, pesan: `Baris ${idRef}: field hilang ${hilang.join(', ')}`, ids: [idRef] }] : [];
}

export const adalahSelesai = (r) => r.status === 'CLOSED' || r.status === 'EXPIRED';
