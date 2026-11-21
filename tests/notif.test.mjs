import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jalankanAdapter } from '../src/adapters/index.mjs';
import { ringkas } from '../src/core/stats.mjs';
import { aturanOtomatis } from '../src/notify/rules.mjs';
import { muatSeed } from '../src/notify/seed.mjs';
import { gabungNotifikasi } from '../src/notify/gabung.mjs';
import { jalankanPush, kanalAktif } from '../src/notify/push.mjs';
import { promptUpgrade } from '../src/notify/prompt.mjs';

const F = (f) => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const J = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
const config = J('../config/config.json'), defs = J('../config/definitions.json'), th = J('../config/thresholds.json'), klaim = J('../config/klaim.json');
const backlog = J('../data/upgrade-backlog.json');
const NOW = Date.UTC(2026, 10, 19, 23, 50);
const run = (id, raw) => jalankanAdapter(id, raw, config, defs, th, NOW);
const paket = (r) => ({ cfg: config.mesin.find((m) => m.id === r.id), rows: r.rows, ring: ringkas(r.rows), anomali: r.anomali });
const ada = (n, id) => n.find((x) => x.id === id);

test('seed backlog: valid, ID unik, prefiks wajib, pertanyaan = INFO, temuan berat punya bukti file', () => {
  const s = muatSeed(backlog);
  assert.deepEqual(s.galat, []); assert.equal(s.items.length, backlog.items.length);
  for (const p of ['SC-', 'SV2-', 'SV4-', 'SV5-', 'SV6-', 'SCTN-', 'X-']) assert.ok(s.items.some((x) => x.id.startsWith(p)), p);
  assert.ok(s.items.filter((x) => x.jenis === 'PERTANYAAN-VERIFIKASI').every((x) => x.tingkat === 'INFO'));
  for (const x of s.items.filter((q) => ['KRITIS', 'TINGGI'].includes(q.tingkat) && q.mesin !== 'LINTAS')) assert.match(x.bukti, /\.(py|mjs|yml|yaml|md|json|csv|jsonl)/, x.id);
  // item wajib dari prompt
  for (const id of ['SV5-01', 'SV5-02', 'SV6-01', 'SV6-02', 'SV6-03', 'SV6-04', 'SV6-05', 'SV6-06', 'SV6-07', 'SV6-08', 'SV6-09', 'SV6-10', 'SC-01', 'SC-02', 'SC-03', 'SCTN-01', 'SCTN-02', 'SCTN-03', 'SCTN-04', 'SCTN-05', 'SV2-01', 'SV2-02', 'X-01', 'X-02']) assert.ok(s.items.some((x) => x.id === id), id);
  assert.deepEqual(s.items.find((x) => x.id === 'SV6-01').doc, ['DOC-05']); assert.deepEqual(s.items.find((x) => x.id === 'SV6-07').doc, ['DOC-06', 'DOC-11']); assert.deepEqual(s.items.find((x) => x.id === 'SV6-10').doc, ['DOC-14']);
  assert.equal(muatSeed({ items: [{ id: 'A' }, { id: 'A', mesin: 'x', tingkat: 'INFO', judul: 'j', bukti: 'b', dampak: 'd', tindakan: 't' }, { id: 'A', mesin: 'x', tingkat: 'INFO', judul: 'j', bukti: 'b', dampak: 'd', tindakan: 't' }] }).galat.length, 2);
});

