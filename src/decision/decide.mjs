// Keputusan monitor (6.C). Urutan evaluasi, berhenti di yang pertama cocok:
//  1 BATAL  2 TERLAMBAT  3 HINDARI (flag keras)  4 TUNGGU (flag lunak / jarak > 1R)  5 LAYAK ENTRY.
// Celah aturan 4-5 (jarak 0,3-1R atau usia >= 50% tanpa flag) diputuskan TUNGGU dengan catatan.
import { jarakKeEntry } from '../core/levels.mjs';

export const KEPUTUSAN = ['LAYAK ENTRY', 'TUNGGU', 'TERLAMBAT', 'BATAL', 'HINDARI'];

// Hanya sinyal yang belum terbukti terisi: PENDING, atau OPEN dengan terisi=null (fill tidak diketahui).
export const perluKeputusan = (r) => r.status === 'PENDING' || (r.status === 'OPEN' && r.terisi === null);

const ringkasFlag = (f) => `${f.flag} ${f.detail ? f.detail + ' ' : ''}[${f.doc}]`.replace(/\s+/g, ' ');

// jejak (opsional) dari candle sejak sinyal: {tp1Tersentuh:boolean, entryTersentuh:boolean}
export function putuskan(row, { harga, nowMs, flags, mesinCfg, th, jejak = null, hargaTersedia = harga != null }) {
  const usiaMenit = (nowMs - row.waktuUtc) / 60000;
  const batas = mesinCfg.batalSetelahMenit;
  const j = hargaTersedia && Number.isFinite(harga) ? jarakKeEntry({ arah: row.arah, entry: row.entry, entryLow: row.entryLow, entryHigh: row.entryHigh, sl: row.sl, harga }) : null;
  const dasar = { usiaMenit, jarakR: j?.jarakR ?? null, jarakPct: j?.jarakPct ?? null, sisi: j?.sisi ?? null };
  const ret = (keputusan, alasan, extra = {}) => ({ keputusan, catatan: `${keputusan}: ${alasan.join('; ')}`, alasan, ...dasar, ...extra });

  // 1. BATAL
  if (hargaTersedia && Number.isFinite(harga)) {
    const lewatSl = row.arah === 'LONG' ? harga <= row.sl : harga >= row.sl;
    if (lewatSl) return ret('BATAL', [`harga ${harga} sudah melewati SL ${row.sl}`]);
  }
  if (Number.isFinite(batas) && usiaMenit > batas) return ret('BATAL', [`usia ${Math.round(usiaMenit)} menit melebihi masa order ${batas} menit`]);

  // 2. TERLAMBAT [DOC-03]
  const lewatTp1 = hargaTersedia && Number.isFinite(harga) && Number.isFinite(row.tp1) && (row.arah === 'LONG' ? harga >= row.tp1 : harga <= row.tp1);
  if (jejak?.tp1Tersentuh && !jejak?.entryTersentuh) return ret('TERLAMBAT', ['TP1 sudah tersentuh sebelum entry [DOC-03]']);
  if (!jejak && lewatTp1) return ret('TERLAMBAT', [`harga ${harga} sudah di TP1 ${row.tp1} tanpa catatan fill [DOC-03]`]);
  if (j && j.sisi === 'BELUM_TERSENTUH' && j.jarakR > th.keputusan.terlambatR) return ret('TERLAMBAT', [`harga bergerak ${j.jarakR.toFixed(2)}R searah profit tanpa menyentuh entry (> ${th.keputusan.terlambatR}R) [DOC-03]`]);

  const keras = flags.filter((f) => f.jenis === 'KERAS'), lunak = flags.filter((f) => f.jenis === 'LUNAK');
  // 3. HINDARI
  if (keras.length) return ret('HINDARI', keras.map(ringkasFlag));

  // Tanpa harga: maksimal TUNGGU (6.G)
  if (!j) {
    const a = lunak.map(ringkasFlag); a.push('data harga tidak ada, tidak bisa memberi LAYAK ENTRY');
    return ret('TUNGGU', a);
  }
  // 4. TUNGGU
  const alasan = lunak.map(ringkasFlag);
  if (j.jarakR > th.keputusan.tungguJarakR) alasan.push(`jarak ke entry ${j.jarakR.toFixed(2)}R > ${th.keputusan.tungguJarakR}R`);
  if (alasan.length) return ret('TUNGGU', alasan);

  // 5. LAYAK ENTRY
  const usiaFraksi = Number.isFinite(batas) && batas > 0 ? usiaMenit / batas : 0;
  const bukanLayak = [];
  if (j.jarakR > th.keputusan.layakJarakMaksR) bukanLayak.push(`jarak ke entry ${j.jarakR.toFixed(2)}R di atas ${th.keputusan.layakJarakMaksR}R`);
  if (usiaFraksi >= th.keputusan.layakUsiaMaksFraksi) bukanLayak.push(`usia ${(usiaFraksi * 100).toFixed(0)}% dari masa order (>= ${th.keputusan.layakUsiaMaksFraksi * 100}%)`);
  if (bukanLayak.length) return ret('TUNGGU', bukanLayak);
  return ret('LAYAK ENTRY', [`tanpa flag keras/lunak, jarak ${j.jarakR.toFixed(2)}R, usia ${(usiaFraksi * 100).toFixed(0)}% masa order`]);
}

// Catat keputusan HANYA saat pertama terlihat. Tidak pernah menulis ulang yang lama, tidak ada backfill.
export function catatBaru(rekamLama, hasilBaru, { definisiHash, nowMs }) {
  const ada = new Set(rekamLama.map((r) => `${r.mesin}|${r.id}`));
  const baru = [];
  for (const h of hasilBaru) {
    const k = `${h.mesin}|${h.id}`;
    if (ada.has(k)) continue;
    ada.add(k);
    baru.push({ mesin: h.mesin, id: h.id, tPertama: nowMs, definisiHash, keputusan: h.keputusan, catatan: h.catatan, flags: h.flags.map((f) => f.flag), flagDetail: h.flags, jarakR: h.jarakR, usiaMenit: h.usiaMenit, pasarTersedia: h.pasarTersedia });
  }
  return baru;
}
