// Konteks pasar BTC (6.G). Semua HIPOTESIS. Candle yang dipakai hanya yang sudah close.
import { hanyaClose } from './prices.mjs';
import { labelTren, rentang, posisiPct, atr, median } from './indikator.mjs';
import { sesiUtc, jendelaVolumeRendah, mondayRange, penutupanPeriode } from './sessions.mjs';
import { eventDalam } from '../events/jadwal.mjs';

const H = 3600000;

export function deteksiShock(c1h, c1d, nowMs, th) {
  const d12 = th.doktrin['DOC-12'];
  let ts = null, alasan = null;
  for (const x of c1d.slice(-3)) {
    const chg = Math.abs(x.c / x.o - 1) * 100;
    if (chg > d12.geserHarianBtcPct) { const t = Math.min(x.t + 86400000, nowMs); if (ts === null || t > ts) { ts = t; alasan = `candle 1D BTC bergerak ${chg.toFixed(1)}% (> ${d12.geserHarianBtcPct}%)`; } }
  }
  const a = atr(c1h, th.doktrin['DOC-06'].atrPeriode);
  const win = d12.medianHari * 24;
  for (let i = c1h.length - 1; i >= Math.max(win + 15, c1h.length - 48); i--) {
    const med = median(a.slice(i - win, i).filter(Number.isFinite));
    if (a[i] != null && med && a[i] > d12.atrJamMultMedian * med) { const t = c1h[i].t + H; if (ts === null || t > ts) { ts = t; alasan = `ATR(1H) BTC ${(a[i] / med).toFixed(1)}x median ${d12.medianHari} hari`; } break; }
  }
  const aktif = ts !== null && nowMs - ts <= d12.cooldownJam * H && nowMs >= ts - 1;
  return { aktif, sejak: ts, sampai: ts !== null ? ts + d12.cooldownJam * H : null, alasan };
}

export function hitungKonteks({ c1h, c4h, c1d, c1w, harga, nowMs, th, events = [], libur = [] }) {
  const need = [c1h, c4h, c1d].some((x) => !Array.isArray(x) || x.length < 60);
  if (need) return { tersedia: false, alasan: 'Konteks pasar tidak tersedia (candle BTC tidak cukup atau semua sumber harga gagal)' };
  const k1h = hanyaClose(c1h, '1h', nowMs), k4h = hanyaClose(c4h, '4h', nowMs), k1d = hanyaClose(c1d, '1d', nowMs), k1w = c1w ? hanyaClose(c1w, '1w', nowMs) : [];
  const tren = { '1H': labelTren(k1h), '4H': labelTren(k4h), '1D': labelTren(k1d), '1W': k1w.length >= 50 ? labelTren(k1w) : { label: null, alasan: 'candle 1W kurang dari 50' } };
  const d01 = th.doktrin['DOC-01'], d07 = th.doktrin['DOC-07'], d10 = th.doktrin['DOC-10'];
  const rg = rentang(k1h, d01.rangeCandles1h);
  const last = harga ?? k1h[k1h.length - 1].c;
  const pos = rg ? posisiPct(last, rg.low, rg.high) : null;
  const btcTengah = pos !== null && pos >= d07.btcTengahRangePct[0] && pos <= d07.btcTengahRangePct[1];
  const a1h = atr(k1h, th.doktrin['DOC-06'].atrPeriode), atrPct = a1h[a1h.length - 1] ? a1h[a1h.length - 1] / k1h[k1h.length - 1].c * 100 : null;
  const ref24 = k1h.length > 24 ? k1h[k1h.length - 25].c : null;
  const shock = deteksiShock(k1h, [...k1d, ...c1d.filter((x) => x.t + 86400000 > nowMs)], nowMs, th);
  const vol = jendelaVolumeRendah(nowMs, libur);
  const evDekat = eventDalam(events, nowMs, d10.eventDekatJam), evSangat = eventDalam(events, nowMs, d10.eventSangatDekatMenit / 60);
  const periode = penutupanPeriode(nowMs, th.doktrin['DOC-20'].penutupanPeriodeJam);

  let status, alasan;
  if (shock.aktif || evSangat.length) { status = 'DEFENSIF-FLAT'; alasan = shock.aktif ? `cooldown pasca shock (${shock.alasan})` : `event ${evSangat[0].nama} dalam <= ${d10.eventSangatDekatMenit} menit`; }
  else if (btcTengah || vol.aktif || evDekat.length) { status = 'SELEKTIF'; alasan = btcTengah ? `BTC di tengah range 1H (${pos.toFixed(0)}%)` : vol.aktif ? `jendela volume rendah (${vol.alasan})` : `event ${evDekat[0].nama} dalam ${d10.eventDekatJam} jam`; }
  else { status = 'AGRESIF-TERBATAS'; alasan = 'tidak ada pemicu defensif; tetap terbatas (maks 1-2 setup per jam)'; }

  return {
    tersedia: true, harga: last, tren, posisiRangePct: pos, range: rg, btcTengahRange: btcTengah, atr1hPct: atrPct,
    perubahan24jPct: ref24 ? (last / ref24 - 1) * 100 : null, shock, monday: mondayRange(c1h, nowMs),
    sesi: sesiUtc(nowMs, d10.sesiUtc), jendelaVolumeRendah: vol, eventDekat: evDekat.map((e) => e.nama), eventSangatDekat: evSangat.map((e) => e.nama),
    penutupanPeriode: periode, status, alasanStatus: alasan, label: 'HIPOTESIS'
  };
}
