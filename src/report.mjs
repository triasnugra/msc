// Laporan teks untuk Claude (6.I). Tidak memuat rahasia/token. n<30 selalu ditulis "belum bermakna" tanpa skor atau peringkat.
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x)) ? '-' : x.toFixed(d);
const p = (x) => (x === null || x === undefined || !Number.isFinite(x)) ? '-' : (x * 100).toFixed(1) + '%';

export function buatLaporan(d) {
  const L = [];
  L.push(`LAPORAN MONITOR MSC v${d.versi}`, `Dibuat: ${d.dibuatWib}`, `Definisi: v${d.definisi.versi}, hash ${d.definisi.hash}${d.definisi.epochBaru ? ' (EPOCH BARU, statistik lama tidak dicampur)' : ''}`, '');
  if (d.banner.length) { L.push('PERINGATAN:'); for (const b of d.banner) L.push(`- [${b.tingkat}] ${b.teks}`); L.push(''); }
  L.push('EVENT MAKRO (FOMC/CPI):', d.event.teks, d.event.sumber ? `Sumber: ${d.event.sumber}` : 'Sumber: belum terverifikasi', '');
  L.push('KONDISI PASAR (HIPOTESIS):');
  const k = d.konteks;
  if (!k.tersedia) L.push(k.alasan);
  else L.push(`Status: ${k.status}. ${k.alasanStatus}.`, `BTC ${f(k.harga, 0)}; tren 1W ${k.tren['1W'].label ?? '-'}, 1D ${k.tren['1D'].label ?? '-'}, 4H ${k.tren['4H'].label ?? '-'}, 1H ${k.tren['1H'].label ?? '-'}; posisi range 1H ${f(k.posisiRangePct, 0)}%; ATR(1H) ${f(k.atr1hPct)}%; 24j ${f(k.perubahan24jPct)}%; shock ${k.shock.aktif ? 'AKTIF (' + k.shock.alasan + ')' : 'tidak'}; sesi ${k.sesi}.`);
  L.push('');
  L.push('KINERJA PER MESIN (R bersih seragam; aturan simulasi tiap mesin berbeda sehingga R tidak sepenuhnya sebanding):');
  for (const m of d.mesin) {
    const r = m.ring;
    L.push(`- ${m.id}: data ${m.status.ok ? 'OK (' + m.status.sumber + ')' : 'GAGAL (' + m.status.error + ')'}; baris ${m.status.jumlahBaris}; selesai ${r.n}; terisi ${m.terisi}; tidak terisi ${m.tidakTerisi}.`);
    if (!r.bermakna) L.push(`    belum bermakna (n=${r.n} < 30); tidak ada skor atau peringkat.`);
    else L.push(`    win rate ${p(r.winRate)} (Wilson ${p(r.wilson?.lo)}-${p(r.wilson?.hi)}); R/trade ${f(r.expectancy, 3)}; PF ${r.pfTakTerhingga ? 'tak terhingga (peringatan: tidak ada kerugian)' : f(r.pf)}; SQN ${f(r.sqn)}; CI95 ${r.ci ? '[' + f(r.ci.lo) + ', ' + f(r.ci.hi) + ']' : '-'}; DD maks ${f(r.maxDD)}R; minggu ${r.minggu}.`);
    L.push(`    kelayakan uang nyata: ${m.kelayakan.layak ? 'SEMUA SYARAT TERPENUHI' : 'BELUM'} (sumber kriteria: ${m.kelayakan.sumber}). ${m.kelayakan.syarat.map((s) => `${s.nama} ${s.aktual ?? '-'}/${s.perlu} ${s.ok ? 'ok' : 'belum'}`).join('; ')}${m.kelayakan.alasanTolak.length ? ' | ' + m.kelayakan.alasanTolak.join('; ') : ''}`);
    L.push(`    kualitas data: ${Object.entries(m.kualitasHitung).map(([a, b]) => `${a} ${b}`).join(', ') || '-'}; R sudah net: ${m.rSudahNet ? 'ya' : 'tidak (biaya dikurangi monitor)'}; stop median ${f(m.stop.median)}%, >2% ${f(m.stop.persenLebar, 0)}%, >5% ${f(m.stop.persenSangatLebar, 0)}%.`);
    if (m.chain) L.push(`    rantai hash: ${m.chain.ok ? 'valid' : 'PUTUS - ' + m.chain.pesan}`);
    if (m.backtest) L.push(`    backtest (terpisah dari forward): n ${m.backtest.ring.n}, R/trade ${f(m.backtest.ring.expectancy, 3)}, PF ${f(m.backtest.ring.pf)}, ${m.backtest.fillInstan} trade selesai berstatus fill instan, ${m.backtest.tidakTerisi} tidak terisi.`);
  }
  L.push('');
  L.push('PROFIL KEPATUHAN DOKTRIN (per definisi_hash):');
  for (const [mid, e] of Object.entries(d.audit.profil)) for (const [h, v] of Object.entries(e)) {
    L.push(`- ${mid} [${h}]: ${v.n} sinyal dicatat${v.bermakna ? '' : ' (belum bermakna, tanpa peringkat)'}; ` + (Object.entries(v.persen).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([fl, pc]) => `${fl} ${pc.toFixed(0)}%`).join(', ') || 'tanpa flag'));
  }
  L.push('', 'UJI BUKTI PER FLAG (gabungan; hanya yang bermakna, n>=30 di kedua grup):');
  const bermakna = Object.entries(d.audit.uji.GABUNGAN ?? {}).filter(([, u]) => u.bermakna);
  if (!bermakna.length) L.push('- belum ada flag dengan sampel bermakna.');
  for (const [fl, u] of bermakna) L.push(`- ${fl}: selisih R ${f(u.selisih, 2)} (n ${u.nA} vs ${u.nB}) = ${u.status}`);
  L.push('', 'PANEL KEGAGALAN (DOC-26):');
  const g = d.audit.kegagalan;
  L.push(`- n ${g.n}; tidak terisi/kedaluwarsa ${g.tidakTerisi}; belum selesai ${g.belumSelesai}`, `- kerugian terbesar: ${g.kerugianTerbesar.map((x) => `${x.mesin}:${x.id} ${f(x.R)}R`).join(', ') || '-'}`, `- kemenangan terbesar: ${g.kemenanganTerbesar.map((x) => `${x.mesin}:${x.id} ${f(x.R)}R`).join(', ') || '-'}`, '');
  const aktif = d.notifikasi.filter((n) => n.status !== 'SELESAI');
  L.push(`NOTIFIKASI AKTIF (${aktif.length}):`);
  for (const n of aktif.slice(0, 40)) L.push(`- [${n.tingkat}] ${n.id} (${n.mesin}) ${n.judul} | bukti: ${n.bukti}${n.doc?.length ? ' | ' + n.doc.join(',') : ''}`);
  if (aktif.length > 40) L.push(`- ... dan ${aktif.length - 40} lainnya (lihat dashboard)`);
  if (d.catatanLuar) L.push('', `${d.catatanLuar.label}:`, JSON.stringify(d.catatanLuar.isi));
  L.push('', 'PERMINTAAN EVALUASI:', '1. Menurut bukti di atas, mesin mana yang layak diteruskan forward test, diperbaiki, atau dihentikan? Jangan memberi saran setel parameter ke data terbaru.', '2. Notifikasi mana yang paling berdampak? Untuk perbaikan kode, wajib uji out-of-sample dan awali epoch/versi baru.', '3. Tunjukkan klaim di laporan ini yang berstatus belum bermakna atau tidak terverifikasi.');
  return L.join('\n');
}
