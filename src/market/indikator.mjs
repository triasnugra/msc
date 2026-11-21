// Indikator dan pola dari candle. Candle: {t,o,h,l,c,v}. Urut naik menurut waktu. Semua fungsi murni.
export const median = (a) => { const x = a.filter(Number.isFinite).sort((p, q) => p - q); if (!x.length) return null; const m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };

export function sma(v, p) {
  const out = Array(v.length).fill(null); let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) out[i] = s / p; }
  return out;
}
// EMA berbenih SMA periode pertama.
export function ema(v, p) {
  const out = Array(v.length).fill(null);
  if (v.length < p) return out;
  const k = 2 / (p + 1);
  let e = v.slice(0, p).reduce((a, x) => a + x, 0) / p; out[p - 1] = e;
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
// ATR Wilder.
export function atr(c, p = 14) {
  const out = Array(c.length).fill(null);
  if (c.length <= p) return out;
  const tr = c.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c)));
  let a = tr.slice(1, p + 1).reduce((s, x) => s + x, 0) / p; out[p] = a;
  for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; out[i] = a; }
  return out;
}
export const atrTerakhir = (c, p = 14) => { const a = atr(c, p); return a[a.length - 1]; };
export function obv(c) {
  const out = [0];
  for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i].c > c[i - 1].c ? c[i].v : c[i].c < c[i - 1].c ? -c[i].v : 0));
  return out;
}

export function rentang(c, n) {
  const s = c.slice(-n);
  if (!s.length) return null;
  return { high: Math.max(...s.map((x) => x.h)), low: Math.min(...s.map((x) => x.l)), n: s.length };
}
export const posisiPct = (harga, low, high) => (high > low && Number.isFinite(harga)) ? (harga - low) / (high - low) * 100 : null;

// Pivot swing (N candle kiri-kanan).
export function swing(c, n = 3) {
  const H = [], L = [];
  for (let i = n; i < c.length - n; i++) {
    let ph = true, pl = true;
    for (let j = 1; j <= n; j++) { if (!(c[i].h > c[i - j].h && c[i].h > c[i + j].h)) ph = false; if (!(c[i].l < c[i - j].l && c[i].l < c[i + j].l)) pl = false; }
    if (ph) H.push({ i, p: c[i].h }); if (pl) L.push({ i, p: c[i].l });
  }
  return { H, L };
}
export function strukturSwing(c, n = 3) {
  const { H, L } = swing(c, n);
  if (H.length < 2 || L.length < 2) return 'TIDAK_CUKUP';
  const hh = H[H.length - 1].p > H[H.length - 2].p, hl = L[L.length - 1].p > L[L.length - 2].p;
  return hh && hl ? 'HH_HL' : (!hh && !hl) ? 'LH_LL' : 'CAMPUR';
}

// Label tren dari candle close: BULL bila EMA20>EMA50 dan harga>EMA20; BEAR kebalikan; selain itu RANGE.
export function labelTren(c, cepat = 20, lambat = 50) {
  if (c.length < lambat) return { label: null, alasan: `candle kurang (${c.length}<${lambat})` };
  const cl = c.map((x) => x.c), e1 = ema(cl, cepat), e2 = ema(cl, lambat);
  const a = e1[e1.length - 1], b = e2[e2.length - 1], h = cl[cl.length - 1];
  const label = (a > b && h > a) ? 'BULL' : (a < b && h < a) ? 'BEAR' : 'RANGE';
  return { label, emaCepat: a, emaLambat: b, harga: h, struktur: strukturSwing(c) };
}

export function rasioVolume(c, n = 20) {
  if (c.length < n + 1) return null;
  const last = c[c.length - 1], prev = c.slice(-n - 1, -1);
  const avg = prev.reduce((s, x) => s + x.v, 0) / n;
  return avg > 0 ? last.v / avg : null;
}

// DOC-15: konfluensi Fibonacci 0,75/0,786 pada impuls terakhir (jendela candle close).
export function fibKonfluensi(c, entry, atrVal, { fibLevel = [0.75, 0.786], atrMult = 0.3, jendela = 48 } = {}) {
  const s = c.slice(-jendela);
  if (s.length < 10 || !Number.isFinite(atrVal)) return null;
  let iH = 0, iL = 0;
  s.forEach((x, i) => { if (x.h >= s[iH].h) iH = i; if (x.l <= s[iL].l) iL = i; });
  const hi = s[iH].h, lo = s[iL].l, naik = iL < iH, rng = hi - lo;
  for (const r of fibLevel) {
    const level = naik ? hi - r * rng : lo + r * rng;
    if (Math.abs(entry - level) <= atrMult * atrVal) return { level, rasio: r, impuls: naik ? 'NAIK' : 'TURUN' };
  }
  return null;
}

