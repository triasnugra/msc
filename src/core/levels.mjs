// Level, jarak, R:R, level unik.
export const stopPctDari = (entry, sl) => (Number.isFinite(entry) && Number.isFinite(sl) && entry !== 0) ? Math.abs(entry - sl) / entry * 100 : null;

// jarak ke entry (6.A). Untuk order LIMIT:
//  BELUM_TERSENTUH = harga masih di sisi profit entry (LONG: harga>entry; SHORT: harga<entry), order belum tercapai;
//  TEMBUS          = harga sudah menembus entry ke sisi rugi (order limit seharusnya sudah terisi);
//  DI_ZONA         = harga di dalam zona entry.
export function jarakKeEntry({ arah, entry, entryLow, entryHigh, sl, harga }) {
  if (![entry, harga].every(Number.isFinite) || (arah !== 'LONG' && arah !== 'SHORT')) return null;
  const lo = Number.isFinite(entryLow) ? Math.min(entryLow, entryHigh) : entry;
  const hi = Number.isFinite(entryHigh) ? Math.max(entryLow, entryHigh) : entry;
  const risiko = Math.abs(entry - sl);
  if (lo !== hi && harga >= lo && harga <= hi) return { jarakPct: 0, jarakR: 0, diDalamZona: true, sisi: 'DI_ZONA' };
  const pct = (arah === 'LONG' ? (harga - entry) / entry : (entry - harga) / entry) * 100;
  const jarakR = risiko > 0 ? Math.abs(harga - entry) / risiko : null;
  return { jarakPct: pct, jarakR, diDalamZona: false, sisi: pct > 0 ? 'BELUM_TERSENTUH' : pct < 0 ? 'TEMBUS' : 'DI_ZONA' };
}

// rr_sisa_tp1 (DOC-05): |tp1-acuan| / |acuan-sl|. acuan = harga live bila sudah melewati entry, selain itu entry.
export function rrSisaTp1({ arah, entry, sl, tp1, harga }) {
  if (![entry, sl, tp1].every(Number.isFinite)) return null;
  let acuan = entry;
  if (Number.isFinite(harga)) {
    const lewat = arah === 'LONG' ? harga < entry : harga > entry;
    if (lewat) acuan = harga;
  }
  const risk = Math.abs(acuan - sl);
  return risk > 0 ? Math.abs(tp1 - acuan) / risk : null;
}

// R ke TP1 dari entry (bukan ke TP2). Dipakai membandingkan dengan rr yang dipublikasikan mesin.
export function rKeTp1(entry, sl, tp1) {
  const risk = Math.abs(entry - sl);
  return (Number.isFinite(risk) && risk > 0 && Number.isFinite(tp1)) ? Math.abs(tp1 - entry) / risk : null;
}

export function median(a) {
  const x = a.filter(Number.isFinite).sort((p, q) => p - q);
  if (!x.length) return null;
  const m = x.length >> 1;
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
}

// Level unik: koin+arah+entry+SL+TP sama = satu trade independen.
export const kunciLevel = (r) => [r.koin, r.arah, r.entry, r.sl, r.tp1, r.tp2].join('|');

export function levelUnik(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) { const k = kunciLevel(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}

// Klaster: sinyal arah sama dalam jendela (menit) sejak awal klaster = satu pengamatan berkorelasi.
export function klasterSamaArah(rows, jendelaMenit) {
  const clusters = [];
  const by = { LONG: [], SHORT: [] };
  for (const r of rows) if (by[r.arah] && Number.isFinite(r.waktuUtc)) by[r.arah].push(r);
  for (const arah of Object.keys(by)) {
    const s = by[arah].sort((a, b) => a.waktuUtc - b.waktuUtc);
    let cur = null;
    for (const r of s) {
      if (cur && r.waktuUtc - cur.start <= jendelaMenit * 60000) cur.rows.push(r);
      else { cur = { arah, start: r.waktuUtc, rows: [r] }; clusters.push(cur); }
    }
  }
  return clusters;
}

export function nEfektif(rows, jendelaMenit) {
  const unik = levelUnik(rows);
  return { nTotal: rows.length, nUnik: unik.length, nEfektif: klasterSamaArah(unik, jendelaMenit).length };
}
