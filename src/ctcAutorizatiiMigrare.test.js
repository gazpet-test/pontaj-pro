// Autorizațiile sudorilor în CTC (TKT-2026-0389, 20261222b): verificări statice ale livrării + logica edge fn și a ecranului.
// Comportamentul pe BD (matricea de conturi, câmpurile permise, fișierul, revenirea, mutanții): scripts/pglite/test_ctc_autorizatii_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { valideazaCerere, caleSigura, statusDinEroareRpc } from '../supabase/functions/_shared/ctcAutorizatieFisier.ts'
import { filtreaza, ordoneaza, fmtZi, clasificaEroare, incarcaAutorizatii, cereScan } from './ctc/ctcAutorizatiiUtil.js'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/ctc_autorizatii_amprente.sql')
const MIG = citeste('supabase/migrations/20261222b_ctc_autorizatii_citire.sql')
const REV = citeste('supabase/revenire/20261222b_ctc_autorizatii_citire_ROLLBACK.sql')
const EDGE = citeste('supabase/functions/ctc-autorizatie-fisier/index.ts')
const UI = citeste('src/ctc/CtcAutorizatii.jsx')
const X = '20261222b'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const nr = (t, s) => t.split(s).length - 1
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const corp = (fn) => { const i = MIG.indexOf(`CREATE FUNCTION public.${fn}(`); const a = MIG.indexOf('AS $f$', i) + 6; return MIG.slice(a, MIG.indexOf('$f$;', a)) }
const fara = t => t.replace(/--[^\n]*/g, '')

