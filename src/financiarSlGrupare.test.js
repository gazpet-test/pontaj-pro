import { describe, it, expect } from 'vitest'
import { normalizeazaNrFactura, grupeazaSlFaraFactura, sorteazaCronologic, decidePrecompletare } from './financiarSlGrupare.js'

describe('normalizeazaNrFactura', () => {
  it('formele scrise de mână ajung la SERIE-NR', () => {
    for (const t of ['gaz 418', 'GAZ-418', 'Gaz418', '  gaz   418  ', 'gaz - 418', 'gaz--418', 'gaz\t418', 'GAZ-0418'])
      expect(normalizeazaNrFactura(t)).toEqual({ serie: 'GAZ', nr: 418, canonic: 'GAZ-418' })
    expect(normalizeazaNrFactura('ph 7')).toEqual({ serie: 'PH', nr: 7, canonic: 'PH-7' })
  })
  it('gol / lipsă / format nerecunoscut = null', () => {
    for (const t of [null, undefined, '', '   ', '418', 'GAZ', 'GAZ 418/419', 'GAZ-418, GAZ-419', 'GAZ 418 bis',
      'GAZ.418', 'GAZ_418', '418 GAZ', 'GAZ 0', 'GAZ\n418', 'gaz 418\r\n', 'GĂZ 418', 'GAZ 99999999999999999999'])
      expect(normalizeazaNrFactura(t)).toBeNull()
  })
})

describe('sorteazaCronologic', () => {
  it('an, lună, id; an/lună lipsă la final; nu modifică intrarea', () => {
    const in_ = [{ id: 5, an: 2026, luna: 3 }, { id: 2, an: 2026, luna: 3 }, { id: 9, an: null, luna: 1 }, { id: 1, an: 2025, luna: 12 }, { id: 3, an: 2026, luna: 1 }]
    const copie = JSON.stringify(in_)
    expect(sorteazaCronologic(in_).map(x => x.id)).toEqual([1, 3, 2, 5, 9])
    expect(JSON.stringify(in_)).toBe(copie)
  })
})

