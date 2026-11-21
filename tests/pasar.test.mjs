import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buatPasar, normBinance, normBybit, normOkx, topMajor, hanyaClose } from '../src/market/prices.mjs';
import { akhirPekan, jendelaVolumeRendah, penutupanPeriode, mondayRange, sesiUtc, awalMingguUtc } from '../src/market/sessions.mjs';
import { nyKeUtc, formatWib, kalimatEvent, gabung, normalisasi } from '../src/events/jadwal.mjs';
import { parseFomcHtml } from '../src/events/fomc.mjs';
import { parseBlsCpiHtml } from '../src/events/bls.mjs';
import { sma, ema, atr, obv, rentang, posisiPct, labelTren, fvgAktif, fvgDekat, threeTap, obvSinyal, fibKonfluensi } from '../src/market/indikator.mjs';
import { hitungKonteks, deteksiShock } from '../src/market/btcContext.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/config.json', import.meta.url)));
const th = JSON.parse(fs.readFileSync(new URL('../config/thresholds.json', import.meta.url)));
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => String(body) });
const H = 3600000;

// ---------- prices ----------
test('normalizer kline: Binance, Bybit (terbalik), OKX (terbalik)', () => {
  assert.deepEqual(normBinance([[1000, '1', '3', '0.5', '2', '10', 1999, '20']]), [{ t: 1000, o: 1, h: 3, l: 0.5, c: 2, v: 10, qv: 20 }]);
  const by = normBybit([['2000', '2', '3', '1', '2.5', '5', '12'], ['1000', '1', '2', '0.5', '1.5', '4', '6']]);
  assert.deepEqual(by.map((x) => x.t), [1000, 2000]);
  const ok = normOkx([['2000', '2', '3', '1', '2.5', '5', '0', '12', '1'], ['1000', '1', '2', '0.5', '1.5', '4', '0', '6', '1']]);
  assert.deepEqual(ok.map((x) => x.t), [1000, 2000]); assert.equal(ok[0].qv, 6);
});
test('fallback: Binance 451 -> Bybit berhasil; hasil di-cache (tidak request ulang)', async () => {
  const urls = [];
  const fetchFn = async (u) => { urls.push(u); if (u.includes('binance.vision')) return resp(451, {}); return resp(200, { retCode: 0, result: { list: [['1000', '1', '2', '0.5', '1.5', '4', '6']] } }); };
  const p = buatPasar(config, { fetchFn, sleepFn: async () => {} });
  const a = await p.kline('BTC', '1h', 10);
  assert.equal(a.ok, true); assert.equal(a.provider, 'bybit'); assert.equal(urls.length, 2);
  await p.kline('BTC', '1h', 10);
  assert.equal(urls.length, 2); assert.equal(p.stat.cacheHit, 1);
});
test('retry+backoff pada 429 lalu sukses; sleep tercatat sesuai config', async () => {
  let n = 0; const tidur = [];
  const fetchFn = async () => (++n < 3 ? resp(429, {}) : resp(200, [[1000, '1', '2', '0.5', '1.5', '4', 2, '6']]));
  const p = buatPasar(config, { fetchFn, sleepFn: async (ms) => tidur.push(ms) });
  const r = await p.kline('ETH', '15m', 5);
  assert.equal(r.ok, true); assert.equal(r.provider, 'binance_vision'); assert.deepEqual(tidur, [1000, 3000]);
});
test('semua sumber gagal -> ok:false dengan rincian; tidak loop tak berujung', async () => {
  let n = 0;
  const p = buatPasar(config, { fetchFn: async () => { n++; throw new Error('jaringan putus'); }, sleepFn: async () => {} });
  const r = await p.kline('BTC', '1h');
  assert.equal(r.ok, false); assert.equal(r.rincian.length, 3);
  assert.ok(n <= 3 * (config.harga.retry.maks + 1));
});
test('batas request per run ditegakkan', async () => {
  const cfg = structuredClone(config); cfg.harga.maksRequestPerRun = 1;
  let n = 0;
  const p = buatPasar(cfg, { fetchFn: async () => { n++; return resp(500, {}); }, sleepFn: async () => {} });
  const r = await p.kline('BTC', '1h');
  assert.equal(r.ok, false); assert.equal(n, 1); assert.match(r.rincian.join(' '), /batas_request_per_run/);
});
test('ticker24h + topMajor mengabaikan stablecoin; hanyaClose membuang candle berjalan', async () => {
  const tk = [{ symbol: 'BTCUSDT', quoteVolume: '900', lastPrice: '1' }, { symbol: 'USDCUSDT', quoteVolume: '5000', lastPrice: '1' }, { symbol: 'ETHUSDT', quoteVolume: '500', lastPrice: '1' }, { symbol: 'XYZBTC', quoteVolume: '9999', lastPrice: '1' }];
  const p = buatPasar(config, { fetchFn: async () => resp(200, tk), sleepFn: async () => {} });
  const t = await p.ticker24h();
  assert.deepEqual(topMajor(t.data, 2), ['BTC', 'ETH']);
  const c = [{ t: 0 }, { t: H }, { t: 2 * H }];
  assert.deepEqual(hanyaClose(c, '1h', 2 * H + 5).map((x) => x.t), [0, H]);
});

