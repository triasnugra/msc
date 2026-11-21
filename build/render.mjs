// Build: jalankan monitor (menulis data/state, data/archive, site/data.json, site/laporan.txt) lalu salin aset dashboard ke site/.
import fs from 'node:fs';
import path from 'node:path';
import { jalankanMonitor } from '../src/run.mjs';

const root = process.cwd();
const d = await jalankanMonitor({ root });
fs.mkdirSync(path.join(root, 'site'), { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js', 'lib.mjs']) fs.copyFileSync(path.join(root, 'web', f), path.join(root, 'site', f));
fs.writeFileSync(path.join(root, 'site', '.nojekyll'), '');
console.log(`Build selesai: ${d.mesin.length} mesin, ${d.notifikasi.length} notifikasi, ${d.keputusanBaru} keputusan baru, ${d.banner.length} peringatan.`);
for (const b of d.banner) console.log(`PERINGATAN [${b.tingkat}] ${b.teks}`);
