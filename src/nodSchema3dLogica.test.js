// Teste pentru logica pură a schemei 3D (probă): validarea modelului, legarea sudurilor de pozițiile din model, culorile.
// Valorile așteptate sunt scrise de mână (culorile legendei 2D alese de Răzvan, codurile din fixture), nu calculate din codul testat.
import { describe, it, expect } from 'vitest'
import {
  parseModel3d, mapeazaSuduri3d, culoarePunct3d, culoareDn, CULORI_DN, CULOARE_DN_ALTA, esteObiectLipsa, esteAtingere, razaSfera,
  cutieGrup, spreScena, dnuriGrup, estePunct, gestNou, gestMisca, punctePeCod,
  citesteAmplasare, transformaPunct, aplicaAmplasare, instalatia, puncteVizibile, ID_INSTALATIE, departareCamera,
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

  it('review r1: reducția fără DN2 e respinsă (altfel geometria ar ieși NaN)', () => {
    const j = MODEL()
    j.grupuri[0].elemente.push({ tip: 'reductie', a: [0, 0, 0], b: [1000, 0, 0], dn: 250 })
    j.grupuri[0].elemente.push({ tip: 'reductie', a: [0, 0, 0], b: [203, 0, 0], dn: 300, dn2: 250 })
    const m = parseModel3d(j)
    expect(m.erori).toEqual(['Grupul 1 (rez), elementul 6 (reductie): reducția nu are DN2'])
    expect(m.grupuri[0].elemente.filter(e => e.tip === 'reductie')).toEqual([{ tip: 'reductie', cert: 'desen', a: [0, 0, 0], b: [203, 0, 0], dn: 300, dn2: 250 }])
  })

  it('review r1: tipul cu spații se normalizează la fel la validare și la curățare (fără excepție care să piardă tot modelul)', () => {
    const j = MODEL()
    j.grupuri[0].elemente.push({ tip: ' teava ', a: [0, 0, 0], b: [0, 0, 500], dn: 50 })
    const m = parseModel3d(j)
    expect(m.erori).toEqual([])
    expect(m.grupuri[0].elemente.at(-1)).toMatchObject({ tip: 'teava', a: [0, 0, 0], b: [0, 0, 500], dn: 50 })
  })

  it('review r1: „fără poziție” peste limită se raportează; un cod din alt prefix e refuzat și nu blochează poziția din grupul lui', () => {
    const j = MODEL()
    j.grupuri[0].fara_pozitie = Array.from({ length: 2001 }, (_, i) => ({ cod: `CR-${2000 + i}`, motiv: 'x' }))
    j.grupuri[0].fara_pozitie.unshift({ cod: 'CI-001', motiv: 'din alt grup' })
    const m = parseModel3d(j)
    expect(m.erori[0]).toBe('Grupul 1 (rez): „fără poziție” are 2002 intrări; peste 2000 nu se citesc')
    expect(m.erori[1]).toBe('Grupul 1 (rez), fără poziție 1 (CI-001): codul nu e în prefixele grupului')
    expect(m.erori).toHaveLength(2)
    expect(m.grupuri[0].faraPozitie).toHaveLength(1999)                 // 2000 citite, minus cea refuzată
    expect(m.grupuri[1].suduri.map(s => s.cod)).toEqual(['CI-001'])      // poziția validă din grupul CI rămâne
  })

  it('review r2: orice text tăiat se raportează (nota > 400, motivul > 160, titlul modelului > 160)', () => {
    const j = MODEL()
    j.note = ['scurtă', 'x'.repeat(400) + ' NU CONFIRMAT']
    j.titlu = 't'.repeat(161)
    j.grupuri[0].fara_pozitie[0].motiv = 'm'.repeat(160) + ' de confirmat'
    const m = parseModel3d(j)
    expect(m.erori).toEqual([
      'Grupul 1 (rez), fără poziție 1 (CR-114): motivul are peste 160 caractere (tăiat)',
      'Nota 2 are peste 400 caractere (tăiată)',
      'Titlul modelului are peste 160 caractere (tăiat)',
    ])
    expect(m.note[1]).toHaveLength(400)
    expect(m.grupuri[0].faraPozitie[0].motiv).toHaveLength(160)
    // la limită exactă: fără mesaj
    const k = MODEL(); k.note = ['y'.repeat(400)]; k.titlu = 'z'.repeat(160)
    expect(parseModel3d(k).erori).toEqual([])
  })

  it('peste 20 de note = raportat, nu tăiat în tăcere', () => {
    const j = MODEL()
    j.note = Array.from({ length: 21 }, (_, i) => `n${i}`)
    const m = parseModel3d(j)
    expect(m.note).toHaveLength(20)
    expect(m.erori).toEqual(['Modelul are 21 note; peste 20 nu se afișează'])
  })

  it('„fără poziție” cu un cod care are deja poziție = eroare; grup cu id duplicat sau fără prefixe = eroare', () => {
    const j = MODEL()
    j.grupuri[0].fara_pozitie.push({ cod: 'CR-001', motiv: 'x' })
    j.grupuri.push({ ...MODEL().grupuri[1], id: 'gaz' })
    j.grupuri.push({ ...MODEL().grupuri[1], id: 'alt', prefixe: [] })
    const m = parseModel3d(j)
    expect(m.grupuri.map(g => g.id)).toEqual(['rez', 'gaz'])
    expect(m.erori).toHaveLength(3)
    expect(m.erori[0]).toMatch(/CR-001.*cod deja folosit/)
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

  it('review r1: gruparea după distanța reală 3D (≤ 1 mm, în lanț), nu după rotunjire; cheia = cel mai mic cod', () => {
    const pe = punctePeCod([
      { cod: 'CR-002', p: [0.49, 0, 0] }, { cod: 'CR-001', p: [0.51, 0, 0] },                 // 0,02 mm: același loc
      { cod: 'CR-010', p: [-0.49, -0.49, -400.49] }, { cod: 'CR-011', p: [0.49, 0.49, -399.51] }, // 1,697 mm: locuri diferite
      { cod: 'CR-020', p: [0, 0, 900] }, { cod: 'CR-021', p: [0.9, 0, 900] }, { cod: 'CR-022', p: [1.8, 0, 900] }, // lanț de vecini
    ])
    expect(pe.get('CR-002').cheie).toBe('3d:CR-001')
    expect(pe.get('CR-001').cheie).toBe('3d:CR-001')
    expect(pe.get('CR-001').p).toEqual([0.49, 0, 0])      // poziția primei suduri din model
    expect(pe.get('CR-010').cheie).toBe('3d:CR-010')
    expect(pe.get('CR-011').cheie).toBe('3d:CR-011')
    expect(new Set(['CR-020', 'CR-021', 'CR-022'].map(c => pe.get(c).cheie))).toEqual(new Set(['3d:CR-020']))
    // cheia nu depinde de filtre: CR-002 singură (CR-001 filtrată) rămâne pe locul „3d:CR-001”
    const grup = { prefixe: ['CR'], suduri: [{ cod: 'CR-002', p: [0, 0, 0], cert: 'desen' }, { cod: 'CR-001', p: [0.5, 0, 0], cert: 'desen' }] }
    const toate = [SUD(1, 'CR-001', 'sudat'), SUD(2, 'CR-002')]
    expect(mapeazaSuduri3d(grup, [toate[1]], toate).grupuri.map(g => g.cheie)).toEqual(['3d:CR-001'])
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

  it('review r1: o rotire de 80 px care se întoarce lângă start NU e atingere; tremuratul mic rămâne atingere', () => {
    let g = gestNou(100, 100, 0)
    g = gestMisca(g, 140, 100); g = gestMisca(g, 180, 100); g = gestMisca(g, 103, 101)
    expect(esteAtingere(g, { x: 102, y: 100, t: 300 })).toBe(false)
    let h = gestNou(100, 100, 0)
    h = gestMisca(h, 104, 103); h = gestMisca(h, 101, 100)
    expect(esteAtingere(h, { x: 101, y: 100, t: 200 })).toBe(true)
    expect(gestMisca(null, 1, 1)).toBe(null)
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

  it('cutia unui grup foarte mare nu pică (buclă, nu spread pe zeci de mii de puncte)', () => {
    const elemente = Array.from({ length: 100000 }, (_, i) => ({ a: [i, 0, 0], b: [i, 1, 0] }))
    const c = cutieGrup({ elemente, suduri: [] })
    expect(c.min).toEqual([0, 0, 0])
    expect(c.max).toEqual([99999, 1, 0])
  })
})

// ═══════════ varianta B: amplasarea grupurilor și vederea „Toată instalația” ═══════════
// Model sintetic (nu e nodul real): trei grupuri, două amplasate, unul nu. Valorile transformate sunt calculate de mână.
const MODEL_B = () => {
  const j = MODEL()
  j.grupuri[0].amplasare = { origine: [0, 0, -1500], rot_z: 0 }           // rezervoarele: doar coborâte 1,5 m
  j.grupuri[0].suduri.push({ cod: 'CR-020', p: [8000, 0, 2000], cert: 'desen' }) // ajunge în (8000, 0, 500)
  j.grupuri.push({
    id: 'gara', titlu: 'Gara', prefixe: ['CP'], teren_z: 0,
    amplasare: { origine: [10000, 0, 0], rot_z: 90 },
    elemente: [
      { tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 300 },
      { tip: 'eticheta', p: [0, 2000, 800], text: 'spre stație' },
    ],
    suduri: [
      { cod: 'CP-001', p: [1000, 0, 0], cert: 'desen' },      // rot 90: (0, 1000, 0) + (10000, 0, 0) = (10000, 1000, 0)
      { cod: 'CP-002', p: [0, 2000, 500], cert: 'desen' },    // rot 90: (-2000, 0, 500) + … = (8000, 0, 500) = locul lui CR-020
      { cod: 'CP-077', p: [0, 0, 0], cert: 'desen' },         // în model, nu în listă
    ],
    fara_pozitie: [{ cod: 'CP-003', motiv: 'de confirmat' }],
  })
  return j                                                    // grupul „gaz” (CI) rămâne fără amplasare
}

describe('amplasare — validare', () => {
  it('lipsă sau null = fără amplasare și fără eroare; validă = păstrată (origine copiată, rotZ)', () => {
    expect(citesteAmplasare(undefined)).toEqual({ amplasare: null, eroare: null })
    expect(citesteAmplasare(null)).toEqual({ amplasare: null, eroare: null })
    const o = [1, 2, 3]
    const r = citesteAmplasare({ origine: o, rot_z: -45.5 })
    expect(r).toEqual({ amplasare: { origine: [1, 2, 3], rotZ: -45.5 }, eroare: null })
    expect(r.amplasare.origine).not.toBe(o)
    expect(citesteAmplasare({ origine: [0, 0, 0], rot_z: 360 }).eroare).toBe(null)
    expect(citesteAmplasare({ origine: [0, 0, 0], rot_z: -360 }).eroare).toBe(null)
  })

  it('invalidă = eroare cu motiv (formă, origine, rot_z, câmpuri necunoscute)', () => {
    for (const [a, motiv] of [
      [[0, 0, 0], /nu e un obiect/],
      ['sus', /nu e un obiect/],
      [{ origine: [0, 0], rot_z: 0 }, /originea/],
      [{ origine: [0, Number.NaN, 0], rot_z: 0 }, /originea/],
      [{ origine: [0, 0, 1e6 + 1], rot_z: 0 }, /originea/],
      [{ origine: [0, 0, '0'], rot_z: 0 }, /originea/],
      [{ rot_z: 0 }, /originea/],
      [{ origine: [0, 0, 0] }, /rot_z/],
      [{ origine: [0, 0, 0], rot_z: '90' }, /rot_z/],
      [{ origine: [0, 0, 0], rot_z: 360.5 }, /rot_z/],
      [{ origine: [0, 0, 0], rot_z: Number.POSITIVE_INFINITY }, /rot_z/],
      [{ origine: [0, 0, 0], rot_z: 0, rotz: 90 }, /câmpuri necunoscute \(rotz\)/],
    ]) {
      const r = citesteAmplasare(a)
      expect(r.amplasare).toBe(null)
      expect(r.eroare).toMatch(motiv)
    }
  })

  it('în parseModel3d: amplasarea invalidă e eroare vizibilă pe grup, iar grupul RĂMÂNE (fără amplasare, L12)', () => {
    const j = MODEL_B()
    j.grupuri[1].amplasare = { origine: [0, 0, 0], rot_z: 400 }
    const m = parseModel3d(j)
    expect(m.grupuri.map(g => g.id)).toEqual(['rez', 'gaz', 'gara'])
    expect(m.grupuri[1].amplasare).toBe(null)
    expect(m.grupuri[1].suduri.map(s => s.cod)).toEqual(['CI-001'])
    expect(m.erori).toEqual(['Grupul 2 (gaz): rot_z lipsește sau nu e un număr între -360 și 360; grupul nu apare în „Toată instalația”, doar în vederea lui'])
    expect(m.grupuri[0].amplasare).toEqual({ origine: [0, 0, -1500], rotZ: 0 })
    expect(m.grupuri[2].amplasare).toEqual({ origine: [10000, 0, 0], rotZ: 90 })
  })

  it('o amplasare care scoate punctele grupului în afara ±1 km e refuzată (grupul rămâne în vederea lui)', () => {
    const j = MODEL_B()
    j.grupuri[2].amplasare = { origine: [999500, 0, 0], rot_z: 0 }   // țeava ajunge la x = 1 000 500 mm
    const m = parseModel3d(j)
    expect(m.grupuri[2].amplasare).toBe(null)
    expect(m.grupuri[2].elemente).toHaveLength(2)
    expect(m.erori).toEqual(['Grupul 3 (gara): amplasarea scoate grupul în afara ±1 km; grupul nu apare în „Toată instalația”, doar în vederea lui'])
  })
})

describe('amplasare — transformarea punctelor', () => {
  const T = (p, origine, rotZ) => transformaPunct(p, { origine, rotZ })
  it('rotirea în jurul lui z (sens trigonometric), apoi translația; z doar se translatează', () => {
    expect(T([1000, 0, 0], [0, 0, 0], 90)).toEqual([0, 1000, 0])            // exact, fără 6e-17
    expect(T([1000, 0, 0], [0, 0, 0], -90)).toEqual([0, -1000, 0])
    expect(T([1000, 0, 0], [0, 0, 0], 180)).toEqual([-1000, 0, 0])
    expect(T([1000, 0, 0], [0, 0, 0], 270)).toEqual([0, -1000, 0])
    expect(T([1000, 2000, 300], [0, 0, 0], 360)).toEqual([1000, 2000, 300])
    expect(T([0, 2000, 500], [10000, 0, 0], 90)).toEqual([8000, 0, 500])
    expect(T([5, 6, 7], [100, 200, -300], 0)).toEqual([105, 206, -293])
    const r30 = T([1000, 0, 0], [0, 0, 0], 30)                             // cos 30° = 0,8660254; sin 30° = 0,5
    expect(r30[0]).toBeCloseTo(866.0254, 3); expect(r30[1]).toBeCloseTo(500, 6); expect(r30[2]).toBe(0)
    const r45 = T([1000, 1000, 0], [10, 20, 30], 45)                         // (0, √2·1000) + translația
    expect(r45[0]).toBeCloseTo(10, 6); expect(r45[1]).toBeCloseTo(1434.2136, 3); expect(r45[2]).toBe(30)
    expect(transformaPunct([1, 2, 3], null)).toEqual([1, 2, 3])
  })

  it('aplicaAmplasare mută toate punctele pieselor (a, b, c, r, p) și ale sudurilor; grupul sursă nu se schimbă', () => {
    const g = parseModel3d(MODEL_B()).grupuri[2]
    const a = aplicaAmplasare(g)
    expect(a.elemente[0]).toMatchObject({ tip: 'teava', a: [10000, 0, 0], b: [10000, 1000, 0], dn: 300 })
    expect(a.elemente[1]).toMatchObject({ tip: 'eticheta', p: [8000, 0, 800], text: 'spre stație' })
    expect(a.suduri.map(s => s.p)).toEqual([[10000, 1000, 0], [8000, 0, 500], [10000, 0, 0]])
    expect(g.suduri[0].p).toEqual([1000, 0, 0])
    expect(g.elemente[0].b).toEqual([1000, 0, 0])
    const cot = aplicaAmplasare({ amplasare: { origine: [0, 0, 0], rotZ: 180 }, elemente: [{ tip: 'cot', a: [1, 0, 0], c: [2, 0, 0], b: [2, 3, 0] }], suduri: [] })
    expect(cot.elemente[0]).toMatchObject({ a: [-1, 0, 0], c: [-2, 0, 0], b: [-2, -3, 0] })
  })
})

describe('vederea „Toată instalația”', () => {
  it('compatibil înapoi: modelul fără amplasare se citește ca înainte și nu are vedere comună', () => {
    const m = parseModel3d(MODEL())
    expect(m.erori).toEqual([])
    expect(m.grupuri.map(g => g.amplasare)).toEqual([null, null])
    expect(instalatia(m)).toBe(null)
    const toate = [SUD(1, 'CR-001'), SUD(4, 'CR-114')]
    const r = mapeazaSuduri3d(m.grupuri[0], toate, toate)
    expect(r.grupuri[0]).not.toHaveProperty('parti')                       // forma veche, fără câmpuri noi
    expect(Object.keys(r.grupuri[0]).sort()).toEqual(['cert', 'cheie', 'p', 'puncte'])
  })

  it('un singur grup amplasat = fără vedere comună', () => {
    const j = MODEL_B(); delete j.grupuri[2].amplasare
    expect(instalatia(parseModel3d(j))).toBe(null)
  })

  it('cu două grupuri amplasate: reuniunea lor transformată, teren la z = 0, grupul neamplasat enumerat', () => {
    const inst = instalatia(parseModel3d(MODEL_B()))
    expect(inst.id).toBe(ID_INSTALATIE)
    expect(inst.terenZ).toBe(0)
    expect(inst.parti.map(p => p.id)).toEqual(['rez', 'gara'])
    expect(inst.neamplasate).toEqual([{ id: 'gaz', titlu: 'Alimentare' }])
    expect(inst.prefixe).toEqual(['CR', 'CP'])
    expect(inst.suduri.map(s => s.cod)).toEqual(['CR-001', 'CR-002', 'CR-003', 'CR-009', 'CR-020', 'CP-001', 'CP-002', 'CP-077'])
    expect(inst.suduri.find(s => s.cod === 'CR-001').p).toEqual([1000, 0, -1500])
    expect(inst.suduri.find(s => s.cod === 'CP-001').p).toEqual([10000, 1000, 0])
    expect(inst.elemente).toHaveLength(5 + 2)
  })

  it('maparea pe reuniune: „fără loc” și „în model, lipsă din listă” fără dubluri; sudurile la același loc din două grupuri = o sferă', () => {
    const inst = instalatia(parseModel3d(MODEL_B()))
    const toate = [
      SUD(1, 'CR-001'), SUD(2, 'CR-020'), SUD(3, 'CP-001', 'sudat'), SUD(4, 'CP-002'),
      SUD(5, 'CR-114'), SUD(6, 'CP-003'), SUD(7, 'CP-050'),              // fără loc: din fara_pozitie (2) + lipsă cu totul (1)
      SUD(8, 'CI-001'),                                                  // grupul neamplasat: nu e „fără loc” aici
    ]
    const r = mapeazaSuduri3d(inst, toate, toate)
    expect(r.faraLoc.map(s => s.cod)).toEqual(['CR-114', 'CP-003', 'CP-050'])
    expect(r.inModelFaraLista).toEqual(['CR-002', 'CR-003', 'CR-009', 'CP-077'])
    const loc = r.grupuri.find(g => g.puncte.length === 2)
    expect(loc.puncte.map(p => p.sudura.cod)).toEqual(['CR-020', 'CP-002'])
    expect(loc.cheie).toBe('3d:CP-002')
    expect(loc.parti).toEqual(['rez', 'gara'])
    expect(r.grupuri.find(g => g.cheie === '3d:CR-001').parti).toEqual(['rez'])
    expect(r.grupuri.find(g => g.cheie === '3d:CP-001').parti).toEqual(['gara'])
    expect(r.grupuri.reduce((n, g) => n + g.puncte.length, 0)).toBe(4)  // fiecare sudură o singură dată
  })

  it('puncteVizibile: un loc se ascunde doar dacă toate grupurile lui sunt ascunse', () => {
    const l = [{ cheie: 'a', parti: ['rez'] }, { cheie: 'b', parti: ['rez', 'gara'] }, { cheie: 'c', parti: ['gara'] }, { cheie: 'd' }]
    expect(puncteVizibile(l, new Set())).toBe(l)
    expect(puncteVizibile(l, new Set(['rez'])).map(x => x.cheie)).toEqual(['b', 'c', 'd'])
    expect(puncteVizibile(l, new Set(['rez', 'gara'])).map(x => x.cheie)).toEqual(['d'])
    expect(puncteVizibile(null, new Set(['rez']))).toEqual([])
  })

  it('locurile pe grilă: vecinii din celule alăturate (și pe negative) se unesc, peste 1 mm nu', () => {
    const pe = punctePeCod([
      { cod: 'CP-001', p: [-0.5, 0, 0] }, { cod: 'CP-002', p: [0.4, 0, 0] },        // 0,9 mm, celule -1 și 0
      { cod: 'CP-010', p: [5000, 0, 0] }, { cod: 'CP-011', p: [5001.01, 0, 0] },    // 1,01 mm: separate
      { cod: 'CP-020', p: [0, 0, 7000.2] }, { cod: 'CP-021', p: [0, 0.6, 7000.9] }, // 0,922 mm pe diagonală
    ])
    expect(pe.get('CP-002').cheie).toBe('3d:CP-001')
    expect(pe.get('CP-011').cheie).toBe('3d:CP-011')
    expect(pe.get('CP-021').cheie).toBe('3d:CP-020')
    // mulți vecini pe o linie (lanț de 0,9 mm) = un singur loc, iar o mie de suduri distincte nu se unesc
    const lant = Array.from({ length: 50 }, (_, i) => ({ cod: `CR-${100 + i}`, p: [i * 0.9, 0, 0] }))
    expect(new Set([...punctePeCod(lant).values()].map(v => v.cheie))).toEqual(new Set(['3d:CR-100']))
    const multe = Array.from({ length: 1000 }, (_, i) => ({ cod: `CR-${1000 + i}`, p: [(i % 40) * 1000, Math.floor(i / 40) * 1000, 0] }))
    expect(new Set([...punctePeCod(multe).values()].map(v => v.cheie)).size).toBe(1000)
  })

  // ── review r1 (P2): grila trebuie să dea EXACT rezultatul variantei fiecare-cu-fiecare, și la limita numerică a pragului ──
  // Referința e scrisă aici, independent: componente conexe prin parcurgere (BFS) pe toate perechile, aceeași regulă din
  // specificație (distanța 3D ≤ 1 mm, Math.hypot), cheia = cel mai mic cod, poziția = a primei suduri din listă.
  const referinta = l => {
    const comp = new Array(l.length).fill(-1)
    for (let s = 0; s < l.length; s++) {
      if (comp[s] !== -1) continue
      comp[s] = s
      const coada = [s]
      while (coada.length) {
        const i = coada.shift()
        for (let j = 0; j < l.length; j++) {
          if (comp[j] !== -1) continue
          const a = l[i].p, b = l[j].p
          if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1) { comp[j] = s; coada.push(j) }
        }
      }
    }
    const coduri = new Map()
    l.forEach((x, i) => { if (!coduri.has(comp[i])) coduri.set(comp[i], []); coduri.get(comp[i]).push(x.cod) })
    return new Map(l.map((x, i) => [x.cod, { cheie: `3d:${[...coduri.get(comp[i])].sort()[0]}`, p: l[comp[i]].p }]))
  }
  const caSiReferinta = l => expect(Object.fromEntries(punctePeCod(l))).toEqual(Object.fromEntries(referinta(l)))

  it('review r1: contraexemplul [0.9999999999999999,0,0] / [2,0,0] (hypot rotunjit = 1) = același loc, ca fiecare-cu-fiecare', () => {
    const l = [{ cod: 'CP-001', p: [2, 0, 0] }, { cod: 'CP-002', p: [0.9999999999999999, 0, 0] }]
    expect(Math.hypot(2 - 0.9999999999999999, 0, 0)).toBe(1)             // premisa contraexemplului
    const pe = punctePeCod(l)
    expect(pe.get('CP-002')).toEqual({ cheie: '3d:CP-001', p: [2, 0, 0] })   // cheia ȘI poziția celei dintâi
    caSiReferinta(l)
    // aceeași limită pe celelalte axe, cu semn negativ și departe de origine (după amplasare, la ±1 km)
    caSiReferinta([{ cod: 'CR-001', p: [0, -0.9999999999999999, 0] }, { cod: 'CR-002', p: [0, -2, 0] }])
    caSiReferinta([{ cod: 'CR-003', p: [0, 0, 0.9999999999999999] }, { cod: 'CR-004', p: [0, 0, 2] }])
    caSiReferinta([{ cod: 'CR-005', p: [999998, 0, 0] }, { cod: 'CR-006', p: [999999, 0, 0] }, { cod: 'CR-007', p: [-999999.0000000001, 5, 5] }, { cod: 'CR-008', p: [-1000000, 5, 5] }])
  })

  it('review r1: paritate cu fiecare-cu-fiecare pe 400 de seturi aleatoare (grilă de 1/8 mm, limite de prag, coordonate mari)', () => {
    let st = 12345
    const rnd = () => { st = (st * 1103515245 + 12345) % 2147483648; return st / 2147483648 }
    // puține valori distincte pe axă: perechile care diferă pe o singură axă (exact cazul de limită) apar des
    const limite = [0, 0.5, 1, 0.9999999999999999, 1.0000000000000002, 2, 1.9999999999999998, 3, -0.9999999999999999, -1, -2]
    const baze = [0, 0, -0.0000001, 999997.5, -999998.25, 123.456]
    let unite = 0
    for (let t = 0; t < 400; t++) {
      const baza = baze[t % baze.length], n = 2 + Math.floor(rnd() * 40)
      const coord = () => baza + (rnd() < 0.8 ? limite[Math.floor(rnd() * limite.length)] : Math.floor(rnd() * 32) / 8)
      const l = Array.from({ length: n }, (_, i) => ({ cod: `CP-${String(i).padStart(3, '0')}`, p: [coord(), coord(), coord()] }))
      unite += new Set([...referinta(l).values()].map(v => v.cheie)).size < n ? 1 : 0
      caSiReferinta(l)
    }
    expect(unite).toBeGreaterThan(100)                                 // seturile chiar conțin locuri cu mai multe suduri
  })

  it('review r1: planul îndepărtat = distanța până la centru + raza scenei (+5%), cel puțin 1000 m, niciodată NaN', () => {
    expect(departareCamera(30, 12)).toBe(1000)                         // nod obișnuit: proiecția de dinainte
    expect(departareCamera(1500, 905)).toBeCloseTo(2525.25, 9)         // (1500 + 905) × 1,05 — dincolo de 1000 m
    expect(departareCamera(1500, 905)).toBeGreaterThan(1500 + 905)     // tot ce e în sferă rămâne înaintea planului
    expect(departareCamera(NaN, 5)).toBe(1000)
    expect(departareCamera(Infinity, 5)).toBe(1000)
  })
})
