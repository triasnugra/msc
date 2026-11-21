// R bersih seragam. Aturan (6.B): R_bersih = R_mesin - (costPct / stopPct) KECUALI R mesin sudah net biaya.
// costPct dan stopPct dalam persen harga. Mengembalikan null bila tidak dapat dihitung (tidak menebak).
export function rBersih(rMesin, stopPct, costPct, sudahNet) {
  if (rMesin === null || rMesin === undefined || !Number.isFinite(rMesin)) return null;
  if (sudahNet) return rMesin;
  if (!Number.isFinite(stopPct) || stopPct <= 0 || !Number.isFinite(costPct)) return null;
  return rMesin - costPct / stopPct;
}
