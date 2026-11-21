// Sesi, akhir pekan, libur, penutupan periode, Monday range (DOC-10, DOC-20). Semua waktu UTC.
const H = 3600000, D = 86400000;

export function sesiUtc(ts, cfg) {
  const j = new Date(ts).getUTCHours();
  for (const [nama, [a, b]] of Object.entries(cfg)) if (j >= a && j < b) return nama.toUpperCase();
  return null;
}
export const akhirPekan = (ts) => { const d = new Date(ts).getUTCDay(); return d === 6 || d === 0; };
export const tanggalUtc = (ts) => new Date(ts).toISOString().slice(0, 10);
export function jendelaVolumeRendah(ts, libur = []) {
  const l = libur.find((x) => x.tanggalUtc === tanggalUtc(ts));
  if (l) return { aktif: true, alasan: `libur ${l.nama}` };
  if (akhirPekan(ts)) return { aktif: true, alasan: 'akhir pekan UTC' };
  return { aktif: false, alasan: null };
}
export const awalMingguUtc = (ts) => { const d = new Date(ts); const k = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - k); };

// Penutupan mingguan = Senin 00:00 UTC berikutnya (Minggu 24:00); bulanan = tanggal 1 bulan berikutnya 00:00 UTC.
export function penutupanPeriode(ts, jam = 12) {
  const out = [], batas = jam * H;
  const mingguan = awalMingguUtc(ts) + 7 * D;
  if (mingguan - ts > 0 && mingguan - ts <= batas) out.push({ jenis: 'MINGGUAN', sisaJam: (mingguan - ts) / H });
  const d = new Date(ts), bulanan = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (bulanan - ts > 0 && bulanan - ts <= batas) out.push({ jenis: 'BULANAN', sisaJam: (bulanan - ts) / H });
  return out;
}

// Monday high/low minggu berjalan dari candle 1H yang dibuka pada hari Senin UTC.
export function mondayRange(c1h, nowMs) {
  const s = awalMingguUtc(nowMs), e = s + D;
  const m = c1h.filter((x) => x.t >= s && x.t < e);
  if (!m.length) return null;
  return { high: Math.max(...m.map((x) => x.h)), low: Math.min(...m.map((x) => x.l)), candle: m.length, lengkap: m.length >= 24 };
}
