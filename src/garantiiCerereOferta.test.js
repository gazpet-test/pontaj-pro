// Generatorul cererii de ofertă poliță GBE / avans / CAR (claude_context #1519, 02.10.2026) — logica pură
import { describe, it, expect } from 'vitest'
import { sumaInLitere, numarInLitere, fmtSuma, fmtData, valoareDinProcent, adaugaLuni, textCerereOferta, lipsuriCerere,
  tipuriDisponibile, areGoluri, marcajCerereTrimisa, adaugaMarcaj, precompleteazaDinContract, precompleteazaDinGarantie, LIPSA } from './garantiiCerereOferta.js'

describe('sume în litere', () => {
  it('numere simple, teens, zeci', () => {
    expect(numarInLitere(0)).toBe('zero')
    expect(numarInLitere(7)).toBe('șapte')
    expect(numarInLitere(12)).toBe('doisprezece')
    expect(numarInLitere(21)).toBe('douăzeci și unu')
    expect(numarInLitere(99)).toBe('nouăzeci și nouă')
  })
  it('sute și mii (feminine), milioane', () => {
    expect(numarInLitere(100)).toBe('o sută')
    expect(numarInLitere(212)).toBe('două sute doisprezece')
    expect(numarInLitere(1000)).toBe('o mie')
    expect(numarInLitere(2500)).toBe('două mii cinci sute')
    expect(numarInLitere(12000)).toBe('douăsprezece mii')
    expect(numarInLitere(21000)).toBe('douăzeci și una de mii')
    expect(numarInLitere(1000000)).toBe('un milion')
    expect(numarInLitere(3200000)).toBe('trei milioane două sute de mii')
  })
  it('„de” înaintea substantivului doar la 0 / ≥ 20 pe ultimul grup', () => {
    expect(sumaInLitere(1)).toBe('un leu')
    expect(sumaInLitere(2)).toBe('doi lei')
    expect(sumaInLitere(19)).toBe('nouăsprezece lei')
    expect(sumaInLitere(20)).toBe('douăzeci de lei')
    expect(sumaInLitere(100)).toBe('o sută de lei')
    expect(sumaInLitere(101)).toBe('o sută unu lei')
    expect(sumaInLitere(1000)).toBe('o mie de lei')
  })
  it('bani, euro, intrare cu virgulă, valori invalide', () => {
    expect(sumaInLitere('1234,56')).toBe('o mie două sute treizeci și patru de lei și cincizeci și șase de bani')
    expect(sumaInLitere(0.01)).toBe('zero lei și un ban')
    expect(sumaInLitere(327478.5)).toBe('trei sute douăzeci și șapte de mii patru sute șaptezeci și opt de lei și cincizeci de bani')
    expect(sumaInLitere(2.05, 'EUR')).toBe('doi euro și cinci cenți')
    expect(sumaInLitere(-3)).toBe('')
    expect(sumaInLitere('abc')).toBe('')
  })
})

describe('formatări și calcule', () => {
  it('fmtSuma / fmtData fără locale', () => {
    expect(fmtSuma(1234567.8)).toBe('1.234.567,80 RON')
    expect(fmtSuma('12,5', 'EUR')).toBe('12,50 EUR')
    expect(fmtSuma('')).toBe('')
    expect(fmtData('2026-10-02')).toBe('02.10.2026')
    expect(fmtData('2026-10-02T10:00:00Z')).toBe('02.10.2026')
    expect(fmtData(null)).toBe('')
  })
  it('valoarea din procent și luni calendaristice', () => {
    expect(valoareDinProcent(100000, 10)).toBe(10000)
    expect(valoareDinProcent(123456.78, 5)).toBe(6172.84)
    expect(valoareDinProcent(0, 5)).toBe('')
    expect(adaugaLuni('2026-01-31', 1)).toBe('2026-03-03') // februarie n-are 31 → rulare, ca Date
    expect(adaugaLuni('2026-06-15', 24)).toBe('2028-06-15')
    expect(adaugaLuni('', 3)).toBeNull()
  })
  it('tipurile disponibile depind de ce permite BD (CAR doar după 20261002e)', () => {
    expect(tipuriDisponibile()).toEqual(['buna_executie', 'avans'])
    expect(tipuriDisponibile(['buna_executie', 'participare', 'mentenanta', 'avans', 'car'])).toEqual(['buna_executie', 'avans', 'car'])
    expect(tipuriDisponibile([])).toEqual([])
  })
})

const d = { beneficiar: 'Comuna Comișani', contract_numar: '12', contract_data: '2026-03-01', lucrare: 'Extindere rețea gaze',
  valoare_contract: 1000000, valoare: 100000, procent: 10, moneda: 'RON', valabil_de: '2026-03-01', valabil_pana: '2028-09-01', perioada_garantie_luni: 24 }

