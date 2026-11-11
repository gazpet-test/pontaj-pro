// TKT-2026-0376 — mailul HR de luni nu mai anunță autorizațiile deja reînnoite.
// Regula (independentă de cod): o autorizație reînnoită din HR are inlocuita_de_id spre cea nouă (HR.jsx → Reînnoiește,
// migrarea 20260925_hr_autorizatii_reinnoire); alertele din platformă o ignoră (adminAlerte.js). Mailul trebuie să facă la fel.
// Rulăm entrypoint-ul real (ca scripts/secretHr.test.js), cu BD simulată care ÎNREGISTREAZĂ filtrele fiecărei citiri.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { verificaSecretHr } from '../supabase/functions/_shared/secretHr.mjs';

const PAROLA = 'fictiv-digest-0123456789-abcdefghij';

function ruleazaDigest() {
  const citiri = [];
  const lant = (pasi) => new Proxy({}, {
    get: (_, key) => key === 'then'
      ? (resolve) => resolve({ data: [], count: 0, error: null })
      : (...args) => { pasi.push([key, ...args]); return lant(pasi); },
  });
  const from = vi.fn((tabel) => { const pasi = []; citiri.push({ tabel, pasi }); return lant(pasi); });
  const createClient = vi.fn(() => ({ from }));
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
  let handler;
  const source = readFileSync(new URL('../supabase/functions/hr-digest-saptamanal/index.ts', import.meta.url), 'utf8');
  runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    require: (name) => {
      if (name === 'npm:@supabase/supabase-js@2') return { createClient };
      if (name === '../_shared/secretHr.mjs') return { verificaSecretHr };
      throw new Error('dependenta neasteptata');
    },
    Deno: { env: { get: (k) => ({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictiv',
      RESEND_API_KEY: 'fictiv', HR_DIGEST_SAPTAMANAL_PAROLA: PAROLA })[k] }, serve: (fn) => { handler = fn; } },
    Response, Request, URL, fetch, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  });
  return { handler, citiri, fetch };
}

const areFiltru = (pasi, col, val) => pasi.some(([m, c, v]) => m === 'is' && c === col && v === val);

describe('hr-digest-saptamanal — autorizațiile reînnoite', () => {
  it('fișe lipsă / expiră în 60 de zile / expirate: doar autorizațiile vii, nereînnoite', async () => {
    const { handler, citiri, fetch } = ruleazaDigest();
    const r = await handler(new Request('https://hr.invalid/functions/v1/hr-digest-saptamanal?test=1',
      { method: 'POST', headers: { 'x-hr-secret': PAROLA }, body: '{}' }));
    expect(r.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);   // ?test=1: un singur mail simulat, doar spre adresa de test

    const aut = citiri.filter(c => c.tabel === 'hr_autorizatii');
    expect(aut).toHaveLength(4);   // 1 fișe, 2 expiră, 3 expirate, 6 calificări noi
    const [fise, expira, expirate, noi] = aut;
    for (const c of [fise, expira, expirate]) {
      expect(areFiltru(c.pasi, 'deleted_at', null)).toBe(true);
      expect(areFiltru(c.pasi, 'inlocuita_de_id', null)).toBe(true);
    }
    // „expiră în 60 de zile” rămâne pe intervalul de date (filtrul nou nu schimbă restul citirii)
    expect(expira.pasi.some(([m, c]) => m === 'gte' && c === 'data_expirare')).toBe(true);
    expect(expira.pasi.some(([m, c]) => m === 'lte' && c === 'data_expirare')).toBe(true);
    // calificările NOI intrate în 7 zile: o reînnoire e chiar una nouă → secțiunea nu se schimbă
    expect(areFiltru(noi.pasi, 'inlocuita_de_id', null)).toBe(false);
  });
});