describe('20261222b — L15 și livrarea', () => {
  it('AMPRENTA_L15 v1 identică cu sursa canonică, o dată în script și o dată în migrare; închiderea identică', () => {
    const canonic = blocuri(SURSA, A, B)[0]
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
    const IA = `-- >>> INCHIDERE_L15 ${X}`, IB = `-- <<< INCHIDERE_L15 ${X}`
    const inch = blocuri(SCRIPT, IA, IB)
    expect(inch.length).toBe(1)
    expect(blocuri(MIG, IA, IB)).toEqual(inch)
    expect(inch[0]).toContain("amp_pornire(oid) AS (VALUES (to_regprocedure('auth.uid()')::oid)),")
  })
  it('scriptul e doar citire; intrarea fără tabele (migrarea nu schimbă niciun tabel)', () => {
    expect(SCRIPT).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    expect(fara(SCRIPT)).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|COMMIT)\b/im)
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual(['amp_tabele(oid) AS (SELECT c.oid FROM pg_class c WHERE false),'])
  })
  it('BASELINE într-un singur loc, DE_COMPLETAT până la lipire, verificat înainte și după; antet NEAPLICAT, gardă, plafon', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    expect(linii.every(l => /^(, )?\('(tabel [^']+|functie [^']+|DE_COMPLETAT)', '([0-9a-f]{32}|DE_COMPLETAT)'\)$/.test(l))).toBe(true)
    expect(MIG).toContain(`PERFORM pg_temp.amp_verifica_${X}('inainte')`)
    expect(MIG).toContain(`PERFORM pg_temp.amp_verifica_${X}('dupa')`)
    expect(MIG.startsWith('-- Version 20261222120100. NEAPLICAT.')).toBe(true)
    expect(nr(MIG, `'${X}_ctc_autorizatii_citire:' || txid_current()`)).toBe(2)
    expect(MIG).toContain("IS DISTINCT FROM '2000/session'")
  })
  it('doar funcții noi: nicio politică, niciun tabel, niciun drept pe tabele / storage, modulul hr neatins', () => {
    const cod = fara(MIG)
    expect(cod).not.toMatch(/CREATE POLICY|ALTER POLICY|DROP POLICY|CREATE TABLE|ALTER TABLE|CREATE VIEW|storage\.|INSERT INTO|UPDATE public|DELETE FROM/)
    expect(cod.split('\n').filter(l => /^GRANT /.test(l))).toEqual([
      'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_sudori() TO authenticated;',
      'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatie_fisier(bigint) TO authenticated;',
    ])
    for (const fn of ['fn_ctc_autorizatii_drept()', 'fn_ctc_autorizatii_sudori()', 'fn_ctc_autorizatie_fisier(bigint)'])
      expect(cod).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated, service_role;`)
  })
  it('predicatul: auth.uid() (L08), owner sau ctc / ctc.* (cu punct); fișierul doar pentru sudor neșters, același refuz altfel', () => {
    const d = corp('fn_ctc_autorizatii_drept')
    expect(d).toContain('auth.uid() IS NOT NULL')
    expect(d).toContain("(u.module = 'ctc' OR u.module LIKE 'ctc.%')")
    const f = corp('fn_ctc_autorizatie_fisier')
    expect(f).toContain("WHERE a.id = p_id AND a.deleted_at IS NULL AND t.categorie = 'sudura';")
    expect(nr(f, "USING ERRCODE = 'P0002'")).toBe(1)
    const l = corp('fn_ctc_autorizatii_sudori')
    expect(l).toContain("WHERE a.deleted_at IS NULL AND t.categorie = 'sudura';")
    expect(l).toContain("(now() AT TIME ZONE 'Europe/Bucharest')::date")
    expect(l).not.toMatch(/fisier_path::text|observatii|cnp|telefon|email|iban/i)
  })
  it('revenirea: amprenta EXACTĂ a corpului fiecărei funcții; scoate doar cele trei', () => {
    for (const [et, fn] of [['dreptul', 'fn_ctc_autorizatii_drept'], ['lista', 'fn_ctc_autorizatii_sudori'], ['fisierul', 'fn_ctc_autorizatie_fisier']]) {
      const m = REV.match(new RegExp(`-- AMPRENTA-START ${et}\\n\\s*'([0-9a-f]{32})'`))
      expect(m, et).toBeTruthy()
      expect(m[1], et).toBe(md5(corp(fn)))
    }
    expect(fara(REV)).not.toMatch(/CASCADE|DELETE FROM|TRUNCATE|DROP (TABLE|POLICY|VIEW)/)
    expect(nr(fara(REV), 'DROP FUNCTION')).toBe(3)
  })
})

describe('edge fn ctc-autorizatie-fisier', () => {
  it('dreptul se verifică în BD CA UTILIZATORUL; service_role doar pentru semnarea căii aprobate, 60 s, bucket autorizatii', () => {
    expect(EDGE).toContain("createClient(url, anon, {\n    global: { headers: { Authorization: auth } },")
    expect(EDGE).toContain("await caUtilizator.rpc('fn_ctc_autorizatie_fisier', { p_id: cerere.id })")
    expect(nr(EDGE, '.rpc(')).toBe(1)
    expect(EDGE).toContain('await sb.storage.from(BUCKET).createSignedUrl(cale, VALABIL_SEC)')
    expect(EDGE).toContain("const BUCKET = 'autorizatii'")
    expect(EDGE).toContain('const VALABIL_SEC = 60')
    // calea semnată e DOAR cea întoarsă de RPC, după caleSigura; nicio cale din cerere
    expect(EDGE).toContain('cale = caleSigura(data)')
    expect(EDGE).not.toMatch(/corp\)?\.(path|cale|fisier)/)
    expect(EDGE).toMatch(/FIȘA DE SECURITATE/)
  })
  it('cererea: doar autorizatie_id întreg pozitiv', () => {
    expect(valideazaCerere({ autorizatie_id: 10 })).toEqual({ ok: true, id: 10 })
    for (const c of [null, [], {}, { autorizatie_id: '10' }, { autorizatie_id: 0 }, { autorizatie_id: -3 }, { autorizatie_id: 1.5 },
                     { autorizatie_id: 2 ** 60 }, { autorizatie_id: 10, cale: '1/a.pdf' }]) expect(valideazaCerere(c).ok).toBe(false)
  })
  it('calea: segmente sigure, fără .. / / la capete / spații / backslash', () => {
    expect(caleSigura('1/1700000000000_ab12.pdf')).toBe('1/1700000000000_ab12.pdf')
    expect(caleSigura('extern-4/scan.jpg')).toBe('extern-4/scan.jpg')
    for (const c of ['', '/1/a.pdf', '1/a.pdf/', '1/../2/a.pdf', '../a.pdf', '1/./a.pdf', '1\\a.pdf', '1/a b.pdf', '1/a\n.pdf', 'x'.repeat(501), null, 5])
      expect(caleSigura(c)).toBe(null)
  })
  it('erorile RPC → HTTP: 42501 = 403, P0002 = 404, funcție lipsă = 503, altceva = 500 (nu „fără drept”)', () => {
    expect(statusDinEroareRpc({ code: '42501' }).status).toBe(403)
    expect(statusDinEroareRpc({ code: 'P0002' }).status).toBe(404)
    expect(statusDinEroareRpc({ code: 'PGRST202' }).status).toBe(503)
    expect(statusDinEroareRpc({ code: '57014' }).status).toBe(500)
    expect(statusDinEroareRpc(null).status).toBe(500)
  })
})

describe('ecranul CTC', () => {
  const rows = [
    { id: 3, titular: 'POPESCU ION', tip: 'Sudor PEHD', numar_autorizatie: 'S-3', procedeu_sudura: 'electrofuziune', stare: 'expirata', data_expirare: '2026-01-01', inlocuita: true },
    { id: 1, titular: 'POPESCU ION', tip: 'Sudor PEHD', numar_autorizatie: 'S-1', procedeu_sudura: 'electrofuziune', stare: 'valabila', data_expirare: '2027-01-01', inlocuita: false },
    { id: 2, titular: 'ȘERBAN ANA', extern: true, firma: 'FIRMA SRL', tip: 'Sudor oțel', numar_autorizatie: 'S-2', procedeu_sudura: '111', stare: 'fara_data', inlocuita: false },
  ]
  it('filtre: text fără diacritice, stare, înlocuite; ordinea: titular, valabile întâi', () => {
    expect(filtreaza(rows, { text: 'serban' }).map(r => r.id)).toEqual([2])
    expect(filtreaza(rows, { text: 'firma' }).map(r => r.id)).toEqual([2])
    expect(filtreaza(rows, { stare: 'expirata' }).map(r => r.id)).toEqual([3])
    expect(filtreaza(rows, { inlocuite: false }).map(r => r.id)).toEqual([1, 2])
    expect(ordoneaza(rows).map(r => r.id)).toEqual([1, 3, 2])
  })
  it('data fără decalaj de fus orar', () => {
    expect(fmtZi('2026-11-13')).toBe('13.11.2026')
    expect(fmtZi(null)).toBe('—')
  })
  it('erorile se deosebesc: fără drept / neactivat / eroare (nu listă goală, L18)', () => {
    expect(clasificaEroare({ code: '42501' }).tip).toBe('fara_drept')
    expect(clasificaEroare({ code: 'PGRST202' }).tip).toBe('neactivat')
    expect(clasificaEroare({ code: '57014', message: 'timeout' })).toEqual({ tip: 'eroare', mesaj: 'Autorizațiile nu au putut fi încărcate: timeout' })
  })
  it('încărcarea: keyset până la pagina goală, peste plafonul de 1000 al serverului (L23)', async () => {
    const toate = Array.from({ length: 2345 }, (_, i) => ({ id: i + 1 }))
    const cereri = []
    const sb = { rpc(nume) {
      const q = { nume, gt: null, lim: null }
      const b = { order() { return b }, limit(n) { q.lim = n; return b }, gt(_c, v) { q.gt = v; return b },
        then(res) { cereri.push(q); const r = toate.filter(x => q.gt == null || x.id > q.gt).slice(0, Math.min(q.lim, 1000)); return Promise.resolve({ data: r, error: null }).then(res) } }
      return b } }
    const r = await incarcaAutorizatii(sb, 5000)
    expect(r.length).toBe(2345)
    expect(cereri.every(q => q.nume === 'fn_ctc_autorizatii_sudori')).toBe(true)
    expect(cereri.length).toBe(4)
  })
  it('încărcarea: eroarea serverului se propagă (nu listă goală)', async () => {
    const sb = { rpc() { const b = { order() { return b }, limit() { return b }, gt() { return b }, then(res) { return Promise.resolve({ data: null, error: { code: '42501', message: 'x' } }).then(res) } }; return b } }
    await expect(incarcaAutorizatii(sb)).rejects.toMatchObject({ code: '42501' })
  })
  it('scanul: doar prin edge fn, cu id-ul; mesajul serverului ajunge la utilizator', async () => {
    const apeluri = []
    const ok = { functions: { invoke: async (n, o) => { apeluri.push([n, o]); return { data: { url: 'https://semnat' }, error: null } } } }
    expect(await cereScan(ok, '10')).toEqual({ url: 'https://semnat' })
    expect(apeluri).toEqual([['ctc-autorizatie-fisier', { body: { autorizatie_id: 10 } }]])
    const refuz = { functions: { invoke: async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Fără acces la autorizațiile pentru cartea tehnică (modulul CTC)' }) } } }) } }
    expect(await cereScan(refuz, 10)).toEqual({ eroare: 'Fără acces la autorizațiile pentru cartea tehnică (modulul CTC)' })
    expect(UI).not.toMatch(/storage\.from\(/)
    expect(UI).toContain('Firmele de control nedistructiv (NDT)')
  })
})
