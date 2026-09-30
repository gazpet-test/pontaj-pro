// Garda citirii automate Ofertare (docs/INGEST_GARDA.md): poarta de rol + contorul (logica pură comună edge/worker).
import { describe, it, expect } from 'vitest'
import { GARDA, egalTimpConstant, identificaApelant, decizieInainte, acelasiObiect, dejaIngeratLaHash, backoffSec, dupaRezultat, sha256Hex } from '../supabase/functions/_shared/gardaIngestLogica.ts'

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
  it('eșecuri consecutive → blocat la plafon (o singură dată blocat_acum); succesul resetează', () => {
    let s = st()
    const blocari = []
    for (let i = 0; i < GARDA.maxIncercari + 2; i++) { s = dupaRezultat(s, false, ACUM); blocari.push(s.blocat_acum) }
    expect(s.blocat).toBe(true)
    expect(blocari.filter(Boolean).length).toBe(1)
    const r = dupaRezultat(st({ incercari_esuate: 3, urmatoarea_dupa: 'x' }), true, ACUM)
    expect([r.incercari_esuate, r.urmatoarea_dupa, r.blocat]).toEqual([0, null, false])
  })
  it('succesul nu deblochează un document blocat', () => expect(dupaRezultat(st({ blocat: true }), true, ACUM).blocat).toBe(true))
  it('sha256Hex', async () => expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'))
})
