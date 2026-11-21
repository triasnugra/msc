// Arsip append-only per mesin (data/archive/<mesin>.jsonl). Setiap baris = satu VERSI sebuah ID.
// Perubahan status/hasil ID ditambahkan sebagai versi baru, tidak menimpa. Riwayat tidak hilang walau mesin memotong jurnalnya.
const FIELD_SIG = ['status', 'terisi', 'hasilMesin', 'R_mesin', 'R_bersih', 'selesaiTs', 'fillTs', 'entry', 'sl', 'tp1', 'tp2', 'versi', 'hash'];
export const sigBaris = (r) => JSON.stringify(FIELD_SIG.map((f) => r[f] ?? null));
const kunci = (r) => `${r.mesin}|${r.id}`;

export function parseJsonl(teks) {
  const out = []; let rusak = 0;
  for (const l of String(teks ?? '').split('\n')) { const t = l.trim(); if (!t) continue; try { out.push(JSON.parse(t)); } catch { rusak++; } }
  return { baris: out, rusak };
}
// Versi terakhir tiap ID (urutan file = urutan waktu).
export function versiTerakhir(baris) { const m = new Map(); for (const r of baris) m.set(kunci(r), r); return m; }

export function barisBaru(terakhir, rows, nowMs) {
  const out = [], lihat = new Set();
  for (const r of rows) {
    const k = kunci(r); if (lihat.has(k)) continue; lihat.add(k);
    const p = terakhir.get(k);
    if (!p || sigBaris(p) !== sigBaris(r)) out.push({ ...r, tVersi: nowMs });
  }
  return out;
}
// Gabungan: arsip (riwayat) ditimpa data terkini dari mesin. ID yang sudah dibuang mesin tetap ada dari arsip.
export function gabungTerkini(terakhir, rows) {
  const m = new Map(terakhir);
  for (const r of rows) m.set(kunci(r), r);
  return [...m.values()].map(({ tVersi, ...r }) => r);
}
