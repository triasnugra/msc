// Orkestrator monitor: muat sumber -> adapter -> arsip -> pasar -> flag -> keputusan -> audit -> notifikasi -> data.json.
// Tidak mengubah keenam mesin. Satu mesin gagal tidak merusak yang lain. Semua ambang dari config/.
import fs from 'node:fs';
import path from 'node:path';
import { definisiHash } from './core/hash.mjs';
import { jalankanAdapter, buatCtx } from './adapters/index.mjs';
import { adaptSctnBacktest } from './adapters/sctn.mjs';
import { parseJsonl, versiTerakhir, barisBaru, gabungTerkini } from './core/arsip.mjs';
import { ringkas, kelayakan, RUMUS } from './core/stats.mjs';
import { median, jarakKeEntry } from './core/levels.mjs';
import { muatMesin } from './data/sumber.mjs';
import { buatPasar, hanyaClose, topMajor } from './market/prices.mjs';
import { hitungKonteks } from './market/btcContext.mjs';
import { hitungJejak } from './market/jejak.mjs';
import { ambilFomc } from './events/fomc.mjs';
import { ambilCpi } from './events/bls.mjs';
import { normalisasi, gabung, kalimatEvent, formatWib } from './events/jadwal.mjs';
import { hitungFlag, flagOvertrading } from './decision/doctrine.mjs';
import { putuskan, catatBaru, perluKeputusan } from './decision/decide.mjs';
import { gabungKeputusan, auditKeputusan, profilKepatuhan, ujiBuktiFlag, panelKegagalan } from './decision/audit.mjs';
import { aturanOtomatis } from './notify/rules.mjs';
import { muatSeed } from './notify/seed.mjs';
import { gabungNotifikasi } from './notify/gabung.mjs';
import { jalankanPush } from './notify/push.mjs';
import { promptUpgrade } from './notify/prompt.mjs';
import { buatLaporan } from './report.mjs';

const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const T = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const tulis = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const tambah = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, s); };
const tipis = (r) => ({ id: r.id, koin: r.koin, arah: r.arah, entry: r.entry, entryLow: r.entryLow, entryHigh: r.entryHigh, entryTerbalik: r.entryTerbalik, sl: r.sl, tp1: r.tp1, tp2: r.tp2, waktuUtc: r.waktuUtc, selesaiTs: r.selesaiTs, status: r.status, terisi: r.terisi, hasilMesin: r.hasilMesin, R_mesin: r.R_mesin, R_bersih: r.R_bersih, R_sudah_net: r.R_sudah_net, kualitasData: r.kualitasData, tipeTrigger: r.tipeTrigger, triggerAsli: r.triggerAsli, stopPct: r.stopPct, tf: r.tf, mode: r.mode, sumber: r.sumber, versi: r.versi, hash: r.hash, rrMesin: r.rrMesin, leverageSaran: r.leverageSaran });

