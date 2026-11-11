// #939 r3: CAS-ul formularului de autorizare Transgaz — rândul din BD trebuie să fie exact cel văzut de formular
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase.js', () => ({ supabase: {} }))
import { autorizareSchimbata, caleAutorizare, areAutorizare, PATCH_GOLIRE, golesteAutorizare, textConfirmareGolire } from './AutorizareTgz.jsx'

describe('AutorizareTgz — CAS și calea PDF-ului', () => {
  const baza = { versiune: 7, autorizare_tgz_nr: '1', autorizare_tgz_data: '2026-11-05', autorizare_tgz_fisier: 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_a.pdf' }
  it('același rând → nu e schimbat; orice câmp / versiune diferită sau rând lipsă → schimbat', () => {
    expect(autorizareSchimbata(baza, { ...baza, id: 'x', cod: 'LOT1-PRUNISOR-JUPA' })).toBe(false)
    expect(autorizareSchimbata(baza, { ...baza, versiune: 8 })).toBe(true)
    for (const k of ['autorizare_tgz_nr', 'autorizare_tgz_data', 'autorizare_tgz_fisier']) expect(autorizareSchimbata(baza, { ...baza, [k]: null }), k).toBe(true)
    expect(autorizareSchimbata(baza, null)).toBe(true)
    expect(autorizareSchimbata({ versiune: 1 }, { versiune: 1, autorizare_tgz_nr: undefined })).toBe(false)
  })
  it('calea respectă CHECK-ul din 20261130m: <cod>/autorizare_tgz/<nume>.pdf, doar [A-Za-z0-9_.-], fără „..”', () => {
    const rx = /^[A-Za-z0-9_-]+\/autorizare_tgz\/[A-Za-z0-9_.-]+[.]pdf$/
    for (const n of ['Autorizare TGZ nr. 12/2026.pdf', 'ăîșțâ.PDF', '../../x.pdf', '', '...pdf']) {
      const c = caleAutorizare('LOT1-PRUNISOR-JUPA', n, 1)
      expect(c, n).toMatch(rx)
      expect(c.includes('..'), n).toBe(false)
    }
  })
})

// Test 07.11.2026: autorizarea se poate goli din ERP (owner); garda din BD o permitea, ecranul nu avea calea
describe('AutorizareTgz — golirea', () => {
  it('areAutorizare: oricare câmp completat → da; toate goale / spații / lipsă → nu', () => {
    expect(areAutorizare({ autorizare_tgz_nr: 'TEST-AUT-0001 (FICTIV)', autorizare_tgz_data: '2026-11-07', autorizare_tgz_fisier: null })).toBe(true)   // cazul TEST-RAZVAN, fără PDF
    expect(areAutorizare({ autorizare_tgz_fisier: 'TEST-RAZVAN/autorizare_tgz/1_a.pdf' })).toBe(true)
    expect(areAutorizare({ autorizare_tgz_nr: ' ', autorizare_tgz_data: null })).toBe(false)
    expect(areAutorizare({})).toBe(false)
    expect(areAutorizare(null)).toBe(false)
  })
  it('patch-ul golește exact cele trei câmpuri scrise de owner (_obiect / _etag le golește serverul când fisier e NULL)', () => {
    expect(PATCH_GOLIRE).toEqual({ autorizare_tgz_nr: null, autorizare_tgz_data: null, autorizare_tgz_fisier: null })
    expect(Object.isFrozen(PATCH_GOLIRE)).toBe(true)
  })
  it('după golire, CAS-ul vede rândul ca schimbat față de baza veche (o salvare veche nu-l mai rescrie)', () => {
    const baza = { versiune: 3, autorizare_tgz_nr: 'X', autorizare_tgz_data: '2026-11-07', autorizare_tgz_fisier: null }
    expect(autorizareSchimbata(baza, { versiune: 4, ...PATCH_GOLIRE })).toBe(true)
  })
})

// Jakarinos r1 P2 (L25): acțiunea de golire, cu client simulat
describe('golesteAutorizare', () => {
  const baza = { versiune: 3, autorizare_tgz_nr: 'TEST-AUT-0001 (FICTIV)', autorizare_tgz_data: '2026-11-07', autorizare_tgz_fisier: null }
  const client = ({ citire = { data: { ...baza }, error: null }, update = { data: [{ versiune: 4 }], error: null }, aruncaUpdate = false } = {}) => {
    const jurnal = []
    const q = tabel => {
      const st = { op: 'select' }
      const o = {
        select: () => o, eq: (k, v) => { jurnal.push(['eq', k, v]); return o },
        maybeSingle: async () => citire,
        update: patch => { st.op = 'update'; jurnal.push(['update', tabel, patch]); return o },
        then: (r, rj) => (aruncaUpdate ? Promise.reject(new Error('timeout')) : Promise.resolve(update)).then(r, rj),
      }
      return o
    }
    return { from: q, jurnal }
  }
  const apel = (c, o = {}) => golesteAutorizare({ client: c, proiectId: 'p1', cod: 'TEST-RAZVAN', baza, confirma: () => true, ...o })
  it('succes → golit, UPDATE cu patch-ul exact și CAS pe versiunea văzută, recitire', async () => {
    const c = client(); const r = await apel(c)
    expect(r).toEqual({ stare: 'golit', recitire: true })
    expect(c.jurnal).toContainEqual(['update', 'red_proiecte', PATCH_GOLIRE])
    expect(c.jurnal).toContainEqual(['eq', 'versiune', 3])
  })
  it('confirmarea refuzată → anulat, nicio citire / scriere; textul numește proiectul și efectele', async () => {
    const c = client(); let text = ''
    expect(await apel(c, { confirma: t => { text = t; return false } })).toEqual({ stare: 'anulat', recitire: false })
    expect(c.jurnal).toEqual([])
    expect(text).toBe(textConfirmareGolire('TEST-RAZVAN')); expect(text).toMatch(/TEST-RAZVAN/); expect(text).toMatch(/expedierii/)
  })
  it('nimic de golit → nimic, fără confirmare', async () => {
    let intrebat = false
    expect(await golesteAutorizare({ client: client(), proiectId: 'p1', cod: 'X', baza: { versiune: 1 }, confirma: () => { intrebat = true; return true } })).toEqual({ stare: 'nimic', recitire: false })
    expect(intrebat).toBe(false)
  })
  it('rândul s-a schimbat între timp → conflict, fără UPDATE', async () => {
    const c = client({ citire: { data: { ...baza, versiune: 9 }, error: null } })
    expect(await apel(c)).toEqual({ stare: 'conflict', recitire: true })
    expect(c.jurnal.some(x => x[0] === 'update')).toBe(false)
  })
  it('CAS cu 0 rânduri → conflict + recitire', async () => {
    expect(await apel(client({ update: { data: [], error: null } }))).toEqual({ stare: 'conflict', recitire: true })
  })
  it('timeout / 5xx după UPDATE → necunoscut + recitire (nu „eșuat”); 4xx → eroare + recitire', async () => {
    expect(await apel(client({ aruncaUpdate: true }))).toMatchObject({ stare: 'necunoscut', recitire: true })
    expect(await apel(client({ update: { data: null, error: { message: 'x' }, status: 503 } }))).toMatchObject({ stare: 'necunoscut', recitire: true })
    expect(await apel(client({ update: { data: null, error: { code: '42501', message: 'doar owner-ul' }, status: 403 } }))).toMatchObject({ stare: 'eroare', recitire: true })
  })
  it('contextul s-a schimbat înainte de UPDATE (proiect reîncărcat) → conflict, fără scriere', async () => {
    const c = client()
    expect(await apel(c, { contextSchimbat: () => true })).toEqual({ stare: 'conflict', recitire: true })
    expect(c.jurnal.some(x => x[0] === 'update')).toBe(false)
  })
})
