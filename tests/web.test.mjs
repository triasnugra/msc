import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { jalankanMonitor } from '../src/run.mjs';
import { KOLOM, esc, tabelJurnal, ringkasanMesin, kelayakanHtml, konteksHtml, notifHtml, auditHtml, rumusHtml, infoMesin, barisJurnal, wib } from '../web/lib.mjs';
import { buatRoot, fakeFetch, NOW } from './helpers.mjs';

const W = (f) => fs.readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');

test('kolom jurnal persis sesuai spesifikasi dan urutan', () => {
  assert.deepEqual(KOLOM, ['Mesin', 'Koin', 'Arah', 'Entry', 'SL', 'TP', 'Harga', 'Jarak ke entry', 'Tgl', 'Keputusan monitor', 'Catatan']);
});
test('escape XSS di semua kolom teks', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  const m = { id: 'sc' };
  const h = barisJurnal(m, { koin: '<script>x</script>', arah: 'LONG', entry: 1, entryLow: 1, entryHigh: 1, sl: 0.9, tp1: 1.2, status: 'PENDING', waktuUtc: NOW, keputusan: 'TUNGGU', catatan: '<b>jahat</b>', kualitasData: ['LENGKAP'] });
  assert.equal(h.includes('<script>'), false); assert.equal(h.includes('<b>jahat</b>'), false);
});
test('baris pending: jarak bertanda dan R; zona = DI DALAM ZONA; baris selesai menampilkan R mesin dan R bersih', () => {
  const m = { id: 'sc' };
  const p = barisJurnal(m, { koin: 'ABC', arah: 'LONG', entry: 100, entryLow: 100, entryHigh: 100, sl: 98, tp1: 104, status: 'PENDING', waktuUtc: NOW, keputusan: 'LAYAK ENTRY', catatan: 'x', harga: 100.5, jarakPct: 0.5, jarakR: 0.25, sisi: 'BELUM_TERSENTUH', kualitasData: ['LENGKAP'] });
  assert.match(p, /\+0\.50% \(0\.25R\)/); assert.match(p, /k-layak/);
  const z = barisJurnal(m, { koin: 'ABC', arah: 'LONG', entry: 101, entryLow: 100, entryHigh: 102, sl: 98, tp1: 104, tp2: 106, status: 'PENDING', waktuUtc: NOW, keputusan: 'LAYAK ENTRY', sisi: 'DI_ZONA', kualitasData: ['LENGKAP'] });
  assert.match(z, /DI DALAM ZONA/); assert.match(z, /104\.00 \/ 106\.00/); assert.match(z, /100\.00 - 102\.00/);
  const s = barisJurnal(m, { koin: 'ABC', arah: 'SHORT', entry: 100, entryLow: 100, entryHigh: 100, sl: 102, tp1: 96, status: 'CLOSED', hasilMesin: 'SL', R_mesin: -1, R_bersih: -1.2, R_sudah_net: false, waktuUtc: NOW, kualitasData: ['HASIL_HARDCODE'] });
  assert.match(s, /R mesin -1\.00/); assert.match(s, /R bersih -1\.20/); assert.match(s, /R hardcode/);
});
test('WIB: 19 Nov 23:55 UTC = 20 Nov 06:55 WIB', () => { assert.equal(wib(NOW), '20 Nov 06:55'); });

test('smoke: seluruh tampilan dirender dari hasil run nyata tanpa error; n<30 = belum bermakna; tidak ada badge layak', async () => {
  const root = buatRoot();
  const d = await jalankanMonitor({ root, fetchFn: fakeFetch({}), env: {}, nowMs: NOW, sleepFn: async () => {} });
  const html = [konteksHtml(d.konteks), notifHtml(d.notifikasi), auditHtml(d.audit, d.definisi.hash), rumusHtml(d.rumus)];
  for (const m of d.mesin) html.push(tabelJurnal(m), ringkasanMesin(m), kelayakanHtml(m, d.kelayakanDefault), infoMesin(m));
  for (const h of html) assert.ok(h.length > 0);
  const semua = html.join('\n');
  assert.equal(semua.includes('badge ok'), false); // tidak ada badge hijau "layak"
  assert.match(semua, /belum bermakna/); assert.match(semua, /BELUM LAYAK MODAL NYATA/); assert.match(semua, /DEFAULT MONITOR/);
  assert.equal(semua.includes('undefined'), false); assert.equal(semua.includes('NaN'), false);
  assert.match(tabelJurnal(d.mesin[0], { koin: 'TIDAKADA' }), /Tidak ada baris/);
  assert.equal(notifHtml(d.notifikasi).includes('data-prompt-id'), true);
  assert.equal(konteksHtml({ tersedia: false, alasan: 'Konteks pasar tidak tersedia' }).includes('tidak tersedia'), true);
});
test('aset web: lang id, tanpa sumber eksternal, app.js valid, tema gelap/terang, viewport responsif', () => {
  const idx = W('index.html');
  assert.match(idx, /<html lang="id">/); assert.match(idx, /name="viewport"/);
  for (const f of ['index.html', 'app.js', 'lib.mjs', 'style.css']) assert.equal(/https?:\/\//.test(W(f)), false, f + ' memuat URL eksternal');
  assert.match(W('style.css'), /prefers-color-scheme:dark/); assert.match(W('style.css'), /data-tema=dark/); assert.match(W('style.css'), /max-width:640px/);
  execFileSync(process.execPath, ['--check', new URL('../web/app.js', import.meta.url).pathname]);
  assert.equal(/innerHTML\s*=\s*[^;]*D\.(banner|event)\.teks/.test(W('app.js')), false); // teks event/banner lewat textContent atau esc
});
test('workflow: cron 15 menit, dispatch, push, concurrency, test gerbang, gagal bila commit state gagal, deploy Pages', () => {
  const y = fs.readFileSync(new URL('../.github/workflows/monitor.yml', import.meta.url), 'utf8');
  for (const s of ["cron: '*/15 * * * *'", 'workflow_dispatch', 'concurrency:', 'npm test', 'npm run build', '[skip ci]', 'exit 1', 'upload-pages-artifact', 'deploy-pages', 'pages: write', 'contents: write']) assert.ok(y.includes(s), s);
  assert.equal(/continue-on-error/.test(y), false); assert.equal(/if:\s*always\(\)/.test(y), false);
  assert.ok(y.indexOf('npm test') < y.indexOf('npm run build'));
  assert.match(y, /for i in 1 2 3 4 5/); // retry terbatas
});
