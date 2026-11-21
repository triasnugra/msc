// Jejak harga sejak sinyal (candle 15m close): apakah entry dan TP1 pernah tersentuh, dan mana yang lebih dulu.
// Candle ambigu (entry dan TP1 di candle yang sama) dianggap entry lebih dulu (konservatif: tidak memvonis TERLAMBAT).
export function hitungJejak(row, c15, nowMs) {
  if (!Array.isArray(c15) || !c15.length || !Number.isFinite(row.waktuUtc) || row.waktuUtc < c15[0].t) return null;
  const lo = Math.min(row.entryLow, row.entryHigh), hi = Math.max(row.entryLow, row.entryHigh);
  let iEntry = -1, iTp1 = -1;
  c15.forEach((c, i) => {
    if (c.t + 900000 <= row.waktuUtc) return;
    const e = row.arah === 'LONG' ? c.l <= hi : c.h >= lo;
    const t = Number.isFinite(row.tp1) && (row.arah === 'LONG' ? c.h >= row.tp1 : c.l <= row.tp1);
    if (e && iEntry < 0) iEntry = i;
    if (t && iTp1 < 0) iTp1 = i;
  });
  return { entryTersentuh: iEntry >= 0 && (iTp1 < 0 || iEntry <= iTp1), tp1Tersentuh: iTp1 >= 0 };
}
