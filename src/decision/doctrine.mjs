// Flag doktrin (DOC-xx). Murni: semua data pasar disuntik lewat ctx. Semua ambang dari thresholds.json (HIPOTESIS).
import { rentang, posisiPct, atrTerakhir, ema, fibKonfluensi, fvgAktif, fvgDekat, threeTap, obvSinyal, rasioVolume } from '../market/indikator.mjs';
import { rrSisaTp1 } from '../core/levels.mjs';
import { jendelaVolumeRendah, penutupanPeriode } from '../market/sessions.mjs';
import { eventDalam } from '../events/jadwal.mjs';

export const DOC = {
  MID_RANGE: 'DOC-01', TANPA_KONFIRMASI: 'DOC-02', TIDAK_TERPETAKAN: 'DOC-02', STOP_LEBAR: 'DOC-04', STOP_SANGAT_LEBAR: 'DOC-04',
  RR_TP1_RENDAH: 'DOC-05', LAWAN_TREN: 'DOC-06', RISIKO_SQUEEZE_SHORT: 'DOC-06', LAWAN_TREN_HTF: 'DOC-23', BTC_TENGAH_RANGE: 'DOC-07',
  LIKUIDITAS_RENDAH: 'DOC-08', LIKUIDITAS_EKSTREM_RENDAH: 'DOC-08', NON_MAJOR_ASING: 'DOC-08', LIKUIDITAS_TIDAK_DIKETAHUI: 'DOC-08',
  JENDELA_VOLUME_RENDAH: 'DOC-10', EVENT_DEKAT: 'DOC-10', EVENT_SANGAT_DEKAT: 'DOC-10', OVERTRADING: 'DOC-11', KLASTER_SATU_ARAH: 'DOC-11',
  COOLDOWN_PASCA_SHOCK: 'DOC-12', LEVERAGE_TINGGI: 'DOC-14', KONFLUENSI_FIB: 'DOC-15', VOLUME_KONFIRMASI: 'DOC-19', VOLUME_LEMAH: 'DOC-19',
  PENUTUPAN_PERIODE: 'DOC-20', OBV_DIVERGENSI_BULL: 'DOC-21', OBV_DIVERGENSI_BEAR: 'DOC-21', OBV_V: 'DOC-21', OBV_TIDAK_ANDAL: 'DOC-21',
  FVG_DEKAT: 'DOC-22', THREE_TAP: 'DOC-22'
};

export function jenisFlag(nama, th) {
  const k = th.keputusan;
  return k.flagKeras.includes(nama) ? 'KERAS' : k.flagLunak.includes(nama) ? 'LUNAK' : 'ANOTASI';
}

