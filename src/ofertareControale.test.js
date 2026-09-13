import { describe, it, expect } from 'vitest'
import { controlCantitati, controlGarantie, controlAnexe, normalizeazaRef, controlIdentitate, controlNumereCheie, controlParticipare, controlTronsoane, clasificaFrazaParticipare, rolPiesa } from './ofertareControale.js'

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

// Cuprinsul REAL al propunerii Hoghilag, p. 4 (cercetare 13.09).
const CAPITOLE_HOG = [
  'Anexa 7|Formular F3 Surse de materiale',
  'Anexa 9|Contract preluare deseuri si autorizatie de mediu',
  'Anexa 10|Planul calitatii, lista procedurilor de executie, proceduri de executie si plan de control',
  'Anexa 11|Grafic de executie',
  'Anexa 12|Documente suport personal',
  'Anexa 13|Infrastructura utilizata',
  'Anexa 14|Plan management mediu',
  'Anexa 15|Plan SSM si declaratie',
  'Anexa 16|Plan management trafic',
]
const anexe = fraze => controlAnexe({
  anexe_referite: null, anexe_existente: null, capitole_ref: CAPITOLE_HOG, fraze_anexe: fraze })

describe('H5 verificarea semantica a trimiterilor — cele 15 trimiteri reale din Hoghilag', () => {
  it('POZITIV p. 28: trimite la Anexa 3 pentru planul calitatii, care e Anexa 10 => block', () => {
    const r = anexe(['In Anexa 3 este prezentat Planul de management al calitatii pentru acest contract'])
    expect(r.stare).toBe('block')
    expect(r.detalii).toMatch(/Anexa 3/); expect(r.detalii).toMatch(/e Anexa 10/)
    expect(r.gresite[0].rol).toBe('plan_calitate')
  })
  // Cele 14 corecte: niciuna nu trebuie semnalata. Fara ele, controlul ar semnala orice.
  const CORECTE = [
    ['p. 11 deseuri', 'In Anexa 9 se regaseste contractul de preluare a deseurilor si autorizatia de mediu'],
    ['p. 31 grafic', 'Graficul de executie a investitiei este prezentat in Anexa 11'],
    ['p. 32 proceduri', 'Procedurile tehnice de executie si planul calitatii sunt prezentate in Anexa 10'],
    ['p. 43 proceduri', 'Procedurile tehnice de executie se regasesc in Anexa 10'],
    ['p. 43 grafic', 'Graficul general de realizare a investitiei este atasat ca Anexa 11'],
    ['p. 65 plan calitate', 'In Anexa 10 se regaseste planul de asigurare a calitatii, procedurile si planul de control'],
    ['p. 66 surse', 'Formularul F3 Surse de materiale este prezentat in Anexa 7'],
    ['p. 69 salubritate', 'Contractul de salubrizare si autorizatia de mediu sunt in Anexa 9'],
    ['p. 69 grafic+PERT', 'Anexa 11 contine graficul, Network Diagram, analiza PERT, Curba S si graficul de resurse'],
    ['p. 69 personal', 'Documentele suport pentru personal sunt prezentate in Anexa 12'],
    ['p. 77 infrastructura', 'Infrastructura utilizata in realizarea activitatilor este descrisa in Anexa 13'],
    ['p. 77 mediu', 'Planul de management al mediului este prezentat in Anexa 14'],
    ['p. 77 ssm', 'Planul de securitate si sanatate in munca si declaratia aferenta se regasesc in Anexa 15'],
    ['p. 80 trafic', 'Planul de management al traficului este prezentat in Anexa 16'],
  ]
  it.each(CORECTE)('negativ %s: nu se semnaleaza', (_, fraza) => {
    const r = anexe([fraza])
    expect(r.gresite).toEqual([])
    expect(r.stare).not.toBe('block')
  })
  it('toate cele 14 corecte impreuna, plus cea gresita => exact o singura constatare', () => {
    const r = anexe([...CORECTE.map(c => c[1]), 'In Anexa 3 este prezentat Planul de management al calitatii'])
    expect(r.gresite).toHaveLength(1); expect(r.gresite[0].refs).toEqual(['anexa:3'])
  })
  it('fraza fara rol recognoscibil nu se verifica — mai bine tace decat sa inventeze', () =>
    expect(anexe(['Detaliile sunt prezentate in Anexa 4']).gresite).toEqual([]))
  it('rol pentru care nu exista nicio piesa in cuprins nu se verifica', () =>
    expect(controlAnexe({ anexe_referite: null, anexe_existente: null, capitole_ref: ['Anexa 1|Rezumat'],
      fraze_anexe: ['Planul calitatii e in Anexa 3'] }).gresite).toEqual([]))
  it('rolPiesa citeste titlul capitolului la fel ca fraza', () => {
    expect(rolPiesa('Planul calitatii, lista procedurilor de executie')).toBe('plan_calitate')
    expect(rolPiesa('Grafic general de realizare a investitiei (fizic)')).toBe('grafic')
    expect(rolPiesa('Rezumat')).toBeNull()
  })
  it('trimiterea la o piesa inexistenta ramane prinsa (verificarea veche)', () => {
    const r = controlAnexe({ anexe_referite: ['anexa 7', 'formularul nr. 5'], anexe_existente: ['Anexa 7'],
      fraze_anexe: null, capitole_ref: null })
    expect(r.stare).toBe('block'); expect(r.lipsa).toEqual(['formular:5'])
  })
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

describe('HOG-08 clasificaFrazaParticipare — propozitii REALE din propunerea Hoghilag', () => {
  const cls = clasificaFrazaParticipare
  // Cele marcate „operational activ" de cercetare (p. 58-62), verbatim.
  const OPERATIONALE = [
    'Subcontractorii vor lucra sub directa coordonare a unui Manager de proiect angajat Gazpet Instal SRL',
    'Managementul executiei lucrarilor se va realiza de catre Echipa de proiect a asocierii sub conducerea Comitetului de coordonare a executiei proiectului',
    'Fiecare asociat va avea o echipa de proiect organizata similar cu echipa de proiect a asocierii',
    'Comitetul de coordonare a executiei proiectului este format din directorii generali ai asociatilor, condus de directorul general al liderului si coordoneaza Echipa de proiect',
    'Fiecare subcontractor va avea o echipa proprie de proiect, care va raspunde de derularea executiei lucrarilor pe care le are in responsabilitate, condusa de un manager de proiect',
    'Echipa de proiect a asocierii va prezenta Beneficiarului rapoarte de progres zilnice si lunare pe toata durata de executie a lucrarilor',
    'Managerul QA/QC sustine directorul de proiect in derularea executiei proiectului si este responsabil cu coordonarea activitatii responsabililor QA/QC de la asociati si de la subcontractori',
    'Celelalte pozitii din organigrama echipei de proiect a asocierii si a echipelor de proiect ale asociatilor vor avea atributii, obligatii si responsabilitati specifice',
    'Responsabil cu centralizarea la nivelul asocierii a situatiilor de lucrari si a facturilor de la fiecare asociat si inaintarea lor la beneficiar spre decontare',
    'Fiecare asociat si subcontractor va identifica zonele sensibile',
  ]
  // Cele marcate generic / conditional (p. 11-13, 25-27, 58).
  const GENERICE = [
    'Se vor aviza subcontractantii. In cazul asocierilor intre executanti lucrarile se coordoneaza prin grija liderului de asociatie',
    'Toate cerintele aplicabile CONTRACTORULUI se aplica obligatoriu subcontractantilor si furnizorilor',
    'Pentru numirea unui Subcontractant propus dupa semnarea Contractului, Gazpet Instal SRL va solicita acordul Beneficiarului',
    'Nu vom subcontracta lucrari ulterior emiterii ordinului de incepere a lucrarilor fara acceptul autoritatii contractante',
  ]
  it.each(OPERATIONALE)('operational: %s', f => expect(cls(f)).toBe('operationala'))
  it.each(GENERICE)('generic: %s', f => expect(cls(f)).toBe('generica'))
  it('negarea explicita de la p. 58 se recunoaste ca atare', () =>
    expect(cls('Pentru realizarea lucrarilor, nu se vor folosi subcontractori')).toBe('negare'))
  it('fraza fara niciunul din cuvinte e irelevanta', () =>
    expect(cls('Lucrarile se executa conform proiectului tehnic')).toBe('irelevanta'))
})

describe('HOG-08 controlParticipare — rolurile nu sunt sinonime', () => {
  const c = p => controlParticipare(p)
  const OP_ASOC = 'Echipa de proiect a asocierii va prezenta Beneficiarului rapoarte de progres zilnice'
  const OP_SUB = 'Fiecare subcontractor va avea o echipa proprie de proiect condusa de un manager'
  const GEN = 'In cazul asocierilor intre executanti lucrarile se coordoneaza prin grija liderului'
  const NEG = 'Pentru realizarea lucrarilor, nu se vor folosi subcontractori'

  it('cazul Hoghilag: HABAU tert, structura de asociere descrisa activ => warn, cu rolul explicat', () => {
    const r = c({ participanti: ['tert_sustinator|HABAU'], fraze_asociere: [OP_ASOC, OP_SUB] })
    expect(r.stare).toBe('warn')
    expect(r.detalii).toMatch(/asociere care func[țt]ioneaz/); expect(r.detalii).toMatch(/HABAU e terț susținător/)
  })
  it('CONTRADICTIA de la p. 58: neaga si descrie in acelasi timp => se spune explicit', () => {
    const r = c({ participanti: [], fraze_asociere: [NEG, OP_SUB] })
    expect(r.stare).toBe('warn')
    expect(r.detalii).toMatch(/spune c[ăa] nu se folosesc subcontractori [șs]i, [îi]n alt[ăa] parte, descrie cum lucreaz/)
  })
  it('DOAR clauze generale => ok: termenul apare legitim in contracte', () => {
    const r = c({ participanti: [], fraze_asociere: [GEN] })
    expect(r.stare).toBe('ok'); expect(r.detalii).toMatch(/generale sau condi[țt]ionale/)
  })
  it('asociat declarat + structura activa => ok', () =>
    expect(c({ participanti: ['asociat|ATSD'], fraze_asociere: [OP_ASOC] }).stare).toBe('ok'))
  it('nimic declarat, text curat => ok', () =>
    expect(c({ participanti: null, fraze_asociere: null }).stare).toBe('ok'))
  it('parteneri declarati fara fraze => ok si ii listeaza pe rol', () => {
    const r = c({ participanti: ['tert_sustinator|HABAU', 'subcontractant|ULTRAJET (foraje)'], fraze_asociere: [] })
    expect(r.stare).toBe('ok'); expect(r.detalii).toMatch(/terț susținător: HABAU/); expect(r.detalii).toMatch(/ULTRAJET/)
  })
  it('rol necunoscut din view nu arunca', () =>
    expect(c({ participanti: ['inventat|X', 'fara-separator'], fraze_asociere: [] }).stare).toBe('ok'))

  // PRUNISOR-JUPA (Transgaz): HABAU e si subcontractant (4.6), si tert sustinator (4.12), in acelasi PT.
  it('rol dublu legitim: tert sustinator + subcontractant => ok, cu cumulul aratat', () => {
    const r = c({ participanti: ['subcontractant|HABAU S.R.L.', 'tert_sustinator|HABAU S.R.L.'], fraze_asociere: [] })
    expect(r.stare).toBe('ok')
    expect(r.multi_rol).toHaveLength(1)
    expect(r.detalii).toMatch(/rol dublu — HABAU S\.R\.L\.: subcontractant \+ terț susținător/)
  })
  it('cu rol dublu, nu se mai spune ca HABAU „nu e subcontractant" — ar fi fals', () => {
    const r = c({ participanti: ['subcontractant|HABAU', 'tert_sustinator|HABAU'], fraze_asociere: [OP_ASOC] })
    expect(r.stare).toBe('warn')                       // asocierea descrisa activ, fara asociat declarat
    expect(r.detalii).not.toMatch(/nu [îi]nseamn[ăa] nici asociat/)
  })
  it('fara rol dublu, fraza despre tert sustinator ramane (cazul Hoghilag)', () => {
    const r = c({ participanti: ['tert_sustinator|HABAU'], fraze_asociere: [OP_ASOC] })
    expect(r.detalii).toMatch(/HABAU e terț susținător/)
  })
  it('asociat + subcontractant la aceeasi firma => warn, e contradictie', () => {
    const r = c({ participanti: ['asociat|ATSD', 'subcontractant|ATSD'], fraze_asociere: [] })
    expect(r.stare).toBe('warn')
    expect(r.detalii).toMatch(/nu poate fi subcontractant al lui [îi]nsu[șs]i/)
  })
  it('acelasi rol de doua ori => warn de dublura', () => {
    const r = c({ participanti: ['subcontractant|ELCAS', 'subcontractant| elcas '], fraze_asociere: [] })
    expect(r.stare).toBe('warn'); expect(r.detalii).toMatch(/de doua ori in acelasi rol/)
  })
})


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
