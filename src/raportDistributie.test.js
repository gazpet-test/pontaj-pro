import { describe, it, expect } from 'vitest'
import { randNou, randCompletat, valideaza, pentruSalvare, dinBd, antetImplicit, buildHtml, numeFisier, DIAMETRE_PE, RANDURI_PDF } from './raportDistributie.js'

describe('valori implicite', () => {
  it('conductă: „Montat conducta”, fără diametru; branșament: „Branșament”, Ø32', () => {
    expect(randNou('conducta')).toMatchObject({ tabel: 'conducta', descriere: 'Montat conducta', diametru_mm: '' })
    expect(randNou('bransament')).toMatchObject({ tabel: 'bransament', descriere: 'Branșament', diametru_mm: 32, se1: '', se2: '', se3: '' })
  })
  it('un rând doar cu implicite nu contează (nu se salvează, nu se validează)', () => {
    expect(randCompletat(randNou('bransament'))).toBe(false)
    expect(randCompletat({ ...randNou('conducta'), tronson: 'T1' })).toBe(true)
    expect(randCompletat({ ...randNou('conducta'), unitate_id: 5 })).toBe(true)
    expect(valideaza([randNou('conducta'), randNou('bransament')])).toEqual([])
    expect(pentruSalvare([randNou('conducta')], 1)).toEqual([])
  })
  it('lista de diametre PE include 32 și e crescătoare', () => {
    expect(DIAMETRE_PE).toContain(32)
    expect([...DIAMETRE_PE].sort((a, b) => a - b)).toEqual(DIAMETRE_PE)
  })
})

describe('validări', () => {
  const c = (p) => ({ ...randNou('conducta'), tronson: 'T1', diametru_mm: 63, lungime_m: '12.5', ...p })
  const b = (p) => ({ ...randNou('bransament'), tronson: 'str. X', lungime_m: '6', ...p })
  it('rânduri corecte → fără erori', () => {
    expect(valideaza([c({ suduri_nr: '3', sudura_tip: 'electrofuziune' }), b({ se1: 'S12', se2: 'S13' })])).toEqual([])
  })
  it('lungime lipsă / negativă / text', () => {
    expect(valideaza([c({ lungime_m: '' })])[0]).toMatch(/lipsește lungimea/)
    expect(valideaza([c({ lungime_m: '-2' })])[0]).toMatch(/număr pozitiv/)
    expect(valideaza([c({ lungime_m: 'abc' })])[0]).toMatch(/număr pozitiv/)
    expect(valideaza([c({ lungime_m: '7,5' })])).toEqual([])
  })
  it('diametru lipsă sau în afara listei', () => {
    expect(valideaza([c({ diametru_mm: '' })])[0]).toMatch(/alege diametrul/)
    expect(valideaza([c({ diametru_mm: 33 })])[0]).toMatch(/diametru necunoscut/)
  })
  it('suduri: întreg ≥ 0 și tip din listă', () => {
    expect(valideaza([c({ suduri_nr: '2.5' })])[0]).toMatch(/întreg/)
    expect(valideaza([c({ sudura_tip: 'laser' })])[0]).toMatch(/tip de sudură/)
  })
  it('SE prea lung și numerotare pe tabel în mesaj', () => {
    const e = valideaza([b({}), b({ se3: 'x'.repeat(41) })])
    expect(e).toEqual(['Branșament rândul 2: SE3 are peste 40 de caractere'])
  })
})

describe('salvare / încărcare', () => {
  it('numerotează separat pe tabel, curăță câmpurile celuilalt tabel, convertește numerele', () => {
    const rows = pentruSalvare([
      { ...randNou('conducta'), tronson: ' T1 ', diametru_mm: '110', lungime_m: '10,5', suduri_nr: '4', sudura_tip: 'cap_la_cap', se1: 'nu' },
      randNou('bransament'),
      { ...randNou('bransament'), tronson: 'B1', lungime_m: '3', se1: 'S1', suduri_nr: '9' },
      { ...randNou('conducta'), unitate_id: 7, diametru_mm: 63, lungime_m: 2 },
    ], 99)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ raport_id: 99, tabel: 'conducta', nr_crt: 1, tronson: 'T1', diametru_mm: 110, lungime_m: 10.5, suduri_nr: 4, sudura_tip: 'cap_la_cap', se1: null })
    expect(rows[1]).toMatchObject({ tabel: 'bransament', nr_crt: 1, se1: 'S1', suduri_nr: null, sudura_tip: null, diametru_mm: 32 })
    expect(rows[2]).toMatchObject({ tabel: 'conducta', nr_crt: 2, unitate_id: 7, tronson: null })
  })
  it('dinBd ordonează conducte apoi branșamente, pe nr_crt', () => {
    const r = dinBd([
      { tabel: 'bransament', nr_crt: 2, se1: 'b' }, { tabel: 'conducta', nr_crt: 1, suduri_nr: 3 }, { tabel: 'bransament', nr_crt: 1, se1: 'a' },
    ])
    expect(r.map(x => x.tabel + (x.se1 || x.suduri_nr))).toEqual(['conducta3', 'bransamenta', 'bransamentb'])
  })
  it('antet implicit: adresa lucrării, altfel numele', () => {
    expect(antetImplicit({ adresa: 'Ploiești, str. Gării', numeLucrare: 'X' })).toBe('Ploiești, str. Gării')
    expect(antetImplicit({ adresa: '', numeLucrare: 'Bucov' })).toBe('Bucov')
  })
})

describe('PDF (HTML)', () => {
  it('are titlul, cele două antete și completează cu rânduri goale până la 4 / 10', () => {
    const h = buildHtml({ antet: 'Bucov', data: '2026-10-13', linii: [{ tabel: 'conducta', tronson: 'T1', descriere: 'Montat conducta', diametru_mm: 63, lungime_m: 12 }], unitati: [] })
    expect(h).toContain('RAPORT LUCRARI EXECUTATE')
    expect(h).toContain('SUDURI / Tip Sudura')
    expect(h).toContain('SE 1 (TEU)')
    expect(h).toContain('SE 3 (MUFA)')
    expect((h.match(/<tr>/g) || []).length).toBe(1 + RANDURI_PDF.conducta + 2 + RANDURI_PDF.bransament)
    expect(h).toContain('Bucov — 13.10.2026')
  })
  it('scapă HTML-ul din câmpurile libere și afișează tronsonul din listă', () => {
    const h = buildHtml({ antet: '<b>x</b>', linii: [{ tabel: 'bransament', unitate_id: 3, observatii: '<script>', diametru_mm: 32, lungime_m: 4, se1: 'S&1' }], unitati: [{ id: 3, cod: 'TR2', nume: 'Str. Lungă' }] })
    expect(h).not.toContain('<script>')
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(h).toContain('TR2 · Str. Lungă')
    expect(h).toContain('S&amp;1')
  })
  it('mai multe rânduri decât pe hârtie → toate apar', () => {
    const linii = Array.from({ length: 12 }, (_, i) => ({ tabel: 'bransament', tronson: 'B' + i, diametru_mm: 32, lungime_m: 1 }))
    expect(buildHtml({ linii }).match(/<tr>/g).length).toBe(1 + 4 + 2 + 12)
  })
  it('nume de fișier curat', () => {
    expect(numeFisier({ lucrare: 'Distribuție Bucov / etapa 2', data: '2026-10-13' })).toBe('Raport_lucrari_Distribu_ie_Bucov_etapa_2_2026-10-13.pdf')
  })
})