// ---------- sesi ----------
test('akhir pekan, libur, sesi', () => {
  const sabtu = Date.UTC(2026, 10, 21, 10), rabu = Date.UTC(2026, 10, 18, 10);
  assert.equal(akhirPekan(sabtu), true); assert.equal(akhirPekan(rabu), false);
  assert.equal(jendelaVolumeRendah(rabu, [{ tanggalUtc: '2026-11-18', nama: 'uji' }]).aktif, true);
  assert.equal(jendelaVolumeRendah(rabu, []).aktif, false);
  assert.equal(sesiUtc(Date.UTC(2026, 10, 18, 3), th.doktrin['DOC-10'].sesiUtc), 'ASIA');
  assert.equal(sesiUtc(Date.UTC(2026, 10, 18, 10), th.doktrin['DOC-10'].sesiUtc), 'EROPA');
  assert.equal(sesiUtc(Date.UTC(2026, 10, 18, 20), th.doktrin['DOC-10'].sesiUtc), 'AS');
});
test('PENUTUPAN_PERIODE: Minggu 14:00 UTC = 10 jam ke close mingguan; Minggu 08:00 = 16 jam (tidak); 30 Nov 15:00 = 9 jam ke close bulanan', () => {
  const a = penutupanPeriode(Date.UTC(2026, 10, 22, 14), 12);
  assert.deepEqual(a.map((x) => x.jenis), ['MINGGUAN']); near(a[0].sisaJam, 10);
  assert.deepEqual(penutupanPeriode(Date.UTC(2026, 10, 22, 8), 12), []);
  const b = penutupanPeriode(Date.UTC(2026, 10, 30, 15), 12);
  assert.deepEqual(b.map((x) => x.jenis), ['BULANAN']); near(b[0].sisaJam, 9);
  assert.deepEqual(penutupanPeriode(Date.UTC(2026, 10, 18, 12), 12), []);
});
test('Monday range: hanya candle 1H yang dibuka hari Senin UTC minggu berjalan', () => {
  const senin = Date.UTC(2026, 10, 16);
  assert.equal(awalMingguUtc(Date.UTC(2026, 10, 19, 5)), senin);
  const c = [{ t: senin - H, h: 999, l: 1 }, { t: senin, h: 110, l: 100 }, { t: senin + 5 * H, h: 120, l: 95 }, { t: senin + 24 * H, h: 500, l: 2 }];
  const m = mondayRange(c, Date.UTC(2026, 10, 19, 5));
  assert.equal(m.high, 120); assert.equal(m.low, 95); assert.equal(m.candle, 2); assert.equal(m.lengkap, false);
});