describe('textCerereOferta', () => {
  it('GBE complet: subiect, valoare cu procent și litere, perioadă, fără goluri', () => {
    const t = textCerereOferta('buna_executie', d)
    expect(t.lipsuri).toEqual([])
    expect(t.subiect).toBe('Solicitare ofertă Poliță garanție de bună execuție — contract nr. 12 — Comuna Comișani')
    expect(t.corp).toContain('Polița de asigurare de garanție de bună execuție')
    expect(t.corp).toContain('- Contract nr. 12 din 01.03.2026')
    expect(t.corp).toContain('- Valoarea contractului: 1.000.000,00 RON (fără TVA)')
    expect(t.corp).toContain('- Valoarea garanției de bună execuție: 100.000,00 RON (10% din valoarea contractului) — adică o sută de mii de lei')
    expect(t.corp).toContain('01.03.2026 – 01.09.2028 (acoperă execuția și perioada de garanție de 24 luni')
    expect(t.corp).toContain('la prima cerere scrisă a beneficiarului')
    expect(areGoluri(t.corp)).toBe(false)
  })
  it('avans și CAR au clauzele lor; CAR cere limita RC explicit', () => {
    const a = textCerereOferta('avans', { ...d, valoare: 50000, procent: '' })
    expect(a.subiect).toMatch(/returnare avans/)
    expect(a.corp).toContain('- Valoarea avansului garantat: 50.000,00 RON — adică cincizeci de mii de lei')
    expect(a.corp).toContain('amortizarea integrală a avansului')
    expect(a.corp).not.toContain('din valoarea contractului)')
    const c = textCerereOferta('car', { ...d, valoare: 1000000, procent: '' })
    expect(c.corp).toContain('- Suma asigurată (valoarea lucrărilor): 1.000.000,00 RON')
    expect(c.corp).toContain('Contractor’s All Risks')
    expect(areGoluri(c.corp)).toBe(true) // limita RC necompletată
    expect(areGoluri(textCerereOferta('car', { ...d, procent: '', limita_rc: 200000 }).corp)).toBe(false)
  })
  it('câmpurile lipsă apar ca [DE COMPLETAT] și în lista de lipsuri; tip necunoscut = refuz', () => {
    const t = textCerereOferta('buna_executie', { beneficiar: 'X' })
    expect(t.corp).toContain(`- Contract nr. ${LIPSA}`)
    expect(t.corp).toContain(`- Valoarea garanției de bună execuție: ${LIPSA}`)
    expect(t.corp).not.toContain('Valoarea contractului')
    expect(t.lipsuri).toEqual(['numărul contractului', 'obiectul contractului / lucrarea', 'valoarea garanției', 'perioada de valabilitate'])
    expect(areGoluri(t.corp)).toBe(true)
    expect(textCerereOferta('mentenanta', d).lipsuri).toEqual(['tipul garanției'])
    expect(lipsuriCerere('buna_executie', { ...d, valabil_pana: '2025-01-01' })).toEqual(['perioada de valabilitate (sfârșitul e înaintea începutului)'])
  })
})

describe('precompletare și marcaj', () => {
  it('din contract: GBE = valoare × procent, sfârșit = termen + luni garanție; CAR = valoarea contractului', () => {
    const c = { id: 7, numar_contract: '45', denumire: 'Branșamente', data_semnare: '2026-02-10', data_termen: '2026-12-10',
      valoare_lei: 800000, garantie_buna_executie_pct: 5, garantie_perioada_luni: 36, beneficiar: { nume: 'Distrigaz' } }
    const g = precompleteazaDinContract(c, 'buna_executie')
    expect(g).toMatchObject({ contract_terti_id: 7, beneficiar: 'Distrigaz', valoare: 40000, procent: 5, valabil_de: '2026-02-10', valabil_pana: '2029-12-10', perioada_garantie_luni: 36 })
    const car = precompleteazaDinContract(c, 'car')
    expect(car).toMatchObject({ valoare: 800000, procent: '', valabil_pana: '2026-12-10' })
    const av = precompleteazaDinContract(c, 'avans')
    expect(av).toMatchObject({ valoare: '', procent: '' })
  })
  it('din rândul registrului: păstrează id-ul garanției și tipul permis', () => {
    const r = precompleteazaDinGarantie({ id: 3, tip: 'avans', beneficiar: 'B', contract_numar: '1', valoare: 10, data_expirare: '2027-01-01' })
    expect(r).toMatchObject({ garantie_id: 3, tip: 'avans', valabil_pana: '2027-01-01', valoare: 10 })
    expect(precompleteazaDinGarantie({ tip: 'participare' }).tip).toBe('buna_executie')
  })
  it('marcajul se adaugă la observații fără să șteargă nimic', () => {
    const m = marcajCerereTrimisa({ broker: 'Safety Broker', cine: 'Mioara', la: '2026-10-02' })
    expect(m).toBe('⟦cerere-oferta⟧ 02.10.2026 → Safety Broker (Mioara)')
    expect(adaugaMarcaj('vechi', m)).toBe(`vechi\n${m}`)
    expect(adaugaMarcaj('', m)).toBe(m)
  })
})
