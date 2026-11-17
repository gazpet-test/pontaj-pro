// Logica pură pentru „Uscare conductă” din lansatorul de telefon (src/uscareMobilLogica.js). Date SINTETICE.
import { describe, it, expect } from 'vitest'
import { candidatiUscare, ordoneazaProiecte, stareDinDrepturi, drumUscare, inParalel, etichetaProiect, arataButonUscare, paginiCatTimpViu, Oprit } from './uscareMobilLogica.js'

const P = (id, extra = {}) => ({ id, nume: `Proiect ${id}`, cod_intern: `C${id}`, activ: true, ...extra })

describe('candidatiUscare', () => {
  it('runda 2: doar proiectele ACTIVE (arhiva nu intră nici cu uscări deschise); uscările deschise dau doar numărul', () => {
    const c = candidatiUscare([P(1), P(2, { activ: false }), P(3, { activ: false }), P(4, { activ: null })], [{ proiect_id: 3 }, { proiect_id: 3 }, { proiect_id: 1 }])
    expect(c.map(x => [x.id, x.activ, x.deschise])).toEqual([[1, true, 1], [4, true, 0]])
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
  const cand = candidatiUscare([P(1), P(2), P(3)], [{ proiect_id: 3 }])
  it('niciun drept -> fără buton', () => {
    const s = stareDinDrepturi(cand, cand.map(c => ({ id: c.id, data: false, error: null })))
    expect(s).toMatchObject({ stare: 'gata', proiecte: [], incomplet: false })
    expect(drumUscare(s).tip).toBe('niciunul')
  })
  it('un singur proiect activ cu drept -> direct', () => {
    const s = stareDinDrepturi(cand, [{ id: 1, data: false }, { id: 2, data: true }, { id: 3, data: false }])
    expect(drumUscare(s)).toEqual({ tip: 'direct', proiectId: 2 })
  })
  it('un singur proiect cu drept, dar marcat inactiv (nu ar trebui să vină) -> lista (nu direct)', () => {
    const s = stareDinDrepturi([{ id: 9, nume: 'X', cod: '', activ: false, deschise: 0 }], [{ id: 9, data: true }])
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

describe('arataButonUscare (lansatorul: fără enumerare la deschidere)', () => {
  it('owner -> da, fără citire', () => { expect(arataButonUscare({ is_owner: true }, null)).toBe(true) })
  it('modulul executie editor / admin -> da; viewer / fără rând -> nu', () => {
    const r = l => ({ data: l.map(access_level => ({ access_level })), error: null })
    expect(arataButonUscare({ is_owner: false }, r(['editor']))).toBe(true)
    expect(arataButonUscare({ is_owner: false }, r(['admin']))).toBe(true)
    expect(arataButonUscare({ is_owner: false }, r(['viewer']))).toBe(false)
    expect(arataButonUscare({ is_owner: false }, r([]))).toBe(false)
    expect(arataButonUscare(null, r([]))).toBe(false)
  })
  it('L18: citirea eșuată / răspuns fără listă = necunoscut -> butonul se arată (decide verificarea de la apăsare)', () => {
    expect(arataButonUscare({ is_owner: false }, { data: null, error: { message: 'Failed to fetch' } })).toBe(true)
    expect(arataButonUscare({ is_owner: false }, { data: null, error: null })).toBe(true)
    expect(arataButonUscare({ is_owner: false }, null)).toBe(true)
  })
})

describe('paginiCatTimpViu (L23 + L24)', () => {
  // n rânduri cu id 1..n, pagini keyset (gt ultim, limit pas)
  const sursa = n => (ultim, p) => {
    const de = ultim == null ? 0 : ultim
    return Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(p, n - de)) }, (_, i) => ({ id: de + i + 1 })), error: null })
  }
  it('până la pagina goală (nu după length < pas)', async () => {
    const cereri = []
    const r = await paginiCatTimpViu((u, p) => { cereri.push(u); return sursa(5)(u, p) }, () => true, 2)
    expect(r.map(x => x.id)).toEqual([1, 2, 3, 4, 5])
    expect(cereri).toEqual([null, 2, 4, 5])
  })
  it('viu() devenit fals în timpul unei pagini -> NICIO cerere în plus, se termină cu Oprit', async () => {
    let viu = true
    const cereri = []
    const p = paginiCatTimpViu((u, pas) => { cereri.push(u); if (cereri.length === 2) viu = false; return sursa(100)(u, pas) }, () => viu, 10)
    await expect(p).rejects.toBeInstanceOf(Oprit)
    expect(cereri).toEqual([null, 10])
  })
  it('viu() fals de la început -> zero cereri', async () => {
    let n = 0
    await expect(paginiCatTimpViu(() => { n++; return { data: [], error: null } }, () => false)).rejects.toBeInstanceOf(Oprit)
    expect(n).toBe(0)
  })
  it('L18: eroarea paginii se propagă; răspuns fără eroare dar fără listă = eroare, nu „gol”', async () => {
    await expect(paginiCatTimpViu(() => ({ data: null, error: { message: 'Failed to fetch' } }))).rejects.toMatchObject({ message: 'Failed to fetch' })
    await expect(paginiCatTimpViu(() => ({ data: null, error: null }))).rejects.toThrow('răspuns neașteptat')
  })
})
