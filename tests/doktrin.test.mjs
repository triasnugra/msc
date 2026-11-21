import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hitungFlag, flagOvertrading } from '../src/decision/doctrine.mjs';
import { putuskan, catatBaru, perluKeputusan } from '../src/decision/decide.mjs';
import { gabungKeputusan, auditKeputusan, profilKepatuhan, ujiBuktiFlag, panelKegagalan } from '../src/decision/audit.mjs';
import { definisiHash } from '../src/core/hash.mjs';
import { hitungKonteks } from '../src/market/btcContext.mjs';

const th = JSON.parse(fs.readFileSync(new URL('../config/thresholds.json', import.meta.url)));
const config = JSON.parse(fs.readFileSync(new URL('../config/config.json', import.meta.url)));
const defs = JSON.parse(fs.readFileSync(new URL('../config/definitions.json', import.meta.url)));
const H = 3600000;
const SABTU = Date.UTC(2026, 10, 21, 10), RABU = Date.UTC(2026, 10, 18, 10);
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const baris = (o = {}) => ({ mesin: 'sc', id: 'x', koin: 'ABC', arah: 'LONG', entry: 100, entryLow: 100, entryHigh: 100, sl: 98, tp1: 104, tp2: null, stopPct: 2, status: 'PENDING', terisi: null, tipeTrigger: 'BREAKOUT_RETEST', triggerAsli: 'x', triggerStatus: 'docstring', waktuUtc: 0, leverageSaran: null, ...o });
const nama = (r) => r.flags.map((f) => f.flag);
const ctx = (o = {}) => ({ th, refTs: RABU, harga: null, events: [], libur: [], ...o });
const c48 = (low, high) => Array.from({ length: 48 }, (_, i) => ({ t: i * H, o: 150, h: i === 3 ? high : 151, l: i === 4 ? low : 149, c: 150, v: 1 }));

