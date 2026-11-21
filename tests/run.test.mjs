import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { jalankanMonitor } from '../src/run.mjs';
import { parseJsonl, barisBaru, gabungTerkini, versiTerakhir } from '../src/core/arsip.mjs';
import { hitungJejak } from '../src/market/jejak.mjs';
import { putuskan } from '../src/decision/decide.mjs';
import { buatRoot, fakeFetch, NOW } from './helpers.mjs';

const nol = async () => {};
const jalan = (root, o = {}) => jalankanMonitor({ root, fetchFn: o.fetchFn ?? fakeFetch(o), env: o.env ?? {}, nowMs: o.nowMs ?? NOW, sleepFn: nol });
const baca = (root, p) => parseJsonl(fs.readFileSync(path.join(root, p), 'utf8')).baris;
const mesin = (d, id) => d.mesin.find((m) => m.id === id);
const scv2 = (status, extra = {}) => JSON.stringify([{ id: 'SOLUSDT-X-long-T1', ts: new Date(NOW - 10 * 60000).toISOString(), symbol: 'SOLUSDT', side: 'long', trigger: 'T1', tf: '15m', level: 100, entry: 100, entry_type: 'LIMIT', stop: 99, tp1: 101.5, tp2: 103, stop_pct: 1.0, cost_pct: 0.14, rr_tp1: 1.5, rr_tp2: 3, score: 80, risk_pct: 0.5, leverage: 3, status, ...extra }]);

test('jalan penuh: 6 mesin, arsip, log keputusan, notifikasi (seed), laporan; tanpa kebocoran', async () => {
  const root = buatRoot();
  const d = await jalan(root);
  assert.equal(d.mesin.length, 6);
  for (const m of d.mesin) assert.equal(m.status.ok, true, m.id);
  assert.equal(mesin(d, 'scv5').chain.ok, true);
  assert.ok(mesin(d, 'sctn').backtest && mesin(d, 'sctn').backtest.ring.n === 282);
  assert.equal(mesin(d, 'sc').rows.length, 5); assert.equal(mesin(d, 'scv6').rows.length, 8);
  assert.ok(d.notifikasi.length >= 40);
  for (const id of ['sc', 'scv2', 'scv4', 'scv5', 'scv6', 'sctn']) assert.ok(fs.existsSync(path.join(root, 'data/archive', id + '.jsonl')), id);
  assert.ok(fs.existsSync(path.join(root, 'site/data.json')) && fs.existsSync(path.join(root, 'site/laporan.txt')));
  assert.match(d.laporan, /LAPORAN MONITOR MSC/); assert.match(d.laporan, /belum bermakna/);
  assert.equal(d.event.teks, 'Jadwal event belum terverifikasi.');
  // kelayakan: tidak ada satu pun mesin yang layak
  assert.ok(d.mesin.every((m) => m.kelayakan.layak === false));
  // setiap baris pending punya keputusan salah satu dari lima label
  const lima = ['LAYAK ENTRY', 'TUNGGU', 'TERLAMBAT', 'BATAL', 'HINDARI'];
  for (const m of d.mesin) for (const r of m.rows.filter((x) => x.status === 'PENDING')) assert.ok(lima.includes(r.keputusan), `${m.id} ${r.id}`);
});

test('idempoten: run kedua tidak menambah versi arsip, tidak menulis ulang keputusan, mempertahankan waktu pertama notifikasi', async () => {
  const root = buatRoot();
  const d1 = await jalan(root);
  const a1 = baca(root, 'data/archive/sc.jsonl').length, k1 = baca(root, 'data/archive/keputusan.jsonl');
  const notif1 = JSON.parse(fs.readFileSync(path.join(root, 'data/state/notif.json'), 'utf8'));
  const d2 = await jalan(root, { nowMs: NOW + 900000 });
  assert.equal(baca(root, 'data/archive/sc.jsonl').length, a1);
  const k2 = baca(root, 'data/archive/keputusan.jsonl');
  assert.deepEqual(k2, k1); assert.equal(d2.keputusanBaru, 0);
  const notif2 = JSON.parse(fs.readFileSync(path.join(root, 'data/state/notif.json'), 'utf8'));
  for (const [id, s] of Object.entries(notif1.items)) assert.equal(notif2.items[id].pertamaTerdeteksi, s.pertamaTerdeteksi, id);
  void d1;
});

