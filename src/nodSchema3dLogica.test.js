// Teste pentru logica pură a schemei 3D (probă): validarea modelului, legarea sudurilor de pozițiile din model, culorile.
// Valorile așteptate sunt scrise de mână (culorile legendei 2D alese de Răzvan, codurile din fixture), nu calculate din codul testat.
import { describe, it, expect } from 'vitest'
import {
  parseModel3d, mapeazaSuduri3d, culoarePunct3d, culoareDn, CULORI_DN, CULOARE_DN_ALTA, esteObiectLipsa, esteAtingere, razaSfera,
  cutieGrup, spreScena, dnuriGrup, estePunct,
} from './nodSchema3dLogica.js'

const MODEL = () => ({
  format: 'gazpet-nod-3d', versiune: 1, unitate: 'mm', titlu: 'Test',
  note: ['nota 1', '  ', 'nota 2'],
  grupuri: [
    {
      id: 'rez', titlu: 'Rezervoare', prefixe: ['CR'], teren_z: 0,
      elemente: [
        { tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 250, cert: 'desen', et: 'poz. 24' },
        { tip: 'cot', a: [1000, 0, 0], c: [1381, 0, 0], b: [1381, 0, 381], dn: 250 },
        { tip: 'robinet', a: [1381, 0, 500], b: [1381, 0, 1068], dn: 250, et: 'RAM 10', cert: 'estimat' },
        { tip: 'rezervor', a: [-2450, 0, 1516], b: [2450, 0, 1516], d: 1200, et: 'Rezervor' },
        { tip: 'eticheta', p: [0, 0, 3000], text: 'spre coș' },
      ],
      suduri: [
        { cod: 'CR-001', p: [1000, 0, 0], cert: 'desen' },
        { cod: 'cr-002', p: [1381, 0, 381], cert: 'estimat' },
        { cod: 'CR-003', p: [1381.4, 0, 381.2], cert: 'desen' },     // la sub 1 mm de CR-002: același punct
        { cod: 'CR-009', p: [0, 0, 0], cert: 'desen' },              // în model, dar nu în listă
      ],
      fara_pozitie: [{ cod: 'CR-114', motiv: 'cot de confirmat' }],
    },
    {
      id: 'gaz', titlu: 'Alimentare', prefixe: ['CI'], teren_z: null,
      elemente: [{ tip: 'teava', a: [0, 0, 0], b: [0, 0, 500], dn: 25 }],
      suduri: [{ cod: 'CI-001', p: [0, 0, 0], cert: 'estimat' }],
      fara_pozitie: [],
    },
  ],
})

const SUD = (id, cod, stare = 'de_executat', dn = 250) => ({ id, cod, stare, dn })