test('MID_RANGE: 50% ya; 5% dan 95% tidak; batas 30% ya (range 100-200)', () => {
  const c = c48(100, 200);
  assert.ok(nama(hitungFlag(baris({ entry: 150 }), ctx({ c1h: c }))).includes('MID_RANGE'));
  assert.ok(!nama(hitungFlag(baris({ entry: 105 }), ctx({ c1h: c }))).includes('MID_RANGE'));
  assert.ok(!nama(hitungFlag(baris({ entry: 195 }), ctx({ c1h: c }))).includes('MID_RANGE'));
  assert.ok(nama(hitungFlag(baris({ entry: 130 }), ctx({ c1h: c }))).includes('MID_RANGE'));
  assert.ok(!nama(hitungFlag(baris({ entry: 129 }), ctx({ c1h: c }))).includes('MID_RANGE'));
  const r = hitungFlag(baris({ entry: 150 }), ctx({ c1h: c }));
  assert.equal(r.flags.find((f) => f.flag === 'MID_RANGE').doc, 'DOC-01');
});
test('STOP_LEBAR 2,5% ; STOP_SANGAT_LEBAR 5,5% (eksklusif) ; 1,5% tidak', () => {
  assert.deepEqual(nama(hitungFlag(baris({ stopPct: 2.5 }), ctx())).filter((f) => f.startsWith('STOP')), ['STOP_LEBAR']);
  assert.deepEqual(nama(hitungFlag(baris({ stopPct: 5.5 }), ctx())).filter((f) => f.startsWith('STOP')), ['STOP_SANGAT_LEBAR']);
  assert.deepEqual(nama(hitungFlag(baris({ stopPct: 1.5 }), ctx())).filter((f) => f.startsWith('STOP')), []);
});
test('RR_TP1_RENDAH: 1,0 ya; 2,0 tidak; harga sudah lewat entry memakai harga nyata', () => {
  assert.ok(nama(hitungFlag(baris({ sl: 99, tp1: 101 }), ctx())).includes('RR_TP1_RENDAH'));
  assert.ok(!nama(hitungFlag(baris({ sl: 99, tp1: 102 }), ctx())).includes('RR_TP1_RENDAH'));
  // harga 99,5 (lewat entry 100): acuan 99,5; risiko 0,5; reward 1,5 -> 3,0 tidak rendah
  assert.ok(!nama(hitungFlag(baris({ sl: 99, tp1: 101 }), ctx({ harga: 99.5 }))).includes('RR_TP1_RENDAH'));
  // harga 99,9: acuan 99,9; risiko 0,9; reward 1,1 -> 1,22 (tidak); harga 99,95: risiko 0,95 reward 1,05 -> 1,105 (rendah)
  assert.ok(nama(hitungFlag(baris({ sl: 99, tp1: 101 }), ctx({ harga: 99.95 }))).includes('RR_TP1_RENDAH'));
});
test('LAWAN_TREN: BEAR 4H vs LONG; pengecualian hanya reclaim yang kode_dibaca; SHORT searah dan RANGE aman; HTF perlu 1D+4H', () => {
  const btc = (t4, t1) => ({ tren: { '4H': { label: t4 }, '1D': { label: t1 } } });
  assert.ok(nama(hitungFlag(baris(), ctx({ btc: btc('BEAR', 'RANGE') }))).includes('LAWAN_TREN'));
  assert.ok(!nama(hitungFlag(baris({ tipeTrigger: 'DEVIATION_RECLAIM', triggerStatus: 'kode_dibaca' }), ctx({ btc: btc('BEAR', 'RANGE') }))).includes('LAWAN_TREN'));
  assert.ok(nama(hitungFlag(baris({ tipeTrigger: 'DEVIATION_RECLAIM', triggerStatus: 'docstring' }), ctx({ btc: btc('BEAR', 'RANGE') }))).includes('LAWAN_TREN'));
  assert.ok(!nama(hitungFlag(baris({ arah: 'SHORT' }), ctx({ btc: btc('BEAR', 'BEAR') }))).includes('LAWAN_TREN'));
  assert.ok(!nama(hitungFlag(baris(), ctx({ btc: btc('RANGE', 'RANGE') }))).includes('LAWAN_TREN'));
  assert.ok(nama(hitungFlag(baris(), ctx({ btc: btc('BEAR', 'BEAR') }))).includes('LAWAN_TREN_HTF'));
  assert.ok(!nama(hitungFlag(baris(), ctx({ btc: btc('BEAR', 'BULL') }))).includes('LAWAN_TREN_HTF'));
});
test('RISIKO_SQUEEZE_SHORT: low30 100, ATR(1D) 2 -> harga 101,5 ya; 103 tidak; LONG tidak', () => {
  const d = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 101, h: 102, l: 100, c: 101, v: 1 }));
  assert.ok(nama(hitungFlag(baris({ arah: 'SHORT', entry: 101.5, sl: 103, tp1: 99 }), ctx({ c1d: d }))).includes('RISIKO_SQUEEZE_SHORT'));
  assert.ok(!nama(hitungFlag(baris({ arah: 'SHORT', entry: 103, sl: 104, tp1: 99 }), ctx({ c1d: d }))).includes('RISIKO_SQUEEZE_SHORT'));
  assert.ok(!nama(hitungFlag(baris({ arah: 'LONG', entry: 101.5 }), ctx({ c1d: d }))).includes('RISIKO_SQUEEZE_SHORT'));
});
test('likuiditas: 9jt ekstrem; 15jt rendah; 30jt aman; tidak ada di ticker = tidak diketahui + non-major', () => {
  const f = (qv, extra = {}) => nama(hitungFlag(baris(), ctx({ tickerTersedia: true, ticker: qv === null ? null : { qv }, major: ['BTC'], ...extra })));
  assert.ok(f(9e6).includes('LIKUIDITAS_EKSTREM_RENDAH') && !f(9e6).includes('LIKUIDITAS_RENDAH'));
  assert.ok(f(15e6).includes('LIKUIDITAS_RENDAH'));
  assert.ok(!f(30e6).includes('LIKUIDITAS_RENDAH') && !f(30e6).includes('LIKUIDITAS_EKSTREM_RENDAH'));
  const t = f(null); assert.ok(t.includes('LIKUIDITAS_TIDAK_DIKETAHUI') && t.includes('NON_MAJOR_ASING'));
  assert.ok(!f(30e6, { major: ['ABC'] }).includes('NON_MAJOR_ASING'));
});
test('waktu: akhir pekan, EVENT_DEKAT 18j vs SANGAT_DEKAT 30 menit (eksklusif), PENUTUPAN_PERIODE, COOLDOWN dengan catatan limit', () => {
  assert.ok(nama(hitungFlag(baris(), ctx({ refTs: SABTU }))).includes('JENDELA_VOLUME_RENDAH'));
  assert.ok(!nama(hitungFlag(baris(), ctx({ refTs: RABU }))).includes('JENDELA_VOLUME_RENDAH'));
  const dekat = nama(hitungFlag(baris(), ctx({ events: [{ nama: 'FOMC', ts: RABU + 18 * H }] })));
  assert.ok(dekat.includes('EVENT_DEKAT') && !dekat.includes('EVENT_SANGAT_DEKAT'));
  const sangat = nama(hitungFlag(baris(), ctx({ events: [{ nama: 'FOMC', ts: RABU + 30 * 60000 }] })));
  assert.ok(sangat.includes('EVENT_SANGAT_DEKAT') && !sangat.includes('EVENT_DEKAT'));
  assert.ok(!nama(hitungFlag(baris(), ctx({ events: [{ nama: 'FOMC', ts: RABU + 30 * H }] }))).includes('EVENT_DEKAT'));
  assert.ok(nama(hitungFlag(baris(), ctx({ refTs: Date.UTC(2026, 10, 22, 14) }))).includes('PENUTUPAN_PERIODE'));
  const cd = hitungFlag(baris({ mesin: 'sc' }), ctx({ btc: { shock: { aktif: true, alasan: 'uji' } } }));
  assert.match(cd.flags.find((f) => f.flag === 'COOLDOWN_PASCA_SHOCK').detail, /limit rawan tersapu/);
  assert.ok(!hitungFlag(baris({ mesin: 'scv5' }), ctx({ btc: { shock: { aktif: true, alasan: 'uji' } } })).flags[0].detail.includes('limit'));
});
test('anotasi lain: TANPA_KONFIRMASI, TIDAK_TERPETAKAN, LEVERAGE 6x ya / 5x tidak; jenis KERAS/LUNAK/ANOTASI sesuai config', () => {
  const r = hitungFlag(baris({ tipeTrigger: 'TANPA_KONFIRMASI', leverageSaran: 6, stopPct: 5.5 }), ctx());
  assert.ok(nama(r).includes('TANPA_KONFIRMASI') && nama(r).includes('LEVERAGE_TINGGI'));
  assert.equal(r.flags.find((f) => f.flag === 'STOP_SANGAT_LEBAR').jenis, 'KERAS');
  assert.equal(r.flags.find((f) => f.flag === 'TANPA_KONFIRMASI').jenis, 'ANOTASI');
  assert.ok(!nama(hitungFlag(baris({ leverageSaran: 5 }), ctx())).includes('LEVERAGE_TINGGI'));
  assert.ok(nama(hitungFlag(baris({ tipeTrigger: 'TIDAK_TERPETAKAN' }), ctx())).includes('TIDAK_TERPETAKAN'));
});
test('anotasi lapis 2: volume candle terakhir 3x rata-rata = VOLUME_KONFIRMASI; tanpa candle koin dicatat sebagai hilang', () => {
  const r0 = hitungFlag(baris(), ctx());
  assert.ok(r0.hilang.some((h) => h.includes('candle 1H koin')));
  const c = Array.from({ length: 80 }, (_, i) => ({ t: i * H, o: 100, h: 101, l: 99, c: 100, v: i === 79 ? 3 : 1 }));
  const r = hitungFlag(baris({ entry: 101.1, sl: 99.5, tp1: 106 }), ctx({ c1h: c, ticker: { qv: 50e6 }, tickerTersedia: true, major: ['ABC'] }));
  assert.ok(nama(r).includes('VOLUME_KONFIRMASI'));
});
test('OVERTRADING: 3 sinyal sc dalam 30 menit -> yang ketiga; klaster 4 searah lintas mesin', () => {
  const t0 = 1e9, mk = (id, m, mesin, arah) => baris({ id, mesin, arah, waktuUtc: t0 + m * 60000 });
  const m = flagOvertrading([mk('a', 0, 'sc', 'LONG'), mk('b', 10, 'sc', 'LONG'), mk('c', 20, 'sc', 'LONG')], th);
  assert.equal(m.has('sc|a'), false); assert.equal(m.has('sc|b'), false);
  assert.deepEqual(m.get('sc|c').map((f) => f.flag), ['OVERTRADING']);
  const k = flagOvertrading([mk('a', 0, 'sc', 'LONG'), mk('b', 5, 'scv2', 'LONG'), mk('c', 10, 'scv4', 'LONG'), mk('d', 15, 'scv6', 'LONG')], th);
  assert.deepEqual(k.get('scv6|d').map((f) => f.flag), ['KLASTER_SATU_ARAH']);
  const luar = flagOvertrading([mk('a', 0, 'sc', 'LONG'), mk('b', 70, 'sc', 'LONG'), mk('c', 140, 'sc', 'LONG')], th);
  assert.equal(luar.size, 0);
});

