import { describe, it, expect } from 'vitest'
import { randuriContinutAviz, SELECT_CONTINUT_AVIZ } from './avizContinut.js'

// Valorile așteptate sunt scrise de mână după regulile tabelului din AvizInsotireMarfaModal
// (Logistica.jsx), nu calculate din codul testat (L25). Date sintetice.
const asset = { id: 'as1', cod_intern: 'EX-01', nr_inventar: 'INV-7', marca: 'Alfa', model: 'X1', nr_inmatriculare: 'PH-01-ABC', serie_sasiu: 'VIN123', regim_transport_special: false }

describe('randuriContinutAviz — forma cu conținut multiplu', () => {
  const R = randuriContinutAviz({ continut_multiplu: true, tip: 'utilaj', activ_transportat: asset }, [
    { id: 'c1', tip: 'utilaj', asset: { ...asset, regim_transport_special: true } },
    { id: 'c2', tip: 'marfa', denumire: 'Țeavă PE 110', cantitate: 120.5, um: 'm', observatii: 'colac' },
    { id: 'c3', tip: 'marfa', denumire: '', cantitate: null },
    { id: 'c4', tip: 'utilaj', asset: { marca: 'Beta', model: null } },
    { id: 'c5', tip: 'utilaj', asset: null, denumire: 'Pompă' },
    { tip: 'marfa', denumire: 'Cot', cantitate: '1.2345', um: null },
    { id: 'c7', tip: 'marfa', denumire: 'Nimic', cantitate: 0, um: 'kg' },
  ])

  it('un rând pe fiecare element, în ordinea primită, numerotat de la 1', () => {
    expect(R.map(r => r.nr)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(R.map(r => r.key)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 5, 'c7'])
    expect(R.every(r => r.forma === 'multiplu' && r.faraBunuri === false)).toBe(true)
  })

  it('utilaj cu activ: marcă + model, identificarea completă cu eticheta „Nr. înmatr.”, regim special', () => {
    expect(R[0]).toMatchObject({ isUtilaj: true, denumire: 'Alfa X1', regimSpecial: true, um: 'buc', cantitate: '1', observatii: '' })
    expect(R[0].identificare).toEqual([
      { camp: 'nr_inventar', eticheta: 'Nr. inventar', valoare: 'INV-7' },
      { camp: 'cod_intern', eticheta: 'Cod intern', valoare: 'EX-01' },
      { camp: 'nr_inmatriculare', eticheta: 'Nr. înmatr.', valoare: 'PH-01-ABC' },
      { camp: 'serie_sasiu', eticheta: 'Serie șasiu', valoare: 'VIN123' },
    ])
  })

  it('marfă: denumire, UM, cantitate cu cel mult 2 zecimale, observații; fără identificare (celula „—”)', () => {
    expect(R[1]).toMatchObject({ isUtilaj: false, denumire: 'Țeavă PE 110', um: 'm', cantitate: '120,5', observatii: 'colac', identificare: null, regimSpecial: false })
    expect(R[5]).toMatchObject({ denumire: 'Cot', um: '—', cantitate: '1,23' })
  })

  it('valori lipsă: denumire „—”, UM „—”, cantitate „—” la marfă; cantitate 0 = lipsă, ca în aviz', () => {
    expect(R[2]).toMatchObject({ denumire: '—', um: '—', cantitate: '—' })
    expect(R[6]).toMatchObject({ um: 'kg', cantitate: '—' })
  })

  it('utilaj cu activ fără model: doar marca, fără spațiu; utilaj fără activ: denumirea rândului, fără identificare', () => {
    expect(R[3]).toMatchObject({ denumire: 'Beta', identificare: [], um: 'buc', cantitate: '1' })
    expect(R[4]).toMatchObject({ isUtilaj: true, denumire: 'Pompă', identificare: null, um: 'buc', cantitate: '1' })
  })
})

describe('randuriContinutAviz — forma simplă (un rând)', () => {
  it('multiplu fără rânduri → forma simplă, utilajul de pe transport, eticheta „Nr. înmatriculare”', () => {
    const R = randuriContinutAviz({ continut_multiplu: true, tip: 'utilaj', activ_transportat: asset }, [])
    expect(R).toEqual([{
      forma: 'simplu', key: 'simplu', nr: 1, isUtilaj: true, denumire: 'Alfa X1', descriere: '', regimSpecial: false, observatii: '',
      identificare: [
        { camp: 'nr_inventar', eticheta: 'Nr. inventar', valoare: 'INV-7' },
        { camp: 'cod_intern', eticheta: 'Cod intern', valoare: 'EX-01' },
        { camp: 'nr_inmatriculare', eticheta: 'Nr. înmatriculare', valoare: 'PH-01-ABC' },
        { camp: 'serie_sasiu', eticheta: 'Serie șasiu', valoare: 'VIN123' },
      ],
      um: 'buc', cantitate: '1', faraBunuri: false,
    }])
  })

  it('descriere text → rândul cu descrierea, UM / cantitate „—”', () => {
    const [r] = randuriContinutAviz({ tip: 'materiale', continut_descriere: '10 saci ciment\nși nisip' }, [])
    expect(r).toMatchObject({ isUtilaj: false, denumire: '', descriere: '10 saci ciment\nși nisip', identificare: null, um: '—', cantitate: '—', faraBunuri: false })
  })

  it('tip utilaj fără activ, cu descriere → descrierea, dar UM buc / cantitate 1 (după tip, ca în aviz)', () => {
    const [r] = randuriContinutAviz({ tip: 'utilaj', activ_transportat: null, continut_descriere: 'Macara închiriată' }, [])
    expect(r).toMatchObject({ isUtilaj: false, descriere: 'Macara închiriată', um: 'buc', cantitate: '1', faraBunuri: false })
  })

  it('NEGATIV: fără utilaj și fără descriere text → rândul „—” marcat faraBunuri', () => {
    expect(randuriContinutAviz({ tip: 'materiale', continut_descriere: null }, [])[0]).toMatchObject({ descriere: '—', faraBunuri: true })
    expect(randuriContinutAviz({ tip: 'materiale', continut_descriere: ' \n\t ' }, [])[0]).toMatchObject({ descriere: ' \n\t ', faraBunuri: true })
    expect(randuriContinutAviz(null, null)[0]).toMatchObject({ descriere: '—', um: '—', cantitate: '—', faraBunuri: true })
    expect(randuriContinutAviz({ tip: 'utilaj', activ_transportat: null }, [])[0]).toMatchObject({ descriere: '—', faraBunuri: true })
  })

  it('activ cu marcă lipsă → „ X1” (textul afișat de aviz, spațiul inițial nu se vede în HTML)', () => {
    expect(randuriContinutAviz({ tip: 'utilaj', activ_transportat: { model: 'X1', marca: null } }, [])[0].denumire).toBe(' X1')
  })
})

describe('selecția din BD', () => {
  it('activul are și regimul de transport special', () => {
    expect(SELECT_CONTINUT_AVIZ).toBe('*, asset:logistica_active!active_id(id, cod_intern, nr_inventar, marca, model, nr_inmatriculare, serie_sasiu, regim_transport_special)')
  })
})