describe('parseModel3d', () => {
  it('model valid: grupurile, elementele și sudurile trec; codurile ies cu majuscule; notele goale cad', () => {
    const m = parseModel3d(MODEL())
    expect(m.erori).toEqual([])
    expect(m.grupuri.map(g => g.id)).toEqual(['rez', 'gaz'])
    expect(m.grupuri[0].elemente).toHaveLength(5)
    expect(m.grupuri[0].suduri.map(s => s.cod)).toEqual(['CR-001', 'CR-002', 'CR-003', 'CR-009'])
    expect(m.grupuri[0].faraPozitie).toEqual([{ cod: 'CR-114', motiv: 'cot de confirmat' }])
    expect(m.grupuri[0].terenZ).toBe(0)
    expect(m.grupuri[1].terenZ).toBe(null)
    expect(m.note).toEqual(['nota 1', 'nota 2'])
    // certitudinea lipsă a unui element = „desen”; estimatul rămâne estimat
    expect(m.grupuri[0].elemente[1].cert).toBe('desen')
    expect(m.grupuri[0].elemente[2].cert).toBe('estimat')
  })

  it('structura greșită respinge tot modelul, cu motiv (format, versiune, unitate, fără grupuri, nu e obiect)', () => {
    for (const [mod, motiv] of [
      [x => { x.format = 'altceva' }, /alt format/],
      [x => { x.versiune = 2 }, /Versiunea/],
      [x => { x.unitate = 'm' }, /milimetri/],
      [x => { x.grupuri = [] }, /niciun grup/],
    ]) {
      const j = MODEL(); mod(j)
      const m = parseModel3d(j)
      expect(m.grupuri).toEqual([])
      expect(m.erori[0]).toMatch(motiv)
    }
    expect(parseModel3d(null).erori[0]).toMatch(/nu e un obiect/)
    expect(parseModel3d([1, 2]).erori[0]).toMatch(/nu e un obiect/)
  })

  it('elementele invalide NU dispar tacit: apar în erori, restul grupului rămâne', () => {
    const j = MODEL()
    j.grupuri[0].elemente.push(
      { tip: 'cub', a: [0, 0, 0], b: [1, 1, 1], dn: 50 },                 // tip necunoscut
      { tip: 'teava', a: [0, 0, 0], b: [0, Number.NaN, 0], dn: 50 },     // coordonată NaN
      { tip: 'teava', a: [0, 0, 0], b: [0, 0], dn: 50 },                  // punct cu 2 coordonate
      { tip: 'cot', a: [0, 0, 0], b: [1, 0, 0], dn: 50 },                 // cot fără colț
      { tip: 'teava', a: [0, 0, 0], b: [100, 0, 0], dn: 5 },              // DN în afara 6…2000
      { tip: 'teava', a: [5, 5, 5], b: [5, 5, 5], dn: 50 },               // lungime zero
      { tip: 'teava', a: [0, 0, 0], b: [2e6, 0, 0], dn: 50 },             // peste ±1 km
      { tip: 'eticheta', p: [0, 0, 0], text: '   ' },                     // etichetă goală
      { tip: 'rezervor', a: [0, 0, 0], b: [1, 0, 0], d: 0 },              // diametru 0
    )
    const m = parseModel3d(j)
    expect(m.grupuri[0].elemente).toHaveLength(5)
    expect(m.erori).toHaveLength(9)
    expect(m.erori[0]).toMatch(/tip necunoscut/)
    expect(m.erori[4]).toMatch(/DN invalid/)
    expect(m.erori[5]).toMatch(/lungime zero/)
  })

  it('sudurile: cod duplicat (și între grupuri), prefix străin, certitudine sau poziție invalidă = eroare pe rândul lor', () => {
    const j = MODEL()
    j.grupuri[0].suduri.push({ cod: 'CR-001', p: [1, 1, 1], cert: 'desen' })      // duplicat în grup
    j.grupuri[1].suduri.push({ cod: 'CR-003', p: [1, 1, 1], cert: 'desen' })      // alt prefix + deja folosit
    j.grupuri[1].suduri.push({ cod: 'CI-002', p: [1, 1, 1], cert: 'sigur' })      // certitudine necunoscută
    j.grupuri[1].suduri.push({ cod: 'CI-003', p: [1, 1], cert: 'desen' })         // poziție invalidă
    j.grupuri[1].suduri.push({ cod: 'CI 004', p: [1, 1, 1], cert: 'desen' })      // cod invalid
    const m = parseModel3d(j)
    expect(m.grupuri[0].suduri.map(s => s.cod)).toEqual(['CR-001', 'CR-002', 'CR-003', 'CR-009'])
    expect(m.grupuri[1].suduri.map(s => s.cod)).toEqual(['CI-001'])
    expect(m.erori).toHaveLength(5)
    expect(m.erori[0]).toMatch(/CR-001.*cod duplicat/)
    expect(m.erori[1]).toMatch(/CR-003.*cod duplicat/)
    expect(m.erori[2]).toMatch(/certitudine invalidă/)
    expect(m.erori[3]).toMatch(/poziție invalidă/)
    expect(m.erori[4]).toMatch(/cod invalid/)
  })

  it('„fără poziție” cu un cod care are deja poziție = eroare; grup cu id duplicat sau fără prefixe = eroare', () => {
    const j = MODEL()
    j.grupuri[0].fara_pozitie.push({ cod: 'CR-001', motiv: 'x' })
    j.grupuri.push({ ...MODEL().grupuri[1], id: 'gaz' })
    j.grupuri.push({ ...MODEL().grupuri[1], id: 'alt', prefixe: [] })
    const m = parseModel3d(j)
    expect(m.grupuri.map(g => g.id)).toEqual(['rez', 'gaz'])
    expect(m.erori).toHaveLength(3)
    expect(m.erori[0]).toMatch(/CR-001.*deja cu poziție/)
    expect(m.erori[1]).toMatch(/id invalid sau duplicat/)
    expect(m.erori[2]).toMatch(/prefixele/)
  })
})

