// Registri adapter + pembungkus aman: satu adapter error TIDAK merusak mesin lain.
import { adaptSc } from './sc.mjs';
import { adaptScv2 } from './scv2.mjs';
import { adaptScv4 } from './scv4.mjs';
import { adaptScv5 } from './scv5.mjs';
import { adaptScv6 } from './scv6.mjs';
import { adaptSctn } from './sctn.mjs';
import { deteksiAnomali } from '../core/anomaly.mjs';

export const ADAPTER = { sc: adaptSc, scv2: adaptScv2, scv4: adaptScv4, scv5: adaptScv5, scv6: adaptScv6, sctn: adaptSctn };

export function buatCtx(config, defs, id, opsi = {}) {
  const mesin = config.mesin.find((m) => m.id === id);
  if (!mesin) throw new Error(`mesin tidak dikenal: ${id}`);
  return { mesin, costPctDefault: config.biaya.costPctDefault, petaTrigger: defs.petaTriggerMesin?.[id] ?? {}, spotHashes: opsi.spotHashes ?? [] };
}

export function jalankanAdapter(id, raw, config, defs, th, nowMs, opsi = {}) {
  try {
    const ctx = buatCtx(config, defs, id, opsi);
    const hasil = ADAPTER[id](raw, ctx);
    const anomali = [...(hasil.anomali ?? []), ...deteksiAnomali(hasil.rows, hasil.meta ?? {}, ctx.mesin, nowMs, th)];
    return { id, ok: true, rows: hasil.rows, anomali, meta: hasil.meta ?? {}, error: null };
  } catch (e) {
    return { id, ok: false, rows: [], anomali: [{ kode: 'ADAPTER_ERROR', tingkat: 'TINGGI', mesin: id, pesan: `Adapter gagal: ${e.message}`, ids: [] }], meta: {}, error: String(e.message) };
  }
}