describe('grupeazaSlFaraFactura', () => {
  const sl = (id, proiect_id, an, luna) => ({ id, proiect_id, an, luna, nr_situatie: `SL${id}`, cod_intern: `P${proiect_id}` })

  it('cazul din tichet: 4 SL ale aceluiași proiect cu "gaz 418" scris diferit = un grup, ordonat cronologic', () => {
    const alert = [sl(14, 7, 2026, 9), sl(11, 7, 2026, 6), sl(13, 7, 2026, 8), sl(12, 7, 2026, 7), sl(20, 7, 2026, 10)]
    const nr = { 11: 'gaz 418', 12: 'GAZ-418', 13: 'Gaz418', 14: ' gaz  418 ', 20: null }
    const r = grupeazaSlFaraFactura(alert, nr)
    expect(r.map(x => x.tip)).toEqual(['grup', 'individual'])
    expect(r[0]).toMatchObject({ proiect_id: 7, serie: 'GAZ', nr: 418, canonic: 'GAZ-418' })
    expect(r[0].sl.map(x => x.id)).toEqual([11, 12, 13, 14])
    expect(r[1].sl.map(x => x.id)).toEqual([20])
    expect(r[1].nr_factura_text).toBeNull()
  })

  it('proiecte diferite cu același număr = grupuri separate', () => {
    const alert = [sl(1, 7, 2026, 1), sl(2, 8, 2026, 1), sl(3, 7, 2026, 2), sl(4, 8, 2026, 2)]
    const nr = new Map([[1, 'gaz 418'], [2, 'GAZ 418'], [3, 'GAZ-418'], [4, 'gaz-418']])
    const r = grupeazaSlFaraFactura(alert, nr)
    expect(r.map(x => [x.tip, x.proiect_id, x.sl.map(s => s.id)])).toEqual([['grup', 7, [1, 3]], ['grup', 8, [2, 4]]])
    expect(new Set(r.map(x => x.cheie)).size).toBe(2)
  })

  it('proiect_id ca text vs număr = același proiect (cheia e pe text)', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, '7', 2026, 2)], { 1: 'gaz 418', 2: 'gaz 418' })
    expect(r).toHaveLength(1)
    expect(r[0].sl.map(s => s.id)).toEqual([1, 2])
  })

  it('același proiect, numere diferite = nu se grupează; un singur SL cu număr rămâne individual', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2), sl(3, 7, 2026, 3)], { 1: 'gaz 418', 2: 'gaz 419', 3: 'GAZ-419' })
    expect(r.map(x => [x.tip, x.sl.map(s => s.id)])).toEqual([['individual', [1]], ['grup', [2, 3]]])
    expect(r[0].nr_recunoscut).toBe('GAZ-418')
    expect(r[0].nr_factura_text).toBe('gaz 418')
  })

  it('serii diferite cu același număr = grupuri diferite', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2), sl(3, 7, 2026, 3), sl(4, 7, 2026, 4)],
      { 1: 'gaz 5', 2: 'ph 5', 3: 'GAZ5', 4: 'PH-5' })
    expect(r.map(x => [x.canonic, x.sl.map(s => s.id)])).toEqual([['GAZ-5', [1, 3]], ['PH-5', [2, 4]]])
  })

  it('format nerecunoscut sau fără proiect = individual, textul brut rămâne vizibil', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2), sl(3, null, 2026, 3), sl(4, null, 2026, 4)],
      { 1: 'GAZ 418/419', 2: 'GAZ 418/419', 3: 'gaz 418', 4: 'gaz 418' })
    expect(r.every(x => x.tip === 'individual')).toBe(true)
    expect(r.map(x => x.nr_factura_text)).toEqual(['GAZ 418/419', 'GAZ 418/419', 'gaz 418', 'gaz 418'])
    expect(r.map(x => x.nr_recunoscut)).toEqual([null, null, 'GAZ-418', 'GAZ-418'])
  })

  it('fără hartă de numere (citire eșuată) = toate individuale', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2)], null)
    expect(r.map(x => x.tip)).toEqual(['individual', 'individual'])
  })

  it('proprietate: fiecare SL apare exact o dată, pe combinații aleatoare', () => {
    let seed = 12345
    const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const forme = [null, '', 'gaz 1', 'GAZ-1', 'gaz 2', 'ph 1', '1', 'GAZ 1/2']
    for (let k = 0; k < 200; k++) {
      const n = 1 + rnd(12)
      const alert = [], nr = {}
      for (let i = 1; i <= n; i++) { alert.push(sl(i, rnd(3) === 0 ? null : 1 + rnd(3), 2026, 1 + rnd(12))); nr[i] = forme[rnd(forme.length)] }
      const r = grupeazaSlFaraFactura(alert, nr)
      const ids = r.flatMap(x => x.sl.map(s => s.id)).sort((a, b) => a - b)
      expect(ids).toEqual(alert.map(s => s.id).sort((a, b) => a - b))
      for (const g of r.filter(x => x.tip === 'grup')) {
        expect(g.sl.length).toBeGreaterThanOrEqual(2)
        expect(new Set(g.sl.map(s => String(s.proiect_id))).size).toBe(1)
        expect(new Set(g.sl.map(s => normalizeazaNrFactura(nr[s.id]).canonic))).toEqual(new Set([g.canonic]))
      }
    }
  })
})

describe('decidePrecompletare', () => {
  const SERII = ['GAZ', 'PH', 'PX']
  const g = { serie: 'GAZ', nr: 418, canonic: 'GAZ-418' }
  it('serie existentă + număr liber = precompletat', () => {
    expect(decidePrecompletare(g, SERII, { stare: 'liber' })).toMatchObject({ serie: 'GAZ', nr: 418 })
  })
  it('număr deja folosit = gol + mesaj', () => {
    const d = decidePrecompletare(g, SERII, { stare: 'folosit' })
    expect(d.nr).toBeNull()
    expect(d.mesaj).toMatch(/deja folosit/)
  })
  it('eroare la verificare = gol (nu se presupune liber)', () => {
    for (const v of [{ stare: 'eroare' }, null, undefined, {}, { stare: 'altceva' }]) {
      const d = decidePrecompletare(g, SERII, v)
      expect(d.nr).toBeNull()
      expect(d.mesaj).toMatch(/Nu am putut verifica/)
    }
  })
  it('serie inexistentă = nimic precompletat, chiar dacă numărul ar fi liber', () => {
    const d = decidePrecompletare({ serie: 'XYZ', nr: 418, canonic: 'XYZ-418' }, SERII, { stare: 'liber' })
    expect([d.serie, d.nr]).toEqual([null, null])
    expect(d.mesaj).toMatch(/nu există/)
  })
  it('grup fără număr valid = nimic precompletat', () => {
    expect(decidePrecompletare(null, SERII, { stare: 'liber' })).toMatchObject({ serie: null, nr: null })
    expect(decidePrecompletare({ serie: 'GAZ', nr: 0 }, SERII, { stare: 'liber' })).toMatchObject({ serie: null, nr: null })
  })
})
