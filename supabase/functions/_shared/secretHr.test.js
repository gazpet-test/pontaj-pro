import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { verificaSecretHr } from './secretHr.mjs';

// Exclusiv valori fictive. Nu citim parolele istorice pentru fixture-uri.
const NOU = 'nou-fictiv-hr-0123456789-abcdefghij';
const VECHI = 'vechi-fictiv-hr-0123456789-abcdef';
const functii = [
  ['hr-autorizatii-scan', 'HR_AUTORIZATII_SCAN_PAROLA'],
  ['hr-digest-saptamanal', 'HR_DIGEST_SAPTAMANAL_PAROLA'],
];
const cerere = (slug, headers = {}, query = '') => new Request(
  `https://hr.invalid/functions/v1/${slug}${query}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' },
);

function incarca(slug, env) {
  let handler;
  const lant = () => new Proxy({}, {
    get: (_, key) => key === 'then'
      ? (resolve) => resolve({ data: [], count: 0, error: null })
      : key === 'single' ? async () => ({ data: { id: 1 }, error: null }) : () => lant(),
  });
  const createClient = vi.fn(() => ({ from: vi.fn(lant) }));
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
  const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  // Executam chiar entrypoint-ul TS; substituim doar runtime-ul si I/O.
  const source = readFileSync(new URL(`../${slug}/index.ts`, import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  runInNewContext(code, {
    require: (name) => {
      if (name === 'npm:@supabase/supabase-js@2') return { createClient };
      if (name === '../_shared/secretHr.mjs') return { verificaSecretHr };
      throw new Error('dependenta neasteptata');
    },
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
    Response, Request, URL, fetch, console,
  });
  return { handler, createClient, fetch, console };
}

describe('secret HR — comparatie si configurare', () => {
  it.each([undefined, '', '   ', '\t\n'])('configurare vida -> 503 (%j)', (secret) => {
    expect(verificaSecretHr(cerere('test'), secret)).toBe(503);
  });
  it.each(['', VECHI, NOU.slice(1), NOU + 'x', 'x' + NOU.slice(1), NOU.slice(0, -1) + 'x', 'é'.repeat(40)])(
    'parola gresita, prefix sau lungime diferita -> 401 (%s)', (secret) => {
      expect(verificaSecretHr(cerere('test', { 'x-hr-secret': secret }), NOU)).toBe(401);
    },
  );
  it('parola exacta -> acces; nu normalizam valoarea configurata', () => {
    expect(verificaSecretHr(cerere('test', { 'x-hr-secret': NOU }), NOU)).toBeNull();
    expect(verificaSecretHr(cerere('test', { 'x-hr-secret': NOU }), NOU + ' ')).toBe(401);
  });
});

describe.each(functii)('%s — entrypoint real, I/O simulat', (slug, numeSecret) => {
  const mediu = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-fictiv',
    RESEND_API_KEY: 'resend-fictiv', SEAP_IMPORT_SECRET: VECHI, HR_DIGEST_SECRET: VECHI };

  it.each([undefined, '', '   '])('secret lipsa/gol -> 503, inclusiv cu service_role', async (secret) => {
    const runtime = incarca(slug, { ...mediu, [numeSecret]: secret });
    const r = await runtime.handler(cerere(slug, { 'x-hr-secret': NOU, Authorization: 'Bearer service-fictiv' }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'secret HR neconfigurat' });
    expect(runtime.createClient).not.toHaveBeenCalled();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { 'x-hr-secret': VECHI }, { Authorization: 'Bearer service-fictiv' },
    { 'x-hr-secret': 'gresit' }, { 'x-hr-secret': NOU.slice(0, -1) }])(
    'fara secret corect -> 401, fara BD/mail/log (%j)', async (headers) => {
      const runtime = incarca(slug, { ...mediu, [numeSecret]: NOU });
      const r = await runtime.handler(cerere(slug, headers));
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'unauthorized' });
      expect(runtime.createClient).not.toHaveBeenCalled();
      expect(runtime.fetch).not.toHaveBeenCalled();
      for (const log of Object.values(runtime.console)) expect(log).not.toHaveBeenCalled();
    },
  );
  it('secretul celeilalte integrari nu poate fi folosit', async () => {
    const altNume = functii.find(([nume]) => nume !== slug)[1];
    const runtime = incarca(slug, { ...mediu, [numeSecret]: NOU, [altNume]: VECHI });
    expect((await runtime.handler(cerere(slug, { 'x-hr-secret': VECHI }))).status).toBe(401);
  });
  it('parola noua -> 200; scan lista / digest test cu un singur mail simulat', async () => {
    const runtime = incarca(slug, { ...mediu, [numeSecret]: NOU });
    const r = await runtime.handler(cerere(slug, { 'x-hr-secret': NOU }, '?test=1'));
    expect(r.status).toBe(200);
    const body = await r.json();
    if (slug === 'hr-autorizatii-scan') {
      expect(body).toEqual({ candidati: 0, lista: [] });
      expect(runtime.fetch).not.toHaveBeenCalled();
    } else {
      expect(body).toMatchObject({ ok: true, test: true, destinatari: ['razvan.trusu@gazpet.ro'] });
      expect(runtime.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = runtime.fetch.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(JSON.parse(options.body)).toMatchObject({ to: ['razvan.trusu@gazpet.ro'] });
      expect(JSON.parse(options.body).subject.startsWith('[TEST] ')).toBe(true);
    }
  });
});

it('scan OPTIONS permite preflight fara secret, fara operatii HR', async () => {
  const runtime = incarca('hr-autorizatii-scan', {});
  const r = await runtime.handler(new Request('https://hr.invalid', { method: 'OPTIONS' }));
  expect(r.status).toBe(200);
  expect(r.headers.get('Access-Control-Allow-Headers')).toContain('x-hr-secret');
  expect(runtime.createClient).not.toHaveBeenCalled();
});
