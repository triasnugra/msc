// Push opsional Telegram/Discord. Tanpa secret = nonaktif diam-diam. Rahasia tidak pernah dicetak atau dimasukkan ke pesan error.
// Hanya notifikasi BARU atau NAIK TINGKAT yang dikirim (dedupe lewat state yang di-commit), plus ringkasan harian.
import { peringkat } from './seed.mjs';

const wib = (ms) => new Date(ms + 7 * 3600000);
const tglWib = (ms) => wib(ms).toISOString().slice(0, 10);

export function kanalAktif(env) {
  return { telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), discord: !!env.DISCORD_WEBHOOK_URL };
}

async function kirim(kanal, teks, env, fetchFn) {
  const t = String(teks).slice(0, 1800);
  try {
    let r;
    if (kanal === 'telegram') r = await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: t }) });
    else r = await fetchFn(env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: t }) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, status: 0 }; } // pesan error sengaja tidak disertakan (bisa memuat URL rahasia)
}

export const formatPesan = (n) => `[${n.tingkat}] ${n.mesin} ${n.id}\n${n.judul}\nBukti: ${n.bukti}\nTindakan: ${n.tindakan}${n.doc?.length ? '\nDoktrin: ' + n.doc.join(', ') : ''}`;

export async function jalankanPush(notifs, pushState, env, fetchFn, nowMs, th) {
  const kanal = kanalAktif(env), aktif = kanal.telegram || kanal.discord;
  const st = { versi: 1, terkirim: { ...(pushState?.terkirim ?? {}) }, terakhirRingkasan: pushState?.terakhirRingkasan ?? null, inisialisasi: pushState?.inisialisasi ?? false };
  const hasil = { aktif, dikirim: 0, gagal: 0, ringkasan: false, state: st };
  const kirimSemua = async (teks) => { let ok = false; for (const k of ['telegram', 'discord']) if (kanal[k]) { const r = await kirim(k, teks, env, fetchFn); if (r.ok) ok = true; else hasil.gagal++; } return ok; };

  const minT = peringkat(th.notifikasi.pushMinTingkat);
  const layak = notifs.filter((n) => peringkat(n.tingkat) <= minT && n.status !== 'SELESAI' && n.status !== 'DITUNDA');

  if (!st.inisialisasi) { // run pertama: jangan banjiri pesan; catat semua yang ada sebagai sudah diketahui
    for (const n of layak) st.terkirim[n.id] = n.tingkat;
    st.inisialisasi = true;
    if (aktif) { const ok = await kirimSemua(`Monitor msc aktif. ${layak.length} notifikasi tercatat (tingkat ${th.notifikasi.pushMinTingkat} ke atas). Mulai sekarang hanya yang baru atau naik tingkat yang dikirim.`); if (ok) hasil.dikirim++; }
    return hasil;
  }
  const kandidat = layak.filter((n) => { const t = st.terkirim[n.id]; return t === undefined || peringkat(n.tingkat) < peringkat(t); }).slice(0, th.notifikasi.pushMaksPerRun);
  for (const n of kandidat) {
    if (aktif) { const ok = await kirimSemua(formatPesan(n)); if (!ok) { continue; } hasil.dikirim++; }
    st.terkirim[n.id] = n.tingkat; // tanpa kanal: tetap dicatat agar tidak menumpuk saat kanal diaktifkan
  }
  const jamWib = wib(nowMs).getUTCHours();
  if (aktif && jamWib >= th.notifikasi.ringkasanHarianJamWib && st.terakhirRingkasan !== tglWib(nowMs)) {
    const per = {}; for (const n of notifs) if (n.status !== 'SELESAI') per[n.tingkat] = (per[n.tingkat] ?? 0) + 1;
    const ok = await kirimSemua(`Ringkasan harian msc (${tglWib(nowMs)} WIB): ` + (Object.entries(per).map(([k, v]) => `${k} ${v}`).join(', ') || 'tidak ada notifikasi aktif'));
    if (ok) { st.terakhirRingkasan = tglWib(nowMs); hasil.ringkasan = true; }
  }
  return hasil;
}