test('perubahan status = versi baru di arsip (tidak menimpa); keputusan lama tidak berubah', async () => {
  const root = buatRoot();
  await jalan(root, { scv2: scv2('PENDING') });
  await jalan(root, { scv2: scv2('CLOSED', { outcome: 'TP2', r: 2.0, fill_ts: '2026-11-19 23:50:00+00:00', exit_ts: '2026-11-19 23:56:00+00:00' }), nowMs: NOW + 600000 });
  const v = baca(root, 'data/archive/scv2.jsonl').filter((r) => r.id === 'SOLUSDT-X-long-T1');
  assert.deepEqual(v.map((r) => r.status), ['PENDING', 'CLOSED']);
  assert.equal(v[1].R_bersih, 2);
  const log = baca(root, 'data/archive/keputusan.jsonl').filter((r) => r.id === 'SOLUSDT-X-long-T1');
  assert.equal(log.length, 1);
});

test('keputusan dicatat saat pertama terlihat dengan flag MID_RANGE dan definisi_hash; tidak pernah LAYAK bila mid-range', async () => {
  const root = buatRoot();
  const d = await jalan(root, { scv2: scv2('PENDING') });
  const r = mesin(d, 'scv2').rows[0];
  assert.equal(r.keputusan, 'TUNGGU'); assert.match(r.catatan, /MID_RANGE .*\[DOC-01\]/);
  const log = baca(root, 'data/archive/keputusan.jsonl').find((x) => x.id === 'SOLUSDT-X-long-T1');
  assert.equal(log.definisiHash, d.definisi.hash); assert.ok(log.flags.includes('MID_RANGE')); assert.equal(log.pasarTersedia, true);
  // harga lari jauh di run berikutnya: keputusan live berubah, catatan pertama tetap
  const d2 = await jalan(root, { scv2: scv2('PENDING'), harga: (s) => ({ BTC: 62000, ETH: 3000, SOL: 104 }[s] ?? 1), nowMs: NOW + 300000 });
  assert.equal(mesin(d2, 'scv2').rows[0].keputusanPertama.keputusan, 'TUNGGU');
  assert.equal(baca(root, 'data/archive/keputusan.jsonl').filter((x) => x.id === 'SOLUSDT-X-long-T1').length, 1);
});

test('satu mesin gagal diambil: memakai arsip, banner + notifikasi, mesin lain normal', async () => {
  const root = buatRoot();
  await jalan(root);
  const d = await jalan(root, { gagalMesin: ['sc'], nowMs: NOW + 900000 });
  const sc = mesin(d, 'sc');
  assert.equal(sc.status.ok, false); assert.equal(sc.rows.length, 5); // dari arsip
  assert.ok(d.banner.some((b) => /Data sc gagal/.test(b.teks)));
  assert.ok(sc.anomali.some((a) => a.kode === 'SUMBER_GAGAL'));
  assert.equal(d.notifikasi.find((n) => n.id === 'OTO-ANOM-SUMBER_GAGAL-sc').tingkat, 'TINGGI');
  assert.equal(mesin(d, 'scv5').status.ok, true);
});

test('semua sumber harga gagal: konteks tidak tersedia, tidak ada LAYAK ENTRY, keputusan tidak dicatat kecuali BATAL', async () => {
  const root = buatRoot();
  const d = await jalan(root, { pasarMati: true, scv2: scv2('PENDING') });
  assert.equal(d.konteks.tersedia, false);
  assert.ok(d.banner.some((b) => /Konteks pasar tidak tersedia/.test(b.teks)));
  for (const m of d.mesin) for (const r of m.rows) assert.notEqual(r.keputusan, 'LAYAK ENTRY');
  const sol = mesin(d, 'scv2').rows[0];
  assert.equal(sol.keputusan, 'TUNGGU'); assert.match(sol.catatan, /data harga tidak ada/);
  const log = baca(root, 'data/archive/keputusan.jsonl');
  assert.equal(log.some((x) => x.id === 'SOLUSDT-X-long-T1'), false);
  assert.ok(log.every((x) => x.keputusan === 'BATAL'));
});

