import { describe, it, expect } from 'vitest'
import { tipStoc, categorieStare, metri, totaluri, filtreaza, lipsaRegistru } from './izoStoc.js'

const t = (o = {}) => ({ tip_cod: 'teava', serie: '247EK08603', serie_canon: '247EK08603', sarja: 'SA07348', lungime_mm: 12280, perete_mm: 7.1, stare: 'receptionat', depozit_id: 11, tronson_id: null, ...o })

describe('tip și stare', () => {
  it.each([
    [t(), 't71'], [t({ perete_mm: 8.8 }), 't88'], [t({ lungime_mm: 6040 }), 't6m'], [t({ tip_cod: 'curba', lungime_mm: null, perete_mm: 8 }), 'curba'],
  ])('%#', (b, e) => expect(tipStoc(b)).toBe(e))
  it.each([['sosit', 'disponibil'], ['receptionat', 'disponibil'], ['retur', 'disponibil'], ['in_tranzit', 'in_drum'], ['pe_tronson', 'pe_tronson'],
    ['montata', 'montat'], ['rest_nereutilizabil', 'rest'], ['taiata', 'iesit'], ['anulata', 'anulat'], ['ciudat', 'alta']])('%s → %s', (s, c) => expect(categorieStare(s)).toBe(c))
  it('metrii: doar țevi, fără tăiate și anulate', () => {
    expect(metri(t())).toBeCloseTo(12.28)
    expect(metri(t({ stare: 'taiata' }))).toBe(0)
    expect(metri(t({ stare: 'anulata' }))).toBe(0)
    expect(metri(t({ tip_cod: 'curba' }))).toBe(0)
  })
})

describe('totaluri', () => {
  const bucati = [t(), t({ serie: 'A', depozit_id: 9, perete_mm: 8.8, lungime_mm: 12410 }), t({ stare: 'pe_tronson', tronson_id: 21, depozit_id: 10 }),
    t({ tip_cod: 'curba', lungime_mm: null }), t({ stare: 'anulata' })]
  const r = totaluri(bucati, { depozite: { 9: 'JUP', 10: 'ORN', 11: 'TOP' }, tronsoane: { 21: 'T17' } })
  it('pe categorie', () => {
    expect(r.pe.disponibil).toEqual({ n: 3, m: 24.69 })
    expect(r.pe.pe_tronson).toEqual({ n: 1, m: 12.28 })
    expect(r.pe.anulat.n).toBe(1)
  })
  it('pe loc × tip; anulatele nu intră; cele de pe tronson stau pe tronson, nu pe depozit', () => {
    expect(r.matrice['disponibil|TOP']).toEqual({ t71: { n: 1, m: 12.28 }, curba: { n: 1, m: 0 } })
    expect(r.matrice['disponibil|JUP']).toEqual({ t88: { n: 1, m: 12.41 } })
    expect(r.matrice['pe_tronson|T17']).toEqual({ t71: { n: 1, m: 12.28 } })
    expect(Object.keys(r.matrice).some(k => k.startsWith('anulat'))).toBe(false)
  })
})

describe('filtreaza', () => {
  const bucati = [t(), t({ serie: '254CA08543', serie_canon: '254CA08543', depozit_id: 9 }), t({ stare: 'anulata', serie: '254CA00001', serie_canon: '254CA00001' })]
  it('implicit ascunde anulatele', () => expect(filtreaza(bucati).length).toBe(2))
  it('după depozit, tip, categorie', () => {
    expect(filtreaza(bucati, { depozitId: '9' }).length).toBe(1)
    expect(filtreaza(bucati, { tip: 't88' }).length).toBe(0)
    expect(filtreaza(bucati, { categorie: 'anulat' }).length).toBe(1)
  })
  it('căutarea după ultimele cifre sau după șarjă, fără spații / cratime', () => {
    expect(filtreaza(bucati, { cauta: '8543' }).map(b => b.serie)).toEqual(['254CA08543'])
    expect(filtreaza(bucati, { cauta: '254-ca 0854' }).length).toBe(1)
    expect(filtreaza(bucati, { cauta: 'sa07348' }).length).toBe(2)
  })
})

describe('lipsaRegistru (fără fail-open)', () => {
  it('doar funcția / coloana lipsă înseamnă „neinstalat”', () => {
    expect(lipsaRegistru({ code: 'PGRST202', message: 'Could not find the function public.fn_izo_citire' })).toBe(true)
    expect(lipsaRegistru({ code: '42703', message: 'column magazie_bucati.tip_cod does not exist' })).toBe(true)
    expect(lipsaRegistru({ code: '42501', message: 'permission denied for function fn_izo_citire' })).toBe(false)
    expect(lipsaRegistru({ code: 'PGRST202', message: 'Could not find the function public.alta_functie' })).toBe(false)
    expect(lipsaRegistru({ code: '42703', message: 'column magazie_bucati.alta_coloana does not exist' })).toBe(false)
    expect(lipsaRegistru({ code: '42883', message: 'function public.fn_izo_proiecte_protejate() does not exist' })).toBe(true)
    expect(lipsaRegistru({ message: 'Failed to fetch' })).toBe(false)
    expect(lipsaRegistru(null)).toBe(false)
  })
})
