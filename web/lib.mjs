// Pustaka render murni (string HTML). Dipakai browser (app.js) dan Node (test). Semua data pengguna di-escape.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x)) ? '-' : Number(x).toFixed(d);
export const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x)) ? '-' : (x * 100).toFixed(d) + '%';
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function wib(ms) {
  if (!Number.isFinite(ms)) return '-';
  const d = new Date(ms + 7 * 3600000);
  return `${d.getUTCDate()} ${BLN[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export const tglWib = (ms) => Number.isFinite(ms) ? new Date(ms + 7 * 3600000).toISOString().slice(0, 10) : '';
export const harga = (x) => { if (!Number.isFinite(x)) return '-'; const a = Math.abs(x); return a >= 100 ? x.toFixed(2) : a >= 1 ? x.toFixed(4) : x.toPrecision(4); };

export const KOLOM = ['Mesin', 'Koin', 'Arah', 'Entry', 'SL', 'TP', 'Harga', 'Jarak ke entry', 'Tgl', 'Keputusan monitor', 'Catatan'];
const CLS_KEP = { 'LAYAK ENTRY': 'k-layak', TUNGGU: 'k-tunggu', TERLAMBAT: 'k-lambat', BATAL: 'k-batal', HINDARI: 'k-hindari' };
const LABEL_Q = { LENGKAP: 'lengkap', TERPOTONG: 'terpotong', TIDAK_TERVERIFIKASI_FILL: 'fill tak terverifikasi', HASIL_HARDCODE: 'R hardcode', REKONSTRUKSI: 'rekonstruksi' };

export function sel(r) {
  const entry = r.entryLow !== r.entryHigh ? `${harga(r.entryLow)} - ${harga(r.entryHigh)}` : harga(r.entry);
  return entry;
}
function jarak(r) {
  if (r.sisi === 'DI_ZONA') return 'DI DALAM ZONA';
  if (!Number.isFinite(r.jarakPct)) return '-';
  return `${r.jarakPct >= 0 ? '+' : ''}${num(r.jarakPct, 2)}% (${num(r.jarakR, 2)}R)`;
}
function hasilSelesai(r) {
  const p = [`Hasil ${esc(r.hasilMesin ?? r.status)}`];
  if (Number.isFinite(r.R_mesin)) p.push(`R mesin ${num(r.R_mesin, 2)}`);
  if (Number.isFinite(r.R_bersih)) p.push(`R bersih ${num(r.R_bersih, 2)}${r.R_sudah_net ? ' (mesin sudah net)' : ''}`);
  return p.join('; ');
}
export function barisJurnal(m, r) {
  const selesai = r.status === 'CLOSED' || r.status === 'EXPIRED';
  const tp = `${harga(r.tp1)}${Number.isFinite(r.tp2) ? ' / ' + harga(r.tp2) : ''}`;
  const q = (r.kualitasData ?? []).filter((x) => x !== 'LENGKAP').map((x) => `<span class="q" title="${esc(x)}">${esc(LABEL_Q[x] ?? x)}</span>`).join(' ');
  const kep = selesai ? `<span class="k-selesai">${r.status === 'EXPIRED' ? 'tidak terisi' : 'selesai'}</span>` : (r.keputusan ? `<span class="kep ${CLS_KEP[r.keputusan] ?? ''}">${esc(r.keputusan)}</span>` : '-');
  const cat = selesai ? hasilSelesai(r) : esc(r.catatan ?? '');
  const pertama = !selesai && r.keputusanPertama && r.keputusanPertama.keputusan !== r.keputusan ? `<div class="kecil">pertama terlihat: ${esc(r.keputusanPertama.keputusan)}</div>` : '';
  return `<tr><td>${esc(m.id)}</td><td>${esc(r.koin)}</td><td class="${r.arah === 'LONG' ? 'long' : 'short'}">${esc(r.arah)}</td><td>${sel(r)}${r.entryTerbalik ? ' <span class="q" title="zona entry terbalik di jurnal mesin">terbalik</span>' : ''}</td><td>${harga(r.sl)}</td><td>${tp}</td><td>${harga(r.harga)}</td><td>${jarak(r)}</td><td title="${esc(new Date(r.waktuUtc).toISOString())}">${wib(r.waktuUtc)}</td><td>${kep}${pertama}</td><td class="cat">${cat} ${q}</td></tr>`;
}
export function tabelJurnal(m, f = {}, batas = 200) {
  let rows = m.rows;
  if (f.koin) rows = rows.filter((r) => r.koin === f.koin);
  if (f.status) rows = rows.filter((r) => r.status === f.status);
  if (f.dari) rows = rows.filter((r) => tglWib(r.waktuUtc) >= f.dari);
  if (f.sampai) rows = rows.filter((r) => tglWib(r.waktuUtc) <= f.sampai);
  const tampil = rows.slice(0, batas);
  const head = `<tr>${KOLOM.map((k) => `<th>${k}</th>`).join('')}</tr>`;
  return `<div class="tbl"><table><thead>${head}</thead><tbody>${tampil.map((r) => barisJurnal(m, r)).join('') || `<tr><td colspan="${KOLOM.length}">Tidak ada baris.</td></tr>`}</tbody></table></div>${rows.length > batas ? `<p class="kecil">Menampilkan ${batas} dari ${rows.length} baris.</p>` : ''}`;
}

export function ringkasanMesin(m) {
  const r = m.ring;
  const wilsonTxt = r.wilson ? `${pct(r.wilson.lo)} - ${pct(r.wilson.hi)}` : '-';
  const pf = r.pfTakTerhingga ? '<span class="peringatan">tak terhingga (tidak ada kerugian)</span>' : num(r.pf);
  const stat = `<div class="grid">
  <div><b>${m.status.jumlahBaris}</b><span>setup tercatat</span></div>
  <div><b>${m.terisi}</b><span>terisi</span></div>
  <div><b>${r.n}</b><span>trade selesai (${r.wins} menang / ${r.losses} kalah)</span></div>
  <div><b>${r.n ? pct(r.winRate) : '-'}</b><span>win rate; Wilson 95%: ${wilsonTxt}</span></div>
  <div><b>${r.n ? num(r.expectancy, 3) : '-'}</b><span>R bersih/trade</span></div>
  <div><b>${r.n ? pf : '-'}</b><span>profit factor</span></div>
  <div><b>${r.minggu}</b><span>minggu data</span></div>
  <div><b>${m.tidakTerisi}</b><span>tidak terisi/kedaluwarsa</span></div></div>`;
  const peringatan = r.bermakna ? '' : `<p class="peringatan">Belum bermakna: ${r.n} trade selesai (< 30). Skor, peringkat, dan CI tidak ditampilkan.</p>`;
  const tambahan = r.bermakna ? `<p class="kecil">CI95 rata-rata R: ${r.ci ? `[${num(r.ci.lo)}, ${num(r.ci.hi)}]` : '-'}; SQN ${num(r.sqn)}; DD maks ${num(r.maxDD)}R; SD ${num(r.sd)}.</p>` : '';
  const epoch = m.epoch.length > 1 ? `<p class="kecil">Epoch konfigurasi (statistik dihitung per hash, tidak dicampur): ${m.epoch.map((e) => `${esc(e.versi ?? '-')}/${esc(String(e.hash).slice(0, 8))}: ${e.n}${e.aktif ? ' (aktif)' : ''}`).join('; ')}</p>` : '';
  return stat + peringatan + tambahan + epoch;
}
export function kelayakanHtml(m, kDefault) {
  const k = m.kelayakan;
  const status = k.layak ? '<span class="badge ok">SEMUA SYARAT TERPENUHI</span>' : '<span class="badge belum">BELUM LAYAK MODAL NYATA</span>';
  const baris = k.syarat.map((s) => `<tr><td>${esc(s.nama)}</td><td>${esc(s.perlu)}</td><td>${esc(s.aktual ?? '-')}</td><td class="${s.ok ? 'ya' : 'tidak'}">${s.ok ? 'terpenuhi' : 'belum'}</td></tr>`).join('');
  return `<div class="kelayakan">${status}<p class="kecil">Sumber kriteria: ${esc(k.sumber)}${k.definisi ? '' : ` - pembanding ini bukan milik mesin (${esc(kDefault.label)})`}</p>
  <table><thead><tr><th>Syarat</th><th>Perlu</th><th>Aktual</th><th>Status</th></tr></thead><tbody>${baris}</tbody></table>
  ${k.alasanTolak.length ? `<ul class="kecil">${k.alasanTolak.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</div>`;
}
export function infoMesin(m) {
  const st = m.status;
  const sumber = st.ok ? `OK (${esc(st.sumber)})` : `<span class="peringatan">GAGAL: ${esc(st.error)}</span>`;
  const q = Object.entries(m.kualitasHitung).map(([k, v]) => `<span class="q">${esc(LABEL_Q[k] ?? k)} ${v}</span>`).join(' ');
  return `<p class="kecil">Sumber data: ${sumber}. Kadensi ${m.kadensiMenit} menit (${esc(m.kadensiStatus)}). Masa order ${m.batalSetelahMenit} menit (${esc(m.batalStatus)}).<br>R sudah net biaya: <b>${m.rSudahNet ? 'ya' : 'tidak'}</b> (${esc(m.rSudahNetBukti)}). Stop median ${num(m.stop.median)}%; >2%: ${num(m.stop.persenLebar, 0)}%; >5%: ${num(m.stop.persenSangatLebar, 0)}%.<br>Kualitas data: ${q || '-'}</p>`
    + (m.chain ? `<p class="${m.chain.ok ? 'kecil' : 'peringatan'}">Rantai hash: ${m.chain.ok ? 'valid' : 'PUTUS - ' + esc(m.chain.pesan)}</p>` : '')
    + (m.backtest ? `<p class="kecil">Backtest (terpisah dari forward): n ${m.backtest.ring.n}, R/trade ${num(m.backtest.ring.expectancy, 3)}, PF ${num(m.backtest.ring.pf)}; ${m.backtest.fillInstan} dari trade selesai berstatus fill instan; ${m.backtest.tidakTerisi} tidak terisi.</p>` : '');
}
export function konteksHtml(k) {
  if (!k.tersedia) return `<div class="panel peringatan">${esc(k.alasan)}</div>`;
  const t = (x) => esc(k.tren[x]?.label ?? '-');
  return `<div class="panel"><div class="status s-${esc(k.status.split('-')[0].toLowerCase())}">${esc(k.status)}</div><p>${esc(k.alasanStatus)}. <span class="kecil">(hipotesis; status ini hanya konteks, tidak membatalkan sinyal)</span></p>
  <p class="kecil">BTC ${harga(k.harga)}; tren 1W ${t('1W')}, 1D ${t('1D')}, 4H ${t('4H')}, 1H ${t('1H')}; posisi range 1H ${num(k.posisiRangePct, 0)}%${k.btcTengahRange ? ' (tengah range)' : ''}; ATR(1H) ${num(k.atr1hPct)}%; 24 jam ${num(k.perubahan24jPct)}%; shock ${k.shock.aktif ? esc(k.shock.alasan) : 'tidak'}; sesi ${esc(k.sesi)}${k.jendelaVolumeRendah.aktif ? '; volume rendah (' + esc(k.jendelaVolumeRendah.alasan) + ')' : ''}; Monday high/low ${k.monday ? harga(k.monday.high) + ' / ' + harga(k.monday.low) : '-'}.</p></div>`;
}
export function notifHtml(list, mesin = null) {
  const L = mesin ? list.filter((n) => n.mesin === mesin) : list;
  if (!L.length) return '<p class="kecil">Tidak ada notifikasi.</p>';
  return L.map((n) => `<div class="notif t-${esc(n.tingkat.toLowerCase())}"><div class="nk"><span class="badge t-${esc(n.tingkat.toLowerCase())}">${esc(n.tingkat)}</span> <b>${esc(n.id)}</b> <span class="kecil">${esc(n.mesin)} - ${esc(n.status)}${n.jenis === 'PERTANYAAN-VERIFIKASI' ? ' - PERTANYAAN-VERIFIKASI' : ''}</span></div>
  <div><b>${esc(n.judul)}</b></div><div class="kecil">Bukti: ${esc(n.bukti)}</div><div class="kecil">Dampak: ${esc(n.dampak)}</div><div class="kecil">Tindakan: ${esc(n.tindakan)}</div>
  <div class="kecil">${n.doc?.length ? 'Doktrin: ' + n.doc.map(esc).join(', ') + '. ' : ''}Pertama terdeteksi ${wib(n.pertamaTerdeteksi)} WIB.</div>
  <button class="salin" data-prompt-id="${esc(n.id)}">Salin prompt upgrade untuk Claude</button></div>`).join('');
}
export function auditHtml(a, hashAktif) {
  const kep = Object.entries(a.keputusan).map(([h, g]) => `<h4>Epoch ${esc(h)}${h === hashAktif ? ' (aktif)' : ''}</h4><table><thead><tr><th>Keputusan</th><th>Selesai</th><th>Menang</th><th>R/trade</th><th>Catatan</th></tr></thead><tbody>${Object.entries(g).map(([k, r]) => `<tr><td>${esc(k)}</td><td>${r.n}</td><td>${r.n ? pct(r.winRate) : '-'}</td><td>${r.bermakna ? num(r.expectancy, 3) : '-'}</td><td>${r.bermakna ? '' : 'belum bermakna'}</td></tr>`).join('')}</tbody></table>`).join('') || '<p class="kecil">Belum ada sinyal selesai yang punya catatan keputusan (keputusan dicatat saat pertama terlihat, tanpa backfill).</p>';
  const profil = Object.entries(a.profil).map(([m, e]) => Object.entries(e).map(([h, v]) => `<tr><td>${esc(m)}</td><td>${esc(h)}</td><td>${v.n}</td><td>${v.bermakna ? Object.entries(v.persen).sort((x, y) => y[1] - x[1]).map(([f, p]) => `${esc(f)} ${p.toFixed(0)}%`).join(', ') : '<span class="redup">belum bermakna (tanpa peringkat)</span>'}</td></tr>`).join('')).join('');
  const uji = Object.entries(a.uji.GABUNGAN ?? {}).map(([f, u]) => `<tr><td>${esc(f)}</td><td>${u.nA}</td><td>${u.nB}</td><td>${Number.isFinite(u.selisih) ? num(u.selisih, 2) : '-'}</td><td>${u.berFlag.winRate === null ? '-' : pct(u.berFlag.winRate, 0)} / ${u.tanpaFlag.winRate === null ? '-' : pct(u.tanpaFlag.winRate, 0)}</td><td class="${u.status === 'terbukti berbeda' ? 'tidak' : ''}">${esc(u.status)}</td></tr>`).join('');
  const g = a.kegagalan;
  const kl = (x) => x.map((y) => `${esc(y.mesin)}:${esc(y.id)} ${num(y.R)}R`).join('<br>') || '-';
  return `<h3>Audit keputusan monitor (6.H.1)</h3>${kep}
  <h3>Profil kepatuhan doktrin (6.H.2)</h3><table><thead><tr><th>Mesin</th><th>definisi_hash</th><th>Sinyal dicatat</th><th>% per flag</th></tr></thead><tbody>${profil || '<tr><td colspan="4">Belum ada data.</td></tr>'}</tbody></table>
  <h3>Uji bukti per flag, gabungan (6.H.3)</h3><p class="kecil">Perbandingan R bersih sinyal ber-flag vs tanpa flag. Label "belum bermakna" bila salah satu grup &lt; 30. Flag yang tidak terbukti ditampilkan apa adanya.</p><table><thead><tr><th>Flag</th><th>n ber-flag</th><th>n tanpa</th><th>Selisih R</th><th>Win rate ber/tanpa</th><th>Status</th></tr></thead><tbody>${uji || '<tr><td colspan="6">Belum ada data.</td></tr>'}</tbody></table>
  <h3>Panel kegagalan (DOC-26)</h3><div class="grid2"><div><b>Kerugian terbesar</b><p class="kecil">${kl(g.kerugianTerbesar)}</p></div><div><b>Kemenangan terbesar</b><p class="kecil">${kl(g.kemenanganTerbesar)}</p></div></div><p class="kecil">Sinyal tidak terisi/kedaluwarsa: ${g.tidakTerisi}; belum selesai: ${g.belumSelesai}; distribusi R: ${g.distribusi.map((b) => `${b.sampai === null ? '&ge; terakhir' : '&lt; ' + b.sampai}: ${b.jumlah}`).join('; ')}.</p>`;
}
export function rumusHtml(r) {
  return `<ul class="kecil">${Object.entries(r).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}</ul>`;
}
