// Memuat dan memvalidasi daftar awal (seed) data/upgrade-backlog.json.
const TINGKAT = ['KRITIS', 'TINGGI', 'SEDANG', 'INFO'];
export const peringkat = (t) => TINGKAT.indexOf(t);

export function muatSeed(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const ids = new Set(), valid = [], galat = [];
  for (const x of items) {
    const wajib = ['id', 'mesin', 'tingkat', 'judul', 'bukti', 'dampak', 'tindakan'];
    const kurang = wajib.filter((k) => !x?.[k]);
    if (kurang.length) { galat.push(`${x?.id ?? '?'}: field kosong ${kurang.join(',')}`); continue; }
    if (!TINGKAT.includes(x.tingkat)) { galat.push(`${x.id}: tingkat tidak valid`); continue; }
    if (ids.has(x.id)) { galat.push(`${x.id}: ID kembar`); continue; }
    ids.add(x.id); valid.push({ ...x, doc: x.doc ?? [], status: x.status ?? 'BARU', sumber: 'seed' });
  }
  return { items: valid, galat };
}