// ---------- event / DST ----------
test('konversi New York -> UTC -> WIB di dua sisi DST (nilai tangan)', () => {
  // EST (UTC-5): 14:00 NY = 19:00Z = 02:00 WIB besok. EDT (UTC-4): 14:00 NY = 18:00Z = 01:00 WIB besok.
  assert.equal(nyKeUtc('2026-11-04', '14:00'), Date.UTC(2026, 10, 4, 19));
  assert.equal(nyKeUtc('2026-10-28', '14:00'), Date.UTC(2026, 9, 28, 18));
  assert.equal(nyKeUtc('2026-06-17', '14:00'), Date.UTC(2026, 5, 17, 18));
  assert.equal(nyKeUtc('2026-12-09', '14:00'), Date.UTC(2026, 11, 9, 19)); // sama dengan config/events.yaml scv2
  assert.equal(nyKeUtc('2026-03-09', '08:30'), Date.UTC(2026, 2, 9, 12, 30)); // sehari setelah DST mulai (8 Mar 2026): EDT
  assert.equal(nyKeUtc('2026-03-06', '08:30'), Date.UTC(2026, 2, 6, 13, 30)); // sebelum DST: EST
  assert.deepEqual(formatWib(Date.UTC(2026, 11, 9, 19)), { hari: 'Kamis', tanggal: '10 Des 2026', jam: '02:00' });
});
test('kalimat event: format, peringatan <=24 jam, dan "belum terverifikasi" bila kosong/lewat', () => {
  const ev = normalisasi([{ jenis: 'FOMC', nama: 'FOMC Rate Decision', tanggalNY: '2026-12-09', jamNY: '14:00' }], 'manual');
  const k = kalimatEvent(ev, Date.UTC(2026, 11, 8, 12), {});
  assert.equal(k.teks, 'Event terdekat: Kamis, 10 Des 2026 02:00 WIB - FOMC Rate Decision (diisi manual).');
  assert.equal(k.peringatan, false);
  assert.equal(kalimatEvent(ev, Date.UTC(2026, 11, 9, 0), {}).peringatan, true);
  assert.equal(kalimatEvent([], 0, {}).teks, 'Jadwal event belum terverifikasi.');
  assert.equal(kalimatEvent(ev, Date.UTC(2027, 0, 1), {}).teks, 'Jadwal event belum terverifikasi.');
});
test('gabung: resmi didahulukan; manual dipakai bila tak ada padanan', () => {
  const resmi = normalisasi([{ jenis: 'FOMC', nama: 'FOMC Rate Decision', tanggalNY: '2026-12-09', jamNY: '14:00' }], 'resmi');
  const manual = normalisasi([{ jenis: 'FOMC', nama: 'FOMC (manual)', tanggalNY: '2026-12-09', jamNY: '14:00' }, { jenis: 'CPI', nama: 'US CPI', tanggalNY: '2026-12-10', jamNY: '08:30' }], 'manual');
  const g = gabung(resmi, manual);
  assert.equal(g.length, 2); assert.equal(g[0].sumber, 'resmi'); assert.equal(g[1].jenis, 'CPI');
});
test('pengurai FOMC/BLS pada HTML SINTETIS (bentuk diasumsikan, bukan halaman asli)', () => {
  const html = '<h4>2026 FOMC Meetings</h4><div class="fomc-meeting__month"><strong>January</strong></div><div class="fomc-meeting__date">27-28</div><div class="fomc-meeting__month"><strong>Oct/Nov</strong></div><div class="fomc-meeting__date">31-1</div>';
  const f = parseFomcHtml(html);
  assert.deepEqual(f.map((x) => x.tanggalNY), ['2026-01-28', '2026-11-01']);
  assert.equal(parseFomcHtml('<html>tidak dikenal</html>').length, 0);
  const b = parseBlsCpiHtml('<table><tr><td>Oct 2026</td><td>Nov. 13, 2026</td><td>08:30 AM</td></tr><tr><td>Nov 2026</td><td>Dec. 10, 2026</td><td>08:30 AM</td></tr></table>');
  assert.deepEqual(b.map((x) => [x.tanggalNY, x.jamNY]), [['2026-11-13', '08:30'], ['2026-12-10', '08:30']]);
  assert.equal(parseBlsCpiHtml('kosong').length, 0);
});

