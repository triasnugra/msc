import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jalankanAdapter } from '../src/adapters/index.mjs';
import { verifikasiRantai } from '../src/adapters/scv5.mjs';
import { adaptSctnBacktest } from '../src/adapters/sctn.mjs';
import { buatCtx } from '../src/adapters/index.mjs';
import { deteksiAnomali } from '../src/core/anomaly.mjs';
import { ringkas, ringkasPerKelompok } from '../src/core/stats.mjs';
import { rKeTp1 } from '../src/core/levels.mjs';

const F = (f) => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const config = JSON.parse(fs.readFileSync(new URL('../config/config.json', import.meta.url)));
const defs = JSON.parse(fs.readFileSync(new URL('../config/definitions.json', import.meta.url)));
const th = JSON.parse(fs.readFileSync(new URL('../config/thresholds.json', import.meta.url)));
const NOW = Date.UTC(2026, 10, 19, 23, 50); // dekat waktu fixture agar tidak MESIN_BASI
const run = (id, raw, now = NOW) => jalankanAdapter(id, raw, config, defs, th, now);
const near = (a, b, e = 1e-3) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const kode = (r) => r.anomali.map((a) => a.kode);

test('sc: 5 baris, R kotor dikurangi biaya 0,2% (tangan: -1 - 0,2/1,1276 = -1,1774)', () => {
  const r = run('sc', JSON.parse(F('nyata_sc_journal.json')));
  assert.equal(r.rows.length, 5);
  const b = r.rows[0];
  assert.equal(b.koin, 'SOXLB'); assert.equal(b.arah, 'SHORT'); assert.equal(b.R_sudah_net, false);
  near(b.stopPct, 1.1276, 1e-3); near(b.R_bersih, -1 - 0.2 / b.stopPct, 1e-9); near(b.R_bersih, -1.1774, 1e-3);
  const tp = r.rows[3]; assert.equal(tp.hasilMesin, 'TP'); near(tp.R_bersih, 1.8 - 0.2 / tp.stopPct, 1e-9);
  assert.equal(r.rows[4].status, 'PENDING'); assert.equal(r.rows[4].R_bersih, null); // R "" tidak jadi 0
  assert.equal(r.rows[0].tipeTrigger, 'DEVIATION_RECLAIM'); assert.equal(r.rows[2].tipeTrigger, 'TIDAK_TERPETAKAN'); // pullback EMA20 bukan trigger baku
  assert.equal(r.rows[0].waktuUtc, 1794396600000 + 900000); // t0 = waktu tutup candle = id + 15 menit
});

test('scv5: rantai hash valid pada jurnal asli; diubah 1 karakter -> putus', () => {
  const t = F('nyata_scv5_journal.jsonl');
  assert.equal(verifikasiRantai(t).ok, true);
  const rusak = t.replace('HBARUSDT', 'HBARUSDX');
  assert.notEqual(rusak, t);
  const v = verifikasiRantai(rusak);
  assert.equal(v.ok, false); assert.match(v.pesan, /hash tidak valid|rantai putus/);
  const r = run('scv5', rusak);
  assert.ok(kode(r).includes('RANTAI_HASH_PUTUS'));
  assert.equal(r.anomali.find((a) => a.kode === 'RANTAI_HASH_PUTUS').tingkat, 'KRITIS');
});
test('scv5: replay 3 sinyal (1 tidak terisi, 2 SL); R sudah net tidak dikurangi lagi; dua epoch hash', () => {
  const r = run('scv5', F('nyata_scv5_journal.jsonl'));
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => x.status), ['EXPIRED', 'CLOSED', 'CLOSED']);
  assert.equal(r.rows[0].terisi, false); assert.equal(r.rows[0].hasilKelas, 'TIDAK_TERISI');
  assert.equal(r.rows[1].R_bersih, -1.1684); assert.equal(r.rows[1].R_bersih, r.rows[1].R_mesin);
  assert.ok(r.rows[1].R_kotor > r.rows[1].R_bersih); // r_gross -1 lebih besar dari r_net -1,1684 (biaya mengurangi)
  const g = ringkasPerKelompok(r.rows, (x) => x.versi + '/' + x.hash.slice(0, 6));
  assert.equal(Object.keys(g).length, 2);
  assert.equal(r.rows[0].versi, '1.0'); assert.equal(r.rows[1].versi, '1.1');
  assert.equal(r.rows[2].tipeTrigger, 'BREAKOUT_RETEST');
});

