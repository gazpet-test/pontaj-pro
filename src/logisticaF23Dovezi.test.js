// TKT-2026-0362 — F23 pe o categorie, cu dovada deținerii / chiriei, doar din ce există pe activ.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dovadaActiv, randuriF23Categorie, foaieF23Categorie, DETINERE } from './logisticaF23Dovezi.js'

const AZI = '2026-11-12'

describe('dovada pe activ', () => {
  it('proprietate: nr. de inventar = dovada; lipsa lui e marcată', () => {
    expect(dovadaActiv({ tip_proprietate: 'firma', nr_inventar: ' 2134 ' }, AZI)).toEqual({ detinere: 'Proprietate', dovada: 'nr. inventar 2134', stare: 'ok' })
    expect(dovadaActiv({ tip_proprietate: 'firma', nr_inventar: '', firma_proprietara: 'Gazpet Instal' }, AZI))
      .toEqual({ detinere: 'Proprietate', dovada: 'fără nr. de inventar în evidență · proprietar: Gazpet Instal', stare: 'lipsa' })
    // implicit (tip_proprietate gol) = firmă, ca în formularul activului
    expect(dovadaActiv({ nr_inventar: '7' }, AZI).detinere).toBe(DETINERE.firma)
  })
  it('chirie: contractul atașat, furnizorul, perioada; expirat după ultima zi', () => {
    const a = { tip_proprietate: 'inchiriat', comodat_contract_path: 'x/contract.pdf', inchiriere_furnizor: 'Furnizor Test SRL',
      comodat_data_start: '2026-01-01', comodat_data_sfarsit: '2026-12-31' }
    expect(dovadaActiv(a, AZI)).toEqual({ detinere: 'În chirie', stare: 'ok',
      dovada: 'contract de închiriere atașat · furnizor: Furnizor Test SRL · perioada: 01.01.2026 – 31.12.2026' })
    expect(dovadaActiv({ ...a, comodat_data_sfarsit: '2026-11-12' }, AZI).stare).toBe('ok')        // ultima zi = încă valabil
    expect(dovadaActiv({ ...a, comodat_data_sfarsit: '2026-11-11' }, AZI)).toMatchObject({ stare: 'expirat', dovada: expect.stringMatching(/EXPIRAT$/) })
    expect(dovadaActiv({ ...a, comodat_contract_path: '  ' }, AZI)).toMatchObject({ stare: 'lipsa', dovada: expect.stringMatching(/^LIPSĂ contract atașat/) })
    expect(dovadaActiv({ tip_proprietate: 'inchiriat', comodat_contract_path: 'c.pdf' }, AZI).dovada).toBe('contract de închiriere atașat')
  })
  it('comodat: proprietarul din lista de nume (helperul existent), perioadă nedeterminată', () => {
    const a = { tip_proprietate: 'comodat', comodat_contract_path: 'c.pdf', comodat_employee_id: 5, comodat_data_start: '2026-03-01' }
    expect(dovadaActiv(a, AZI, id => (id === 5 ? 'POPESCU ION' : null)).dovada)
      .toBe('contract de comodat atașat · proprietar: POPESCU ION · perioada: 01.03.2026 – nedeterminat')
  })
  it('formă de deținere necunoscută: nu o ghicim', () => {
    expect(dovadaActiv({ tip_proprietate: 'leasing' }, AZI)).toEqual({ detinere: 'leasing', dovada: 'formă de deținere necunoscută', stare: 'necunoscut' })
  })
})

describe('lista pe categorie', () => {
  const active = [
    { id: 1, categorie_id: 9, marca: 'Ritmo', model: 'Delta 315', cod_intern: 'SA-02', tip_proprietate: 'firma', nr_inventar: '11', stare: 'Functional' },
    { id: 2, categorie_id: 9, marca: 'Ritmo', model: 'Delta 315', cod_intern: 'SA-01', tip_proprietate: 'inchiriat', stare: 'Functional' },
    { id: 3, categorie_id: 9, marca: 'Vândut', cod_intern: 'SA-03', vandut: true },
    { id: 4, categorie_id: 9, marca: 'Conservat', cod_intern: 'SA-04', deep_sleep: true },
    { id: 5, categorie_id: 8, marca: 'Altă categorie', cod_intern: 'EX-01' },
  ]
  it('doar categoria aleasă, fără vândute / conservate, ordonat după denumire și cod', () => {
    const r = randuriF23Categorie(active, '9', AZI)
    expect(r.map(x => x.cod_intern)).toEqual(['SA-01', 'SA-02'])
    expect(r[0]).toMatchObject({ denumire: 'Ritmo Delta 315', detinere: 'În chirie', stare: 'lipsa' })
    expect(r[1]).toMatchObject({ detinere: 'Proprietate', stare: 'ok' })
    expect(randuriF23Categorie(active, 'abc', AZI)).toEqual([])
    expect(randuriF23Categorie(null, 9, AZI)).toEqual([])
  })
  it('foaia Excel: titlu, sumar, antet, rânduri cu verificarea pe înțeles', () => {
    const f = foaieF23Categorie(randuriF23Categorie(active, 9, AZI), 'Aparat sudură · Automată', AZI)
    expect(f[0][0]).toBe('Formular 23 — listă separată: Aparat sudură · Automată')
    expect(f[1][0]).toBe('Situația la 12.11.2026 · 2 bucăți · 1 fără dovadă completă')
    expect(f[3]).toEqual(['Nr. crt.', 'Denumire', 'Cod intern', 'Serie', 'An', 'Stare activ', 'Deținere', 'Dovada', 'Verificare'])
    expect(f[4][8]).toBe('LIPSĂ DOVADĂ')
    expect(f[5][8]).toBe('OK')
  })
})

describe('coloanele folosite = cele salvate de formularul activului (nimic inventat)', () => {
  it('Logistica.jsx salvează exact câmpurile citite aici', () => {
    const src = readFileSync(new URL('./Logistica.jsx', import.meta.url), 'utf8')
    for (const c of ['tip_proprietate', 'comodat_contract_path', 'inchiriere_furnizor', 'comodat_data_start', 'comodat_data_sfarsit', 'comodat_employee_id'])
      expect(src).toMatch(new RegExp(`\\b${c}:`))
  })
})
