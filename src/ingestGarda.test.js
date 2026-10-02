// Garda citirii automate Ofertare (docs/INGEST_GARDA.md): poarta de rol + contorul (logica pură comună edge/worker).
// Runda 2: lease/token (oglinda SQL), exact-once (deschideIncercare / cuIncercare / plasaExactOnce), egress mărginit.
import { describe, it, expect } from 'vitest'
import { GARDA, egalTimpConstant, identificaApelant, decizieInainte, acelasiObiect, dejaIngeratLaHash, backoffSec, dupaRezultat, sha256Hex,
  deschideIncercare, cuIncercare, plasaExactOnce, cuTermen, opritDeGarda, leaseActiv, inchideAbandonata, egressMaximDocumentBytes } from '../supabase/functions/_shared/gardaIngestLogica.ts'

const SECRET = 's'.repeat(40)
const hdr = (o) => new Headers(o)
const deps = (over = {}) => {
  const n = { getUser: 0, areAcces: 0 }
  return { n, d: {
    secretAsteptat: SECRET,
    getUser: async (jwt) => { n.getUser++; return jwt === 'jwt-user' || jwt === 'jwt-fara-modul' ? 'uid-1' : null },
    areAcces: async (jwt) => { n.areAcces++; return jwt === 'jwt-user' },
    ...over,
  } }
}

describe('poarta de rol (1)', () => {
  it('egalTimpConstant', () => {
    expect(egalTimpConstant(SECRET, SECRET)).toBe(true)
    expect(egalTimpConstant(SECRET + 'x', SECRET)).toBe(false)
    expect(egalTimpConstant('', SECRET)).toBe(false)
    expect(egalTimpConstant('', '')).toBe(false)
    expect(egalTimpConstant('t' + SECRET.slice(1), SECRET)).toBe(false)
  })
  it('secret corect → serviciu, fără Auth', async () => {
    const { n, d } = deps()
    expect(await identificaApelant(hdr({ 'x-ingest-secret': SECRET }), d)).toEqual({ tip: 'serviciu' })
    expect(n.getUser).toBe(0)
  })
  it('secret greșit → 401, nu cade pe JWT', async () => {
    const { n, d } = deps()
    const r = await identificaApelant(hdr({ 'x-ingest-secret': 'gresit', authorization: 'Bearer jwt-user' }), d)
    expect(r).toMatchObject({ tip: 'refuz', status: 401 }); expect(n.getUser).toBe(0)
  })
  it('secret neconfigurat sau scurt → 401 chiar dacă headerul e gol', async () => {
    for (const s of [undefined, '', 'scurt']) {
      const { d } = deps({ secretAsteptat: s })
      expect(await identificaApelant(hdr({ 'x-ingest-secret': s ?? '' }), d)).toMatchObject({ tip: 'refuz', status: 401 })
    }
  })
  it('cheia anon / service_role ca Bearer (fără secret) → 401: nu sunt identități de utilizator', async () => {
    const { d } = deps()
    const payload = btoa(JSON.stringify({ role: 'service_role' }))
    for (const jwt of ['anon-key', `x.${payload}.y`]) expect(await identificaApelant(hdr({ authorization: `Bearer ${jwt}` }), d)).toMatchObject({ tip: 'refuz', status: 401 })
  })
  it('fără Authorization / header invalid → 401 fără apel Auth', async () => {
    for (const a of [undefined, 'Bearer', 'Basic x', 'jwt-user']) {
      const { n, d } = deps()
      expect(await identificaApelant(hdr(a ? { authorization: a } : {}), d)).toMatchObject({ tip: 'refuz', status: 401 })
      expect(n.getUser).toBe(0)
    }
  })
  it('utilizator fără modulul Ofertare → 403; cu modul → utilizator', async () => {
    const { d } = deps()
    expect(await identificaApelant(hdr({ authorization: 'Bearer jwt-fara-modul' }), d)).toMatchObject({ tip: 'refuz', status: 403 })
    expect(await identificaApelant(hdr({ authorization: 'Bearer jwt-user' }), d)).toEqual({ tip: 'utilizator', uid: 'uid-1' })
  })
  it('Auth / RPC care aruncă → refuz (fail-closed)', async () => {
    const a = deps({ getUser: async () => { throw new Error('x') } }).d
    expect(await identificaApelant(hdr({ authorization: 'Bearer jwt-user' }), a)).toMatchObject({ status: 401 })
    const b = deps({ areAcces: async () => { throw new Error('x') } }).d
    expect(await identificaApelant(hdr({ authorization: 'Bearer jwt-user' }), b)).toMatchObject({ status: 403 })
  })
})

