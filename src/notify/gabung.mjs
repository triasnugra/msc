// Menggabungkan notifikasi otomatis + seed dengan state (waktu pertama terdeteksi, status, tingkat terakhir).
import { peringkat } from './seed.mjs';

export function gabungNotifikasi(auto, seed, stateLama, nowMs) {
  const lama = stateLama?.items ?? {};
  const semua = new Map();
  for (const x of [...seed, ...auto]) semua.set(x.id, x);
  const hasil = [], stateBaru = {};
  for (const x of semua.values()) {
    const s = lama[x.id];
    const naik = !!s && peringkat(x.tingkat) < peringkat(s.tingkat);
    const status = s?.status ?? x.status ?? 'BARU';
    const item = { ...x, status, pertamaTerdeteksi: s?.pertamaTerdeteksi ?? nowMs, baru: !s, naikTingkat: naik };
    hasil.push(item);
    stateBaru[x.id] = { pertamaTerdeteksi: item.pertamaTerdeteksi, status, tingkat: x.tingkat };
  }
  for (const [id, s] of Object.entries(lama)) if (!stateBaru[id]) stateBaru[id] = s; // kondisi yang sudah tak terpicu tetap dikenang
  hasil.sort((a, b) => peringkat(a.tingkat) - peringkat(b.tingkat) || a.id.localeCompare(b.id));
  return { items: hasil, state: { versi: 1, items: stateBaru } };
}
