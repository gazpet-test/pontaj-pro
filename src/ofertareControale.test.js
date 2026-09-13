import { describe, it, expect } from 'vitest'
import { controlCantitati, controlGarantie, controlAnexe, normalizeazaRef, controlIdentitate, controlNumereCheie, controlParticipare, controlTronsoane } from './ofertareControale.js'

// Regula: referinta = lista F3 (pe ea se pun banii). Memoriu/planse/C6 diferite = de clarificat, nu de ales.
describe('H2 controlCantitati — F3 e referinta, restul se clarifica', () => {
  it('F3 = grafic, restul egal => ok', () =>
    expect(controlCantitati({ lista_f3_m: 18007, lista_c6_m: 18007, memoriu_m: 18007, grafic_fronturi_m: 18007 }).stare).toBe('ok'))
  it('rotunjire sub 0,1 % => warn, nu ok (se spune, nu se ascunde)', () => {
    const r = controlCantitati({ lista_f3_m: 29980, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('warn'); expect(r.diferenta_m).toBe(5)
  })
  it('grafic ≠ F3 => block, cu ambele valori si diferenta', () => {
    const r = controlCantitati({ lista_f3_m: 37320, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('block'); expect(r.diferenta_m).toBe(-7335); expect(r.detalii).toMatch(/37.320/)
  })
  it('372 vs 371 la 0,27 % => block', () =>
    expect(controlCantitati({ lista_f3_m: 372, grafic_fronturi_m: 371 }).stare).toBe('block'))
  it('lipsa F3 => block, chiar daca memoriul e egal cu graficul (Mostistea)', () => {
    const r = controlCantitati({ lista_f3_m: null, memoriu_m: 29980, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('block'); expect(r.detalii).toMatch(/F3/); expect(r.detalii).toMatch(/memoriu 29.980/)
  })
  it('memoriu/planse/C6 diferite de F3 => warn "nerezolvata prin clarificare", nu block, si le listeaza', () => {
    const r = controlCantitati({ lista_f3_m: 6520, lista_c6_m: 7077, memoriu_m: 5455, plansa_m: 4355, grafic_fronturi_m: 6520 })
    expect(r.stare).toBe('warn'); expect(r.neclarificate).toHaveLength(3); expect(r.detalii).toMatch(/clarificare/)
  })
  it('diferenta reala + neclarificate => block, nota de clarificare ramane in detalii', () => {
    const r = controlCantitati({ lista_f3_m: 6520, memoriu_m: 5455, grafic_fronturi_m: 5455 })
    expect(r.stare).toBe('block'); expect(r.detalii).toMatch(/clarificare/)
  })
  it('grafic fara fronturi => warn "nu se poate face"', () =>
    expect(controlCantitati({ lista_f3_m: 100, grafic_fronturi_m: null }).stare).toBe('warn'))
})

describe('H4 controlGarantie — luni + momentul de start, aceleasi peste tot', () => {
  const OK = { garantie_cerut_luni: 36, garantie_cerut_moment: 'pif', garantie_oferit_luni: 36, garantie_oferit_moment: 'pif',
               garantie_confirmata: true, garantie_justificata: false, garantie_luni_in_capitole: [36], garantie_cerinte_lucrari: 3 }
  const g = p => controlGarantie({ ...OK, ...p })
  it('totul aliniat => ok', () => expect(g({}).stare).toBe('ok'))
  it('oferit < cerut => block', () => expect(g({ garantie_oferit_luni: 24 }).stare).toBe('block'))
  it('moment diferit (Hoghilag: PIF vs receptie) => block, cu ambele momente in clar', () => {
    const r = g({ garantie_oferit_moment: 'receptie_terminare' })
    expect(r.stare).toBe('block'); expect(r.detalii).toMatch(/recepția la terminarea/); expect(r.detalii).toMatch(/punerea în funcțiune/)
  })
  it('un capitol pomeneste alt numar de luni => block', () => expect(g({ garantie_luni_in_capitole: [36, 24] }).stare).toBe('block'))
  it('neasumata dar ceruta => block; neasumata si neceruta => warn', () => {
    expect(g({ garantie_oferit_luni: null }).stare).toBe('block')
    expect(g({ garantie_oferit_luni: null, garantie_cerinte_lucrari: 0 }).stare).toBe('warn')
  })
  it('oferita dar cerinta nenotata sau neconfirmata => warn, nu ok', () => {
    expect(g({ garantie_cerut_luni: null, garantie_cerut_moment: null }).stare).toBe('warn')
    expect(g({ garantie_confirmata: false }).stare).toBe('warn')
  })
  it('H-051: oferit peste cerut fara justificare => warn, nu ok (Hoghilag: 60 luni nejustificate)', () => {
    const r = g({ garantie_oferit_luni: 60, garantie_luni_in_capitole: [60] })
    expect(r.stare).toBe('warn'); expect(r.detalii).toMatch(/24 luni peste minim/)
  })
  it('oferit peste cerut CU justificare => ok', () =>
    expect(g({ garantie_oferit_luni: 60, garantie_luni_in_capitole: [60], garantie_justificata: true }).stare).toBe('ok'))
})

describe('H5 controlAnexe — trimiterile din text au piesa in cuprins', () => {
  it('normalizare: Anexa 7 / anexa nr. 7 / ANEXA 7 => anexa:7; Cap. III / capitolul 3 => cap:3; Formularul nr. 5 => formular:5', () => {
    expect(normalizeazaRef('Anexa 7')).toBe('anexa:7'); expect(normalizeazaRef('anexa nr. 7')).toBe('anexa:7')
    expect(normalizeazaRef('Cap. III')).toBe('cap:3'); expect(normalizeazaRef('capitolul 3')).toBe('cap:3')
    expect(normalizeazaRef('Formularul nr. 5')).toBe('formular:5'); expect(normalizeazaRef('Rezumat')).toBeNull()
  })
  it('toate referintele exista => ok', () =>
    expect(controlAnexe({ anexe_referite: ['anexa 7', 'cap. 3'], anexe_existente: ['Anexa 7', 'Cap. III', 'Metodologia'] }).stare).toBe('ok'))
  it('o referinta fara piesa => block si o numeste', () => {
    const r = controlAnexe({ anexe_referite: ['anexa 7', 'formularul nr. 5'], anexe_existente: ['Anexa 7'] })
    expect(r.stare).toBe('block'); expect(r.lipsa).toEqual(['formular:5']); expect(r.detalii).toMatch(/Formularul 5/)
  })
  it('fara referinte => ok (nu warn: nu e obligatoriu sa trimiti la anexe)', () =>
    expect(controlAnexe({ anexe_referite: null, anexe_existente: ['Anexa 1'] }).stare).toBe('ok'))
  it('etichetele existente vin si din nr-ul capitolului (cap. 4)', () =>
    expect(controlAnexe({ anexe_referite: ['capitolul 4'], anexe_existente: ['cap. 4'] }).stare).toBe('ok'))
})

describe('H1 controlIdentitate — numele altei lucrari ramas in text', () => {
  it('niciun nume strain => ok', () => expect(controlIdentitate({ identitate_straine: [] }).stare).toBe('ok'))
  it('null (nicio proba) => ok, nu warn', () => expect(controlIdentitate({ identitate_straine: null }).stare).toBe('ok'))
  it('nume strain => WARN, nu block: experienta similara numeste legitim alte lucrari (Hoghilag)', () => {
    const r = controlIdentitate({ identitate_straine: ['Domnesti', 'Ilfov'] })
    expect(r.stare).toBe('warn'); expect(r.detalii).toMatch(/Domnesti, Ilfov/)
    expect(r.detalii).toMatch(/experien[țt]/); expect(r.detalii).toMatch(/contaminare/)
  })
  it('dubluri se strang intr-una', () => expect(controlIdentitate({ identitate_straine: ['Racari', 'Racari'] }).straine).toEqual(['Racari']))
})

describe('H6 controlNumereCheie — 372 vs 371 bransamente (Hoghilag)', () => {
  const n = p => controlNumereCheie(p)
  it('acelasi numar peste tot => ok', () => expect(n({ bransamente_in_capitole: [372], bransamente_in_cerinte: [372] }).stare).toBe('ok'))
  it('capitolele nu confirma niciun numar din cerinte (758 vs 372) => block', () => {
    const r = n({ bransamente_in_capitole: [758], bransamente_in_cerinte: [372] })
    expect(r.stare).toBe('block'); expect(r.detalii).toMatch(/372/); expect(r.detalii).toMatch(/758/)
  })
  it('total plus defalcari => warn, nu block: textul contine legitim si partile', () => {
    const r = n({ bransamente_in_capitole: [129, 243, 372], bransamente_in_cerinte: [372] })
    expect(r.stare).toBe('warn'); expect(r.detalii).toMatch(/compensarea/)
  })
  it('doua numere, fara cerinta => warn cu ambele', () =>
    expect(n({ bransamente_in_capitole: [371, 372], bransamente_in_cerinte: null }).stare).toBe('warn'))
  it('niciun numar in capitole => ok, nu block', () =>
    expect(n({ bransamente_in_capitole: null, bransamente_in_cerinte: [372] }).stare).toBe('ok'))
  it('HOG-04: cerintele insele dau 371 SI 372 => conflict de surse aratat, chiar daca un capitol coincide', () => {
    const r = n({ bransamente_in_capitole: [372], bransamente_in_cerinte: [371, 372] })
    expect(r.stare).toBe('warn')
    expect(r.detalii).toMatch(/conflict de surse/); expect(r.detalii).toMatch(/371, 372/)
    expect(r.detalii).toMatch(/nu alege singur/)
  })
  it('conflictul de surse se arata si cand capitolele tac', () =>
    expect(n({ bransamente_in_capitole: null, bransamente_in_cerinte: [371, 372] }).detalii).toMatch(/conflict de surse/))
})

describe('HOG-08 controlParticipare — rolurile nu sunt sinonime', () => {
  const c = p => controlParticipare(p)
  it('cazul Hoghilag: HABAU tert, text „asocierii" + „subcontractor" => warn, cu explicatia rolului', () => {
    const r = c({ participanti: ['tert_sustinator|HABAU'], semnale_asociere: ['asocierii', 'subcontractor'] })
    expect(r.stare).toBe('warn')
    expect(r.detalii).toMatch(/asociere/); expect(r.detalii).toMatch(/subcontractare/)
    expect(r.detalii).toMatch(/HABAU e terț susținător/)
  })
  it('NICIODATA blocant: „subcontractant" poate aparea intr-o clauza conditionala', () => {
    const r = c({ participanti: [], semnale_asociere: ['subcontracta'] })
    expect(r.stare).toBe('warn'); expect(r.detalii).toMatch(/clauz[ăa] general/)
  })
  it('asociat declarat + text despre asociere => ok', () =>
    expect(c({ participanti: ['asociat|ATSD'], semnale_asociere: ['asocierii'] }).stare).toBe('ok'))
  it('nimic declarat, text curat => ok', () =>
    expect(c({ participanti: null, semnale_asociere: null }).stare).toBe('ok'))
  it('parteneri declarati fara semnale => ok si ii listeaza pe rol', () => {
    const r = c({ participanti: ['tert_sustinator|HABAU', 'subcontractant|ULTRAJET (foraje)'], semnale_asociere: [] })
    expect(r.stare).toBe('ok'); expect(r.detalii).toMatch(/terț susținător: HABAU/); expect(r.detalii).toMatch(/ULTRAJET/)
  })
  it('rol necunoscut din view nu arunca', () =>
    expect(c({ participanti: ['inventat|X', 'fara-separator'], semnale_asociere: [] }).stare).toBe('ok'))
})

// Fixtures REALE din Hoghilag (cercetare 13.09): memoriu p.70 + planse, vs graficul valoric.
// Toate cifrele sunt verificate aritmetic: Valchid segmente = tabel montaj pe ambele diametre
// (Dn63 2.779, Dn90 6.388); Prod planse fara cele 3 lipsa = graficul (8.581); cu ele = memoriul (8.840).
describe('HOG-02/03 controlTronsoane — perechea de noduri e cheia, nu eticheta', () => {
  const S = (localitate, nod_start, nod_end, lungime_m) => ({ localitate, nod_start, nod_end, lungime_m })
  const G = (localitate, id_activitate, nod_start, nod_end, lungime_m) => ({ localitate, id_activitate, nod_start, nod_end, lungime_m })

  it('SPARGERE LEGITIMA: doua activitati pe aceeasi pereche, suma = sursa => ok', () => {
    const r = controlTronsoane({
      tronsoane_sursa: [S('VALCHID', 1, 2, 2410), S('VALCHID', 2, 3, 1695)],
      tronsoane_grafic: [G('VALCHID', 86, 1, 2, 1600), G('VALCHID', 108, 1, 2, 810),
                         G('VALCHID', 109, 2, 3, 800), G('VALCHID', 128, 2, 3, 895)],
    })
    expect(r.stare).toBe('ok'); expect(r.randuri).toEqual([])
  })
  it('acelasi tipar la Prod: 9-10 = 1600+1435, 10-11 = 200+1530', () => {
    const r = controlTronsoane({
      tronsoane_sursa: [S('PROD', 9, 10, 3035), S('PROD', 10, 11, 1730)],
      tronsoane_grafic: [G('PROD', 35, 9, 10, 1600), G('PROD', 62, 9, 10, 1435),
                         G('PROD', 63, 10, 11, 200), G('PROD', 75, 10, 11, 1530)],
    })
    expect(r.stare).toBe('ok')
  })
  it('MISMATCH REAL 15-16: grafic 245+100 = 345 vs sursa 100, iar 15-13 lipseste => block, ambele randuri', () => {
    const r = controlTronsoane({
      tronsoane_sursa: [S('VALCHID', 15, 13, 245), S('VALCHID', 15, 16, 100)],
      tronsoane_grafic: [G('VALCHID', 90, 15, 16, 245), G('VALCHID', 91, 15, 16, 100)],
    })
    expect(r.stare).toBe('block')
    expect(r.randuri.find(x => x.k.endsWith('13-15')).stare).toBe('lipsa_in_grafic')
    const dif = r.randuri.find(x => x.k.endsWith('15-16'))
    expect(dif.stare).toBe('cantitate_diferita'); expect(dif.grafic_m).toBe(345); expect(dif.sursa_m).toBe(100)
  })
  it('CANTITATE LIPSA 26-28: 155 m in sursa, absent din grafic => block, cu formularea prudenta', () => {
    const r = controlTronsoane({
      tronsoane_sursa: [S('VALCHID', 26, 28, 155)], tronsoane_grafic: [G('VALCHID', 9, 26, 30, 180)],
    })
    expect(r.stare).toBe('block')
    expect(r.detalii).toMatch(/graficul nu poart[ăa] cantitatea/)
    expect(r.detalii).not.toMatch(/omis/)
  })
  it('ordinea nodurilor nu conteaza: 15-13 din sursa = 13-15 din grafic', () =>
    expect(controlTronsoane({ tronsoane_sursa: [S('VALCHID', 15, 13, 245)],
                              tronsoane_grafic: [G('VALCHID', 1, 13, 15, 245)] }).stare).toBe('ok'))
  it('noduri cu litera (28A) se normalizeaza', () =>
    expect(controlTronsoane({ tronsoane_sursa: [S('VALCHID', '28A', 38, 75)],
                              tronsoane_grafic: [G('VALCHID', 142, '28a', 38, 75)] }).stare).toBe('ok'))
  it('pereche in grafic fara corespondent in sursa => warn, nu block (poate fi legitima)', () => {
    const r = controlTronsoane({ tronsoane_sursa: [S('PROD', 1, 2, 180)],
                                 tronsoane_grafic: [G('PROD', 27, 1, 2, 180), G('PROD', 99, 31, 34, 150)] })
    expect(r.stare).toBe('warn'); expect(r.randuri[0].stare).toBe('necunoscut_in_sursa')
  })
  it('acelasi nod in doua localitati nu se amesteca', () => {
    const r = controlTronsoane({ tronsoane_sursa: [S('PROD', 1, 2, 180), S('VALCHID', 1, 2, 2410)],
                                 tronsoane_grafic: [G('PROD', 27, 1, 2, 180), G('VALCHID', 86, 1, 2, 2410)] })
    expect(r.stare).toBe('ok'); expect(r.total_sursa_m).toBe(2590)
  })
  it('lipsa datelor => warn „nu se poate face", nu ok fals', () => {
    expect(controlTronsoane({ tronsoane_sursa: [], tronsoane_grafic: [] }).stare).toBe('warn')
    expect(controlTronsoane({ tronsoane_sursa: [S('PROD', 1, 2, 180)], tronsoane_grafic: [] }).detalii).toMatch(/activit[ăa][țt]i de tronson/)
  })
})
