// Jadwal FOMC resmi dari halaman kalender Federal Reserve. BEST-EFFORT: pengurai heuristik terhadap kelas HTML
// "fomc-meeting__month" dan "fomc-meeting__date". STATUS: TIDAK TERVERIFIKASI terhadap halaman asli (tidak dapat diakses saat
// pengembangan). Bila bentuk halaman berbeda, hasilnya KOSONG dan monitor jatuh ke data/events.json (tidak mengarang tanggal).
export const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const m3 = (s) => BULAN[s.trim().slice(0, 3).toLowerCase()];

export function parseFomcHtml(html) {
  const out = [];
  const tahunRe = /(20\d{2})\s+FOMC\s+Meetings/gi;
  const marks = [...String(html ?? '').matchAll(tahunRe)].map((m) => ({ y: +m[1], i: m.index }));
  if (!marks.length) return out;
  marks.forEach((mk, idx) => {
    const seg = html.slice(mk.i, idx + 1 < marks.length ? marks[idx + 1].i : undefined);
    const re = /fomc-meeting__month[^>]*>\s*(?:<[^>]+>\s*)*([A-Za-z]{3,9}(?:\/[A-Za-z]{3,9})?)[\s\S]*?fomc-meeting__date[^>]*>\s*([0-9]{1,2})(?:\s*[-–]\s*([0-9]{1,2}))?/g;
    for (const m of seg.matchAll(re)) {
      const bulan = m[1].split('/'), a = +m[2], b = m[3] ? +m[3] : null;
      let bln = m3(bulan[bulan.length - 1]);
      if (!bln) continue;
      const hari = b ?? a; // hari keputusan = hari terakhir pertemuan
      if (!(hari >= 1 && hari <= 31)) continue;
      const tgl = `${mk.y}-${String(bln).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
      out.push({ jenis: 'FOMC', nama: 'FOMC Rate Decision', tanggalNY: tgl, jamNY: '14:00', sumberUrl: FOMC_URL });
    }
  });
  return out.length <= 40 ? out : [];
}

export async function ambilFomc(fetchFn, timeoutMs = 15000) {
  try {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetchFn(FOMC_URL, { signal: ac.signal, headers: { 'user-agent': 'msc-monitor/2.0' } });
    clearTimeout(to);
    if (!r.ok) return { ok: false, daftar: [], error: `http_${r.status}` };
    const daftar = parseFomcHtml(await r.text());
    return daftar.length ? { ok: true, daftar, error: null } : { ok: false, daftar: [], error: 'format_halaman_tidak_dikenali' };
  } catch (e) { return { ok: false, daftar: [], error: String(e.message).slice(0, 80) }; }
}