export async function jalankanMonitor({ root = process.cwd(), fetchFn = globalThis.fetch, env = process.env, nowMs = Date.now(), sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), tulisFile = true } = {}) {
  const P = (...x) => path.join(root, ...x);
  const config = J(P('config/config.json')), th = J(P('config/thresholds.json')), defs = J(P('config/definitions.json')), klaim = J(P('config/klaim.json'), {});
  const eventsManual = J(P('data/events.json'), { events: [], libur: [] });
  const seed = muatSeed(J(P('data/upgrade-backlog.json'), { items: [] }));
  const notes = J(P('data/context-notes.json'), null);
  const defHash = definisiHash(defs);
  const OPSI = { minSampel: th.statistik.minSampelBermakna, z: th.statistik.wilsonZ, ciMinN: th.statistik.ciMinN };
  const stDef = J(P('data/state/definisi.json'), null);
  const defHashLama = stDef?.hash ?? null;
  const banner = [];

  // ---- 1. sumber + adapter + arsip ----
  const hasilMesin = {}, perMesin = {};
  for (const m of config.mesin.filter((x) => x.aktif)) {
    const s = await muatMesin(m, config, { fetchFn, env, sleepFn });
    const arsipPath = P(config.arsip.dir, `${m.id}.jsonl`);
    const { baris: lama, rusak } = parseJsonl(T(arsipPath));
    const terakhir = versiTerakhir(lama);
    let ad = null;
    if (s.raw !== null) ad = jalankanAdapter(m.id, s.raw, config, defs, th, nowMs, { spotHashes: config.modeSpotHashes ?? [] });
    else ad = { ok: false, rows: [], anomali: [{ kode: 'SUMBER_GAGAL', tingkat: 'TINGGI', mesin: m.id, pesan: `Sumber data gagal: ${s.error}. Memakai arsip monitor (data bisa basi).`, ids: [] }], meta: {}, error: s.error };
    if (rusak) ad.anomali.push({ kode: 'ARSIP_RUSAK', tingkat: 'TINGGI', mesin: m.id, pesan: `${rusak} baris arsip tidak bisa dibaca`, ids: [] });
    const baru = barisBaru(terakhir, ad.rows, nowMs);
    if (tulisFile && baru.length) tambah(arsipPath, baru.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const rows = gabungTerkini(terakhir, ad.rows).filter((r) => r.sumber !== 'backtest');
    hasilMesin[m.id] = { cfg: m, sumber: s, ad, rows, baruArsip: baru.length };
    if (s.raw === null) banner.push({ tingkat: 'TINGGI', teks: `Data ${m.id} gagal diambil (${s.error}). Tampilan memakai arsip dan bisa basi.` });
    if (m.id === 'sctn' && s.backtest) {
      const bt = adaptSctnBacktest({ tradesCsv: s.backtest.tradesCsv, summary: s.backtest.summary }, buatCtx(config, defs, 'sctn'));
      hasilMesin.sctn.backtest = { ring: ringkas(bt.rows, OPSI), klaim: bt.meta.klaimMesin, jumlah: bt.rows.length, tidakTerisi: bt.rows.filter((r) => r.status === 'EXPIRED').length, fillInstan: bt.rows.filter((r) => r.status === 'CLOSED' && r.kualitasData.includes('TIDAK_TERVERIFIKASI_FILL')).length };
    }
  }
  const semuaRows = Object.values(hasilMesin).flatMap((h) => h.rows);

  // ---- 2. event ----
  const [fo, cp] = await Promise.all([ambilFomc(fetchFn, config.sumber.timeoutMs), ambilCpi(fetchFn, config.sumber.timeoutMs)]);
  const evResmi = normalisasi([...fo.daftar, ...cp.daftar], 'resmi'), evManual = normalisasi(eventsManual.events, 'manual');
  const events = gabung(evResmi, evManual);
  const infoEvent = { resmiOk: fo.ok || cp.ok, manualKosong: !(eventsManual.events?.length), diperbarui: eventsManual.diperbaruiPada ? Date.parse(eventsManual.diperbaruiPada) : (evResmi.length ? nowMs : null) };
  const kalimat = kalimatEvent(events, nowMs, infoEvent);
  if (kalimat.peringatan) banner.push({ tingkat: 'SEDANG', teks: `Peringatan event: ${kalimat.teks}` });

  // ---- 3. pasar ----
  const pasar = buatPasar(config, { fetchFn, sleepFn });
  const tk = await pasar.ticker24h();
  const ticker = tk.ok ? tk.data : {};
  const major = tk.ok ? topMajor(ticker, th.doktrin['DOC-08'].topNMajor) : null;
  const [b1h, b4h, b1d, b1w] = await Promise.all([pasar.kline('BTC', '1h'), pasar.kline('BTC', '4h'), pasar.kline('BTC', '1d'), pasar.kline('BTC', '1w')]);
  const libur = eventsManual.libur ?? [];
  const konteks = (b1h.ok && b4h.ok && b1d.ok) ? hitungKonteks({ c1h: b1h.data, c4h: b4h.data, c1d: b1d.data, c1w: b1w.ok ? b1w.data : null, harga: ticker.BTC?.last ?? null, nowMs, th, events, libur }) : { tersedia: false, alasan: 'Konteks pasar tidak tersedia (semua sumber harga gagal)' };
  if (!konteks.tersedia) banner.push({ tingkat: 'SEDANG', teks: 'Konteks pasar tidak tersedia. Tidak ada keputusan LAYAK ENTRY (maksimal TUNGGU).' });

  // ---- 4. keputusan ----
  const logPath = P(config.arsip.keputusanFile);
  const { baris: logLama } = parseJsonl(T(logPath));
  const logMap = new Map(logLama.map((x) => [`${x.mesin}|${x.id}`, x]));
  const pending = semuaRows.filter(perluKeputusan).sort((a, b) => b.waktuUtc - a.waktuUtc);
  const koinList = [...new Set(pending.map((r) => r.koin))].slice(0, config.harga.maksKoinPerRun);
  const dataKoin = {};
  for (const k of koinList) {
    const [c15, c1h, c4h, c1d] = await Promise.all(['15m', '1h', '4h', '1d'].map((tf) => pasar.kline(k, tf, config.harga.tfKoin[tf])));
    dataKoin[k] = { c15: c15.ok ? hanyaClose(c15.data, '15m', nowMs) : null, c1h: c1h.ok ? hanyaClose(c1h.data, '1h', nowMs) : null, c4h: c4h.ok ? hanyaClose(c4h.data, '4h', nowMs) : null, c1d: c1d.ok ? hanyaClose(c1d.data, '1d', nowMs) : null, last: c15.ok ? c15.data[c15.data.length - 1].c : (c1h.ok ? c1h.data[c1h.data.length - 1].c : null) };
  }
  const over = flagOvertrading(semuaRows.filter((r) => r.status !== 'EXPIRED'), th);
  const hasilKeputusan = [], tampil = new Map();
  for (const r of pending) {
    const dk = dataKoin[r.koin], tkr = ticker[r.koin];
    const harga = tkr?.last ?? dk?.last ?? null, hargaTersedia = Number.isFinite(harga);
    const { flags, hilang } = hitungFlag(r, { th, refTs: nowMs, harga, c1h: dk?.c1h, c4h: dk?.c4h, c1d: dk?.c1d, ticker: tkr ?? null, tickerTersedia: tk.ok, major, btc: konteks.tersedia ? konteks : null, events, libur });
    const semuaFlag = [...flags, ...(over.get(`${r.mesin}|${r.id}`) ?? [])];
    const mesinCfg = hasilMesin[r.mesin].cfg;
    const jejak = dk?.c15 ? hitungJejak(r, dk.c15, nowMs) : null;
    const k = putuskan(r, { harga, nowMs, flags: semuaFlag, mesinCfg, th, jejak, hargaTersedia: hargaTersedia && konteks.tersedia });
    const pasarTersedia = hargaTersedia && konteks.tersedia && (dk?.c1h?.length ?? 0) >= th.doktrin['DOC-01'].rangeCandles1h;
    tampil.set(`${r.mesin}|${r.id}`, { ...k, harga, hilang });
    if (pasarTersedia || k.keputusan === 'BATAL') hasilKeputusan.push({ mesin: r.mesin, id: r.id, ...k, flags: semuaFlag, pasarTersedia });
  }
  const baruLog = catatBaru(logLama, hasilKeputusan, { definisiHash: defHash, nowMs });
  if (tulisFile && baruLog.length) tambah(logPath, baruLog.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const logSemua = [...logLama, ...baruLog];

  // ---- 5. audit ----
  const gab = gabungKeputusan(semuaRows.filter((r) => r.sumber !== 'backtest'), logSemua);
  const audit = { keputusan: auditKeputusan(gab, OPSI), profil: profilKepatuhan(gab, logSemua, OPSI), uji: ujiBuktiFlag(gab, OPSI), kegagalan: panelKegagalan(semuaRows.filter((r) => r.sumber !== 'backtest'), th.statistik.panelKegagalanJumlah, th.statistik.distribusiR) };

  // ---- 6. statistik per mesin ----
  const mesinOut = [], paketRules = [];
  for (const [id, h] of Object.entries(hasilMesin)) {
    const rows = h.rows, cfg = h.cfg;
    const epoch = new Map();
    for (const r of rows) { const k = r.hash ?? 'tanpa-hash'; if (!epoch.has(k)) epoch.set(k, []); epoch.get(k).push(r); }
    const aktifKey = [...epoch.entries()].sort((a, b) => Math.max(...b[1].map((x) => x.waktuUtc ?? 0)) - Math.max(...a[1].map((x) => x.waktuUtc ?? 0)))[0]?.[0];
    const rowsAktif = epoch.get(aktifKey) ?? [];
    const ring = ringkas(rowsAktif, OPSI);
    const closed = rowsAktif.filter((r) => r.status === 'CLOSED');
    const kualitasBuruk = closed.length > 0 && closed.filter((r) => r.kualitasData.some((q) => q === 'TIDAK_TERVERIFIKASI_FILL' || q === 'HASIL_HARDCODE')).length / closed.length > th.statistik.kualitasBurukFraksi;
    const kel = kelayakan(ring, { ...cfg.kesiapan }, config.kesiapanDefaultMonitor, kualitasBuruk);
    const stops = rows.map((r) => r.stopPct).filter(Number.isFinite);
    const kualitasHitung = {}; for (const r of rows) for (const q of r.kualitasData) kualitasHitung[q] = (kualitasHitung[q] ?? 0) + 1;
    const terisi = rows.filter((r) => r.terisi === true).length, tak = rows.filter((r) => r.terisi === false).length;
    const lastUpdate = h.ad.meta?.lastUpdateMs ?? null;
    const urut = [...rows].sort((a, b) => (b.waktuUtc ?? 0) - (a.waktuUtc ?? 0)).slice(0, config.arsip.tampilBarisMaks);
    const rowsTampil = urut.map((r) => { const k = tampil.get(`${r.mesin}|${r.id}`), kp = logMap.get(`${r.mesin}|${r.id}`) ?? baruLog.find((x) => x.mesin === r.mesin && x.id === r.id);
      const j = k && Number.isFinite(k.harga) ? jarakKeEntry({ arah: r.arah, entry: r.entry, entryLow: r.entryLow, entryHigh: r.entryHigh, sl: r.sl, harga: k.harga }) : null;
      return { ...tipis(r), harga: k?.harga ?? null, jarakPct: j?.jarakPct ?? null, jarakR: j?.jarakR ?? null, sisi: j?.sisi ?? null, keputusan: k?.keputusan ?? null, catatan: k?.catatan ?? null, keputusanPertama: kp ? { keputusan: kp.keputusan, catatan: kp.catatan } : null }; });
    mesinOut.push({
      id, nama: cfg.nama, kadensiMenit: cfg.kadensiMenit, kadensiStatus: cfg.kadensiStatus, batalSetelahMenit: cfg.batalSetelahMenit, batalStatus: cfg.batalStatus,
      rSudahNet: cfg.rSudahNet, rSudahNetBukti: cfg.rSudahNetBukti, pemotongan: cfg.pemotongan, biayaPct: cfg.biayaPct,
      status: { ok: h.sumber.raw !== null, sumber: h.sumber.sumber, error: h.sumber.error, lastUpdateMs: lastUpdate, jumlahBaris: rows.length, baruArsip: h.baruArsip },
      epoch: [...epoch.entries()].map(([k, v]) => ({ hash: k, n: v.length, versi: v.find((x) => x.versi)?.versi ?? null, aktif: k === aktifKey })),
      ring, kelayakan: kel, kualitasHitung, terisi, tidakTerisi: tak, anomali: h.ad.anomali,
      stop: { n: stops.length, median: median(stops), persenLebar: stops.length ? stops.filter((x) => x > th.doktrin['DOC-04'].stopLebarPct).length / stops.length * 100 : null, persenSangatLebar: stops.length ? stops.filter((x) => x > th.doktrin['DOC-04'].stopSangatLebarPct).length / stops.length * 100 : null },
      backtest: h.backtest ?? null, chain: h.ad.meta?.chain ?? null, rows: rowsTampil
    });
    paketRules.push({ cfg, rows: rowsAktif, ring, anomali: h.ad.anomali });
  }

  // ---- 7. notifikasi ----
  const auto = aturanOtomatis({ mesin: paketRules, gabungan: semuaRows, uji: audit.uji, profil: audit.profil, eventInfo: infoEvent, klaim, defHash, defHashLama, th, nowMs });
  const stNotif = J(P('data/state/notif.json'), null);
  const gabNotif = gabungNotifikasi(auto, seed.items, stNotif, nowMs);
  const notifikasi = gabNotif.items.map((n) => ({ ...n, prompt: promptUpgrade({ notifs: [n], mesin: n.mesin === 'LINTAS' ? null : n.mesin, definisiHash: defHash }) }));
  const stPush = J(P('data/state/push.json'), null);
  const push = await jalankanPush(notifikasi, stPush, env, fetchFn, nowMs, th);
  if (seed.galat.length) banner.push({ tingkat: 'SEDANG', teks: `Seed backlog bermasalah: ${seed.galat.join('; ')}` });

  // ---- 8. keluaran ----
  const wib = formatWib(nowMs);
  const data = {
    versi: '2.0.0', basiMenit: config.basi.bannerJikaDataTuaMenit, dibuat: nowMs, dibuatWib: `${wib.hari}, ${wib.tanggal} ${wib.jam} WIB`, banner,
    event: { teks: kalimat.teks, peringatan: kalimat.peringatan, sumber: infoEvent.resmiOk ? 'resmi' : (infoEvent.manualKosong ? null : 'manual'), diperbarui: infoEvent.diperbarui, resmiGagal: { fomc: fo.error, cpi: cp.error } },
    konteks, definisi: { versi: defs.versi, hash: defHash, hashLama: defHashLama, epochBaru: !!defHashLama && defHashLama !== defHash },
    pasar: { ticker: tk.ok ? tk.provider : null, request: pasar.stat.request, gagal: pasar.stat.gagal, rincianTicker: tk.rincian },
    mesin: mesinOut, notifikasi: notifikasi.map(({ prompt, ...n }) => ({ ...n, prompt })),
    promptMesin: Object.fromEntries(config.mesin.map((m) => [m.id, promptUpgrade({ notifs: notifikasi.filter((n) => n.mesin === m.id), mesin: m.id, definisiHash: defHash })])),
    audit, rumus: RUMUS, push: { aktif: push.aktif, dikirim: push.dikirim }, keputusanBaru: baruLog.length,
    kelayakanDefault: config.kesiapanDefaultMonitor, catatanLuar: notes ? { label: 'OPINI EKSTERNAL, BUKAN SINYAL', isi: notes } : null
  };
  data.laporan = buatLaporan(data);
  if (tulisFile) {
    tulis(P('data/state/notif.json'), JSON.stringify(gabNotif.state, null, 1));
    tulis(P('data/state/push.json'), JSON.stringify(push.state, null, 1));
    tulis(P('data/state/definisi.json'), JSON.stringify({ hash: defHash, versi: defs.versi, sejak: stDef && stDef.hash === defHash ? stDef.sejak : nowMs }, null, 1));
    tulis(P('data/state/status.json'), JSON.stringify({ dibuat: nowMs, mesin: Object.fromEntries(mesinOut.map((m) => [m.id, m.status])) }, null, 1));
    tulis(P('site/data.json'), JSON.stringify(data));
    tulis(P('site/laporan.txt'), data.laporan);
  }
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  jalankanMonitor().then((d) => { console.log(`Selesai: ${d.mesin.length} mesin, ${d.notifikasi.length} notifikasi, ${d.keputusanBaru} keputusan baru, banner ${d.banner.length}`); }).catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
}
