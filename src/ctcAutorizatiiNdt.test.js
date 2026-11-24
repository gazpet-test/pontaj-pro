// Autorizațiile firmelor NDT în CTC (TKT-2026-0389, migrarea 20270111a): regula căii (ecran + edge) pe tabelul COMUN de cazuri (L19, același
// fișier ca proba PGlite a trigger-ului), decizia edge-ului (cu mutanți pe modulul lui), logica ecranelor și verificări statice ale livrării.
// Comportamentul pe BD (trigger, RPC-uri, matricea de conturi, revenirea, mutanții SQL): scripts/pglite/test_ctc_autorizatii_ndt_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as edge from '../supabase/functions/_shared/ctcAutorizatieFisier.ts'
import { sanitize, caleNoua, caleValida, pregatesteSalvare, esecCert, MESAJ_CATEGORIE_NOUA, CATEGORIE_NDT } from './ofertareParteneriCale.js'
import { filtreazaNdt, ordoneazaNdt, stareScanNdt, incarcaNdt, cereScan, STARI_NDT } from './ctc/ctcAutorizatiiUtil.js'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270111a_ctc_autorizatii_ndt'
const MIG = citeste(`supabase/migrations/${NUME}.sql`)
const REV = citeste(`supabase/revenire/${NUME}_ROLLBACK.sql`)
const EDGE_IDX = citeste('supabase/functions/ctc-autorizatie-fisier/index.ts')
const EDGE_SH = citeste('supabase/functions/_shared/ctcAutorizatieFisier.ts')
const UI_CTC = citeste('src/ctc/CtcAutorizatii.jsx')
const UI_OF = citeste('src/OfertareParteneri.jsx')
const decodeaza = s => s.split('{BS}').join(String.fromCharCode(92)).split('{CTRL}').join(String.fromCharCode(1))
const CAZURI = JSON.parse(citeste(`supabase/tests/${NUME}_cazuri_cale.json`)).cazuri.map(c => ({ ...c, cale: decodeaza(c.cale) }))
const corp = fn => { const i = MIG.indexOf(`CREATE FUNCTION public.${fn}(`); const a = MIG.indexOf('AS $f$', i) + 6; return MIG.slice(a, MIG.indexOf('$f$;', a)) }
const fara = t => t.replace(/--[^\n]*/g, '')
const nr = (t, s) => t.split(s).length - 1

describe('regula căii pe tabelul comun de cazuri (L19)', () => {
  it('tabelul are cazuri pentru fiecare regulă (NDT + non-NDT, acceptate + refuzate)', () => {
    expect(CAZURI.length).toBeGreaterThanOrEqual(30)
    expect(CAZURI.some(c => c.categorie === CATEGORIE_NDT && c.garda)).toBe(true)
    expect(CAZURI.some(c => c.categorie !== CATEGORIE_NDT && !c.garda)).toBe(true)
    expect(CAZURI.some(c => c.cale.includes(String.fromCharCode(92)))).toBe(true)
    expect(CAZURI.some(c => c.cale.includes(String.fromCharCode(1)))).toBe(true)
  })
  it('ecranul (caleValida) = garda din BD pe fiecare caz', () => {
    const dif = CAZURI.filter(c => caleValida(c.cale, c.partener, c.categorie) !== c.garda).map(c => `${c.categorie} ${JSON.stringify(c.cale)}`)
    expect(dif).toEqual([])
    expect(caleValida(null, 1, CATEGORIE_NDT)).toBe(true)
  })
  it('edge-ul (caleNdtSigura) = valoarea „edge” pe fiecare caz; nicio cale refuzată de BD la deschidere nu e semnabilă dacă e și în afara formei', () => {
    const dif = CAZURI.filter(c => (edge.caleNdtSigura(c.cale) !== null) !== c.edge).map(c => JSON.stringify(c.cale))
    expect(dif).toEqual([])
    // ce deschide BD-ul și edge-ul acceptă = exact cazurile cu nume din [A-Za-z0-9._-] (numele cu spații: BD da, edge nu — 422, declarat)
    expect(CAZURI.filter(c => c.deschide && !c.edge).map(c => c.cale)).toEqual(['parteneri/1/ndt/scan cu spatii.pdf'])
  })
})

