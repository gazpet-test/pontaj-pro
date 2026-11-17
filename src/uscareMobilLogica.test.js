// Logica pură pentru „Uscare conductă” din lansatorul de telefon (src/uscareMobilLogica.js). Date SINTETICE.
import { describe, it, expect } from 'vitest'
import { candidatiUscare, ordoneazaProiecte, stareDinDrepturi, drumUscare, inParalel, etichetaProiect } from './uscareMobilLogica.js'

const P = (id, extra = {}) => ({ id, nume: `Proiect ${id}`, cod_intern: `C${id}`, activ: true, ...extra })

describe('candidatiUscare', () => {
  it('active + cele din arhivă cu uscări deschise; arhiva fără uscări deschise nu intră', () => {
    const c = candidatiUscare([P(1), P(2, { activ: false }), P(3, { activ: false }), P(4, { activ: null })], [{ proiect_id: 3 }, { proiect_id: 3 }, { proiect_id: 1 }])
    expect(c.map(x => [x.id, x.activ, x.deschise])).toEqual([[1, true, 1], [3, false, 2], [4, true, 0]])
  })
  it('id-uri invalide și dubluri sunt ignorate; intrare lipsă = listă goală', () => {
    expect(candidatiUscare([P(0), P('x'), P(5), P(5)], null).map(x => x.id)).toEqual([5])
    expect(candidatiUscare(null, null)).toEqual([])
  })
})

describe('ordoneazaProiecte', () => {
  it('întâi cele cu uscări deschise, apoi active, apoi arhivă; în grup după nume', () => {
    const l = ordoneazaProiecte([
      { id: 1, nume: 'Beta', cod: '', activ: true, deschise: 0 },
      { id: 2, nume: 'Alfa', cod: '', activ: true, deschise: 0 },
      { id: 3, nume: 'Zeta', cod: '', activ: false, deschise: 1 },
      { id: 4, nume: 'Gama', cod: '', activ: false, deschise: 0 },
      { id: 5, nume: 'Delta', cod: '', activ: true, deschise: 2 },
    ])
    expect(l.map(x => x.id)).toEqual([5, 3, 2, 1, 4])
  })
  it('eticheta: cod — nume, altfel id-ul', () => {
    expect(etichetaProiect({ id: 7, cod: 'C7', nume: 'Lot' })).toBe('C7 — Lot')
    expect(etichetaProiect({ id: 7, cod: '', nume: '' })).toBe('Proiectul 7')
  })
})

describe('stareDinDrepturi + drumUscare', () => {
  const cand = candidatiUscare([P(1), P(2), P(3, { activ: false })], [{ proiect_id: 3 }])
  it('niciun drept -> fără buton', () => {
    const s = stareDinDrepturi(cand, cand.map(c => ({ id: c.id, data: false, error: null })))
    expect(s).toMatchObject({ stare: 'gata', proiecte: [], incomplet: false })
    expect(drumUscare(s).tip).toBe('niciunul')
  })
  it('un singur proiect activ cu drept -> direct', () => {
    const s = stareDinDrepturi(cand, [{ id: 1, data: false }, { id: 2, data: true }, { id: 3, data: false }])
    expect(drumUscare(s)).toEqual({ tip: 'direct', proiectId: 2 })
  })
  it('un singur proiect cu drept, dar din arhivă -> lista (nu direct)', () => {
    const s = stareDinDrepturi(cand, [{ id: 1, data: false }, { id: 2, data: false }, { id: 3, data: true }])
    expect(drumUscare(s).tip).toBe('lista')
  })
  it('mai multe -> lista, ordonată (cel cu uscare deschisă sus)', () => {
    const s = stareDinDrepturi(cand, cand.map(c => ({ id: c.id, data: true })))
    expect(drumUscare(s).tip).toBe('lista')
    expect(s.proiecte.map(p => p.id)).toEqual([3, 1, 2])
  })
  it('L18: o eroare nu e „fără drept”: toate eșuate = stare de eroare; parțial = listă marcată incompletă, fără drum direct', () => {
    const toate = stareDinDrepturi(cand, cand.map(c => ({ id: c.id, data: null, error: { message: 'Failed to fetch' } })))
    expect(toate).toMatchObject({ stare: 'eroare', eroare: 'Failed to fetch' })
    expect(drumUscare(toate).tip).toBe('niciunul')
    const partial = stareDinDrepturi(cand, [{ id: 1, data: true }, { id: 2, data: null, error: { message: 'x' } }, { id: 3, data: false }])
    expect(partial).toMatchObject({ stare: 'gata', incomplet: true, erori: [2] })
    expect(drumUscare(partial).tip).toBe('lista')
  })
  it('răspuns care nu e boolean sau candidat fără rezultat = necunoscut', () => {
    const s = stareDinDrepturi(cand, [{ id: 1, data: 'true' }, { id: 2, data: true }])
    expect(s.erori.sort()).toEqual([1, 3])
    expect(s.incomplet).toBe(true)
  })
})

describe('inParalel', () => {
  it('cel mult n deodată, ordinea rezultatelor = ordinea intrării', async () => {
    let acum = 0, max = 0
    const r = await inParalel([1, 2, 3, 4, 5, 6, 7], 3, async x => { acum++; max = Math.max(max, acum); await new Promise(res => setTimeout(res, 1)); acum--; return x * 2 })
    expect(r).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(max).toBeLessThanOrEqual(3)
  })
  it('viu() = false oprește pornirea altor apeluri', async () => {
    let n = 0, viu = true
    await inParalel([1, 2, 3, 4], 1, async () => { n++; viu = false }, () => viu)
    expect(n).toBe(1)
  })
})
