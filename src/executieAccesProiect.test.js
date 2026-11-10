// Acces pe proiect în Execuție (20261209a): logica din UI. Cazurile vin din regula scrisă în decizie (owner = tot; fără rânduri = tot;
// cu rânduri = doar acestea; eroare != fără rânduri), nu din cod.
import { describe, it, expect } from 'vitest'
import {
  stareAcces, filtreazaProiecte, verdictLinkProiect, listaPentruRpc, listaDinRanduri, diferenteAcces, rezultatSetare,
} from './executieAccesProiect.js'

const PROIECTE = [{ id: 1, cod_intern: 'LOT1' }, { id: 2, cod_intern: 'LOT2' }, { id: 3, cod_intern: 'DOMNESTI' }]
const restrans = stareAcces({ gata: true, eOwner: false, randuri: [{ proiect_id: 1, nivel: 'editor' }, { proiect_id: 2, nivel: 'viewer' }] })

describe('stareAcces', () => {
  it('încărcarea nu e „vede tot” și nici „nimic”', () => {
    expect(stareAcces({ gata: false }).stare).toBe('incarcare')
  })
  it('cont fără rânduri = nerestrâns (ca azi)', () => {
    expect(stareAcces({ gata: true, eOwner: false, randuri: [] }).stare).toBe('nerestrans')
  })
  it('owner = nerestrâns chiar dacă ar avea rânduri', () => {
    expect(stareAcces({ gata: true, eOwner: true, randuri: [{ proiect_id: 1, nivel: 'viewer' }] }).stare).toBe('nerestrans')
  })
  it('cont cu 2 proiecte: citire pe ambele, scriere doar pe cel „editor”', () => {
    expect(restrans.stare).toBe('restrans')
    expect([...restrans.permise].sort()).toEqual([1, 2])
    expect([...restrans.scriere]).toEqual([1])
  })
  it('eroarea la citire NU e „fără rânduri” (L18)', () => {
    const a = stareAcces({ gata: true, eroare: 'timeout', randuri: [] })
    expect(a.stare).toBe('eroare')
    expect(a.permise.size).toBe(0)
  })
  it('răspuns fără listă sau cu rând invalid = eroare, nu „vede tot”', () => {
    expect(stareAcces({ gata: true, eOwner: false, randuri: null }).stare).toBe('eroare')
    expect(stareAcces({ gata: true, eOwner: false, randuri: [{ proiect_id: 'x', nivel: 'editor' }] }).stare).toBe('eroare')
    expect(stareAcces({ gata: true, eOwner: false, randuri: [{ proiect_id: 1, nivel: 'admin' }] }).stare).toBe('eroare')
  })
})

describe('filtreazaProiecte', () => {
  it('nerestrâns: lista întreagă', () => {
    expect(filtreazaProiecte(PROIECTE, stareAcces({ gata: true, eOwner: false, randuri: [] })).map(p => p.id)).toEqual([1, 2, 3])
  })
  it('restrâns: doar proiectele listate (al treilea dispare)', () => {
    expect(filtreazaProiecte(PROIECTE, restrans).map(p => p.id)).toEqual([1, 2])
  })
  it('id-uri ca text din view tot se potrivesc', () => {
    expect(filtreazaProiecte([{ id: '2' }, { id: '3' }], restrans).map(p => p.id)).toEqual(['2'])
  })
  it('eroare / încărcare: lista serverului (filtrată de RLS) rămâne, eroarea se afișează separat', () => {
    expect(filtreazaProiecte(PROIECTE, stareAcces({ gata: true, eroare: 'x' })).length).toBe(3)
    expect(filtreazaProiecte(PROIECTE, stareAcces({ gata: false })).length).toBe(3)
    expect(filtreazaProiecte(null, restrans)).toEqual([])
  })
})