describe('numele și calea din ecranul Parteneri', () => {
  it('sanitize: același rezultat ca înainte (diacritice scoase, restul → _, cel mult 120)', () => {
    expect(sanitize('Autorizație RT-ș.pdf')).toBe('Autorizatie_RT-s.pdf')
    expect(sanitize('certificat..pdf')).toBe('certificat..pdf')
    expect(sanitize('a/b\\c%d.pdf'.replace('\\', String.fromCharCode(92)))).toBe('a_b_c_d.pdf')
    expect(sanitize('')).toBe('fisier')
    expect(sanitize('x'.repeat(200) + '.pdf').length).toBe(120)
  })
  it('caleNoua: NDT în parteneri/<id>/ndt/, restul ca înainte', () => {
    expect(caleNoua(7, CATEGORIE_NDT, 'Raport RT.pdf', 1700000000000)).toBe('parteneri/7/ndt/1700000000000_Raport_RT.pdf')
    expect(caleNoua(7, 'iso', 'Raport RT.pdf', 1700000000000)).toBe('parteneri/7/1700000000000_Raport_RT.pdf')
  })
  it('proprietate: orice nume de fișier, prin sanitize, dă o cale care trece garda, pentru fiecare categorie (nimic urcat și respins)', () => {
    let s = 20270111
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
    const alfabet = ['a', 'Z', '0', '.', '..', '/', '%', ' ', 'ș', 'ț', 'ă', '-', '_', String.fromCharCode(92), String.fromCharCode(1), String.fromCharCode(10), '😀', 'ndt/', '..', '%2e']
    const categorii = ['autorizatie_isc', 'iso', 'certificat_legal', 'atestat', 'etalonare', 'alta', CATEGORIE_NDT]
    for (let i = 0; i < 3000; i++) {
      const nume = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => alfabet[Math.floor(rnd() * alfabet.length)]).join('')
      const pid = 1 + Math.floor(rnd() * 5000)
      for (const cat of categorii) {
        const c = caleNoua(pid, cat, nume, 1700000000000 + i)
        if (!caleValida(c, pid, cat)) throw new Error(`calea ${JSON.stringify(c)} (${cat}) din numele ${JSON.stringify(nume)} nu trece garda`)
        if (cat === CATEGORIE_NDT && edge.caleNdtSigura(c) !== c) throw new Error(`calea NDT ${JSON.stringify(c)} nu se poate semna în edge`)
      }
    }
  })
  it('certificat..pdf se salvează la NDT și la certificat_legal', () => {
    for (const cat of [CATEGORIE_NDT, 'certificat_legal']) {
      const p = pregatesteSalvare({ d: {}, categorie: cat, file: { name: 'certificat..pdf' }, pid: 3, timp: 1700000000000 })
      expect(p.eroare).toBeUndefined()
      expect(caleValida(p.cale, 3, cat)).toBe(true)
    }
  })
  it('schimbarea categoriei unui document cu fișier: fără fișier nou = blocat cu mesajul din specificație; cu fișier nou = calea în dosarul potrivit', () => {
    const alta = { id: 1, categorie: 'alta', fisier_path: 'parteneri/3/1700000000000_x.pdf' }
    expect(pregatesteSalvare({ d: alta, categorie: CATEGORIE_NDT, file: null, pid: 3 })).toEqual({ eroare: MESAJ_CATEGORIE_NOUA })
    expect(MESAJ_CATEGORIE_NOUA).toBe('Pentru categoria nouă, încărcați din nou fișierul (se mută în dosarul potrivit)')
    expect(pregatesteSalvare({ d: alta, categorie: CATEGORIE_NDT, file: { name: 'x.pdf' }, pid: 3, timp: 5 })).toEqual({ cale: 'parteneri/3/ndt/5_x.pdf', urca: true })
    const ndt = { id: 2, categorie: CATEGORIE_NDT, fisier_path: 'parteneri/3/ndt/1700000000000_x.pdf' }
    expect(pregatesteSalvare({ d: ndt, categorie: 'alta', file: null, pid: 3 })).toEqual({ eroare: MESAJ_CATEGORIE_NOUA })
    expect(pregatesteSalvare({ d: ndt, categorie: 'alta', file: { name: 'x.pdf' }, pid: 3, timp: 6 })).toEqual({ cale: 'parteneri/3/6_x.pdf', urca: true })
    // între două categorii non-NDT calea rămâne bună; un document fără fișier își schimbă liber categoria
    expect(pregatesteSalvare({ d: alta, categorie: 'iso', file: null, pid: 3 })).toEqual({ cale: alta.fisier_path, urca: false })
    expect(pregatesteSalvare({ d: { id: 4, categorie: 'alta', fisier_path: null }, categorie: CATEGORIE_NDT, file: null, pid: 3 })).toEqual({ cale: null, urca: false })
  })
  it('eșecul cert al scrierii (L05): doar 4xx sau 0 rânduri; rețea / 5xx = necunoscut', () => {
    expect(esecCert({ error: { code: '23514' }, data: null, status: 400 })).toBe(true)
    expect(esecCert({ error: { code: '23505' }, data: null, status: 409 })).toBe(true)
    expect(esecCert({ error: null, data: [], status: 200 })).toBe(true)
    expect(esecCert({ error: { message: 'Failed to fetch' }, data: null, status: 0 })).toBe(false)
    expect(esecCert({ error: { message: 'x' }, data: null, status: 503 })).toBe(false)
    expect(esecCert({ error: null, data: [{ id: 1 }], status: 200 })).toBe(false)
  })
})

