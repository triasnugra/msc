// Pembantu test integrasi: fetch tiruan (jurnal dari fixture + pasar sintetis) dan root sementara.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FX = (f) => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
export const NOW = Date.UTC(2026, 10, 19, 23, 55); // Kamis, hari kerja
export function buatRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msc-'));
  for (const d of ['config', 'data']) fs.cpSync(new URL('../' + d, import.meta.url), path.join(root, d), { recursive: true });
  return root;
}
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const MS = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000 };

export function fakeFetch(o = {}) {
  const calls = [];
  const sumber = {
    'triasnugra.github.io/sc/data/journal.json': () => FX('nyata_sc_journal.json'),
    'triasnugra.github.io/scv2/data/journal.json': () => o.scv2 ?? FX('SINTETIS_scv2_journal.json'),
    'triasnugra.github.io/scv4/history.json': () => FX('SINTETIS_scv4_history.json'),
    'raw.githubusercontent.com/triasnugra/scv5/main/data/journal.jsonl': () => FX('nyata_scv5_journal.jsonl'),
    'raw.githubusercontent.com/triasnugra/scv6/main/data/journal.json': () => FX('nyata_scv6_journal.json'),
    'triasnugra.github.io/sctn/data/forward_test.json': () => FX('nyata_sctn_forward_test.json'),
    'triasnugra.github.io/sctn/data/signal_log.csv': () => FX('nyata_sctn_signal_log.csv'),
    'triasnugra.github.io/sctn/data/backtest/summary.json': () => FX('nyata_sctn_backtest_summary.json'),
    'triasnugra.github.io/sctn/data/backtest/trades.csv': () => FX('nyata_sctn_backtest_trades.csv')
  };
  const harga = o.harga ?? ((s) => ({ BTC: 62000, ETH: 3000, SOL: 100 }[s] ?? 1));
  const fn = async (url, init = {}) => {
    calls.push({ url, body: init.body });
    const u = new URL(url);
    if (init.method === 'POST') return o.post ? o.post(url, init) : resp(200, {});
    const kunci = u.host + u.pathname;
    if (o.gagalMesin?.some((m) => kunci.includes(`/${m}/`))) return resp(500, 'x');
    if (sumber[kunci]) return resp(200, sumber[kunci]());
    if (u.host === 'data-api.binance.vision') {
      if (o.pasarMati) return resp(451, {});
      if (u.pathname.endsWith('/ticker/24hr')) return resp(200, o.ticker ?? [{ symbol: 'BTCUSDT', quoteVolume: '9e9', lastPrice: String(harga('BTC')) }, { symbol: 'ETHUSDT', quoteVolume: '5e9', lastPrice: String(harga('ETH')) }, { symbol: 'SOLUSDT', quoteVolume: '9e8', lastPrice: String(harga('SOL')) }, { symbol: 'GRAMUSDT', quoteVolume: '5e6', lastPrice: '1' }]);
      if (u.pathname.endsWith('/klines')) {
        const sym = u.searchParams.get('symbol').replace('USDT', ''), tf = u.searchParams.get('interval'), n = +u.searchParams.get('limit'), ms = MS[tf], base = harga(sym);
        const fin = Math.floor((o.nowMs ?? NOW) / ms) * ms;
        return resp(200, Array.from({ length: n }, (_, i) => { const t = fin - (n - 1 - i) * ms, c = base * (1 + 0.03 * Math.sin(i * 0.9)); return [t, String(c), String(c * 1.004), String(c * 0.996), String(c), '100', t + ms - 1, String(c * 100)]; }));
      }
    }
    if (u.host === 'api.bybit.com' || u.host === 'www.okx.com') return resp(o.pasarMati ? 451 : 500, {});
    return resp(404, '');
  };
  fn.calls = calls;
  return fn;
}
export const barisJson = (rows) => JSON.stringify(rows);
