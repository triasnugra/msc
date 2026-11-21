// Data pasar publik: Binance data-api -> Bybit -> OKX. Retry+backoff terbatas, HTTP 451/403 = lewati penyedia,
// cache per run, batas request per run. fetchFn dan sleepFn dapat disuntik (untuk test).
export const MS = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000 };
const BYBIT_INT = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };
const OKX_BAR = { '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1Dutc', '1w': '1Wutc' };
const f = (x) => (x === undefined || x === null || x === '') ? null : Number(x);

export const normBinance = (a) => a.map((k) => ({ t: +k[0], o: f(k[1]), h: f(k[2]), l: f(k[3]), c: f(k[4]), v: f(k[5]), qv: f(k[7]) }));
export const normBybit = (l) => l.map((k) => ({ t: +k[0], o: f(k[1]), h: f(k[2]), l: f(k[3]), c: f(k[4]), v: f(k[5]), qv: f(k[6]) })).reverse();
export const normOkx = (l) => l.map((k) => ({ t: +k[0], o: f(k[1]), h: f(k[2]), l: f(k[3]), c: f(k[4]), v: f(k[5]), qv: f(k[7]) })).reverse();
const valid = (c) => c.filter((x) => [x.t, x.o, x.h, x.l, x.c].every(Number.isFinite) && x.h >= x.l);

// Tandai candle sudah close (t + interval <= now). Dipakai SEMUA flag range/tren.
export const hanyaClose = (c, tf, nowMs) => c.filter((x) => x.t + MS[tf] <= nowMs);