// ── edge-ul: decizia completă, cu RPC și semnare false ──
function dep({ data = null, error = null, arunca = false, semnare = { data: { signedUrl: 'https://semnat' }, error: null } } = {}) {
  const st = { rpc: [], semn: [] }
  return {
    st,
    d: {
      rpc: async (n, a) => { st.rpc.push([n, a]); if (arunca) throw new Error('retea'); return { data, error } },
      semneaza: async (b, c, s) => { st.semn.push([b, c, s]); return semnare },
    },
  }
}
// cazurile de comportament; întoarce lista abaterilor (folosită și pe mutanții modulului)
async function abateriEdge(m) {
  const ab = []
  const verif = (ce, cond) => { if (!cond) ab.push(ce) }
  let x = dep({ data: 'parteneri/1/ndt/1700000000000_rt.pdf' })
  let r = await m.trateazaCerere({ ndt_document_id: 5 }, x.d)
  verif('NDT valid → 200', r.status === 200 && r.corp.url === 'https://semnat' && r.corp.expira_in_sec === 60)
  verif('NDT: RPC-ul NDT cu p_document_id', JSON.stringify(x.st.rpc) === JSON.stringify([['fn_ctc_autorizatie_ndt_fisier', { p_document_id: 5 }]]))
  verif('NDT: semnat în ofertare, exact calea, 60 s', JSON.stringify(x.st.semn) === JSON.stringify([['ofertare', 'parteneri/1/ndt/1700000000000_rt.pdf', 60]]))
  x = dep({ data: null }); r = await m.trateazaCerere({ ndt_document_id: 5 }, x.d)
  verif('NDT NULL → 404 fără semnare', r.status === 404 && x.st.semn.length === 0)
  for (const cale of ['licitatii/103/caiet_de_sarcini.pdf', 'parteneri/1/ndt/scan cu spatii.pdf', '1/a.pdf', 'evil/parteneri/1/ndt/a.pdf', 'parteneri/1/ndt/..', 5]) {
    x = dep({ data: cale }); r = await m.trateazaCerere({ ndt_document_id: 5 }, x.d)
    verif(`NDT cale ${JSON.stringify(cale)} → 422 fără semnare`, r.status === 422 && x.st.semn.length === 0)
  }
  for (const [cod, s] of [['42501', 403], ['PGRST202', 503], ['42883', 503], ['57014', 500]]) {
    x = dep({ error: { code: cod } }); r = await m.trateazaCerere({ ndt_document_id: 5 }, x.d)
    verif(`NDT eroare ${cod} → ${s}`, r.status === s && x.st.semn.length === 0)
  }
  x = dep({ arunca: true }); r = await m.trateazaCerere({ ndt_document_id: 5 }, x.d)
  verif('NDT RPC aruncă → 500', r.status === 500 && x.st.semn.length === 0)
  x = dep({ data: 'parteneri/1/ndt/1700000000000_rt.pdf', semnare: { data: null, error: { message: 'x' } } }); r = await m.trateazaCerere({ ndt_document_id: 5 }, x.d)
  verif('NDT semnare eșuată → 502', r.status === 502)
  // sudorii: neschimbat
  x = dep({ data: '1/a.pdf' }); r = await m.trateazaCerere({ autorizatie_id: 10 }, x.d)
  verif('sudor → 200 pe autorizatii, p_id', r.status === 200 && JSON.stringify(x.st.rpc) === JSON.stringify([['fn_ctc_autorizatie_fisier', { p_id: 10 }]])
    && JSON.stringify(x.st.semn) === JSON.stringify([['autorizatii', '1/a.pdf', 60]]))
  x = dep({ error: { code: 'P0002' } }); r = await m.trateazaCerere({ autorizatie_id: 10 }, x.d)
  verif('sudor P0002 → 404', r.status === 404)
  x = dep({ data: null }); r = await m.trateazaCerere({ autorizatie_id: 10 }, x.d)
  verif('sudor fără cale → 422 (ca înainte)', r.status === 422 && x.st.semn.length === 0)
  // orice altă formă de cerere → 400, fără apel la BD
  for (const c of [null, [], {}, 'x', { autorizatie_id: 1, ndt_document_id: 2 }, { ndt_document_id: '5' }, { ndt_document_id: 0 }, { ndt_document_id: -1 },
    { ndt_document_id: 1.5 }, { ndt_document_id: 2 ** 60 }, { ndt_document_id: 5, cale: 'parteneri/1/ndt/a.pdf' }, { ndt_id: 5 }, { autorizatie_id: 10, bucket: 'ofertare' }]) {
    x = dep({ data: 'parteneri/1/ndt/1700000000000_rt.pdf' }); r = await m.trateazaCerere(c, x.d)
    verif(`corp ${JSON.stringify(c)} → 400 fără BD`, r.status === 400 && x.st.rpc.length === 0 && x.st.semn.length === 0)
  }
  for (const c of CAZURI) verif(`caleNdtSigura ${JSON.stringify(c.cale)}`, (m.caleNdtSigura(c.cale) !== null) === c.edge)
  return ab
}