describe('mapeazaSuduri3d', () => {
  const grup = () => parseModel3d(MODEL()).grupuri[0]

  it('leagă după cod; sudurile la sub 1 mm devin un singur punct; estimatul se transmite punctului', () => {
    const toate = [SUD(1, 'CR-001'), SUD(2, 'CR-002', 'sudat'), SUD(3, 'CR-003', 'acceptat'), SUD(4, 'CR-114'), SUD(5, 'CP-010')]
    const r = mapeazaSuduri3d(grup(), toate, toate)
    expect(r.grupuri).toHaveLength(2)
    expect(r.grupuri[0].puncte.map(p => p.sudura.id)).toEqual([1])
    expect(r.grupuri[0].cert).toBe('desen')
    expect(r.grupuri[1].puncte.map(p => p.sudura.id)).toEqual([2, 3])
    expect(r.grupuri[1].cert).toBe('estimat')
    expect(r.grupuri[1].puncte.map(p => p.certitudine)).toEqual(['estimat', 'desen'])
    // CR-114 e în domeniul grupului (prefix CR), fără poziție; CP-010 e al altui grup / al planșei principale: nu apare
    expect(r.faraLoc.map(s => s.cod)).toEqual(['CR-114'])
    expect(r.inModelFaraLista).toEqual(['CR-009'])
  })

  it('o sudură scoasă de filtre nu e nici sferă, nici „fără loc”, nici „lipsă din listă”', () => {
    const toate = [SUD(1, 'CR-001'), SUD(2, 'CR-002', 'sudat'), SUD(3, 'CR-003', 'acceptat'), SUD(4, 'CR-114')]
    const filtrate = toate.filter(s => s.stare === 'sudat')
    const r = mapeazaSuduri3d(grup(), filtrate, toate)
    expect(r.grupuri).toHaveLength(1)
    expect(r.grupuri[0].puncte.map(p => p.sudura.cod)).toEqual(['CR-002'])
    expect(r.faraLoc).toEqual([])
    expect(r.inModelFaraLista).toEqual(['CR-009'])
  })

  it('codurile din BD se compară fără să conteze literele mici; fără grup = rezultat gol', () => {
    const r = mapeazaSuduri3d(grup(), [SUD(7, 'cr-001')])
    expect(r.grupuri[0].puncte[0].sudura.id).toBe(7)
    expect(mapeazaSuduri3d(null, [SUD(1, 'CR-001')])).toEqual({ grupuri: [], faraLoc: [], inModelFaraLista: [] })
  })
})