export function hitungFlag(row, ctx) {
  const th = ctx.th, flags = [], hilang = [];
  const add = (flag, detail) => flags.push({ flag, doc: DOC[flag], jenis: jenisFlag(flag, th), detail });
  const d = th.doktrin;
  const harga = Number.isFinite(ctx.harga) ? ctx.harga : null;
  const ref = ctx.refTs;

  // DOC-02
  if (row.tipeTrigger === 'TANPA_KONFIRMASI') add('TANPA_KONFIRMASI', `${row.triggerAsli}: tanpa konfirmasi close yang terbukti dari kode`);
  if (row.tipeTrigger === 'TIDAK_TERPETAKAN') add('TIDAK_TERPETAKAN', `${row.triggerAsli ?? '?'} belum terpetakan ke tipe baku`);

  // DOC-04
  if (Number.isFinite(row.stopPct)) {
    if (row.stopPct > d['DOC-04'].stopSangatLebarPct) add('STOP_SANGAT_LEBAR', `stop ${row.stopPct.toFixed(2)}% > ${d['DOC-04'].stopSangatLebarPct}%`);
    else if (row.stopPct > d['DOC-04'].stopLebarPct) add('STOP_LEBAR', `stop ${row.stopPct.toFixed(2)}% > ${d['DOC-04'].stopLebarPct}%`);
  }
  // DOC-05
  const rr = rrSisaTp1({ arah: row.arah, entry: row.entry, sl: row.sl, tp1: row.tp1, harga });
  if (rr !== null && rr < d['DOC-05'].rrTp1RendahDi) add('RR_TP1_RENDAH', `R:R sisa ke TP1 ${rr.toFixed(2)} < ${d['DOC-05'].rrTp1RendahDi}`);
  // DOC-14
  if (Number.isFinite(row.leverageSaran) && row.leverageSaran > d['DOC-14'].levTinggiDi) add('LEVERAGE_TINGGI', `leverage disarankan ${row.leverageSaran}x > ${d['DOC-14'].levTinggiDi}x`);

  // DOC-01: range 48 candle 1H sudah close pada koin sinyal
  const c1h = ctx.c1h;
  if (Array.isArray(c1h) && c1h.length >= d['DOC-01'].rangeCandles1h) {
    const rg = rentang(c1h, d['DOC-01'].rangeCandles1h), pos = posisiPct(row.entry, rg.low, rg.high);
    if (pos !== null && pos >= d['DOC-01'].zonaTengahPct[0] && pos <= d['DOC-01'].zonaTengahPct[1]) add('MID_RANGE', `posisi ${pos.toFixed(0)}% dari range ${rg.n} candle 1H`);
  } else hilang.push('MID_RANGE(candle 1H koin)');

  // DOC-06 / DOC-23
  const tren4 = ctx.btc?.tren?.['4H']?.label, tren1d = ctx.btc?.tren?.['1D']?.label;
  const lawan = (lbl) => (row.arah === 'LONG' && lbl === 'BEAR') || (row.arah === 'SHORT' && lbl === 'BULL');
  if (tren4) {
    const dikecualikan = row.tipeTrigger === 'DEVIATION_RECLAIM' && row.triggerStatus === 'kode_dibaca';
    if (lawan(tren4) && !dikecualikan) add('LAWAN_TREN', `${row.arah} melawan BTC 4H ${tren4}${row.tipeTrigger === 'DEVIATION_RECLAIM' ? ' (reclaim belum terbukti terkonfirmasi dari kode)' : ''}`);
    if (tren1d && lawan(tren4) && lawan(tren1d)) add('LAWAN_TREN_HTF', `${row.arah} melawan BTC 1D ${tren1d} dan 4H ${tren4}`);
  } else hilang.push('LAWAN_TREN(konteks BTC)');
  if (row.arah === 'SHORT' && Array.isArray(ctx.c1d) && ctx.c1d.length >= 30) {
    const low30 = Math.min(...ctx.c1d.slice(-d['DOC-06'].low30hHari).map((x) => x.l)), a1d = atrTerakhir(ctx.c1d, d['DOC-06'].atrPeriode), h = harga ?? row.entry;
    if (Number.isFinite(a1d) && h <= low30 + d['DOC-06'].squeezeAtrMultDariLow30h * a1d) add('RISIKO_SQUEEZE_SHORT', `harga ${h} dalam ${d['DOC-06'].squeezeAtrMultDariLow30h} x ATR(1D) dari low 30 hari ${low30}`);
  }
  if (ctx.btc?.btcTengahRange) add('BTC_TENGAH_RANGE', `BTC 1H di ${ctx.btc.posisiRangePct.toFixed(0)}% range`);

  // DOC-08
  if (ctx.tickerTersedia) {
    const t = ctx.ticker;
    if (!t) add('LIKUIDITAS_TIDAK_DIKETAHUI', `${row.koin}${'USDT'} tidak ada di ticker bursa publik`);
    else if (t.qv < d['DOC-08'].likuiditasEkstremRendahUsdt) add('LIKUIDITAS_EKSTREM_RENDAH', `volume 24j ${(t.qv / 1e6).toFixed(1)} jt USDT < ${d['DOC-08'].likuiditasEkstremRendahUsdt / 1e6} jt`);
    else if (t.qv < d['DOC-08'].likuiditasRendahUsdt) add('LIKUIDITAS_RENDAH', `volume 24j ${(t.qv / 1e6).toFixed(1)} jt USDT < ${d['DOC-08'].likuiditasRendahUsdt / 1e6} jt`);
    if (Array.isArray(ctx.major) && !ctx.major.includes(row.koin)) add('NON_MAJOR_ASING', `${row.koin} di luar top-${d['DOC-08'].topNMajor} volume`);
  } else hilang.push('LIKUIDITAS(ticker 24j)');

  // DOC-10 / DOC-20 / DOC-12 (berbasis waktu acuan)
  const vol = jendelaVolumeRendah(ref, ctx.libur ?? []);
  if (vol.aktif) add('JENDELA_VOLUME_RENDAH', vol.alasan);
  const sangat = eventDalam(ctx.events ?? [], ref, d['DOC-10'].eventSangatDekatMenit / 60), dekat = eventDalam(ctx.events ?? [], ref, d['DOC-10'].eventDekatJam);
  if (sangat.length) add('EVENT_SANGAT_DEKAT', `${sangat[0].nama} dalam <= ${d['DOC-10'].eventSangatDekatMenit} menit`);
  else if (dekat.length) add('EVENT_DEKAT', `${dekat[0].nama} ${Math.round((dekat[0].ts - ref) / 3600000)}j`);
  for (const p of penutupanPeriode(ref, d['DOC-20'].penutupanPeriodeJam)) add('PENUTUPAN_PERIODE', `close ${p.jenis.toLowerCase()} ${p.sisaJam.toFixed(1)}j lagi`);
  if (ctx.btc?.shock?.aktif) add('COOLDOWN_PASCA_SHOCK', `${ctx.btc.shock.alasan}${['sc', 'scv2'].includes(row.mesin) ? '; limit rawan tersapu saat flash' : ''}`);

  // Lapis 2 (anotasi): hanya bila candle koin tersedia
  if (Array.isArray(c1h) && c1h.length >= 60) {
    const a1h = atrTerakhir(c1h, d['DOC-06'].atrPeriode);
    const fib = fibKonfluensi(c1h, row.entry, a1h, { ...d['DOC-15'], jendela: d['DOC-15'].jendelaImpulsCandle1h });
    if (fib) add('KONFLUENSI_FIB', `entry dekat fib ${fib.rasio} impuls ${fib.impuls}`);
    const likuid = ctx.ticker ? ctx.ticker.qv >= d['DOC-08'].likuiditasRendahUsdt : false;
    if (likuid) {
      const rv = rasioVolume(c1h, d['DOC-19'].volumeRataCandle);
      if (rv !== null) add(rv >= d['DOC-19'].volumeKonfirmasiRasio ? 'VOLUME_KONFIRMASI' : 'VOLUME_LEMAH', `rasio volume ${rv.toFixed(2)}`);
      for (const [tf, cc] of [['1H', c1h], ['4H', ctx.c4h]]) {
        if (!Array.isArray(cc) || cc.length < d['DOC-21'].jendelaDivergensi + 1) continue;
        const o = obvSinyal(cc, { jendela: d['DOC-21'].jendelaDivergensi, troughTerakhir: d['DOC-21'].obvVTroughTerakhirCandle, pulih: d['DOC-21'].obvVPulihFraksi });
        if (o.bull) add('OBV_DIVERGENSI_BULL', `harga LL, OBV HL (${tf})`);
        if (o.bear) add('OBV_DIVERGENSI_BEAR', `harga HH, OBV LH (${tf})`);
        if (o.v) add('OBV_V', `OBV berbalik dari dasar (${tf})`);
      }
    } else add('OBV_TIDAK_ANDAL', 'koin di bawah ambang likuiditas atau likuiditas tidak diketahui');
    const taps = threeTap(c1h, a1h, { toleransiAtr: d['DOC-22'].threeTapToleransiAtr, maksCandle: d['DOC-22'].threeTapMaksCandle1h }) ?? [];
    for (const t of taps) {
      const cocok = (t.sisi === 'ATAS' && row.arah === 'SHORT') || (t.sisi === 'BAWAH' && row.arah === 'LONG');
      if (cocok && Math.abs(row.entry - t.level) <= d['DOC-22'].threeTapEntryDekatAtr * a1h) add('THREE_TAP', `${t.taps} sapuan sisi ${t.sisi.toLowerCase()} di ${t.level}`);
    }
    for (const [tf, cc] of [['1H', c1h], ['4H', ctx.c4h]]) {
      if (!Array.isArray(cc) || cc.length < 10) continue;
      const z = fvgAktif(cc);
      const hit = fvgDekat(z, row.arah, row.entry, a1h, d['DOC-22'].fvgDekatAtr) ?? (Number.isFinite(row.tp1) ? fvgDekat(z, row.arah, row.tp1, a1h, d['DOC-22'].fvgDekatAtr) : null);
      if (hit) { add('FVG_DEKAT', `FVG ${hit.arah} ${tf} ${hit.low}-${hit.high}`); break; }
    }
  } else hilang.push('anotasi lapis 2 (candle 1H koin)');

  return { flags, hilang };
}