describe('edge fn ctc-autorizatie-fisier v2', () => {
  it('decizia: NDT (404 / 422 / 403 / 503 / 500 / 502), sudorii neschimbați, cererile strâmbe = 400 fără BD', async () => {
    expect(await abateriEdge(edge)).toEqual([])
  })
  it('cererea: exact o cheie', () => {
    expect(edge.valideazaCerere({ autorizatie_id: 10 })).toEqual({ ok: true, tip: 'sudor', id: 10 })
    expect(edge.valideazaCerere({ ndt_document_id: 3 })).toEqual({ ok: true, tip: 'ndt', id: 3 })
    expect(edge.valideazaCerere({ ndt_document_id: 3, autorizatie_id: 10 }).ok).toBe(false)
  })
  it('mutanții modulului edge sunt prinși de aceleași cazuri', async () => {
    const MUTANTI = [
      ['fără reverificarea formei NDT', '      cale = caleNdtSigura(data)\n', '      cale = caleSigura(data)\n'],
      ['fără răspunsul 404 la NULL', "      if (data == null) return { status: 404, corp: { error: 'Autorizație NDT inexistentă sau fără scan' } }\n", ''],
      ['bucket greșit pentru NDT', "arg: 'p_document_id', bucket: 'ofertare' }", "arg: 'p_document_id', bucket: 'autorizatii' }"],
      ['chei în plus acceptate', 'if (chei.length !== 1 || !tip)', 'if (!tip)'],
      ['forma NDT fără ancoră', "new RegExp('^parteneri/[1-9][0-9]*/ndt/[^/]+$')", "new RegExp('parteneri/[1-9][0-9]*/ndt/[^/]+$')"],
      ['link de o oră', 'export const VALABIL_SEC = 60', 'export const VALABIL_SEC = 3600'],
      ['RPC-ul de sudor pe ramura NDT', "ndt: { cheie: 'ndt_document_id', rpc: 'fn_ctc_autorizatie_ndt_fisier'", "ndt: { cheie: 'ndt_document_id', rpc: 'fn_ctc_autorizatie_fisier'"],
      ['id-ul neverificat', 'if (typeof id !== \'number\' || !Number.isSafeInteger(id) || id <= 0)', 'if (id == null)'],
    ]
    const dir = new URL('../.tmp/ndt_mutanti_edge/', import.meta.url)
    mkdirSync(dir, { recursive: true })
    // martor: copia NEMODIFICATĂ, importată la fel, trece toate cazurile (deci o abatere la mutant vine din mutație)
    const fm = new URL(`martor_${Date.now()}.ts`, dir)
    writeFileSync(fm, EDGE_SH)
    expect(await abateriEdge(await import(/* @vite-ignore */ fm.href))).toEqual([])
    for (const [i, [nume, din, in_]] of MUTANTI.entries()) {
      expect(EDGE_SH.includes(din), nume + ': textul mutat există').toBe(true)
      const f = new URL(`m${i}_${Date.now()}.ts`, dir)
      writeFileSync(f, EDGE_SH.split(din).join(in_))
      const m = await import(/* @vite-ignore */ f.href)
      expect((await abateriEdge(m)).length, nume + ' trebuie prins').toBeGreaterThan(0)
    }
  })
  it('index.ts: dreptul în BD CA UTILIZATORUL, service_role doar la semnare, totul prin trateazaCerere', () => {
    expect(EDGE_IDX).toContain("createClient(url, anon, {\n    global: { headers: { Authorization: auth } },")
    expect(EDGE_IDX).toContain('rpc: (nume, argumente) => caUtilizator.rpc(nume, argumente),')
    expect(EDGE_IDX).toContain('semneaza: (bucket, cale, secunde) => sb.storage.from(bucket).createSignedUrl(cale, secunde),')
    expect(nr(EDGE_IDX, '.rpc(')).toBe(1)
    expect(nr(EDGE_IDX, '.storage.from(')).toBe(1)
    expect(EDGE_IDX).toContain('const r = await trateazaCerere(corp, {')
    expect(EDGE_IDX).toMatch(/FIȘA DE SECURITATE/)
    expect(EDGE_IDX).not.toMatch(/corp\)?\.(path|cale|fisier|bucket)/)
    // bucket-urile sunt fixe, câte unul pe ramură
    expect(edge.RAMURI).toEqual({
      sudor: { cheie: 'autorizatie_id', rpc: 'fn_ctc_autorizatie_fisier', arg: 'p_id', bucket: 'autorizatii' },
      ndt: { cheie: 'ndt_document_id', rpc: 'fn_ctc_autorizatie_ndt_fisier', arg: 'p_document_id', bucket: 'ofertare' },
    })
  })
})

