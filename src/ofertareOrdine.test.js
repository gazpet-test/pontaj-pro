import { describe, it, expect } from 'vitest'
import { inainte, grupeazaAcoperiri, scorNumeric } from './ofertareOrdine.js'

const r = (o) => ({ cerinta_id: 1, id: 1, scor: null, ales_de: null, verificat_pe_scan: false, ...o })

describe('ordinea candidaților', () => {
  it('alegerea omului trece peste orice scor', () => {
    const om = r({ id: 9, scor: 10, ales_de: 'uuid-oana' })
    const ai = r({ id: 2, scor: 95 })
    expect([ai, om].sort(inainte)[0]).toBe(om)
  })

  it('dovada verificată pe scan bate scorul AI', () => {
    const scan = r({ id: 9, scor: 20, verificat_pe_scan: true })
    const ai = r({ id: 2, scor: 90 })
    expect([ai, scan].sort(inainte)[0]).toBe(scan)
  })

  it('alegerea omului bate dovada verificată pe scan', () => {
    const om = r({ id: 9, ales_de: 'uuid' })
    const scan = r({ id: 2, verificat_pe_scan: true })
    expect([scan, om].sort(inainte)[0]).toBe(om)
  })

  it('la scor egal departajează id-ul crescător — deci ordinea nu mai e hazard', () => {
    const a = r({ id: 7, scor: 60 }), b = r({ id: 3, scor: 60 }), c = r({ id: 5, scor: 60 })
    expect([a, b, c].sort(inainte).map(x => x.id)).toEqual([3, 5, 7])
    // aceeași listă, altă ordine de intrare → același rezultat
    expect([c, a, b].sort(inainte).map(x => x.id)).toEqual([3, 5, 7])
  })

  it('candidatul fără scor cade ultimul, nu primul', () => {
    const fara = r({ id: 1, scor: null }), cu = r({ id: 9, scor: 0 })
    expect([fara, cu].sort(inainte).map(x => x.id)).toEqual([9, 1])
  })

  it('scorul mai mare trece înaintea celui mic, indiferent de id', () => {
    const mic = r({ id: 1, scor: 30 }), mare = r({ id: 99, scor: 80 })
    expect([mic, mare].sort(inainte)[0]).toBe(mare)
  })
})

describe('grupeazaAcoperiri', () => {
  it('întoarce primul candidat cu alternativele în aceeași ordine', () => {
    const out = grupeazaAcoperiri([
      r({ id: 3, scor: 50 }), r({ id: 1, scor: 90 }), r({ id: 2, scor: 70 }),
    ])
    expect(out[1].id).toBe(1)
    expect(out[1].alternative.map(x => x.id)).toEqual([2, 3])
  })

  it('numără câți candidați sunt la egalitate cu primul', () => {
    const out = grupeazaAcoperiri([
      r({ id: 1, scor: 80 }), r({ id: 2, scor: 80 }), r({ id: 3, scor: 80 }), r({ id: 4, scor: 40 }),
    ])
    expect(out[1].la_egalitate).toBe(2)
  })

  it('nu raportează egalitate când primul e ales de om', () => {
    const out = grupeazaAcoperiri([
      r({ id: 1, scor: 80, ales_de: 'uuid' }), r({ id: 2, scor: 80 }),
    ])
    expect(out[1].la_egalitate).toBe(0)
  })

  it('nu raportează egalitate când primul e verificat pe scan', () => {
    const out = grupeazaAcoperiri([
      r({ id: 1, scor: 80, verificat_pe_scan: true }), r({ id: 2, scor: 80 }),
    ])
    expect(out[1].la_egalitate).toBe(0)
  })

  it('un candidat verificat pe scan nu intră la numărătoarea de egalitate', () => {
    const out = grupeazaAcoperiri([
      r({ id: 1, scor: 80 }), r({ id: 2, scor: 80, verificat_pe_scan: true }),
    ])
    // rândul 2 e decizie, deci urcă primul; nu mai există egalitate de raportat
    expect(out[1].id).toBe(2)
    expect(out[1].la_egalitate).toBe(0)
  })

  it('separă cerințele între ele', () => {
    const out = grupeazaAcoperiri([
      { cerinta_id: 1, id: 1, scor: 10 }, { cerinta_id: 2, id: 2, scor: 20 },
    ])
    expect(Object.keys(out).sort()).toEqual(['1', '2'])
    expect(out[2].alternative).toEqual([])
  })

  it('ignoră rândurile fără cerinta_id și lista goală', () => {
    expect(grupeazaAcoperiri([])).toEqual({})
    expect(grupeazaAcoperiri(null)).toEqual({})
    expect(grupeazaAcoperiri([{ id: 1 }, null])).toEqual({})
  })

  it('un singur candidat nu are alternative și nu e la egalitate', () => {
    const out = grupeazaAcoperiri([r({ id: 1, scor: 70 })])
    expect(out[1].alternative).toEqual([])
    expect(out[1].la_egalitate).toBe(0)
  })
})

describe('scorNumeric — ce înseamnă „fără scor"', () => {
  it('numerele trec', () => {
    expect(scorNumeric(0)).toBe(0)
    expect(scorNumeric(80)).toBe(80)
    expect(scorNumeric(-3)).toBe(-3)
  })

  it('șirurile numerice trec', () => {
    expect(scorNumeric('42')).toBe(42)
    expect(scorNumeric(' 42 ')).toBe(42)
  })

  // Toate astea dau 0 prin `Number()` și urcau candidatul înaintea unuia cu scor 0 real.
  it.each([null, undefined, '', '   ', false, true, [], {}, 'abc', NaN, Infinity])(
    'valoarea %p înseamnă „fără scor", nu 0', v => { expect(scorNumeric(v)).toBe(null) })

  it('un candidat cu scor „   " cade tot ultimul, ca unul fără scor', () => {
    const gol = { cerinta_id: 1, id: 1, scor: '   ' }
    const zero = { cerinta_id: 1, id: 9, scor: 0 }
    expect([gol, zero].sort(inainte).map(x => x.id)).toEqual([9, 1])
  })

  it('doi candidați „fără scor" scriși diferit nu sunt la egalitate', () => {
    const out = grupeazaAcoperiri([
      { cerinta_id: 1, id: 1, scor: null }, { cerinta_id: 1, id: 2, scor: '  ' },
    ])
    expect(out[1].la_egalitate).toBe(0)
  })
})