test('push: secret tidak bocor ke data.json/laporan; run pertama hanya satu pesan inisialisasi', async () => {
  const root = buatRoot();
  const TOKEN = 'TOKEN-RAHASIA-XYZ';
  const f = fakeFetch({});
  const d = await jalan(root, { fetchFn: f, env: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '7', MONITOR_TOKEN: 'MT-RAHASIA' } });
  const posts = f.calls.filter((c) => c.body);
  assert.equal(posts.length, 1); assert.match(posts[0].body, /notifikasi tercatat/);
  const semua = fs.readFileSync(path.join(root, 'site/data.json'), 'utf8') + d.laporan + fs.readFileSync(path.join(root, 'data/state/push.json'), 'utf8');
  assert.equal(semua.includes(TOKEN), false); assert.equal(semua.includes('MT-RAHASIA'), false);
});

test('definisi berubah = epoch baru + notifikasi INFO', async () => {
  const root = buatRoot();
  await jalan(root);
  const p = path.join(root, 'config/definitions.json'), dfn = JSON.parse(fs.readFileSync(p, 'utf8'));
  dfn.range.zonaTengahPct = [25, 75]; fs.writeFileSync(p, JSON.stringify(dfn));
  const d = await jalan(root, { nowMs: NOW + 900000 });
  assert.equal(d.definisi.epochBaru, true);
  assert.equal(d.notifikasi.find((n) => n.id === 'OTO-DEFINISI-LINTAS').tingkat, 'INFO');
});

test('arsip: parseJsonl menghitung baris rusak; gabungTerkini mempertahankan ID yang sudah dibuang mesin', () => {
  const { baris, rusak } = parseJsonl('{"mesin":"a","id":"1","status":"PENDING"}\nrusak{\n{"mesin":"a","id":"2","status":"CLOSED"}\n');
  assert.equal(baris.length, 2); assert.equal(rusak, 1);
  const t = versiTerakhir(baris);
  assert.equal(barisBaru(t, [{ mesin: 'a', id: '1', status: 'PENDING' }], 5).length, 0);
  assert.equal(barisBaru(t, [{ mesin: 'a', id: '1', status: 'CLOSED' }], 5)[0].tVersi, 5);
  const g = gabungTerkini(t, [{ mesin: 'a', id: '1', status: 'CLOSED' }]);
  assert.deepEqual(g.map((r) => `${r.id}:${r.status}`).sort(), ['1:CLOSED', '2:CLOSED']);
});

test('jejak harga: TP1 tersentuh sebelum entry -> TERLAMBAT; entry lebih dulu atau candle yang sama -> tidak', () => {
  const row = { arah: 'LONG', entry: 100, entryLow: 100, entryHigh: 100, sl: 98, tp1: 104, waktuUtc: 1000, mesin: 'sc' };
  const c = (t, h, l) => ({ t, h, l, c: (h + l) / 2 });
  const A = hitungJejak(row, [c(0, 101, 100.5), c(900000, 105, 101), c(1800000, 104, 99.9)], 0);
  assert.deepEqual(A, { entryTersentuh: false, tp1Tersentuh: true });
  const B = hitungJejak(row, [c(0, 101, 99.9), c(900000, 105, 101)], 0);
  assert.deepEqual(B, { entryTersentuh: true, tp1Tersentuh: true });
  const C = hitungJejak(row, [c(0, 105, 99.5)], 0);
  assert.equal(C.entryTersentuh, true);
  assert.equal(hitungJejak(row, [c(5000000, 101, 99)], 0), null); // candle mulai setelah sinyal: tak bisa dinilai
  const mesin = { id: 'sc', batalSetelahMenit: 60 }; const th = JSON.parse(fs.readFileSync(new URL('../config/thresholds.json', import.meta.url)));
  const k = putuskan({ ...row, waktuUtc: 5 * 60000 }, { harga: 101, nowMs: 10 * 60000, flags: [], mesinCfg: mesin, th, jejak: A });
  assert.equal(k.keputusan, 'TERLAMBAT');
});