// DOC-11: overtrading dan klaster satu arah. Jendela berakhir pada waktu sinyal itu sendiri (konsisten dengan "saat pertama terlihat").
export function flagOvertrading(rows, th) {
  const d = th.doktrin['DOC-11'], W = d.klasterJendelaMenit * 60000;
  const out = new Map();
  const ok = rows.filter((r) => Number.isFinite(r.waktuUtc)).sort((a, b) => a.waktuUtc - b.waktuUtc);
  for (const r of ok) {
    const jendela = ok.filter((x) => x.waktuUtc <= r.waktuUtc && r.waktuUtc - x.waktuUtc < W);
    const perMesin = jendela.filter((x) => x.mesin === r.mesin).length, gabungan = jendela.length;
    const searah = jendela.filter((x) => x.arah === r.arah).length;
    const f = [];
    if (perMesin > d.maksPerJamPerMesin) f.push({ flag: 'OVERTRADING', doc: 'DOC-11', jenis: jenisFlag('OVERTRADING', th), detail: `${perMesin} sinyal/jam di ${r.mesin} (> ${d.maksPerJamPerMesin})` });
    else if (gabungan > d.maksPerJamGabungan) f.push({ flag: 'OVERTRADING', doc: 'DOC-11', jenis: jenisFlag('OVERTRADING', th), detail: `${gabungan} sinyal/jam gabungan (> ${d.maksPerJamGabungan})` });
    if (searah >= d.klasterSamaArahMin) f.push({ flag: 'KLASTER_SATU_ARAH', doc: 'DOC-11', jenis: 'ANOTASI', detail: `${searah} sinyal ${r.arah} dalam ${d.klasterJendelaMenit} menit` });
    if (f.length) out.set(`${r.mesin}|${r.id}`, f);
  }
  return out;
}