describe('verdictLinkProiect (link direct ?proiect=)', () => {
  it('proiect nepermis unui cont restrâns = „interzis”, chiar înainte să răspundă serverul', () => {
    expect(verdictLinkProiect('3', restrans, undefined, null)).toBe('interzis')
    expect(verdictLinkProiect('3', restrans, null, null)).toBe('interzis')
  })
  it('proiect permis găsit = ok; negăsit = lipsă', () => {
    expect(verdictLinkProiect('1', restrans, { id: 1 }, null)).toBe('ok')
    expect(verdictLinkProiect('2', restrans, null, null)).toBe('lipsa')
  })
  it('nerestrâns: negăsit = lipsă (nu există sau RLS-ul nu-l dă)', () => {
    expect(verdictLinkProiect('99', stareAcces({ gata: true, eOwner: false, randuri: [] }), null, null)).toBe('lipsa')
  })
  it('eroarea cererii = eroare (nu „nu ai acces”)', () => {
    expect(verdictLinkProiect('1', restrans, null, 'rețea')).toBe('eroare')
  })
  it('accesul necitit + proiect negăsit = eroare; accesul necitit + proiect găsit = ok (serverul e poarta)', () => {
    const er = stareAcces({ gata: true, eroare: 'x' })
    expect(verdictLinkProiect('1', er, null, null)).toBe('eroare')
    expect(verdictLinkProiect('1', er, { id: 1 }, null)).toBe('ok')
  })
  it('în așteptare = încărcare', () => {
    expect(verdictLinkProiect('1', restrans, undefined, null)).toBe('incarcare')
    expect(verdictLinkProiect('1', stareAcces({ gata: false }), null, null)).toBe('incarcare')
  })
  it('id invalid în link', () => {
    for (const x of ['', 'abc', '0', '-1', '1.5', '01', null, undefined]) expect(verdictLinkProiect(x, restrans, null, null)).toBe('invalid')
  })
})

describe('ecranul owner-ului', () => {
  it('lista pentru RPC: sortată după proiect, forma exactă din BD', () => {
    expect(listaPentruRpc(new Map([[5, 'viewer'], [2, 'editor']]))).toEqual([{ proiect_id: 2, nivel: 'editor' }, { proiect_id: 5, nivel: 'viewer' }])
    expect(listaPentruRpc(new Map())).toEqual([])
    expect(() => listaPentruRpc(new Map([[2, 'admin']]))).toThrow()
    expect(() => listaPentruRpc(new Map([[0, 'editor']]))).toThrow()
  })
  it('lista văzută a unui cont (pentru CAS) ia doar rândurile lui', () => {
    const r = [{ profile_id: 'a', proiect_id: 3, nivel: 'editor' }, { profile_id: 'b', proiect_id: 1, nivel: 'viewer' }, { profile_id: 'a', proiect_id: 1, nivel: 'viewer' }]
    expect(listaDinRanduri(r, 'a')).toEqual([{ proiect_id: 1, nivel: 'viewer' }, { proiect_id: 3, nivel: 'editor' }])
    expect(listaDinRanduri(r, 'c')).toEqual([])
  })
  it('diferențele: adăugate / scoase / nivel schimbat', () => {
    const d = diferenteAcces([{ proiect_id: 1, nivel: 'editor' }, { proiect_id: 2, nivel: 'viewer' }],
                             [{ proiect_id: 1, nivel: 'viewer' }, { proiect_id: 3, nivel: 'editor' }])
    expect(d).toEqual({ adaugate: [3], scoase: [2], schimbate: [1], nimic: false })
    expect(diferenteAcces([{ proiect_id: 1, nivel: 'editor' }], [{ proiect_id: 1, nivel: 'editor' }]).nimic).toBe(true)
  })
  it('răspunsul RPC: ok / duplicat / conflict / eroare sunt distincte (L18)', () => {
    expect(rezultatSetare({ ok: true, duplicat: false, lista: [{ proiect_id: 1, nivel: 'editor' }] }, null)).toEqual({ tip: 'ok', duplicat: false, lista: [{ proiect_id: 1, nivel: 'editor' }] })
    expect(rezultatSetare({ ok: true, duplicat: true, lista: [] }, null).duplicat).toBe(true)
    expect(rezultatSetare({ ok: false, motiv: 'conflict', lista: [] }, null).tip).toBe('conflict')
    expect(rezultatSetare(null, { message: 'acces proiect: doar owner-ul' })).toEqual({ tip: 'eroare', mesaj: 'acces proiect: doar owner-ul' })
    expect(rezultatSetare({ ok: false, motiv: 'altceva' }, null).tip).toBe('eroare')
    expect(rezultatSetare(undefined, null).tip).toBe('eroare')
  })
})
