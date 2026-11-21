import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wilson, ringkas, kelayakan, bandingkanGrup, ringkasPerKelompok, indeksMinggu } from '../src/core/stats.mjs';
import { rBersih } from '../src/core/cost.mjs';
import { jarakKeEntry, rrSisaTp1, nEfektif, median } from '../src/core/levels.mjs';
import { parseRaw, canonPy, definisiHash } from '../src/core/hash.mjs';
import { parseCsv } from '../src/core/csv.mjs';
import { parseTs } from '../src/core/schema.mjs';

const mk = (R, t = 0) => ({ status: 'CLOSED', terisi: true, R_bersih: R, selesaiTs: t * 86400000, waktuUtc: t * 86400000, mode: 'SCALP' });
const near = (a, b, e = 1e-3) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('Wilson k=5 n=10 z=1,96 (nilai tangan 0,2366 .. 0,7634)', () => {
  const w = wilson(5, 10, 1.96);
  near(w.lo, 0.23659, 5e-4); near(w.hi, 0.76341, 5e-4);
});
test('PF, mean, SD, SQN, drawdown dengan R=[2,-1,1,-1] (tangan: PF 1,5; mean 0,25; sd 1,5; SQN 1/3; DD 1)', () => {
  const s = ringkas([mk(2, 1), mk(-1, 2), mk(1, 3), mk(-1, 4)]);
  near(s.pf, 1.5); near(s.expectancy, 0.25); near(s.sd, 1.5); near(s.sqn, 1 / 3); near(s.maxDD, 1); near(s.totalR, 1);
  assert.equal(s.bermakna, false); assert.equal(s.ci, null); assert.match(s.peringatan, /belum bermakna/);
});
test('PF tanpa kalah = tak terhingga (bukan angka)', () => {
  const s = ringkas([mk(1, 1), mk(2, 2)]);
  assert.equal(s.pf, null); assert.equal(s.pfTakTerhingga, true);
});
test('CI95 hanya untuk n>=30', () => {
  const rs = Array.from({ length: 30 }, (_, i) => mk(i % 2 ? -1 : 2, i));
  const s = ringkas(rs);
  assert.ok(s.ci && s.bermakna);
  near(s.ci.lo, s.expectancy - 1.96 * s.sd / Math.sqrt(30), 1e-9);
});
test('SPOT dan tidak-terisi dikeluarkan dari statistik', () => {
  const s = ringkas([mk(1, 1), { ...mk(5, 2), mode: 'SPOT' }, { ...mk(-1, 3), terisi: false }]);
  assert.equal(s.n, 1);
});
test('indeks minggu: Senin dan Minggu UTC berbeda minggu', () => {
  const senin = Date.UTC(2026, 10, 16), minggu = Date.UTC(2026, 10, 22, 23), seninDepan = Date.UTC(2026, 10, 23);
  assert.equal(indeksMinggu(senin), indeksMinggu(minggu));
  assert.equal(indeksMinggu(seninDepan), indeksMinggu(senin) + 1);
});
test('biaya: sc R=-1 stop 1% biaya 0,2% -> -1,2; sudah net tidak dikurangi lagi', () => {
  near(rBersih(-1, 1, 0.2, false), -1.2);
  assert.equal(rBersih(-1.1684, 0.6, 0.1, true), -1.1684);
  assert.equal(rBersih(-1, 0, 0.2, false), null);
  assert.equal(rBersih(null, 1, 0.2, false), null);
});
test('kelayakan: tak pernah layak bila kriteria tak didefinisikan, kualitas buruk, atau syarat kurang', () => {
  const ring = { n: 200, minggu: 25, ci: { lo: 0.1, hi: 0.5 }, pf: 2, pfTakTerhingga: false, sqn: 3, bermakna: true };
  const kDef = { label: 'DEFAULT MONITOR', minTrades: 150, minMinggu: 20, ciBawahHarusPositif: true, minPF: 1.2, minSQN: null };
  const kMesin = { sumber: 'x', minTrades: 150, minMinggu: 20, ciBawahHarusPositif: true, minPF: 1.2, minSQN: null };
  assert.equal(kelayakan(ring, kMesin, kDef, false).layak, true);
  assert.equal(kelayakan(ring, kMesin, kDef, true).layak, false);
  assert.equal(kelayakan(ring, { minTrades: null }, kDef, false).layak, false);
  assert.equal(kelayakan({ ...ring, minggu: 6 }, kMesin, kDef, false).layak, false);
  assert.equal(kelayakan({ ...ring, ci: { lo: -0.05, hi: 0.4 } }, kMesin, kDef, false).layak, false);
});
test('bandingkanGrup: n<30 = belum bermakna', () => {
  const b = bandingkanGrup([mk(1), mk(1)], [mk(-1), mk(-1)]);
  assert.equal(b.bermakna, false); assert.equal(b.status, 'belum bermakna'); near(b.selisih, 2);
});
test('jarak ke entry: LONG/SHORT/zona/R', () => {
  let j = jarakKeEntry({ arah: 'LONG', entry: 100, sl: 98, harga: 101 });
  near(j.jarakPct, 1); near(j.jarakR, 0.5); assert.equal(j.sisi, 'BELUM_TERSENTUH');
  j = jarakKeEntry({ arah: 'LONG', entry: 100, sl: 98, harga: 99 });
  near(j.jarakPct, -1); assert.equal(j.sisi, 'TEMBUS');
  j = jarakKeEntry({ arah: 'SHORT', entry: 100, sl: 102, harga: 99 });
  near(j.jarakPct, 1);
  j = jarakKeEntry({ arah: 'LONG', entry: 101, entryLow: 100, entryHigh: 102, sl: 99, harga: 101.5 });
  assert.equal(j.diDalamZona, true); assert.equal(j.jarakPct, 0);
});
test('rr sisa TP1: tangan 2 dari entry; 5 bila harga sudah lewat entry ke 99', () => {
  near(rrSisaTp1({ arah: 'LONG', entry: 100, sl: 98, tp1: 104 }), 2);
  near(rrSisaTp1({ arah: 'LONG', entry: 100, sl: 98, tp1: 104, harga: 99 }), 5);
});
test('N efektif: 5 baris, 1 kembar, 3 sinyal LONG dalam 20 menit = 1 klaster, 1 lagi di menit 120', () => {
  const b = (koin, m, entry) => ({ koin, arah: 'LONG', entry, sl: entry - 1, tp1: entry + 2, tp2: null, waktuUtc: m * 60000 });
  const r = nEfektif([b('A', 0, 10), b('B', 10, 20), b('C', 20, 30), b('D', 120, 40), b('A', 0, 10)], 60);
  assert.deepEqual(r, { nTotal: 5, nUnik: 4, nEfektif: 2 });
});
test('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null); });
test('canonPy mempertahankan literal angka Python dan mengurutkan kunci', () => {
  assert.equal(canonPy(parseRaw('{"b":1.0,"a":3.71e-06,"c":[1,"x",null,true]}')), '{"a":3.71e-06,"b":1.0,"c":[1,"x",null,true]}');
});
test('definisi_hash: versi tidak memengaruhi, perubahan isi = hash baru (epoch baru)', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../config/definitions.json', import.meta.url)));
  const h = definisiHash(d);
  assert.equal(definisiHash({ ...d, versi: '9.9.9' }), h);
  assert.equal(definisiHash({ ...d, _catatan: 'lain' }), h);
  const d2 = JSON.parse(JSON.stringify(d)); d2.range.candles1h = 49;
  assert.notEqual(definisiHash(d2), h);
});
test('CSV: kutip, koma, CRLF', () => {
  const r = parseCsv('a,b\r\n1,"x,y"\r\n2,"he said ""hi"""\r\n');
  assert.deepEqual(r, [{ a: '1', b: 'x,y' }, { a: '2', b: 'he said "hi"' }]);
});
test('parseTs: ISO, spasi+offset, "UTC", epoch detik/ms', () => {
  assert.equal(parseTs('2026-11-11 11:45 UTC'), 1794397500000);
  assert.equal(parseTs('2026-11-19 10:05:00+00:00'), Date.UTC(2026, 10, 19, 10, 5));
  assert.equal(parseTs(1794397500), 1794397500000);
  assert.equal(parseTs('rusak'), null);
});
test('ringkasPerKelompok memisahkan epoch', () => {
  const rows = [{ ...mk(1), hash: 'a' }, { ...mk(-1), hash: 'b' }];
  const g = ringkasPerKelompok(rows, (r) => r.hash);
  assert.deepEqual(Object.keys(g).sort(), ['a', 'b']);
});
