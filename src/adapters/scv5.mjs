// Adapter scv5. Sumber: data/journal.jsonl (event: SIGNAL, FILL, TP1, CLOSE, EXPIRE; bukan baris datar).
// Record: {seq, ts, type, prev, data, hash}. State diturunkan lewat replay (scalp/journal.py replay).
// Rantai hash: hash = sha256(canon(rec tanpa 'hash')), canon = json.dumps(sort_keys, (",",":"), ensure_ascii=False) (scalp/config.py).
import { parseRaw, canonPy, sha256hex } from '../core/hash.mjs';
import { buatBaris, num, baseKoin, arahDari, petaTrigger } from '../core/schema.mjs';

export const GENESIS = '0'.repeat(64);

// Verifikasi rantai dari TEKS mentah (agar literal angka Python terjaga).
export function verifikasiRantai(teks) {
  const baris = String(teks ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  let prev = GENESIS;
  for (let i = 0; i < baris.length; i++) {
    let rec;
    try { rec = parseRaw(baris[i]); } catch (e) { return { ok: false, pesan: `baris ${i + 1} bukan JSON valid`, seq: i, jumlah: baris.length }; }
    if (rec.prev !== prev) return { ok: false, pesan: `rantai putus di seq ${i}: prev tidak cocok`, seq: i, jumlah: baris.length };
    const { hash, ...body } = rec;
    if (sha256hex(canonPy(body)) !== hash) return { ok: false, pesan: `hash tidak valid di seq ${i}: catatan diubah`, seq: i, jumlah: baris.length };
    prev = hash;
  }
  return { ok: true, pesan: `OK (${baris.length} catatan)`, seq: baris.length - 1, jumlah: baris.length, head: prev };
}

export function replay(records) {
  const sigs = new Map();
  for (const r of records) {
    const d = r.data, t = r.type;
    if (t === 'SIGNAL') { sigs.set(d.id, { ...d, status: 'PENDING', fill_ts: null, tp1_ts: null, close_ts: null, reason: null, r_net: null, r_gross: null }); continue; }
    const s = sigs.get(d?.id);
    if (!s) continue;
    if (t === 'FILL') { s.status = 'OPEN'; s.fill_ts = d.ts; }
    else if (t === 'TP1') { s.status = 'OPEN_TP1'; s.tp1_ts = d.ts; }
    else if (t === 'CLOSE') { Object.assign(s, { status: 'CLOSED', close_ts: d.ts, reason: d.reason, r_net: d.r_net, r_gross: d.r_gross }); }
    else if (t === 'EXPIRE') { Object.assign(s, { status: 'EXPIRED', close_ts: d.ts, reason: d.reason }); }
  }
  return sigs;
}

const KELAS = { SL: 'SL', BE: 'BE', TP2: 'TP', TIMEOUT: 'WAKTU' };

export function adaptScv5(teks, ctx) {
  const anomali = [], rows = [];
  const chain = verifikasiRantai(teks);
  const records = [];
  for (const l of String(teks ?? '').split('\n')) { const t = l.trim(); if (!t) continue; try { records.push(JSON.parse(t)); } catch { /* sudah dilaporkan chain */ } }
  const sigs = replay(records);
  for (const s of sigs.values()) {
    const spot = ctx.spotHashes?.includes(s.strategy_hash);
    const status = s.status === 'PENDING' ? 'PENDING' : (s.status === 'OPEN' || s.status === 'OPEN_TP1') ? 'OPEN' : s.status;
    const tr = petaTrigger(ctx.petaTrigger, s.setup);
    rows.push(buatBaris({
      id: s.id, koin: baseKoin(s.symbol), arah: arahDari(s.direction), entry: s.entry, sl: s.stop, tp1: s.tp1, tp2: s.tp2,
      stopPct: s.risk_pct, waktuUtc: num(s.created_ts), selesaiTs: num(s.close_ts), fillTs: num(s.fill_ts), status,
      terisi: s.status === 'EXPIRED' ? false : (s.status === 'PENDING' ? null : true),
      hasilMesin: s.reason, hasilKelas: s.status === 'EXPIRED' ? 'TIDAK_TERISI' : (KELAS[s.reason] ?? null),
      R_mesin: s.status === 'CLOSED' ? num(s.r_net) : null, R_kotor: s.status === 'CLOSED' ? num(s.r_gross) : null,
      rrMesin: num(s.rr1), versi: s.strategy_version, hash: s.strategy_hash,
      tipeTrigger: tr.tipe, triggerAsli: s.setup, triggerStatus: tr.status, tf: '5m', skor: s.score,
      mode: spot ? 'SPOT' : 'SCALP', kualitasData: ['LENGKAP']
    }, ctx));
  }
  return { rows, anomali, meta: { selesaiTsJenis: 'candle', terpotong: false, chain, lastUpdateMs: records.length ? num(records[records.length - 1].ts) : null, jumlahRecord: records.length } };
}