describe('ecranul CTC: secțiunea firmelor NDT', () => {
  const rows = [
    { id: 3, firma: 'ȘTEFAN NDT SRL', cui: 'RO3', numar_document: 'UT-3', metoda: 'UT', stare: 'expirat', data_valabilitate: '2026-01-01', are_fisier: true },
    { id: 1, firma: 'ȘTEFAN NDT SRL', cui: 'RO3', numar_document: 'RT-1', metoda: 'RT', stare: 'valabil', data_valabilitate: '2027-01-01', are_fisier: false },
    { id: 2, firma: 'ALFA CONTROL', cui: 'RO2', numar_document: 'PT-2', emitent: 'ISCIR', metoda: 'PT', stare: 'necunoscut', are_fisier: true },
  ]
  it('filtre: text fără diacritice (firmă, CUI, nr., emitent, metodă), stare; ordinea: firmă, valabile întâi', () => {
    expect(filtreazaNdt(rows, { text: 'stefan' }).map(r => r.id)).toEqual([3, 1])
    expect(filtreazaNdt(rows, { text: 'iscir' }).map(r => r.id)).toEqual([2])
    expect(filtreazaNdt(rows, { text: 'ut' }).map(r => r.id)).toEqual([3])
    expect(filtreazaNdt(rows, { stare: 'expirat' }).map(r => r.id)).toEqual([3])
    expect(ordoneazaNdt(rows).map(r => r.id)).toEqual([2, 1, 3])
  })
  it('stările: exact cele trei ale RPC-ului; butonul doar la are_fisier = true; altă valoare = necunoscut (L18)', () => {
    expect(Object.keys(STARI_NDT).sort()).toEqual(['expirat', 'necunoscut', 'valabil'])
    expect(stareScanNdt(true)).toEqual({ deschide: true, text: 'Deschide scanul' })
    expect(stareScanNdt(false)).toEqual({ deschide: false, text: 'fără scan' })
    for (const v of [undefined, null, 'true', 1]) expect(stareScanNdt(v).deschide).toBe(false)
  })
  it('încărcarea: keyset pe fn_ctc_autorizatii_ndt până la pagina goală (L23); eroarea se propagă', async () => {
    const toate = Array.from({ length: 2100 }, (_, i) => ({ id: i + 1 }))
    const cereri = []
    const sb = { rpc(nume) {
      const q = { nume, gt: null, lim: null }
      const b = { order() { return b }, limit(n) { q.lim = n; return b }, gt(_c, v) { q.gt = v; return b },
        then(res) { cereri.push(q); const r = toate.filter(x => q.gt == null || x.id > q.gt).slice(0, Math.min(q.lim, 1000)); return Promise.resolve({ data: r, error: null }).then(res) } }
      return b } }
    expect((await incarcaNdt(sb, 5000)).length).toBe(2100)
    expect(cereri.every(q => q.nume === 'fn_ctc_autorizatii_ndt')).toBe(true)
    const er = { rpc() { const b = { order() { return b }, limit() { return b }, gt() { return b }, then(res) { return Promise.resolve({ data: null, error: { code: '42501' } }).then(res) } }; return b } }
    await expect(incarcaNdt(er)).rejects.toMatchObject({ code: '42501' })
  })
  it('scanul NDT: aceeași funcție edge, DOAR cheia ndt_document_id; sudorii neschimbați', async () => {
    const apeluri = []
    const sb = { functions: { invoke: async (n, o) => { apeluri.push([n, o]); return { data: { url: 'https://semnat' }, error: null } } } }
    expect(await cereScan(sb, '7', 'ndt')).toEqual({ url: 'https://semnat' })
    expect(await cereScan(sb, 10)).toEqual({ url: 'https://semnat' })
    expect(apeluri).toEqual([['ctc-autorizatie-fisier', { body: { ndt_document_id: 7 } }], ['ctc-autorizatie-fisier', { body: { autorizatie_id: 10 } }]])
  })
  it('static: secțiunea există, textul „nu sunt încă în platformă” a dispărut, fără acces direct la storage / tabelele Ofertare', () => {
    expect(UI_CTC).toContain('🔬 Firme de control nedistructiv')
    expect(UI_CTC).toContain('<SectiuneNdt />')
    expect(UI_CTC).not.toContain('nu sunt încă în platformă')
    expect(UI_CTC).toContain("const rez = await cereScan(client, r.id, 'ndt')")
    expect(UI_CTC).toContain('const sc = stareScanNdt(r.are_fisier)')
    expect(UI_CTC).not.toMatch(/storage\.from\(|ofertare_parteneri|fisier_path/)
  })
})

describe(`${NUME} — migrarea și revenirea (static)`, () => {
  it('antet NEAPLICAT, versiune, marcajul runnerului, plafonul 5000, L15 v2 obligatoriu', () => {
    expect(MIG.startsWith('-- Version 20270111120000. NEAPLICAT.')).toBe(true)
    expect(nr(MIG, `'${NUME}:' || txid_current()`)).toBe(2)
    expect(MIG).toContain("IS DISTINCT FROM '5000/session'")
    expect(MIG).toContain('AMPRENTA_GLOBALA_LIPSA')
    expect(nr(REV, `'${NUME}_ROLLBACK:' || txid_current()`)).toBe(2)
    expect(REV).toContain("IS DISTINCT FROM '2000/session'")
  })
  it('doar ce cere specificația: CHECK, garda + trigger, index unic, 2 RPC-uri; nicio politică, niciun drept pe tabele / storage, nicio scriere de date', () => {
    const cod = fara(MIG)
    expect(cod).not.toMatch(/CREATE POLICY|ALTER POLICY|DROP POLICY|CREATE TABLE|CREATE VIEW|storage\.|INSERT INTO|UPDATE public|DELETE FROM|GRANT [A-Z, ]+ ON (TABLE )?public\.ofertare/)
    expect(cod.split('\n').filter(l => /^GRANT /.test(l))).toEqual([
      'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_ndt() TO authenticated;',
      'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatie_ndt_fisier(bigint) TO authenticated;',
    ])
    for (const fn of ['fn_ofertare_doc_cale_garda()', 'fn_ctc_autorizatii_ndt()', 'fn_ctc_autorizatie_ndt_fisier(bigint)'])
      expect(cod).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated, service_role;`)
    expect(cod.split('\n').filter(l => /^CREATE /.test(l)).map(l => l.split(' (')[0].split('(')[0])).toEqual([
      'CREATE FUNCTION public.fn_ofertare_doc_cale_garda',
      'CREATE TRIGGER trg_ofertare_doc_cale_garda BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie ON public.ofertare_parteneri_documente',
      'CREATE UNIQUE INDEX ofertare_parteneri_documente_fisier_path_uq ON public.ofertare_parteneri_documente',
      'CREATE FUNCTION public.fn_ctc_autorizatii_ndt',
      'CREATE FUNCTION public.fn_ctc_autorizatie_ndt_fisier',
    ])
    // fn_ctc_autorizatie_fisier (sudorii) neatinsă
    expect(cod).not.toMatch(/FUNCTION public\.fn_ctc_autorizatie_fisier\(|OR REPLACE/)
  })
  it('garda: SECURITY INVOKER, toate categoriile; regula NDT ancorată pe firma rândului; non-NDT în afara ndt/', () => {
    const g = corp('fn_ofertare_doc_cale_garda')
    expect(MIG).toContain('CREATE FUNCTION public.fn_ofertare_doc_cale_garda() RETURNS trigger\nLANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$')
    expect(g).toContain("NEW.fisier_path !~ ('^parteneri/' || NEW.partener_id::text || '/ndt/[^/]+$')")
    expect(g).toContain("ELSIF strpos('/' || NEW.fisier_path, '/ndt/') > 0 THEN")
    expect(g).toContain("'..' = ANY (string_to_array(NEW.fisier_path, '/'))")
    expect(g).toContain('strpos(NEW.fisier_path, chr(92)) > 0')
  })
  it('RPC-urile: DEFINER, predicatul CTC pe auth.uid(), lista doar NDT fără cale / observații / contact; deschiderea reverifică forma', () => {
    const l = corp('fn_ctc_autorizatii_ndt'), f = corp('fn_ctc_autorizatie_ndt_fisier')
    for (const c of [l, f]) expect(c).toContain('IF NOT public.fn_ctc_autorizatii_drept() THEN')
    expect(l).toContain("   WHERE d.categorie = 'autorizatie_ndt';")
    expect(l).toContain("(now() AT TIME ZONE 'Europe/Bucharest')::date")
    expect(l).not.toMatch(/d\.fisier_path::|observatii|contact|denumire/)
    expect(MIG).toContain('RETURNS TABLE (id bigint, firma text, cui text, numar_document text, emitent text, metoda text, data_emitere date, data_valabilitate date,\n               fara_expirare boolean, stare text, are_fisier boolean)')
    expect(f).toContain("   WHERE d.id = p_document_id AND d.categorie = 'autorizatie_ndt'\n     AND d.fisier_path ~ ('^parteneri/' || d.partener_id::text || '/ndt/[^/]+$')")
    expect(f).toContain('  RETURN v_cale;')
    expect(nr(f, 'RAISE EXCEPTION')).toBe(1)
  })
  it('revenirea: corp_md5 = corpurile migrării; ordinea din specificație; refuz pe date NDT; absența tuturor obiectelor la final', () => {
    for (const [et, fn] of [['garda', 'fn_ofertare_doc_cale_garda'], ['lista', 'fn_ctc_autorizatii_ndt'], ['fisierul', 'fn_ctc_autorizatie_ndt_fisier']]) {
      const bloc = REV.slice(REV.indexOf(`-- DETALIU-START ${et}\n`), REV.indexOf(`-- DETALIU-END ${et}\n`))
      expect(bloc, et).toContain(`'corp_md5', '${md5(corp(fn))}'`)
    }
    const cod = fara(REV)
    const pasi = ['ALTER TABLE public.ofertare_parteneri_documente DROP CONSTRAINT', 'DROP TRIGGER trg_ofertare_doc_cale_garda', 'DROP FUNCTION public.fn_ofertare_doc_cale_garda()',
      'DROP INDEX public.ofertare_parteneri_documente_fisier_path_uq', 'DROP FUNCTION public.fn_ctc_autorizatie_ndt_fisier(bigint)', 'DROP FUNCTION public.fn_ctc_autorizatii_ndt()']
    const poz = pasi.map(p => cod.indexOf(p))
    expect(poz.every(p => p > 0)).toBe(true)
    expect([...poz].sort((a, b) => a - b)).toEqual(poz)
    expect(cod.indexOf('LOCK TABLE public.ofertare_parteneri_documente IN ACCESS EXCLUSIVE MODE NOWAIT;')).toBeLessThan(cod.indexOf("count(*) FILTER (WHERE categorie = 'autorizatie_ndt')"))
    expect(cod).not.toMatch(/CASCADE|DELETE FROM|TRUNCATE|DROP (TABLE|POLICY|VIEW)/)
    expect(REV).toContain("revenire post: au ramas obiecte")
  })
})

describe('ecranul Parteneri (static)', () => {
  it('categoria nouă, eticheta metodei, calea prin regula comună, blocarea fără fișier nou', () => {
    expect(UI_OF).toContain("autorizatie_ndt:  '🔬 Autorizație control nedistructiv (NDT)',")
    expect(UI_OF).toContain("(categorie === CATEGORIE_NDT ? 'Metoda (RT/UT/PT/MT/VT)' : 'Domeniu')")
    expect(UI_OF).toContain('const plan = pregatesteSalvare({ d, categorie: f.categorie, file, pid, timp: Date.now() })')
    expect(UI_OF).toContain('disabled={busy || cereFisierNou}')
    expect(UI_OF).not.toMatch(/`parteneri\/\$\{pid\}\/\$\{Date\.now\(\)\}/)
    // fișierul vechi se șterge DOAR după salvarea reușită; cel nou doar la eșec cert
    expect(UI_OF.indexOf('if (plan.urca && esecCert(rez))')).toBeLessThan(UI_OF.indexOf('if (plan.urca && d.fisier_path && d.fisier_path !== fisier_path)'))
  })
})