test('aturan otomatis pada fixture nyata scv6: R:R ke TP2, hardcode, zona terbalik, penutupan massal', () => {
  const m = paket(run('scv6', J('./fixtures/nyata_scv6_journal.json')));
  const n = aturanOtomatis({ mesin: [m], gabungan: [], eventInfo: null, klaim, defHash: 'h', th, nowMs: NOW });
  const rr = ada(n, 'OTO-RR-TP2-scv6'); assert.equal(rr.tingkat, 'TINGGI'); assert.deepEqual(rr.doc, ['DOC-05']); assert.match(rr.bukti, /median rr jurnal/);
  assert.equal(ada(n, 'OTO-HARDCODE-scv6').tingkat, 'TINGGI');
  assert.match(ada(n, 'OTO-ANOM-ENTRY_TERBALIK-scv6').bukti, /4x/);
  assert.ok(ada(n, 'OTO-ANOM-PENUTUPAN_MASSAL-scv6'));
  assert.ok(ada(n, 'OTO-FILL-TAK-TERVERIFIKASI-scv6'));
  assert.equal(n.every((x) => x.id && x.mesin && x.tingkat && x.judul && x.bukti && x.dampak && x.tindakan && x.status === 'BARU' && Number.isFinite(x.tDeteksi)), true);
});
test('aturan otomatis scv5: klaim versi 1.2 vs jurnal 1.1 = TINGGI; rantai putus = KRITIS', () => {
  const m = paket(run('scv5', F('nyata_scv5_journal.jsonl')));
  const n = aturanOtomatis({ mesin: [m], gabungan: [], eventInfo: null, klaim, defHash: 'h', th, nowMs: NOW });
  const k = ada(n, 'OTO-KLAIM-VERSI-scv5'); assert.equal(k.tingkat, 'TINGGI'); assert.match(k.bukti, /1\.1.*1\.2-ElizStrict/);
  const rusak = paket(run('scv5', F('nyata_scv5_journal.jsonl').replace('HBARUSDT', 'HBARUSDX')));
  const n2 = aturanOtomatis({ mesin: [rusak], gabungan: [], eventInfo: null, klaim, defHash: 'h', th, nowMs: NOW });
  assert.equal(ada(n2, 'OTO-ANOM-RANTAI_HASH_PUTUS-scv5').tingkat, 'KRITIS');
});
test('aturan statistik (n>=30): ekspektasi negatif, PF<1, CI negatif, arah satu sisi, tak terisi', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ mesin: 'x', id: 'r' + i, arah: 'SHORT', status: 'CLOSED', terisi: true, R_bersih: i % 4 === 0 ? 1 : -1, selesaiTs: i * 1000, waktuUtc: i, mode: 'SCALP', kualitasData: ['LENGKAP'], entry: 1, sl: 0.9, tp1: 1.2, rrMesin: 2 }));
  const m = { cfg: { id: 'x' }, rows, ring: ringkas(rows), anomali: [] };
  const n = aturanOtomatis({ mesin: [m], gabungan: [], eventInfo: null, klaim: {}, defHash: 'h', th, nowMs: NOW });
  assert.equal(ada(n, 'OTO-EXP-NEG-x').tingkat, 'TINGGI'); assert.equal(ada(n, 'OTO-PF-LT1-x').tingkat, 'TINGGI'); assert.ok(ada(n, 'OTO-CI-NEG-x')); assert.ok(ada(n, 'OTO-ARAH-x'));
  assert.equal(ada(n, 'OTO-RR-TP2-x'), undefined); // rr 2 vs R ke TP1 2 -> wajar
  const kecil = aturanOtomatis({ mesin: [{ ...m, rows: rows.slice(0, 10), ring: ringkas(rows.slice(0, 10)) }], gabungan: [], eventInfo: null, klaim: {}, defHash: 'h', th, nowMs: NOW });
  assert.equal(ada(kecil, 'OTO-EXP-NEG-x'), undefined); // n<30: tidak ada notifikasi statistik
  const fill = (f, t) => [...Array.from({ length: f }, (_, i) => ({ ...rows[0], id: 'f' + i, terisi: false, status: 'EXPIRED' })), ...Array.from({ length: t }, (_, i) => ({ ...rows[0], id: 't' + i, terisi: true }))];
  const a = aturanOtomatis({ mesin: [{ ...m, rows: fill(25, 15), ring: ringkas(fill(25, 15)) }], gabungan: [], eventInfo: null, klaim: {}, defHash: 'h', th, nowMs: NOW });
  assert.equal(ada(a, 'OTO-FILL-x').tingkat, 'TINGGI'); // fill rate 37,5% < 50%
  const b = aturanOtomatis({ mesin: [{ ...m, rows: fill(14, 26), ring: ringkas(fill(14, 26)) }], gabungan: [], eventInfo: null, klaim: {}, defHash: 'h', th, nowMs: NOW });
  assert.equal(ada(b, 'OTO-FILL-x').tingkat, 'SEDANG'); // 35% tak terisi, fill rate 65%
});
test('notifikasi doktrin: SEDANG; naik TINGGI bila ber-flag lebih buruk; turun INFO bila tidak terbukti; tidak muncul bila <3 atau <20%', () => {
  const rows = []; const m = { cfg: { id: 'x' }, rows, ring: ringkas(rows), anomali: [] };
  const profil = { x: { h: { n: 40, flags: { MID_RANGE: 12, LAWAN_TREN: 12, STOP_LEBAR: 2, OVERTRADING: 4 }, persen: { MID_RANGE: 30, LAWAN_TREN: 30, STOP_LEBAR: 5, OVERTRADING: 10 } } } };
  const uji = { x: { MID_RANGE: { bermakna: true, lebihBuruk: true, tidakTerbukti: false, selisih: -1.2, nA: 12, nB: 28 }, LAWAN_TREN: { bermakna: true, lebihBuruk: false, tidakTerbukti: true, selisih: 0.1, nA: 31, nB: 31 } } };
  const n = aturanOtomatis({ mesin: [m], gabungan: [], profil, uji, eventInfo: null, klaim: {}, defHash: 'h', th, nowMs: NOW });
  assert.equal(ada(n, 'OTO-DOKTRIN-x-MID_RANGE').tingkat, 'TINGGI'); assert.deepEqual(ada(n, 'OTO-DOKTRIN-x-MID_RANGE').doc, ['DOC-01']);
  assert.equal(ada(n, 'OTO-DOKTRIN-x-LAWAN_TREN').tingkat, 'INFO');
  assert.equal(ada(n, 'OTO-DOKTRIN-x-STOP_LEBAR'), undefined); assert.equal(ada(n, 'OTO-DOKTRIN-x-OVERTRADING'), undefined);
  const tanpaUji = aturanOtomatis({ mesin: [m], gabungan: [], profil, uji: {}, eventInfo: null, klaim: {}, defHash: 'h', th, nowMs: NOW });
  assert.equal(ada(tanpaUji, 'OTO-DOKTRIN-x-MID_RANGE').tingkat, 'SEDANG'); assert.match(ada(tanpaUji, 'OTO-DOKTRIN-x-MID_RANGE').bukti, /belum bermakna/);
});
test('lintas: event kosong dan perubahan definisi (epoch baru) menghasilkan notifikasi', () => {
  const n = aturanOtomatis({ mesin: [], gabungan: [], eventInfo: { manualKosong: true, resmiOk: false }, klaim: {}, defHash: 'baru', defHashLama: 'lama', th, nowMs: NOW });
  assert.equal(ada(n, 'OTO-EVENT-KOSONG-LINTAS').tingkat, 'SEDANG'); assert.match(ada(n, 'OTO-EVENT-KOSONG-LINTAS').bukti, /9 Des 2026/);
  assert.equal(ada(n, 'OTO-DEFINISI-LINTAS').tingkat, 'INFO');
  assert.equal(aturanOtomatis({ mesin: [], gabungan: [], eventInfo: { manualKosong: false, resmiOk: false }, klaim: {}, defHash: 'a', defHashLama: 'a', th, nowMs: NOW }).length, 0);
});

