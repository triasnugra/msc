// Pemuat jurnal mesin: Pages dahulu, lalu raw.githubusercontent.com. Token (MONITOR_TOKEN) hanya untuk header, tidak pernah dicetak.
const urlPages = (cfg, repo, path) => `${cfg.sumber.baseUrlPages}/${repo}/${path}`;
const urlRaw = (cfg, repo, ref, path) => `${cfg.sumber.rawBase}/${repo}/${ref}/${path}`;

async function ambilTeks(url, { fetchFn, cfg, env, sleepFn, rahasia }) {
  const headers = { accept: '*/*' };
  if (rahasia && env.MONITOR_TOKEN) headers.authorization = `Bearer ${env.MONITOR_TOKEN}`;
  let err = 'gagal';
  for (let k = 0; k <= cfg.sumber.retry.maks; k++) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), cfg.sumber.timeoutMs);
    try {
      const r = await fetchFn(url, { signal: ac.signal, headers }); clearTimeout(to);
      if (r.status === 404 || r.status === 401 || r.status === 403) return { ok: false, error: `http_${r.status}` };
      if (r.status === 429 || r.status >= 500) { err = `http_${r.status}`; if (k < cfg.sumber.retry.maks) await sleepFn(cfg.sumber.retry.backoffMs[Math.min(k, 2)]); continue; }
      if (!r.ok) return { ok: false, error: `http_${r.status}` };
      return { ok: true, teks: await r.text() };
    } catch (e) { clearTimeout(to); err = e.name === 'AbortError' ? 'timeout' : 'jaringan'; if (k < cfg.sumber.retry.maks) await sleepFn(cfg.sumber.retry.backoffMs[Math.min(k, 2)]); }
  }
  return { ok: false, error: err };
}

// Kandidat URL untuk satu path jurnal: [{url,label,rahasia}]
function kandidat(cfg, m, path) {
  const out = [];
  if (m.id !== 'sctn') { // mesin berjurnal satu file: semua jalur Pages lalu semua jalur raw (path raw boleh berbeda, mis. scv2 di branch data)
    for (const p of m.jurnal.pages) out.push({ url: urlPages(cfg, m.repo, p), label: 'pages', rahasia: false });
    for (const r of m.jurnal.raw) out.push({ url: urlRaw(cfg, m.repo, r.ref, r.path), label: 'raw', rahasia: true });
    return out;
  }
  if (m.jurnal.pages.includes(path)) out.push({ url: urlPages(cfg, m.repo, path), label: 'pages', rahasia: false });
  return out;
}
async function ambilPath(cfg, m, path, o, json) {
  const gagal = [];
  for (const c of kandidat(cfg, m, path)) {
    const r = await ambilTeks(c.url, { ...o, rahasia: c.rahasia });
    if (!r.ok) { gagal.push(`${c.label}: ${r.error}`); continue; }
    if (json) { try { JSON.parse(r.teks); } catch { gagal.push(`${c.label}: bukan JSON`); continue; } }
    if (!r.teks.trim()) { gagal.push(`${c.label}: kosong`); continue; }
    return { ok: true, teks: r.teks, sumber: c.label };
  }
  return { ok: false, error: gagal.join('; ') || 'tidak ada kandidat URL' };
}

// Mengembalikan {raw, sumber, error, backtest}. raw berbentuk sesuai adapter masing-masing.
export async function muatMesin(m, cfg, { fetchFn, env = {}, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const o = { fetchFn, cfg, env, sleepFn };
  const [p0] = [m.jurnal.pages[0] ?? m.jurnal.raw[0].path];
  if (m.id === 'sctn') {
    const fwd = await ambilPath(cfg, m, 'data/forward_test.json', o, true);
    const log = await ambilPath(cfg, m, 'data/signal_log.csv', o, false);
    // jalur raw sctn memakai output/..., jadi coba juga padanannya
    const fwd2 = fwd.ok ? fwd : await ambilRaw(cfg, m, 'output/forward_test.json', o, true);
    const log2 = log.ok ? log : await ambilRaw(cfg, m, 'output/signal_log.csv', o, false);
    if (!fwd2.ok || !log2.ok) return { raw: null, sumber: null, error: `forward: ${fwd2.error ?? 'ok'}; log: ${log2.error ?? 'ok'}`, backtest: null };
    const sm = await ambilPath(cfg, m, 'data/backtest/summary.json', o, true), tr = await ambilPath(cfg, m, 'data/backtest/trades.csv', o, false);
    const sm2 = sm.ok ? sm : await ambilRaw(cfg, m, 'output/backtest/summary.json', o, true), tr2 = tr.ok ? tr : await ambilRaw(cfg, m, 'output/backtest/trades.csv', o, false);
    return { raw: { forward: JSON.parse(fwd2.teks), signalLogCsv: log2.teks }, sumber: fwd2.sumber, error: null, backtest: sm2.ok && tr2.ok ? { summary: JSON.parse(sm2.teks), tradesCsv: tr2.teks } : null };
  }
  const json = m.id !== 'scv5';
  const r = await ambilPath(cfg, m, p0, o, json);
  if (!r.ok) return { raw: null, sumber: null, error: r.error, backtest: null };
  return { raw: json ? JSON.parse(r.teks) : r.teks, sumber: r.sumber, error: null, backtest: null };
}
async function ambilRaw(cfg, m, path, o, json) {
  const e = m.jurnal.raw.find((x) => x.path === path);
  if (!e) return { ok: false, error: 'tidak ada jalur raw' };
  const r = await ambilTeks(urlRaw(cfg, m.repo, e.ref, e.path), { ...o, rahasia: true });
  if (!r.ok) return { ok: false, error: `raw: ${r.error}` };
  if (json) { try { JSON.parse(r.teks); } catch { return { ok: false, error: 'raw: bukan JSON' }; } }
  return { ok: true, teks: r.teks, sumber: 'raw' };
}
