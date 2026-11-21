// Perekat DOM. Seluruh render ada di lib.mjs (murni, teruji). Tidak ada dependensi atau sumber eksternal.
import { esc, tabelJurnal, ringkasanMesin, kelayakanHtml, infoMesin, konteksHtml, notifHtml, auditHtml, rumusHtml, wib } from './lib.mjs';

const $ = (id) => document.getElementById(id);
let D = null, tab = 'mesin:sc', filter = {};

function tema() {
  let t = null; try { t = localStorage.getItem('tema'); } catch { /* penyimpanan bisa tidak tersedia */ }
  if (t) document.documentElement.dataset.tema = t;
  $('btnTema').onclick = () => {
    const sekarang = document.documentElement.dataset.tema || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const baru = sekarang === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.tema = baru; try { localStorage.setItem('tema', baru); } catch { /* abaikan */ }
  };
}
async function salin(teks, tombol) {
  try { await navigator.clipboard.writeText(teks); } catch { const a = document.createElement('textarea'); a.value = teks; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch { /* abaikan */ } a.remove(); }
  if (tombol) { const t = tombol.textContent; tombol.textContent = 'Tersalin'; setTimeout(() => { tombol.textContent = t; }, 1500); }
}
function pasangSalin(root) {
  root.querySelectorAll('button.salin').forEach((b) => { b.onclick = () => salin(D.notifikasi.find((n) => n.id === b.dataset.promptId)?.prompt ?? '', b); });
  root.querySelectorAll('button.salin-mesin').forEach((b) => { b.onclick = () => salin(D.promptMesin[b.dataset.mesin] ?? '', b); });
}
function tabs() {
  const items = D.mesin.map((m) => [`mesin:${m.id}`, m.id]).concat([['notif', 'Notifikasi'], ['audit', 'Audit & Doktrin'], ['tentang', 'Rumus & Batasan']]);
  $('tabs').innerHTML = items.map(([k, l]) => `<button class="${k === tab ? 'aktif' : ''}" data-tab="${esc(k)}">${esc(l)}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; filter = {}; render(); }; });
}
function viewMesin(m) {
  const koin = [...new Set(m.rows.map((r) => r.koin))].sort();
  const opt = (v, l, s) => `<option value="${esc(v)}"${s === v ? ' selected' : ''}>${esc(l)}</option>`;
  const notif = D.notifikasi.filter((n) => n.mesin === m.id && n.status !== 'SELESAI');
  return `<h3>${esc(m.nama)}</h3>${infoMesin(m)}${ringkasanMesin(m)}
  <h3>Syarat kelayakan uang sungguhan</h3>${kelayakanHtml(m, D.kelayakanDefault)}
  <h3>Perlu diupgrade (${notif.length})</h3><button class="salin-mesin" data-mesin="${esc(m.id)}">Salin prompt upgrade untuk ${esc(m.id)}</button>${notifHtml(notif.slice(0, 8))}${notif.length > 8 ? `<p class="kecil">${notif.length - 8} lainnya di tab Notifikasi.</p>` : ''}
  ${m.anomali.length ? `<h3>Anomali data (${m.anomali.length})</h3><ul class="kecil">${m.anomali.slice(0, 12).map((a) => `<li><b>${esc(a.kode)}</b> ${esc(a.pesan)}</li>`).join('')}</ul>` : ''}
  <h3>Jurnal</h3><div class="filter"><select id="fKoin">${opt('', 'Semua koin', filter.koin ?? '')}${koin.map((k) => opt(k, k, filter.koin ?? '')).join('')}</select>
  <select id="fStatus">${opt('', 'Semua status', filter.status ?? '')}${['PENDING', 'OPEN', 'CLOSED', 'EXPIRED'].map((s) => opt(s, s, filter.status ?? '')).join('')}</select>
  <input type="date" id="fDari" value="${esc(filter.dari ?? '')}" title="dari (WIB)"><input type="date" id="fSampai" value="${esc(filter.sampai ?? '')}" title="sampai (WIB)"></div>
  <div id="tabelJurnal">${tabelJurnal(m, filter)}</div>
  <p class="kecil">Tgl dalam WIB (UTC+7), arahkan kursor untuk UTC. Jarak ke entry: positif = harga di sisi profit entry (limit belum tercapai), negatif = harga sudah menembus entry. Aturan simulasi tiap mesin berbeda (fill, biaya, TP1 parsial), jadi angka R tidak sepenuhnya sebanding.</p>`;
}
function render() {
  tabs();
  const el = $('isi');
  if (tab.startsWith('mesin:')) {
    const m = D.mesin.find((x) => `mesin:${x.id}` === tab) ?? D.mesin[0];
    el.innerHTML = viewMesin(m);
    const ubah = () => { filter = { koin: $('fKoin').value, status: $('fStatus').value, dari: $('fDari').value, sampai: $('fSampai').value }; $('tabelJurnal').innerHTML = tabelJurnal(m, filter); };
    ['fKoin', 'fStatus', 'fDari', 'fSampai'].forEach((i) => { $(i).onchange = ubah; });
  } else if (tab === 'notif') {
    const aktif = D.notifikasi.filter((n) => n.status !== 'SELESAI');
    el.innerHTML = `<h3>Pusat notifikasi upgrade (${aktif.length})</h3><p class="kecil">Status diubah di data/state/notif.json (BARU/DILIHAT/SELESAI/DITUNDA). Tingkat doktrin awal SEDANG dan baru naik bila uji bukti (6.H.3) menunjukkan grup ber-flag lebih buruk (n&ge;30 kedua grup).</p>${notifHtml(aktif)}`;
  } else if (tab === 'audit') {
    el.innerHTML = auditHtml(D.audit, D.definisi.hash);
  } else {
    el.innerHTML = `<h3>Rumus statistik</h3>${rumusHtml(D.rumus)}<h3>Batasan jujur monitor</h3><ul class="kecil">
    <li>R antar mesin tidak sepenuhnya sebanding: aturan fill, biaya, dan TP1 parsial berbeda. Lihat label kualitas data pada tiap baris.</li>
    <li>Flag doktrin (DOC-xx) adalah HIPOTESIS dari sumber opini, bukan bukti. Ambang di config/thresholds.json; mengubah definisi memulai epoch baru.</li>
    <li>Heatmap/peta likuiditas tidak disimulasikan. Hanya proksi dari candle (swing, FVG, three-tap, OBV) sebagai anotasi.</li>
    <li>Data harga gratis bisa tertunda, terbatas, atau diblokir (HTTP 451). Tanpa harga: maksimal TUNGGU.</li>
    <li>Keputusan monitor tidak menjamin hasil. Keputusan dicatat saat pertama terlihat, tanpa backfill.</li>
    <li>Jadwal FOMC/CPI resmi diambil best-effort; bila gagal dipakai data/events.json manual, tidak pernah dikarang.</li></ul>
    <p class="kecil">Definisi v${esc(D.definisi.versi)}, hash ${esc(D.definisi.hash)}${D.definisi.epochBaru ? ' (EPOCH BARU)' : ''}.</p>`;
  }
  pasangSalin(el);
}
function atas() {
  $('versi').textContent = `v${D.versi} - diperbarui ${D.dibuatWib}`;
  const aktif = D.notifikasi.filter((n) => n.status !== 'SELESAI'), kritis = aktif.filter((n) => n.tingkat === 'KRITIS' || n.tingkat === 'TINGGI').length;
  $('lencana').textContent = `${aktif.length} notifikasi (${kritis} tinggi/kritis)`; $('lencana').className = 'badge ' + (kritis ? 't-tinggi' : '');
  const umur = Math.round((Date.now() - D.dibuat) / 60000);
  const b = [...D.banner]; if (umur > (D.basiMenit ?? 90)) b.unshift({ tingkat: 'TINGGI', teks: `Data dasbor berumur ${umur} menit (pembaruan terakhir ${D.dibuatWib}). Bisa basi.` });
  $('banner').innerHTML = b.map((x) => `<div class="banner b-${esc(x.tingkat.toLowerCase())}">${esc(x.teks)}</div>`).join('');
  $('event').className = 'event' + (D.event.peringatan ? ' peringatan' : '');
  $('event').textContent = D.event.teks + (D.event.peringatan ? ' (kurang dari 24 jam)' : '');
  $('konteks').innerHTML = konteksHtml(D.konteks);
  $('kaki').textContent = `Monitor tidak mengubah keenam mesin. Pasar: ${D.pasar.ticker ?? 'tidak tersedia'}; request ${D.pasar.request}. Keputusan baru run ini: ${D.keputusanBaru}. Push: ${D.push.aktif ? 'aktif' : 'nonaktif'}.`;
  $('btnLaporan').onclick = (e) => salin(D.laporan, e.target);
}
tema();
fetch('data.json', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((d) => { D = d; atas(); render(); }).catch((e) => { $('event').textContent = 'Gagal memuat data.json: ' + e.message; $('event').className = 'event peringatan'; });