const ACUM = new Date('2026-09-30T10:00:00Z')
const st = (o = {}) => ({ incercari_esuate: 0, descarcari: 0, blocat: false, urmatoarea_dupa: null, ingerat_hash: null, ingerat_size: null, ingerat_etag: null, ...o })

describe('contor + scurtcircuit (2)(3)', () => {
  it('document nou → continua', () => expect(decizieInainte(null, null, false, ACUM)).toEqual({ actiune: 'continua' }))
  it('blocat rămâne blocat (doar om)', () => expect(decizieInainte(st({ blocat: true }), null, false, ACUM).actiune).toBe('blocat'))
  it('plafon descărcări / eșecuri → blocat', () => {
    expect(decizieInainte(st({ descarcari: GARDA.maxDescarcari }), null, false, ACUM).actiune).toBe('blocat')
    expect(decizieInainte(st({ incercari_esuate: GARDA.maxIncercari }), null, false, ACUM).actiune).toBe('blocat')
    expect(decizieInainte(st({ descarcari: GARDA.maxDescarcari - 1 }), null, false, ACUM).actiune).toBe('continua')
  })
  it('backoff în curs → asteapta; expirat → continua', () => {
    expect(decizieInainte(st({ urmatoarea_dupa: '2026-09-30T10:05:00Z' }), null, false, ACUM).actiune).toBe('asteapta')
    expect(decizieInainte(st({ urmatoarea_dupa: '2026-09-30T09:59:00Z' }), null, false, ACUM).actiune).toBe('continua')
  })
  it('același obiect (mărime + etag) pe document încheiat → deja_ingerat, fără descărcare', () => {
    const s = st({ ingerat_size: 100, ingerat_etag: '"abc"' })
    expect(decizieInainte(s, { size: 100, etag: 'W/"abc"' }, true, ACUM).actiune).toBe('deja_ingerat')
    expect(decizieInainte(s, { size: 100, etag: '"abc"' }, false, ACUM).actiune).toBe('continua')
    expect(decizieInainte(s, { size: 101, etag: '"abc"' }, true, ACUM).actiune).toBe('continua')
  })
  it('fără etag, mărimea singură NU e dovadă', () => expect(acelasiObiect({ ingerat_size: 100, ingerat_etag: null }, { size: 100, etag: null })).toBe(false))
  it('hash identic doar pe document încheiat', () => {
    expect(dejaIngeratLaHash(st({ ingerat_hash: 'h' }), 'h', true)).toBe(true)
    expect(dejaIngeratLaHash(st({ ingerat_hash: 'h' }), 'h', false)).toBe(false)
    expect(dejaIngeratLaHash(st({ ingerat_hash: 'h' }), 'x', true)).toBe(false)
  })
  it('backoff exponențial plafonat', () => {
    expect([0, 1, 2, 3].map(n => backoffSec(n))).toEqual([0, 60, 120, 240])
    expect(backoffSec(30)).toBe(GARDA.backoffMaxSec)
  })
  it('eșecuri consecutive → blocat la plafon (o singură dată blocat_acum); succesul/progresul resetează', () => {
    let s = st()
    const blocari = []
    for (let i = 0; i < GARDA.maxIncercari + 2; i++) { s = dupaRezultat(s, 'esec', ACUM); blocari.push(s.blocat_acum) }
    expect(s.blocat).toBe(true)
    expect(blocari.filter(Boolean).length).toBe(1)
    for (const r of ['succes', 'progres']) {
      const x = dupaRezultat(st({ incercari_esuate: 3, urmatoarea_dupa: 'x', incercare_token: 't', in_curs_pana: 'y' }), r, ACUM)
      expect([x.incercari_esuate, x.urmatoarea_dupa, x.blocat, x.incercare_token, x.in_curs_pana]).toEqual([0, null, false, null, null])
    }
  })
  it('predat: lease eliberat, contoarele NEATINSE', () => {
    const x = dupaRezultat(st({ incercari_esuate: 3, urmatoarea_dupa: null, incercare_token: 't', in_curs_pana: 'y' }), 'predat', ACUM)
    expect([x.incercari_esuate, x.blocat, x.incercare_token]).toEqual([3, false, null])
  })
  it('succesul nu deblochează un document blocat', () => expect(dupaRezultat(st({ blocat: true }), 'succes', ACUM).blocat).toBe(true))
  it('sha256Hex', async () => expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'))
})

describe('lease + token (2) — oglinda SQL', () => {
  const PANA = '2026-09-30T10:05:00Z', TRECUT = '2026-09-30T09:59:50Z'
  it('lease activ → in_curs, fără numărare; blocat are prioritate', () => {
    expect(decizieInainte(st({ incercare_token: 't', in_curs_pana: PANA }), null, false, ACUM)).toMatchObject({ actiune: 'in_curs', pana_la: PANA })
    expect(decizieInainte(st({ blocat: true, incercare_token: 't', in_curs_pana: PANA }), null, false, ACUM).actiune).toBe('blocat')
  })
  it('lease expirat → abandonat = eșec +1, backoff de la EXPIRARE (60 s): 10 s în urmă → asteapta; 5 min în urmă → continua', () => {
    const s = inchideAbandonata(st({ incercare_token: 't', in_curs_pana: TRECUT }))
    expect([s.incercari_esuate, s.incercare_token, s.urmatoarea_dupa]).toEqual([1, null, '2026-09-30T10:00:50.000Z'])
    expect(decizieInainte(st({ incercare_token: 't', in_curs_pana: TRECUT }), null, false, ACUM).actiune).toBe('asteapta')
    expect(decizieInainte(st({ incercare_token: 't', in_curs_pana: '2026-09-30T09:55:00Z' }), null, false, ACUM).actiune).toBe('continua')
  })
  it('al 5-lea abandon → blocat', () =>
    expect(decizieInainte(st({ incercari_esuate: GARDA.maxIncercari - 1, incercare_token: 't', in_curs_pana: '2026-09-30T08:00:00Z' }), null, false, ACUM).actiune).toBe('blocat'))
  it('filtrul de candidați al workerului: blocat / backoff / lease activ = oprit; lease expirat = candidat (decide _incearca)', () => {
    expect(opritDeGarda(st({ blocat: true }), ACUM)).toBe(true)
    expect(opritDeGarda(st({ urmatoarea_dupa: PANA }), ACUM)).toBe(true)
    expect(opritDeGarda(st({ incercare_token: 't', in_curs_pana: PANA }), ACUM)).toBe(true)
    expect(opritDeGarda(st({ incercare_token: 't', in_curs_pana: TRECUT }), ACUM)).toBe(false)
    expect(opritDeGarda(st(), ACUM)).toBe(false)
    expect(leaseActiv(null, ACUM)).toBe(false)
  })
  it('lease-ul (10 min) acoperă o invocare edge întreagă (400 s pe Pro)', () => expect(GARDA.leaseSec).toBeGreaterThan(400))
})

describe('exact-once (3): fiecare încercare acordată se închide cu EXACT un _rezultat', () => {
  const fals = () => { const trimise = []; return { trimise, trimite: async (token, r) => { trimise.push({ token, ...r }) } } }
  it('închidere explicită → un singur RPC; a doua închidere (alt drum, finally) nu mai trimite nimic', async () => {
    const f = fals(), inc = deschideIncercare('T1', f.trimite)
    expect(await inc.inchide({ rezultat: 'succes', hash: 'h' })).toBe(true)
    expect(await inc.inchide({ rezultat: 'esec', eroare: 'x' })).toBe(false)
    expect(await plasaExactOnce(inc)).toBe(false)
    expect(f.trimise).toEqual([{ token: 'T1', rezultat: 'succes', hash: 'h' }])
  })
  it('închideri CONCURENTE (fără await între ele) → tot un singur RPC', async () => {
    const f = fals(), inc = deschideIncercare('T2', f.trimite)
    await Promise.all([inc.inchide({ rezultat: 'progres' }), inc.inchide({ rezultat: 'esec' }), plasaExactOnce(inc)])
    expect(f.trimise.map(x => x.rezultat)).toEqual(['progres'])
  })
  it('cuIncercare: excepție aruncată ÎNAINTE de închidere → esec cu mesajul excepției, apoi excepția se re-aruncă', async () => {
    const f = fals(), inc = deschideIncercare('T3', f.trimite)
    await expect(cuIncercare(inc, async () => { throw new Error('pdftotext a căzut') })).rejects.toThrow('pdftotext a căzut')
    expect(f.trimise).toEqual([{ token: 'T3', rezultat: 'esec', eroare: 'excepție: pdftotext a căzut', doc: null }])
  })
  it('cuIncercare: excepție DUPĂ închidere (ex. drumul predat → citesteCuAI aruncă) → nimic în plus trimis', async () => {
    const f = fals(), inc = deschideIncercare('T4', f.trimite)
    await expect(cuIncercare(inc, async (i) => { await i.inchide({ rezultat: 'predat' }); throw new Error('edge') })).rejects.toThrow('edge')
    expect(f.trimise.map(x => x.rezultat)).toEqual(['predat'])
  })
  it('cuIncercare: ieșire fără închidere explicită → plasa trimite esec o dată', async () => {
    const f = fals(), inc = deschideIncercare('T5', f.trimite)
    expect(await cuIncercare(inc, async () => 'gata')).toBe('gata')
    expect(f.trimise).toEqual([{ token: 'T5', rezultat: 'esec', eroare: 'încercare încheiată fără rezultat explicit' }])
  })
  it('RPC-ul de rezultat care aruncă nu maschează rezultatul drumului și nu produce o a doua trimitere', async () => {
    let n = 0
    const inc = deschideIncercare('T6', async () => { n++; throw new Error('rețea') })
    expect(await cuIncercare(inc, async (i) => { await i.inchide({ rezultat: 'succes' }); return 'ok' })).toBe('ok')
    expect(n).toBe(1)
    expect(inc.raport).toEqual({ rezultat: 'succes' })
  })
})

describe('egress mărginit (4)', () => {
  it('plafon per document pe calea edge = 80 × 60 MiB = 4 800 MiB (5 033 164 800 B)', () => {
    expect(GARDA.maxDescarcari * GARDA.pragEdgeBytes / 1048576).toBe(4800)
    expect(egressMaximDocumentBytes()).toBe(5_033_164_800)
  })
})

describe('runda 3', () => {
  it('J2: inchide păstrează răspunsul serverului; marcheaza trimite „marcaj” fără să închidă, apoi nimic după închidere', async () => {
    const trimise = []
    const inc = deschideIncercare('T7', async (token, r) => { trimise.push(r.rezultat); return { acceptat: r.rezultat !== 'progres' } })
    expect(await inc.marcheaza({ status_procesare: 'in_lucru' })).toEqual({ acceptat: true })
    expect(inc.inchisa).toBe(false)
    await inc.inchide({ rezultat: 'progres', doc: { pagini_procesate: 2 } })
    expect(inc.raspuns).toEqual({ acceptat: false })   // server: token respins ⇒ apelantul NU raportează „salvat”
    expect(await inc.marcheaza({})).toBe(null)
    expect(trimise).toEqual(['marcaj', 'progres'])
  })
  it('J2: excepția închide cu docLaEsec (status eroare scris atomic sub token)', async () => {
    const trimise = []
    const inc = deschideIncercare('T8', async (token, r) => { trimise.push(r) })
    await expect(cuIncercare(inc, async () => { throw new Error('x') }, (m) => ({ status_procesare: 'eroare', eroare: 'eroare: ' + m }))).rejects.toThrow('x')
    expect(trimise[0].doc).toEqual({ status_procesare: 'eroare', eroare: 'eroare: x' })
  })
  it('J2: cuTermen — operația care depășește termenul aruncă „termen depășit”', async () => {
    await expect(cuTermen(new Promise(() => {}), 20, 'pdftotext')).rejects.toThrow(/termen depășit: pdftotext/)
    expect(await cuTermen(Promise.resolve(5), 1000, 'x')).toBe(5)
  })
  it('marcaj nu schimbă contoarele în oglinda TS', () => {
    const x = dupaRezultat(st({ incercari_esuate: 2, incercare_token: 't', in_curs_pana: 'y' }), 'marcaj', ACUM)
    expect([x.incercari_esuate, x.incercare_token]).toEqual([2, 't'])
  })
})