export function buatPasar(config, { fetchFn = globalThis.fetch, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), nowFn = () => Date.now() } = {}) {
  const cfg = config.harga, quote = cfg.quote ?? 'USDT';
  const cache = new Map();
  const stat = { request: 0, gagal: 0, cacheHit: 0, penyedia: {} };
  const catatan = [];

  async function ambil(url) {
    for (let k = 0; k <= cfg.retry.maks; k++) {
      if (stat.request >= cfg.maksRequestPerRun) return { ok: false, status: 0, error: 'batas_request_per_run' }; // dicek di tiap percobaan, termasuk retry
      stat.request++;
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), cfg.timeoutMs);
      try {
        const r = await fetchFn(url, { signal: ac.signal, headers: { accept: 'application/json' } });
        clearTimeout(to);
        if (r.status === 451 || r.status === 403) return { ok: false, status: r.status, error: `diblokir_http_${r.status}` };
        if (r.status === 429 || r.status >= 500) { if (k < cfg.retry.maks) { await sleepFn(cfg.retry.backoffMs[Math.min(k, cfg.retry.backoffMs.length - 1)]); continue; } return { ok: false, status: r.status, error: `http_${r.status}` }; }
        if (!r.ok) return { ok: false, status: r.status, error: `http_${r.status}` };
        return { ok: true, json: await r.json() };
      } catch (e) {
        clearTimeout(to);
        if (k < cfg.retry.maks) { await sleepFn(cfg.retry.backoffMs[Math.min(k, cfg.retry.backoffMs.length - 1)]); continue; }
        return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 80) };
      }
    }
    return { ok: false, status: 0, error: 'gagal' };
  }

  const urlKline = (p, sym, tf, limit) => {
    const P = cfg.providers.find((x) => x.id === p);
    if (p === 'binance_vision') return `${P.base}${P.klines}?symbol=${sym}${quote}&interval=${tf}&limit=${Math.min(limit, 1000)}`;
    if (p === 'bybit') return `${P.base}${P.klines}?category=${P.kategori}&symbol=${sym}${quote}&interval=${BYBIT_INT[tf]}&limit=${Math.min(limit, 1000)}`;
    return `${P.base}${P.klines}?instId=${sym}-${quote}&bar=${OKX_BAR[tf]}&limit=${Math.min(limit, cfg.maksCandleOkx ?? 300)}`;
  };
  const parseKline = (p, j) => {
    if (p === 'binance_vision') return Array.isArray(j) ? normBinance(j) : null;
    if (p === 'bybit') return j?.retCode === 0 && Array.isArray(j.result?.list) ? normBybit(j.result.list) : null;
    return j?.code === '0' && Array.isArray(j.data) ? normOkx(j.data) : null;
  };

  async function kline(sym, tf, limit = cfg.candleDibutuhkan?.[tf] ?? 100) {
    const key = `K|${sym}|${tf}|${limit}`;
    if (cache.has(key)) { stat.cacheHit++; return cache.get(key); }
    const rincian = [];
    let hasil = { ok: false, data: [], provider: null, error: 'semua_sumber_gagal', rincian };
    for (const P of cfg.providers) {
      const r = await ambil(urlKline(P.id, sym, tf, limit));
      stat.penyedia[P.id] = (stat.penyedia[P.id] ?? 0) + 1;
      if (!r.ok) { stat.gagal++; rincian.push(`${P.id}: ${r.error}`); if (r.error === 'batas_request_per_run') break; continue; }
      const data = parseKline(P.id, r.json);
      const bersih = data ? valid(data) : null;
      if (!bersih || !bersih.length) { stat.gagal++; rincian.push(`${P.id}: respons kosong/tidak valid`); continue; }
      hasil = { ok: true, data: bersih, provider: P.id, error: null, rincian };
      break;
    }
    cache.set(key, hasil);
    return hasil;
  }

  // Ticker 24 jam seluruh pasar USDT -> {SIMBOL: {qv, last}}
  async function ticker24h() {
    if (cache.has('T')) { stat.cacheHit++; return cache.get('T'); }
    const rincian = [];
    let hasil = { ok: false, data: {}, provider: null, error: 'semua_sumber_gagal', rincian };
    for (const P of cfg.providers) {
      let url, parse;
      if (P.id === 'binance_vision') { url = `${P.base}${P.ticker24h}`; parse = (j) => Array.isArray(j) ? j.filter((x) => x.symbol?.endsWith(quote)).map((x) => [x.symbol.slice(0, -quote.length), f(x.quoteVolume), f(x.lastPrice)]) : null; }
      else if (P.id === 'bybit') { url = `${P.base}${P.ticker24h}?category=${P.kategori}`; parse = (j) => j?.retCode === 0 && Array.isArray(j.result?.list) ? j.result.list.filter((x) => x.symbol?.endsWith(quote)).map((x) => [x.symbol.slice(0, -quote.length), f(x.turnover24h), f(x.lastPrice)]) : null; }
      else { url = `${P.base}${P.ticker24h}?instType=${P.instType}`; parse = (j) => j?.code === '0' && Array.isArray(j.data) ? j.data.filter((x) => x.instId?.endsWith('-' + quote)).map((x) => [x.instId.split('-')[0], f(x.volCcy24h), f(x.last)]) : null; }
      const r = await ambil(url);
      stat.penyedia[P.id] = (stat.penyedia[P.id] ?? 0) + 1;
      if (!r.ok) { stat.gagal++; rincian.push(`${P.id}: ${r.error}`); continue; }
      const rows = parse(r.json);
      if (!rows || !rows.length) { stat.gagal++; rincian.push(`${P.id}: respons kosong/tidak valid`); continue; }
      hasil = { ok: true, data: Object.fromEntries(rows.filter((x) => Number.isFinite(x[1])).map(([s, qv, last]) => [s, { qv, last }])), provider: P.id, error: null, rincian };
      break;
    }
    cache.set('T', hasil);
    return hasil;
  }

  return { kline, ticker24h, stat, catatan, nowFn };
}

// Peringkat volume top-N (tanpa stablecoin) dari hasil ticker24h.
export function topMajor(tickerData, n, stable = ['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDT', 'EUR', 'AEUR', 'BUSD', 'PYUSD']) {
  return Object.entries(tickerData).filter(([s]) => !stable.includes(s)).sort((a, b) => b[1].qv - a[1].qv).slice(0, n).map(([s]) => s);
}
