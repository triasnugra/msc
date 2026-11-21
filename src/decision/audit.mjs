// Audit keputusan (6.H.1), profil kepatuhan (6.H.2), uji bukti per flag (6.H.3), panel kegagalan (DOC-26).
// Semua dikelompokkan per definisi_hash (epoch, DOC-25): statistik epoch berbeda TIDAK dicampur.
import { ringkas, bandingkanGrup, masukStatistik, wilson } from '../core/stats.mjs';

const kunci = (r) => `${r.mesin}|${r.id}`;

// Tempelkan catatan keputusan (flags, keputusan, definisiHash) ke baris. Baris tanpa catatan = belum pernah dilihat saat pending.
export function gabungKeputusan(rows, rekam) {
  const m = new Map(rekam.map((x) => [`${x.mesin}|${x.id}`, x]));
  return rows.map((r) => {
    const x = m.get(kunci(r));
    return { ...r, keputusan: x?.keputusan ?? null, flagLog: x?.flags ?? null, defHash: x?.definisiHash ?? null, tPertama: x?.tPertama ?? null };
  });
}

const dipakai = (r) => masukStatistik(r) && r.defHash !== null && r.flagLog !== null;

export function auditKeputusan(rowsGabung, opsi) {
  const out = {};
  for (const r of rowsGabung.filter(dipakai)) {
    const e = (out[r.defHash] ??= {});
    (e[r.keputusan] ??= []).push(r);
  }
  return Object.fromEntries(Object.entries(out).map(([h, g]) => [h, Object.fromEntries(Object.entries(g).map(([k, v]) => [k, ringkas(v, opsi)]))]));
}

export function profilKepatuhan(rowsGabung, rekam, opsi = {}) {
  const minN = opsi.minSampel;
  const out = {};
  for (const x of rekam) {
    const e = (out[x.mesin] ??= {})[x.definisiHash] ??= { n: 0, flags: {} };
    e.n++;
    for (const f of new Set(x.flags)) e.flags[f] = (e.flags[f] ?? 0) + 1;
  }
  for (const m of Object.values(out)) for (const e of Object.values(m)) {
    e.bermakna = e.n >= minN;
    e.persen = Object.fromEntries(Object.entries(e.flags).map(([f, c]) => [f, c / e.n * 100]));
    e.peringkat = e.bermakna ? Object.entries(e.persen).sort((a, b) => b[1] - a[1]).map(([f]) => f) : null;
  }
  return out;
}

export function ujiBuktiFlag(rowsGabung, opsi = {}) {
  const t = rowsGabung.filter(dipakai);
  const out = { GABUNGAN: {} };
  const flags = new Set(t.flatMap((r) => r.flagLog));
  const hitung = (rows, flag) => {
    const A = rows.filter((r) => r.flagLog.includes(flag)), B = rows.filter((r) => !r.flagLog.includes(flag));
    const cmp = bandingkanGrup(A, B, opsi);
    const wr = (rs) => { const n = rs.length, w = rs.filter((r) => r.R_bersih > 0).length; return { n, winRate: n ? w / n : null, wilson: wilson(w, n) }; };
    const lebihBuruk = cmp.status === 'terbukti berbeda' && cmp.selisih < 0;
    return { ...cmp, berFlag: wr(A), tanpaFlag: wr(B), lebihBuruk, tidakTerbukti: cmp.status === 'tidak terbukti' };
  };
  for (const f of flags) {
    out.GABUNGAN[f] = hitung(t, f);
    for (const m of new Set(t.map((r) => r.mesin))) (out[m] ??= {})[f] = hitung(t.filter((r) => r.mesin === m), f);
  }
  return out;
}

// DOC-26: kerugian terbesar sebanyak kemenangan terbesar, distribusi R lengkap, dan jumlah tak terisi.
export function panelKegagalan(rows, k, batas) {
  const t = rows.filter(masukStatistik);
  const urut = [...t].sort((a, b) => b.R_bersih - a.R_bersih);
  const n = Math.min(k, Math.floor(urut.length / 2) || urut.length);
  const bin = Array(batas.length + 1).fill(0);
  for (const r of t) { let i = batas.findIndex((b) => r.R_bersih < b); if (i < 0) i = batas.length; bin[i]++; }
  return {
    n: t.length, kemenanganTerbesar: urut.slice(0, n).map((r) => ({ id: r.id, mesin: r.mesin, R: r.R_bersih })),
    kerugianTerbesar: urut.slice(-n).reverse().map((r) => ({ id: r.id, mesin: r.mesin, R: r.R_bersih })),
    distribusi: batas.map((b, i) => ({ sampai: b, jumlah: bin[i] })).concat([{ sampai: null, jumlah: bin[batas.length] }]),
    tidakTerisi: rows.filter((r) => r.status === 'EXPIRED' || r.terisi === false).length,
    belumSelesai: rows.filter((r) => r.status === 'PENDING' || r.status === 'OPEN').length
  };
}
