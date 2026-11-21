// Hash kanonik. Dua jenis:
// 1) canonPy: meniru Python json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False)
//    DENGAN mempertahankan literal angka asli (mis. "1.0", "3.71e-06"), karena JS tidak bisa
//    membedakan 1.0 dari 1. Dipakai untuk memverifikasi rantai hash scv5 (scalp/config.py canon()).
// 2) canonJs: kanonik untuk hash milik monitor sendiri (definisi_hash).
import { createHash } from 'node:crypto';

export class RawNum { constructor(raw) { this.raw = raw; } }

export function sha256hex(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

// Parser JSON minimal yang menyimpan angka sebagai RawNum.
export function parseRaw(text) {
  let i = 0;
  const ws = () => { while (i < text.length && ' \t\r\n'.includes(text[i])) i++; };
  const fail = (m) => { throw new Error(`JSON tidak valid di posisi ${i}: ${m}`); };
  function val() {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; const o = {}; ws();
      if (text[i] === '}') { i++; return o; }
      for (;;) {
        ws(); if (text[i] !== '"') fail('kunci harus string');
        const k = str(); ws(); if (text[i++] !== ':') fail('butuh ":"');
        o[k] = val(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return o; }
        fail('butuh "," atau "}"');
      }
    }
    if (c === '[') {
      i++; const a = []; ws();
      if (text[i] === ']') { i++; return a; }
      for (;;) {
        a.push(val()); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return a; }
        fail('butuh "," atau "]"');
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 40));
    if (!m) fail('token tidak dikenal');
    i += m[0].length; return new RawNum(m[0]);
  }
  function str() {
    const st = i; i++;
    while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
    i++;
    return JSON.parse(text.slice(st, i));
  }
  const v = val(); ws();
  if (i !== text.length) fail('sisa teks setelah nilai');
  return v;
}

export function canonPy(v) {
  if (v instanceof RawNum) return v.raw;
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonPy).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonPy(v[k])).join(',') + '}';
}

export function canonJs(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonJs).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonJs(v[k])).join(',') + '}';
}

// definisi_hash (DOC-25): isi definitions.json tanpa 'versi' dan tanpa kunci berawalan '_' di level atas.
export function definisiHash(defs) {
  const body = {};
  for (const k of Object.keys(defs)) if (k !== 'versi' && !k.startsWith('_')) body[k] = defs[k];
  return sha256hex(canonJs(body)).slice(0, 16);
}
