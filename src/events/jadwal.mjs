// Jadwal event makro: gabungan resmi/manual, konversi zona waktu NY -> UTC -> WIB, dan kalimat dashboard (6.E).
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function wallNY(utcMs) {
  const p = Object.fromEntries(NY.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
// Jam dinding New York -> epoch UTC. Memakai Intl (DST benar). Iterasi dua kali untuk tepi perubahan.
export function nyKeUtc(tanggal, jam) {
  const [y, m, d] = tanggal.split('-').map(Number), [h, mi] = jam.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) guess += target - wallNY(guess);
  return guess;
}

export function formatWib(utcMs) {
  const d = new Date(utcMs + 7 * 3600000);
  const jam = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  return { hari: HARI[d.getUTCDay()], tanggal: `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`, jam };
}

// Normalisasi daftar mentah {jenis,nama,tanggalNY,jamNY} -> {jenis,nama,ts,sumber}
export function normalisasi(daftar, sumber) {
  const out = [];
  for (const e of daftar ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.tanggalNY ?? '') || !/^\d{2}:\d{2}$/.test(e?.jamNY ?? '')) continue;
    const ts = nyKeUtc(e.tanggalNY, e.jamNY);
    if (Number.isFinite(ts)) out.push({ jenis: e.jenis, nama: e.nama, ts, sumber, tanggalNY: e.tanggalNY });
  }
  return out;
}

// Resmi diutamakan; manual hanya dipakai bila tidak ada event resmi sejenis pada tanggal yang sama atau resmi kosong.
export function gabung(resmi, manual) {
  const out = [...resmi];
  for (const m of manual) if (!resmi.some((r) => r.jenis === m.jenis && Math.abs(r.ts - m.ts) < 86400000)) out.push(m);
  return out.sort((a, b) => a.ts - b.ts);
}

export function eventBerikut(events, nowMs) { return events.filter((e) => e.ts >= nowMs).sort((a, b) => a.ts - b.ts)[0] ?? null; }

export function eventDalam(events, nowMs, jam) { return events.filter((e) => e.ts >= nowMs && e.ts - nowMs <= jam * 3600000); }

// Kalimat dashboard. info = {sumber:'resmi'|'manual'|null, diperbarui:ms|null}
export function kalimatEvent(events, nowMs, info = {}) {
  const e = eventBerikut(events, nowMs);
  if (!e) return { teks: 'Jadwal event belum terverifikasi.', peringatan: false, event: null };
  const w = formatWib(e.ts);
  const jamLagi = (e.ts - nowMs) / 3600000;
  const sumber = e.sumber === 'resmi' ? 'sumber resmi' : 'diisi manual';
  const upd = info.diperbarui ? `, diperbarui ${formatWib(info.diperbarui).tanggal} ${formatWib(info.diperbarui).jam} WIB` : '';
  return { teks: `Event terdekat: ${w.hari}, ${w.tanggal} ${w.jam} WIB - ${e.nama} (${sumber}${upd}).`, peringatan: jamLagi <= 24, jamLagi, event: e };
}