// DOC-22: FVG tiga candle yang belum terisi penuh. Mengembalikan zona aktif.
export function fvgAktif(c, maks = 60) {
  const zones = [], start = Math.max(2, c.length - maks);
  for (let i = start; i < c.length; i++) {
    const a = c[i - 2], z = c[i];
    let zona = null;
    if (a.h < z.l) zona = { arah: 'BULL', low: a.h, high: z.l, i };
    else if (a.l > z.h) zona = { arah: 'BEAR', low: z.h, high: a.l, i };
    if (!zona) continue;
    const after = c.slice(i + 1);
    const terisi = zona.arah === 'BULL' ? after.some((x) => x.l <= zona.low) : after.some((x) => x.h >= zona.high);
    if (!terisi) zones.push(zona);
  }
  return zones;
}
export function fvgDekat(zones, arahSinyal, harga, atrVal, atrMult = 0.3) {
  if (![harga, atrVal].every(Number.isFinite)) return null;
  const want = arahSinyal === 'LONG' ? 'BULL' : 'BEAR', tol = atrMult * atrVal;
  return zones.find((z) => z.arah === want && harga >= z.low - tol && harga <= z.high + tol) ?? null;
}

// DOC-22: three-tap. Tap = candle yang high (atau low) berada dalam tol dari level ekstrem lalu close kembali di sisi dalam.
export function threeTap(c, atrVal, { toleransiAtr = 0.3, maksCandle = 48 } = {}) {
  const s = c.slice(-maksCandle);
  if (s.length < 6 || !Number.isFinite(atrVal)) return null;
  const tol = toleransiAtr * atrVal, hasil = [];
  const sisiAtas = Math.max(...s.map((x) => x.h)), sisiBawah = Math.min(...s.map((x) => x.l));
  const hitung = (level, atas) => {
    let taps = 0, prev = -2;
    s.forEach((x, i) => {
      const sentuh = atas ? (x.h >= level - tol && x.c < level - tol) : (x.l <= level + tol && x.c > level + tol);
      if (sentuh && i - prev > 1) taps++;
      if (sentuh) prev = i;
    });
    return taps;
  };
  const tAtas = hitung(sisiAtas, true), tBawah = hitung(sisiBawah, false);
  if (tAtas >= 3) hasil.push({ sisi: 'ATAS', level: sisiAtas, taps: tAtas });
  if (tBawah >= 3) hasil.push({ sisi: 'BAWAH', level: sisiBawah, taps: tBawah });
  return hasil;
}

// DOC-21: sinyal OBV (anotasi). Hanya dipanggil untuk koin likuid.
export function obvSinyal(c, { jendela = 30, troughTerakhir = 12, pulih = 0.5 } = {}) {
  if (c.length < jendela + 1) return { bull: false, bear: false, v: false };
  const w = c.slice(-jendela), o = obv(c).slice(-jendela), h = Math.floor(jendela / 2);
  const argmin = (arr, a, b) => { let k = a; for (let i = a; i < b; i++) if (arr[i] < arr[k]) k = i; return k; };
  const argmax = (arr, a, b) => { let k = a; for (let i = a; i < b; i++) if (arr[i] > arr[k]) k = i; return k; };
  const lows = w.map((x) => x.l), highs = w.map((x) => x.h);
  const l1 = argmin(lows, 0, h), l2 = argmin(lows, h, jendela), h1 = argmax(highs, 0, h), h2 = argmax(highs, h, jendela);
  const bull = lows[l2] < lows[l1] && o[l2] > o[l1];
  const bear = highs[h2] > highs[h1] && o[h2] < o[h1];
  const oMin = Math.min(...o), oMax = Math.max(...o), iMin = o.indexOf(oMin);
  const v = iMin >= jendela - troughTerakhir && iMin < jendela - 2 && oMax > oMin && (o[o.length - 1] - oMin) >= pulih * (oMax - oMin);
  return { bull, bear, v };
}