test('gabung: waktu pertama terdeteksi dipertahankan, status dipertahankan, naik tingkat terdeteksi', () => {
  const s1 = [{ id: 'A', mesin: 'sc', tingkat: 'SEDANG', judul: 'j', bukti: 'b', dampak: 'd', tindakan: 't', doc: [], status: 'BARU' }];
  const a = gabungNotifikasi([], s1, null, 1000);
  assert.equal(a.items[0].baru, true); assert.equal(a.items[0].pertamaTerdeteksi, 1000);
  const st = { items: { A: { ...a.state.items.A, status: 'DILIHAT' } } };
  const b = gabungNotifikasi([{ ...s1[0], tingkat: 'TINGGI' }], [], st, 9000);
  assert.equal(b.items[0].pertamaTerdeteksi, 1000); assert.equal(b.items[0].status, 'DILIHAT'); assert.equal(b.items[0].naikTingkat, true); assert.equal(b.items[0].baru, false);
  const c = gabungNotifikasi([], [], b.state, 9500);
  assert.equal(c.items.length, 0); assert.ok(c.state.items.A);
});

const N = (id, tingkat, extra = {}) => ({ id, mesin: 'sc', tingkat, judul: 'J ' + id, bukti: 'B', tindakan: 'T', doc: ['DOC-01'], status: 'BARU', ...extra });
const TOKEN = 'TOKEN-RAHASIA-123';
test('push: tanpa secret nonaktif dan tidak memanggil jaringan', async () => {
  let n = 0;
  const r = await jalankanPush([N('A', 'TINGGI')], null, {}, async () => { n++; return { ok: true }; }, NOW, th);
  assert.equal(r.aktif, false); assert.equal(n, 0); assert.deepEqual(kanalAktif({}), { telegram: false, discord: false });
});
test('push: run pertama hanya satu pesan inisialisasi; berikutnya hanya BARU atau NAIK TINGKAT; INFO tidak dikirim', async () => {
  const kirim = []; const fetchFn = async (u, o) => { kirim.push({ u, b: JSON.parse(o.body) }); return { ok: true, status: 200 }; };
  const env = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '1' };
  const siang = Date.UTC(2026, 10, 19, 2); // 09:00 WIB
  const r1 = await jalankanPush([N('A', 'TINGGI'), N('B', 'SEDANG'), N('I', 'INFO')], null, env, fetchFn, Date.UTC(2026, 10, 19, 20), th);
  assert.equal(kirim.length, 1); assert.match(kirim[0].b.text, /2 notifikasi tercatat/); assert.equal(r1.state.terkirim.I, undefined);
  kirim.length = 0;
  const r2 = await jalankanPush([N('A', 'TINGGI'), N('B', 'SEDANG'), N('C', 'TINGGI')], r1.state, env, fetchFn, Date.UTC(2026, 10, 19, 20), th);
  assert.equal(kirim.filter((k) => k.b.text.includes('C')).length, 1); assert.equal(kirim.some((k) => k.b.text.includes('J A')), false); // A,B tidak diulang
  kirim.length = 0;
  const r3 = await jalankanPush([N('B', 'KRITIS'), N('C', 'TINGGI')], r2.state, env, fetchFn, Date.UTC(2026, 10, 19, 20), th);
  assert.equal(kirim.length, 1); assert.match(kirim[0].b.text, /\[KRITIS\]/); // B naik tingkat
  assert.equal(kirim[0].u.includes(TOKEN), true); // token hanya di URL permintaan, tidak di isi pesan
  assert.equal(JSON.stringify(kirim.map((k) => k.b)).includes(TOKEN), false);
  void siang; void r3;
});
test('push: ringkasan harian sekali per tanggal WIB setelah jam 07; kegagalan tidak membocorkan token', async () => {
  const kirim = []; const fetchFn = async (u, o) => { kirim.push(JSON.parse(o.body).content); return { ok: true, status: 200 }; };
  const env = { DISCORD_WEBHOOK_URL: 'https://discord.example/webhook/' + TOKEN };
  const st0 = { versi: 1, terkirim: { A: 'TINGGI' }, terakhirRingkasan: null, inisialisasi: true };
  const pagi = Date.UTC(2026, 10, 20, 1); // 08:00 WIB
  const a = await jalankanPush([N('A', 'TINGGI')], st0, env, fetchFn, pagi, th);
  assert.equal(a.ringkasan, true); assert.match(kirim[0], /Ringkasan harian msc \(2026-11-20 WIB\)/);
  const b = await jalankanPush([N('A', 'TINGGI')], a.state, env, fetchFn, pagi + 3600000, th);
  assert.equal(b.ringkasan, false);
  const gagal = await jalankanPush([N('Z', 'KRITIS')], st0, env, async () => { throw new Error('gagal ' + TOKEN); }, pagi, th);
  assert.equal(gagal.dikirim, 0); assert.equal(JSON.stringify(gagal).includes(TOKEN), false);
  assert.equal(gagal.state.terkirim.Z, undefined); // gagal terkirim -> akan dicoba lagi
  const dini = await jalankanPush([N('A', 'TINGGI')], st0, env, fetchFn, Date.UTC(2026, 10, 19, 22), th); // 05:00 WIB
  assert.equal(dini.ringkasan, false);
});
test('prompt upgrade: memuat bukti, ID doktrin, larangan setel ke data terbaru, larangan ubah core tanpa epoch; tanpa rahasia', () => {
  const p = promptUpgrade({ notifs: [N('SV6-01', 'TINGGI', { mesin: 'scv6', judul: 'rr ke TP2', bukti: 'baris 108', dampak: 'd', tindakan: 'hitung ke TP1', doc: ['DOC-05'] }), N('SC-01', 'TINGGI')], mesin: 'scv6', definisiHash: 'abc123' });
  assert.match(p, /SV6-01/); assert.match(p, /baris 108/); assert.match(p, /DOC-05/); assert.match(p, /out-of-sample/); assert.match(p, /DILARANG menyetel parameter ke data terbaru/); assert.match(p, /epoch\/strategy_hash\/versi baru/); assert.match(p, /KODE LENGKAP/);
  assert.equal(p.includes('SC-01'), false); assert.equal(p.includes(TOKEN), false);
});