// ---------- urutan keputusan ----------
const mesin = { id: 'sc', batalSetelahMenit: 60 };
const NOW = 100 * 60000;
const kep = (o, harga, flags = [], extra = {}) => putuskan(baris({ waktuUtc: NOW - 10 * 60000, ...o }), { harga, nowMs: NOW, flags, mesinCfg: mesin, th, ...extra });
const F = (flag, jenis) => ({ flag, doc: 'DOC-00', jenis, detail: '' });

test('keputusan 1 BATAL: SL terlewati, atau usia > masa order; mengalahkan flag keras', () => {
  const a = kep({}, 97.9, [F('STOP_SANGAT_LEBAR', 'KERAS')]);
  assert.equal(a.keputusan, 'BATAL'); assert.match(a.catatan, /melewati SL/);
  assert.equal(kep({ waktuUtc: NOW - 61 * 60000 }, 100.5).keputusan, 'BATAL');
  assert.equal(kep({ arah: 'SHORT', entry: 100, sl: 102, tp1: 96 }, 102.1).keputusan, 'BATAL');
});
test('keputusan 2 TERLAMBAT: >0,5R searah profit; TP1 sebelum entry; mengalahkan HINDARI', () => {
  // entry 100, sl 98 => 1R = 2. Harga 101,5 = 0,75R di sisi profit tanpa menyentuh entry.
  const a = kep({}, 101.5, [F('STOP_SANGAT_LEBAR', 'KERAS')]);
  assert.equal(a.keputusan, 'TERLAMBAT'); near(a.jarakR, 0.75);
  assert.equal(kep({}, 100.9).keputusan !== 'TERLAMBAT', true); // 0,45R belum terlambat
  assert.equal(kep({}, 100.5, [], { jejak: { tp1Tersentuh: true, entryTersentuh: false } }).keputusan, 'TERLAMBAT');
  assert.notEqual(kep({}, 100.5, [], { jejak: { tp1Tersentuh: true, entryTersentuh: true } }).keputusan, 'TERLAMBAT');
  assert.equal(kep({}, 104.2).keputusan, 'TERLAMBAT'); // harga sudah di TP1 tanpa catatan fill
});
test('keputusan 3 HINDARI (keras) mengalahkan TUNGGU (lunak); 4 TUNGGU; 5 LAYAK ENTRY', () => {
  assert.equal(kep({}, 100.2, [F('STOP_SANGAT_LEBAR', 'KERAS'), F('MID_RANGE', 'LUNAK')]).keputusan, 'HINDARI');
  const t = kep({}, 100.2, [F('MID_RANGE', 'LUNAK')]);
  assert.equal(t.keputusan, 'TUNGGU'); assert.match(t.catatan, /^TUNGGU: MID_RANGE .*\[DOC-00\]/);
  assert.equal(kep({}, 100.2, [F('KONFLUENSI_FIB', 'ANOTASI')]).keputusan, 'LAYAK ENTRY'); // anotasi tidak memengaruhi
  const l = kep({}, 100.2); // 0,1R, usia 10/60
  assert.equal(l.keputusan, 'LAYAK ENTRY'); near(l.jarakR, 0.1);
});
test('celah aturan: jarak 0,4R atau usia >= 50% tanpa flag = TUNGGU dengan alasan', () => {
  const a = kep({}, 100.8); assert.equal(a.keputusan, 'TUNGGU'); assert.match(a.catatan, /jarak ke entry 0\.40R/);
  const b = kep({ waktuUtc: NOW - 40 * 60000 }, 100.2); assert.equal(b.keputusan, 'TUNGGU'); assert.match(b.catatan, /usia 67%/);
});
test('tanpa data harga: tidak pernah LAYAK ENTRY; BATAL karena usia tetap berlaku', () => {
  const a = kep({}, null, [], { hargaTersedia: false });
  assert.equal(a.keputusan, 'TUNGGU'); assert.match(a.catatan, /data harga tidak ada/);
  assert.equal(kep({ waktuUtc: NOW - 70 * 60000 }, null, [], { hargaTersedia: false }).keputusan, 'BATAL');
});
test('zona entry: harga di dalam zona = jarak 0 -> LAYAK ENTRY', () => {
  const r = kep({ entry: 101, entryLow: 100, entryHigh: 102, sl: 99, tp1: 105 }, 101.5);
  assert.equal(r.keputusan, 'LAYAK ENTRY'); assert.equal(r.sisi, 'DI_ZONA');
});
test('perluKeputusan: PENDING dan OPEN dengan terisi=null; tidak untuk yang terbukti terisi atau selesai', () => {
  assert.equal(perluKeputusan({ status: 'PENDING' }), true);
  assert.equal(perluKeputusan({ status: 'OPEN', terisi: null }), true);
  assert.equal(perluKeputusan({ status: 'OPEN', terisi: true }), false);
  assert.equal(perluKeputusan({ status: 'CLOSED', terisi: true }), false);
});
test('catatBaru: hanya saat pertama terlihat; tidak menulis ulang, tidak backfill', () => {
  const lama = [{ mesin: 'sc', id: 'A', keputusan: 'LAYAK ENTRY' }];
  const baru = catatBaru(lama, [{ mesin: 'sc', id: 'A', keputusan: 'BATAL', catatan: 'x', flags: [] }, { mesin: 'sc', id: 'B', keputusan: 'TUNGGU', catatan: 'y', flags: [{ flag: 'MID_RANGE' }] }, { mesin: 'sc', id: 'B', keputusan: 'BATAL', catatan: 'z', flags: [] }], { definisiHash: 'h1', nowMs: 5 });
  assert.equal(baru.length, 1); assert.equal(baru[0].id, 'B'); assert.equal(baru[0].keputusan, 'TUNGGU'); assert.deepEqual(baru[0].flags, ['MID_RANGE']); assert.equal(baru[0].definisiHash, 'h1');
});
test('skenario 5.4 end-to-end: LONG alt saat BTC bearish dan di tengah range -> LAWAN_TREN -> TUNGGU, tidak pernah LAYAK ENTRY', () => {
  const ms = (tf, n, fn) => Array.from({ length: n }, (_, i) => { const w = { '1h': H, '4h': 4 * H, '1d': 86400000 }[tf]; const p = fn(i, n); return { t: Math.floor(RABU / w) * w - (n - 1 - i) * w, o: p.o ?? p.c, h: p.h, l: p.l, c: p.c, v: 1 }; });
  const c1h = ms('1h', 300, (i, n) => { const c = 62 + (i % 2 ? 0.5 : -0.5); const x = { c, h: c + 0.5, l: c - 0.5 }; if (i === n - 20) x.l = 60; if (i === n - 30) x.h = 64; return x; });
  const c4h = ms('4h', 100, (i) => ({ c: 90 - 0.2 * i, h: 90 - 0.2 * i + 0.3, l: 90 - 0.2 * i - 0.3 }));
  const c1d = ms('1d', 100, (i) => ({ o: 90 - 0.2 * i + 0.2, c: 90 - 0.2 * i, h: 90 - 0.2 * i + 0.4, l: 90 - 0.2 * i - 0.4 }));
  const btc = hitungKonteks({ c1h, c4h, c1d, harga: 62, nowMs: RABU, th });
  assert.equal(btc.status, 'SELEKTIF');
  const row = baris({ waktuUtc: RABU - 5 * 60000, entry: 100, sl: 98, tp1: 104 });
  const { flags } = hitungFlag(row, ctx({ btc, refTs: RABU, harga: 100.1 }));
  assert.ok(flags.some((f) => f.flag === 'LAWAN_TREN'));
  const k = putuskan(row, { harga: 100.1, nowMs: RABU, flags, mesinCfg: { id: 'sc', batalSetelahMenit: 60 }, th });
  assert.equal(k.keputusan, 'TUNGGU'); assert.match(k.catatan, /LAWAN_TREN/);
});