test('scv6: 4 zona entry terbalik (SUI, ARB, TRB aktif + HBAR-1795108684157 closed), disimpan urut min/maks', () => {
  const r = run('scv6', JSON.parse(F('nyata_scv6_journal.json')));
  assert.equal(r.rows.length, 8);
  const tb = r.rows.filter((x) => x.entryTerbalik).map((x) => x.id).sort();
  assert.deepEqual(tb, ['ARB-LONG-1795108684157', 'HBAR-LONG-1795108684157', 'SUI-LONG-1795108684157', 'TRB-LONG-1795108684157']);
  for (const x of r.rows) assert.ok(x.entryLow <= x.entryHigh);
  assert.equal(kode(r).filter((k) => k === 'ENTRY_TERBALIK').length, 4);
});
test('scv6: penutupan massal, R hardcode kena biaya 0,2%, leverage "6x", rr TP2 vs R ke TP1', () => {
  const r = run('scv6', JSON.parse(F('nyata_scv6_journal.json')));
  assert.ok(kode(r).includes('PENUTUPAN_MASSAL'));
  const sol = r.rows.find((x) => x.id === 'SOL-SHORT-1795069397567');
  assert.equal(sol.R_mesin, 0.9); near(sol.R_bersih, 0.9 - 0.2 / 0.35, 1e-9); assert.equal(sol.R_sudah_net, false);
  assert.ok(sol.kualitasData.includes('HASIL_HARDCODE') && sol.kualitasData.includes('TIDAK_TERVERIFIKASI_FILL'));
  assert.equal(sol.leverageSaran, 6);
  const rTp1 = rKeTp1(sol.entry, sol.sl, sol.tp1);
  near(rTp1, 2.43, 0.02);               // R ke TP1 yang sebenarnya
  assert.ok(sol.rrMesin > 10);          // rr terpublikasi mesin dihitung ke TP2 (menyesatkan)
  assert.equal(r.rows.find((x) => x.id === 'TRB-LONG-1795108684157').status, 'OPEN');
});

test('sctn forward: 3 baris, ENTRY ZONE = fill instan (TIDAK_TERVERIFIKASI_FILL), stop_pct dari log', () => {
  const r = run('sctn', { forward: JSON.parse(F('nyata_sctn_forward_test.json')), signalLogCsv: F('nyata_sctn_signal_log.csv') });
  assert.equal(r.rows.length, 3);
  const axs = r.rows.find((x) => x.koin === 'AXS');
  assert.equal(axs.status, 'OPEN'); assert.ok(axs.kualitasData.includes('TIDAK_TERVERIFIKASI_FILL'));
  assert.equal(axs.tipeTrigger, 'BREAKOUT_RETEST'); assert.equal(axs.R_bersih, null); // belum selesai
  assert.equal(r.rows.filter((x) => x.status === 'PENDING').length, 2);
});
test('sctn backtest: statistik monitor = ringkasan mesin sendiri (n 282, WR, mean, PF, SQN, CI, DD)', () => {
  const ctx = buatCtx(config, defs, 'sctn');
  const summary = JSON.parse(F('nyata_sctn_backtest_summary.json'));
  const bt = adaptSctnBacktest({ tradesCsv: F('nyata_sctn_backtest_trades.csv'), summary }, ctx);
  assert.equal(bt.rows.length, 406);
  assert.equal(bt.rows.filter((x) => x.status === 'CLOSED').length, 282);
  assert.equal(bt.rows.filter((x) => x.status === 'EXPIRED').length, 122);
  assert.equal(bt.rows.filter((x) => x.status === 'CLOSED' && x.kualitasData.includes('TIDAK_TERVERIFIKASI_FILL')).length, 152);
  assert.ok(bt.rows.every((x) => x.sumber === 'backtest'));
  const s = ringkas(bt.rows);
  const k = summary.stats ?? summary;
  assert.equal(s.n, 282);
  near(s.winRate, 0.37943, 1e-3); near(s.expectancy, 0.16053, 1e-3); near(s.pf, 1.23104, 2e-3);
  near(s.sqn, 1.4822, 5e-3); near(s.ci.lo, -0.05175, 2e-3);
  // Drawdown: sctn mengurutkan menurut waktu SINYAL (40,051); monitor menurut waktu SELESAI (definisi di RUMUS.drawdown) = 46,968.
  near(s.maxDD, 46.968, 0.01); assert.ok(s.maxDD > k.max_drawdown_r);
  assert.ok(k && k.n === 282);
});

