// Jadwal rilis CPI dari halaman jadwal BLS. BEST-EFFORT dan TIDAK TERVERIFIKASI terhadap halaman asli:
// mencari pasangan "tanggal rilis (Nov 13, 2026)" + "jam (08:30 AM)". Bila tidak ketemu, hasil kosong -> fallback events.json.
export const BLS_URL = 'https://www.bls.gov/schedule/news_release/cpi.htm';
const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseBlsCpiHtml(html) {
  const out = [], seen = new Set();
  const teks = String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const re = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(20\d{2})\s+(\d{1,2}):(\d{2})\s*([AP])\.?M/gi;
  for (const m of teks.matchAll(re)) {
    const bln = BULAN[m[1].slice(0, 3).toLowerCase()];
    let h = +m[4]; const ap = m[6].toUpperCase();
    if (ap === 'P' && h < 12) h += 12; if (ap === 'A' && h === 12) h = 0;
    const tgl = `${m[3]}-${String(bln).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
    if (seen.has(tgl)) continue; seen.add(tgl);
    out.push({ jenis: 'CPI', nama: 'US CPI', tanggalNY: tgl, jamNY: `${String(h).padStart(2, '0')}:${m[5]}`, sumberUrl: BLS_URL });
  }
  return out.length <= 40 ? out : [];
}

export async function ambilCpi(fetchFn, timeoutMs = 15000) {
  try {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetchFn(BLS_URL, { signal: ac.signal, headers: { 'user-agent': 'msc-monitor/2.0' } });
    clearTimeout(to);
    if (!r.ok) return { ok: false, daftar: [], error: `http_${r.status}` };
    const daftar = parseBlsCpiHtml(await r.text());
    return daftar.length ? { ok: true, daftar, error: null } : { ok: false, daftar: [], error: 'format_halaman_tidak_dikenali' };
  } catch (e) { return { ok: false, daftar: [], error: String(e.message).slice(0, 80) }; }
}