// ---------- audit ----------
const trade = (id, R, flagLog, hash = 'h1', mesinId = 'sc') => ({ mesin: mesinId, id, status: 'CLOSED', terisi: true, R_bersih: R, selesaiTs: Number(id.replace(/\D/g, '')) * 1000 + 1, waktuUtc: 1, mode: 'SCALP', keputusan: 'TUNGGU', flagLog, defHash: hash });
test('uji bukti per flag: selisih terbukti (n>=30), tidak terbukti, belum bermakna (nilai tangan)', () => {
  // ber-flag: R bergantian -1 dan -0,5 (mean -0,75); tanpa flag: +1 dan +2 (mean 1,5); selisih -2,25
  const A = Array.from({ length: 30 }, (_, i) => trade('a' + i, i % 2 ? -0.5 : -1, ['MID_RANGE']));
  const B = Array.from({ length: 30 }, (_, i) => trade('b' + i, i % 2 ? 2 : 1, []));
  const u = ujiBuktiFlag([...A, ...B]).GABUNGAN.MID_RANGE;
  assert.equal(u.bermakna, true); near(u.selisih, -2.25, 1e-9); assert.equal(u.status, 'terbukti berbeda'); assert.equal(u.lebihBuruk, true);
  assert.equal(u.berFlag.n, 30); assert.equal(u.tanpaFlag.winRate, 1);
  // sama persis -> tidak terbukti
  const A2 = Array.from({ length: 30 }, (_, i) => trade('c' + i, i % 2 ? 2 : -1, ['LAWAN_TREN'])), B2 = Array.from({ length: 30 }, (_, i) => trade('d' + i, i % 2 ? 2 : -1, []));
  const u2 = ujiBuktiFlag([...A2, ...B2]).GABUNGAN.LAWAN_TREN;
  assert.equal(u2.status, 'tidak terbukti'); assert.equal(u2.tidakTerbukti, true); near(u2.selisih, 0, 1e-12);
  // kecil -> belum bermakna
  const u3 = ujiBuktiFlag([trade('e1', -1, ['X']), trade('e2', 1, [])]).GABUNGAN.X;
  assert.equal(u3.status, 'belum bermakna'); assert.equal(u3.bermakna, false);
});
test('epoch definisi_hash tidak dicampur; baris tanpa catatan keputusan tidak dihitung', () => {
  const rows = [trade('a1', 1, [], 'h1'), trade('a2', -1, [], 'h2'), { ...trade('a3', 5, []), defHash: null, flagLog: null }];
  const a = auditKeputusan(rows, {});
  assert.deepEqual(Object.keys(a).sort(), ['h1', 'h2']); assert.equal(a.h1.TUNGGU.n, 1); assert.equal(a.h2.TUNGGU.n, 1);
});
test('profil kepatuhan: persen per flag; tanpa peringkat bila n<30', () => {
  const rekam = Array.from({ length: 40 }, (_, i) => ({ mesin: 'sc', id: 'r' + i, definisiHash: 'h1', flags: i < 10 ? ['MID_RANGE'] : [] }));
  const p = profilKepatuhan([], rekam, { minSampel: 30 }).sc.h1;
  assert.equal(p.n, 40); near(p.persen.MID_RANGE, 25); assert.deepEqual(p.peringkat, ['MID_RANGE']);
  const kecil = profilKepatuhan([], rekam.slice(0, 5), { minSampel: 30 }).sc.h1;
  assert.equal(kecil.bermakna, false); assert.equal(kecil.peringkat, null);
});
test('panel kegagalan: kerugian terbesar sebanyak kemenangan terbesar + distribusi + tak terisi (DOC-26)', () => {
  const R = [3, 2, 1, -1, -2, -3, 0.5];
  const rows = [...R.map((x, i) => trade('p' + i, x, [])), { mesin: 'sc', id: 'u1', status: 'EXPIRED', terisi: false }];
  const p = panelKegagalan(rows, th.statistik.panelKegagalanJumlah, th.statistik.distribusiR);
  assert.deepEqual(p.kemenanganTerbesar.map((x) => x.R), [3, 2, 1]); assert.deepEqual(p.kerugianTerbesar.map((x) => x.R), [-3, -2, -1]);
  assert.equal(p.kemenanganTerbesar.length, p.kerugianTerbesar.length); assert.equal(p.tidakTerisi, 1);
  assert.equal(p.distribusi.reduce((s, x) => s + x.jumlah, 0), 7);
});
test('gabungKeputusan: menempelkan catatan; perubahan definisi = hash baru = epoch baru', () => {
  const g = gabungKeputusan([{ mesin: 'sc', id: 'A' }, { mesin: 'sc', id: 'B' }], [{ mesin: 'sc', id: 'A', keputusan: 'BATAL', flags: ['X'], definisiHash: 'h9', tPertama: 7 }]);
  assert.equal(g[0].keputusan, 'BATAL'); assert.equal(g[0].defHash, 'h9'); assert.equal(g[1].keputusan, null);
  const d2 = structuredClone(defs); d2.range.zonaTengahPct = [25, 75];
  assert.notEqual(definisiHash(d2), definisiHash(defs));
});