// ---------- indikator ----------
test('SMA, EMA (benih SMA), ATR konstan, OBV, rentang, posisi (nilai tangan)', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const c = Array.from({ length: 20 }, (_, i) => ({ t: i, o: 10, h: 11, l: 9, c: 10, v: 1 }));
  near(atr(c, 14)[19], 2);
  assert.deepEqual(obv([{ c: 1, v: 5 }, { c: 2, v: 3 }, { c: 1.5, v: 2 }, { c: 1.5, v: 9 }]), [0, 3, 1, 1]);
  assert.deepEqual(rentang([{ h: 5, l: 1 }, { h: 9, l: 4 }], 2), { high: 9, low: 1, n: 2 });
  assert.equal(posisiPct(150, 100, 200), 50); assert.equal(posisiPct(1, 5, 5), null);
});
test('label tren: naik = BULL, turun = BEAR, datar = RANGE', () => {
  const mk = (f) => Array.from({ length: 80 }, (_, i) => ({ t: i, o: f(i), h: f(i) + 1, l: f(i) - 1, c: f(i), v: 1 }));
  assert.equal(labelTren(mk((i) => 100 + i)).label, 'BULL');
  assert.equal(labelTren(mk((i) => 200 - i)).label, 'BEAR');
  assert.equal(labelTren(mk(() => 100)).label, 'RANGE');
  assert.equal(labelTren(mk(() => 1).slice(0, 10)).label, null);
});
test('FVG: bullish aktif; terisi penuh hilang; dekat searah', () => {
  const c = [{ h: 10, l: 8, c: 9 }, { h: 14, l: 10, c: 13 }, { h: 15, l: 12, c: 14 }, { h: 16, l: 13, c: 15 }];
  const z = fvgAktif(c);
  assert.equal(z.length, 1); assert.deepEqual([z[0].arah, z[0].low, z[0].high], ['BULL', 10, 12]);
  assert.equal(fvgAktif([...c, { h: 13, l: 9.5, c: 11 }]).length, 0); // low 9,5 <= 10: terisi penuh
  assert.ok(fvgDekat(z, 'LONG', 11, 1, 0.3)); assert.equal(fvgDekat(z, 'SHORT', 11, 1, 0.3), null); assert.equal(fvgDekat(z, 'LONG', 13, 1, 0.3), null);
  const bear = [{ h: 20, l: 18, c: 19 }, { h: 17, l: 12, c: 13 }, { h: 15, l: 11, c: 12 }];
  assert.deepEqual([fvgAktif(bear)[0].arah, fvgAktif(bear)[0].low, fvgAktif(bear)[0].high], ['BEAR', 15, 18]);
});
test('three-tap: 3 sapuan tidak berurutan terdeteksi; 2 sapuan tidak', () => {
  const dasar = () => Array.from({ length: 48 }, () => ({ h: 105, l: 102, c: 103.5 }));
  const a = dasar(); for (const i of [5, 15, 25]) a[i] = { h: 110, l: 104, c: 107 };
  const r = threeTap(a, 5, { toleransiAtr: 0.3, maksCandle: 48 });
  assert.equal(r.length, 1); assert.deepEqual([r[0].sisi, r[0].taps, r[0].level], ['ATAS', 3, 110]);
  const b = dasar(); for (const i of [5, 15]) b[i] = { h: 110, l: 104, c: 107 };
  assert.deepEqual(threeTap(b, 5), []);
  const c = dasar(); for (const i of [5, 6, 7]) c[i] = { h: 110, l: 104, c: 107 }; // berurutan = satu tap
  assert.deepEqual(threeTap(c, 5), []);
});
test('OBV: divergensi bull terdeteksi; deret naik monoton tidak; pola V terdeteksi', () => {
  const dari = (closes, vol) => closes.map((c, i) => ({ t: i, o: c, h: c + 1, l: c - 1, c, v: vol[i] }));
  // idx0 filler; 1-5 turun (v1), 6-14 naik (v3), 15-20 turun 3/langkah (v1), 21-29 naik (v1)
  const cl = [110]; const v = [1];
  for (let i = 1; i <= 30; i++) { const prev = cl[i - 1]; let d, vv = 1; if (i <= 5) d = -1; else if (i <= 14) { d = 1; vv = 3; } else if (i <= 20) d = -3; else d = 1; cl.push(prev + d); v.push(vv); }
  assert.equal(obvSinyal(dari(cl, v)).bull, true);
  const naik = Array.from({ length: 31 }, (_, i) => 100 + i);
  const o = obvSinyal(dari(naik, naik.map(() => 1)));
  assert.deepEqual(o, { bull: false, bear: false, v: false });
  // pola V: 1-10 naik, 11-24 turun (OBV min di idx24), 25-29 naik dengan volume 10
  const c2 = [100], v2 = [1];
  for (let i = 1; i <= 30; i++) { const prev = c2[i - 1]; let d = 1, vv = 1; if (i >= 11 && i <= 24) d = -1; if (i >= 25) vv = 10; c2.push(prev + d); v2.push(vv); }
  assert.equal(obvSinyal(dari(c2, v2)).v, true);
});
test('konfluensi Fib: impuls naik 100->200, level 0,75 = 125; entry 125,2 dalam 0,3xATR; 130 tidak', () => {
  const c = Array.from({ length: 20 }, (_, i) => { const p = 100 + i * (100 / 19); return { h: p, l: p, c: p }; });
  const f = fibKonfluensi(c, 125.2, 1);
  assert.equal(f.rasio, 0.75); assert.equal(f.impuls, 'NAIK'); near(f.level, 125, 1e-9);
  assert.equal(fibKonfluensi(c, 130, 1), null);
});