describe('culori', () => {
  // legenda 2D (Răzvan, 09.11.2026): gri / galben / albastru / violet / verde / roșu / gri închis
  const STARE = { de_executat: '#8B949E', insailat: '#E3B341', sudat: '#58A6FF', ndt: '#BC8CFF', acceptat: '#3FB950', reparat: '#F85149', anulat: '#3D444D' }
  const pct = (...stari) => ({ puncte: stari.map((s, i) => ({ sudura: { id: i, stare: s } })) })

  it('o singură stare = culoarea ei din legenda 2D; mai multe = starea cea mai puțin avansată; necunoscută = alb', () => {
    for (const [s, c] of Object.entries(STARE)) expect(culoarePunct3d(pct(s))).toBe(c)
    expect(culoarePunct3d(pct('acceptat', 'de_executat'))).toBe('#8B949E')
    expect(culoarePunct3d(pct('ndt', 'sudat'))).toBe('#58A6FF')
    expect(culoarePunct3d(pct('ceva'))).toBe('#FFFFFF')
    expect(culoarePunct3d(pct('sudat', 'ceva'))).toBe('#FFFFFF')
  })

  it('țevile pe DN: culori fixe, niciuna egală cu o culoare de stare (sferele se disting de țevi)', () => {
    expect(culoareDn(250)).toBe('#2A9D8F')
    expect(culoareDn(150)).toBe('#4E6E95')
    expect(culoareDn(999)).toBe(CULOARE_DN_ALTA)
    const stari = new Set([...Object.values(STARE), '#FFFFFF'].map(c => c.toUpperCase()))
    for (const c of [...Object.values(CULORI_DN), CULOARE_DN_ALTA]) expect(stari.has(c.toUpperCase())).toBe(false)
    expect(new Set(Object.values(CULORI_DN)).size).toBe(Object.keys(CULORI_DN).length)
  })

  it('legenda DN a grupului: DN-urile elementelor, descrescător, fără duplicate', () => {
    expect(dnuriGrup(parseModel3d(MODEL()).grupuri[0])).toEqual([250])
    expect(dnuriGrup({ elemente: [{ dn: 50 }, { dn: 300 }, { dn: 50 }, {}] })).toEqual([300, 50])
  })
})

describe('mărunte', () => {
  it('lipsa fișierului din bucket se recunoaște; alte erori nu', () => {
    expect(esteObiectLipsa({ status: 404, message: 'x' })).toBe(true)
    expect(esteObiectLipsa({ status: 400, statusCode: '404', message: 'Object not found' })).toBe(true)
    expect(esteObiectLipsa({ message: 'Object not found' })).toBe(true)
    expect(esteObiectLipsa({ message: 'not found' })).toBe(true)
    expect(esteObiectLipsa({ status: 400, statusCode: '400', message: 'Bad request' })).toBe(false)
    expect(esteObiectLipsa({ message: 'Failed to fetch' })).toBe(false)
    expect(esteObiectLipsa({ message: 'bucket not found here' })).toBe(false)
    expect(esteObiectLipsa(null)).toBe(false)
  })

  it('atingere vs. rotire: mișcare ≤ 8 px și ≤ 600 ms', () => {
    const jos = { x: 100, y: 100, t: 0 }
    expect(esteAtingere(jos, { x: 105, y: 104, t: 200 })).toBe(true)
    expect(esteAtingere(jos, { x: 109, y: 100, t: 200 })).toBe(false)
    expect(esteAtingere(jos, { x: 100, y: 100, t: 700 })).toBe(false)
    expect(esteAtingere(null, { x: 100, y: 100, t: 1 })).toBe(false)
  })

  it('raza sferei: minim 55 mm; altfel 1,45 × raza exterioară (DN300: Ø323,9)', () => {
    expect(razaSfera(50)).toBe(55)
    expect(razaSfera(300)).toBeCloseTo(323.9 / 2 * 1.45, 6)
    expect(razaSfera(null)).toBe(55)
  })

  it('cutia grupului și trecerea în sistemul scenei (y în sus, metri)', () => {
    const c = cutieGrup({ elemente: [{ a: [0, 0, 0], b: [4000, 0, 0] }, { p: [0, 1000, 2000] }], suduri: [{ p: [0, -1000, -500] }] })
    expect(c.min).toEqual([0, -1000, -500])
    expect(c.max).toEqual([4000, 1000, 2000])
    expect(c.centru).toEqual([2000, 0, 750])
    expect(c.marime).toBe(4000)
    expect(cutieGrup({ elemente: [], suduri: [] })).toBe(null)
    expect(spreScena([1000, 2000, 3000])).toEqual([1, 3, -2])
    expect(estePunct([1, 2, 3])).toBe(true)
    expect(estePunct([1, 2, '3'])).toBe(false)
  })
})
