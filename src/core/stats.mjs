// Statistik (6.D). Semua rumus tertulis di sini DAN di UI.
//  win rate  : Wilson 95% (z=1,96)
//  expectancy: rata-rata R_bersih
//  PF        : jumlah R menang / |jumlah R kalah| (kalah=0 -> "tak terhingga", bukan angka)
//  CI95 mean : mean +- 1,96 x sd/sqrt(n), hanya n>=30 (sd sampel, n-1)
//  SQN       : sqrt(n) x mean / sd
//  DD maks   : puncak-ke-lembah kurva R kumulatif, urut waktu selesai
//  minggu    : jumlah minggu kalender (Senin UTC) dengan >=1 trade selesai
export const RUMUS = {
  winRate: 'Wilson 95%: pusat=(p+z²/2n)/(1+z²/n); setengah-lebar=z·√(p(1-p)/n+z²/4n²)/(1+z²/n), z=1,96',
  expectancy: 'rata-rata R_bersih',
  pf: 'jumlah R menang / |jumlah R kalah|; bila tidak ada kalah: tak terhingga (diberi peringatan)',
  ci95: 'mean ± 1,96·sd/√n (sd sampel n-1), hanya untuk n≥30',
  sqn: '√n · mean / sd',
  drawdown: 'penurunan terbesar dari puncak pada kurva R kumulatif (urut waktu selesai)',
  minggu: 'jumlah minggu kalender (Senin UTC) berisi ≥1 trade selesai'
};

export function wilson(k, n, z = 1.96) {
  if (!(n > 0)) return null;
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

export const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
export function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

const MINGGU_MS = 7 * 86400000;
export const indeksMinggu = (ts) => Math.floor((ts + 3 * 86400000) / MINGGU_MS); // 1 Jan 1970 = Kamis

// Trade yang masuk statistik: selesai (CLOSED), tidak terbukti tak terisi, R_bersih ada, bukan SPOT.
export const masukStatistik = (r) => r.status === 'CLOSED' && r.terisi !== false && Number.isFinite(r.R_bersih) && r.mode !== 'SPOT';

export function ringkas(rows, { minSampel = 30, z = 1.96, ciMinN = 30 } = {}) {
  const t = rows.filter(masukStatistik).sort((a, b) => (a.selesaiTs ?? a.waktuUtc ?? 0) - (b.selesaiTs ?? b.waktuUtc ?? 0));
  const Rs = t.map((r) => r.R_bersih);
  const n = Rs.length;
  const wins = Rs.filter((x) => x > 0).length;
  const sumW = Rs.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const sumL = Rs.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  const m = mean(Rs), s = sd(Rs);
  let pf = null, pfTakTerhingga = false;
  if (sumL < 0) pf = sumW / Math.abs(sumL); else if (sumW > 0) pfTakTerhingga = true;
  let eq = 0, peak = 0, dd = 0;
  for (const x of Rs) { eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const total = Rs.reduce((a, x) => a + x, 0);
  const ci = (n >= ciMinN && s !== null) ? { lo: m - z * s / Math.sqrt(n), hi: m + z * s / Math.sqrt(n) } : null;
  const top3 = [...Rs].sort((a, b) => b - a).slice(0, 3).filter((x) => x > 0).reduce((a, x) => a + x, 0);
  const minggu = new Set(t.map((r) => indeksMinggu(r.selesaiTs ?? r.waktuUtc)).filter(Number.isFinite)).size;
  return {
    n, wins, losses: Rs.filter((x) => x < 0).length, bermakna: n >= minSampel,
    peringatan: n < minSampel ? 'belum bermakna (n<' + minSampel + ')' : null,
    winRate: n ? wins / n : null, wilson: wilson(wins, n, z),
    expectancy: m, sd: s, ci, pf, pfTakTerhingga, sqn: (s && s > 0) ? Math.sqrt(n) * m / s : null,
    maxDD: dd, totalR: total, minggu,
    top3ShareWins: sumW > 0 ? top3 / sumW : null,
    maxDDvsTotal: total > 0 ? dd / total : null
  };
}

// Kelayakan uang nyata. TIDAK pernah "layak" bila ada syarat yang tak terpenuhi, kriteria tak didefinisikan,
// atau mayoritas data bermutu rendah. Pembanding default monitor tidak pernah menghasilkan "layak".
export function kelayakan(ring, kriteria, kriteriaDefault, kualitasBuruk = false) {
  const definisi = kriteria && kriteria.minTrades != null;
  const k = definisi ? kriteria : kriteriaDefault;
  const syarat = [];
  const tambah = (nama, perlu, aktual, ok) => syarat.push({ nama, perlu, aktual, ok });
  tambah('Trade selesai', k.minTrades, ring.n, ring.n >= k.minTrades);
  tambah('Minggu data', k.minMinggu, ring.minggu, ring.minggu >= k.minMinggu);
  if (k.ciBawahHarusPositif) tambah('CI95 bawah > 0', '> 0', ring.ci ? +ring.ci.lo.toFixed(3) : null, !!ring.ci && ring.ci.lo > 0);
  if (k.minPF != null) tambah('Profit factor', k.minPF, ring.pfTakTerhingga ? 'tak terhingga' : (ring.pf == null ? null : +ring.pf.toFixed(3)), ring.pfTakTerhingga || (ring.pf != null && ring.pf >= k.minPF));
  if (k.minSQN != null) tambah('SQN', k.minSQN, ring.sqn == null ? null : +ring.sqn.toFixed(3), ring.sqn != null && ring.sqn >= k.minSQN);
  const semuaOk = syarat.every((x) => x.ok);
  const alasanTolak = [];
  if (!definisi) alasanTolak.push('mesin tidak mendefinisikan kriteria; pembanding default monitor tidak pernah memberi status layak');
  if (kualitasBuruk) alasanTolak.push('data bermutu rendah (fill tidak terverifikasi atau R hardcode)');
  if (!ring.bermakna) alasanTolak.push('sampel belum bermakna');
  const layak = definisi && semuaOk && !kualitasBuruk && ring.bermakna;
  return { layak, sumber: definisi ? kriteria.sumber : kriteriaDefault.label, definisi, syarat, alasanTolak };
}

// Kelompokkan baris menurut fungsi kunci lalu ringkas masing-masing (epoch/hash, keputusan, flag).
export function ringkasPerKelompok(rows, kunci, opsi) {
  const g = new Map();
  for (const r of rows) { const k = kunci(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return Object.fromEntries([...g].map(([k, v]) => [k, ringkas(v, opsi)]));
}

// Selisih rata-rata R_bersih antara dua grup (6.H.3). Bermakna bila kedua grup n>=minSampel.
export function bandingkanGrup(a, b, opsi = {}) {
  const minSampel = opsi.minSampel ?? 30, z = opsi.z ?? 1.96;
  const A = a.filter(masukStatistik).map((r) => r.R_bersih), B = b.filter(masukStatistik).map((r) => r.R_bersih);
  const out = { nA: A.length, nB: B.length, meanA: mean(A), meanB: mean(B), selisih: null, ci: null, bermakna: A.length >= minSampel && B.length >= minSampel, status: 'belum bermakna' };
  if (A.length && B.length) out.selisih = mean(A) - mean(B);
  if (out.bermakna) {
    const se = Math.sqrt(sd(A) ** 2 / A.length + sd(B) ** 2 / B.length);
    out.ci = { lo: out.selisih - z * se, hi: out.selisih + z * se };
    out.status = (out.ci.lo > 0 || out.ci.hi < 0) ? 'terbukti berbeda' : 'tidak terbukti';
  }
  return out;
}