// ---------- konteks BTC (skenario uji 5.4) ----------
const seri = (tf, ms, n, now, fn) => Array.from({ length: n }, (_, i) => { const t = Math.floor(now / ms) * ms - (n - 1 - i) * ms, p = fn(i, n); return { t, o: p.o ?? p.c, h: p.h, l: p.l, c: p.c, v: 1 }; });
const RABU = Date.UTC(2026, 10, 18, 10, 20);
function btc({ now = RABU, dailyShock = false } = {}) {
  const c1h = seri('1h', H, 300, now, (i, n) => { const c = 62 + (i % 2 ? 0.5 : -0.5); const x = { c, h: c + 0.5, l: c - 0.5 }; if (i === n - 20) x.l = 60; if (i === n - 30) x.h = 64; return x; });
  const c4h = seri('4h', 4 * H, 100, now, (i, n) => { const c = 90 - 0.2 * i; return { c, h: c + 0.3, l: c - 0.3 }; });
  const c1d = seri('1d', 86400000, 100, now, (i, n) => { const c = 90 - 0.2 * i; const x = { o: c + 0.2, c, h: c + 0.4, l: c - 0.4 }; if (dailyShock && i === n - 2) { x.o = 100; x.c = 90; x.h = 101; x.l = 89; } return x; });
  return { c1h, c4h, c1d };
}
test('skenario 5.4: BTC lemah dan di tengah range -> SELEKTIF; tren 4H BEAR; konteks berlabel HIPOTESIS', () => {
  const k = hitungKonteks({ ...btc(), harga: 62, nowMs: RABU, th, events: [], libur: [] });
  assert.equal(k.tersedia, true); assert.equal(k.tren['4H'].label, 'BEAR'); assert.equal(k.tren['1D'].label, 'BEAR');
  assert.equal(k.btcTengahRange, true); near(k.posisiRangePct, 50, 1); assert.equal(k.status, 'SELEKTIF'); assert.equal(k.label, 'HIPOTESIS');
  assert.equal(k.shock.aktif, false);
});
test('status DEFENSIF-FLAT: shock candle 1D > 6% atau event <= 60 menit', () => {
  const s = hitungKonteks({ ...btc({ dailyShock: true }), harga: 62, nowMs: RABU, th });
  assert.equal(s.shock.aktif, true); assert.equal(s.status, 'DEFENSIF-FLAT'); assert.match(s.shock.alasan, /10\.0%/);
  const ev = [{ jenis: 'FOMC', nama: 'FOMC Rate Decision', ts: RABU + 30 * 60000 }];
  assert.equal(hitungKonteks({ ...btc(), harga: 62, nowMs: RABU, th, events: ev }).status, 'DEFENSIF-FLAT');
  const ev2 = [{ jenis: 'CPI', nama: 'US CPI', ts: RABU + 10 * H }];
  assert.equal(hitungKonteks({ ...btc(), harga: 70, nowMs: RABU, th, events: ev2 }).status, 'SELEKTIF'); // EVENT_DEKAT
});
test('konteks tidak tersedia bila candle kurang; shock berakhir setelah 24 jam', () => {
  assert.equal(hitungKonteks({ c1h: [], c4h: [], c1d: [], nowMs: RABU, th }).tersedia, false);
  const b = btc({ dailyShock: true });
  const lewat = deteksiShock(b.c1h.filter((x) => x.t + H <= RABU + 3 * 86400000), b.c1d, RABU + 3 * 86400000, th);
  assert.equal(lewat.aktif, false);
});