test('scv2 (SINTETIS): R sudah net dibiarkan; terisi/tidak; truncation 500 terdeteksi', () => {
  const j = JSON.parse(F('SINTETIS_scv2_journal.json'));
  const r = run('scv2', j);
  assert.deepEqual(r.rows.map((x) => x.status), ['CLOSED', 'CLOSED', 'PENDING', 'EXPIRED']);
  assert.equal(r.rows[0].R_bersih, -1); assert.equal(r.rows[1].R_bersih, 2); assert.equal(r.rows[3].terisi, false);
  assert.equal(r.rows[2].tipeTrigger, 'FIB_PULLBACK'); assert.equal(r.rows[0].leverageSaran, 3);
  assert.equal(kode(r).includes('JURNAL_TERPOTONG'), false);
  const besar = Array.from({ length: 500 }, (_, i) => ({ ...j[0], id: 'X' + i }));
  const r2 = run('scv2', besar);
  assert.ok(kode(r2).includes('JURNAL_TERPOTONG')); assert.ok(r2.rows.every((x) => x.kualitasData.includes('TERPOTONG')));
});
test('scv4 (SINTETIS): fill tak terverifikasi, INVALID anomali, R net, tanpa masa order', () => {
  const r = run('scv4', JSON.parse(F('SINTETIS_scv4_history.json')));
  assert.deepEqual(r.rows.map((x) => x.status), ['CLOSED', 'CLOSED', 'OPEN', 'EXPIRED']);
  assert.equal(r.rows[0].R_bersih, -1.04); assert.equal(r.rows[1].R_bersih, 0.56); assert.equal(r.rows[1].hasilKelas, 'BE');
  assert.ok(r.rows.every((x) => x.kualitasData.includes('TIDAK_TERVERIFIKASI_FILL')));
  assert.ok(kode(r).includes('STATUS_INVALID'));
  assert.equal(r.rows[0].arah, 'LONG'); assert.equal(r.rows[1].arah, 'SHORT');
});

test('anomali: mesin basi (kadensi x 2), skema berubah, adapter error terisolasi', () => {
  const basi = run('scv6', JSON.parse(F('nyata_scv6_journal.json')), Date.UTC(2026, 10, 25));
  assert.ok(kode(basi).includes('MESIN_BASI'));
  const sc = run('sc', { bukan: 'array' });
  assert.ok(kode(sc).includes('SKEMA_BERUBAH')); assert.equal(sc.rows.length, 0);
  const x = run('mesin_tak_ada', []);
  assert.equal(x.ok, false); assert.ok(kode(x).includes('ADAPTER_ERROR'));
  const kosong = run('scv6', null);
  assert.ok(kode(kosong).includes('SKEMA_BERUBAH'));
});
test('anomali: level tidak konsisten & R tidak konsisten', () => {
  const m = config.mesin.find((q) => q.id === 'sc');
  const rows = [
    { id: 'a', arah: 'LONG', entry: 100, sl: 101, tp1: 102, status: 'CLOSED', waktuUtc: 1, R_mesin: 1, hasilKelas: 'TP' },
    { id: 'b', arah: 'LONG', entry: 100, sl: 99, tp1: 102, status: 'CLOSED', waktuUtc: 1, R_mesin: 1, hasilKelas: 'SL' }
  ];
  const k = deteksiAnomali(rows, {}, m, NOW, th).map((a) => a.kode);
  assert.ok(k.includes('LEVEL_TIDAK_KONSISTEN')); assert.ok(k.includes('R_TIDAK_KONSISTEN'));
});

test('DOC-24: sinyal berhash profil SPOT ditandai MODE=SPOT dan dikeluarkan dari statistik scalp', () => {
  const t = F('nyata_scv5_journal.jsonl');
  const normal = jalankanAdapter('scv5', t, config, defs, th, NOW);
  const hashHbar = normal.rows.find((x) => x.koin === 'HBAR').hash;
  const spot = jalankanAdapter('scv5', t, config, defs, th, NOW, { spotHashes: [hashHbar] });
  assert.equal(spot.rows.filter((x) => x.mode === 'SPOT').length, 2); assert.equal(spot.rows.find((x) => x.koin === 'ETH').mode, 'SCALP');
  assert.equal(ringkas(normal.rows).n, 2); assert.equal(ringkas(spot.rows).n, 0);
});
