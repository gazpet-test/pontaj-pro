// Teste pentru logica PURĂ a ecranului pe pași (uscarePasi.js). Valorile așteptate sunt calculate de mână din regula scrisă în brief /
// V2 §3.1 (100 g pe km × lungimea; egalitatea trece), nu din codul testat (L25). Date SINTETICE.
import { describe, it, expect } from 'vitest'
import {
  PRAG_G_PE_KM, grame, diferentaGrame, pragGrame, inPrag, ultimulPiston, verdictPropus, contrazice, avertismenteGreutate, avertismentePereche,
  lipsaEtapa1, lipsaEtapa2, pasCurent, pasTinut, precompletare, formularPasNou, formularTrecereNoua, treceriPeTronson, momentAcum, cuOraImplicita,
  minuteIntre, formularInregistreazaEtapa1, formularTerminaEtapa2, concluzieDinVerdict,
} from './uscarePasi.js'
import { isoDinOraLocala, formularDinRand, payloadDinFormular, lipsaDinRand } from './uscareLogica.js'

const C = (nr, intrare_kg, iesire_kg = null, motiv = null) => ({ nr, intrare_kg, iesire_kg, motiv })
const P = (categorie, burete_nr = null) => ({ categorie, burete_nr })
// eticheta motivului verdictului contrar, scrisă de mână (L25); textul liber al observațiilor NU e motiv (proba din 17.11.2026)
const MOTIV = 'Verdictul diferit de calcul, motivul:'
const LIPSA_MOTIV = 'motivul scris de tine pentru verdictul diferit de calcul'
const LIPSA_CONCLUZIE = 'concluzia din verdict (o pune „Termină etapa 2”)'

describe('grame și diferența (întregi, fără rotunjiri înainte de comparație)', () => {
  it('kg → g întregi; diferența ieșire − intrare', () => {
    expect(grame(1.25)).toBe(1250)
    expect(grame(0.001)).toBe(1)
    expect(grame('2,5')).toBe(null)                 // textul de pe ecran nu e număr: îl convertește formularul, nu calculul
    expect(grame(null)).toBe(null)
    expect(diferentaGrame(C(1, 1.25, 1.35))).toBe(100) // 1,35 × 1000 = 1350,0000000000002 în virgulă mobilă: tot 100 g
    expect(diferentaGrame(C(1, 1.25, 1.24))).toBe(-10)
    expect(diferentaGrame(C(1, 1.25, null))).toBe(null)
  })
  it('pragul: 100 g/km × lungimea, inclusiv lungimi fracționare', () => {
    expect(PRAG_G_PE_KM).toBe(100)
    expect(pragGrame(1000)).toBe(100)
    expect(pragGrame(5000)).toBe(500)                 // exemplul proprietarului: 500 g pe 5 km
    expect(pragGrame(1234.5)).toBeCloseTo(123.45, 10)
    expect(pragGrame(0)).toBe(null)
    expect(pragGrame(null)).toBe(null)
  })
  it('la limită: egalitatea TRECE, un gram peste nu; lungimi fracționare; Δ negativ', () => {
    expect(inPrag(500, 5000)).toBe(true)
    expect(inPrag(501, 5000)).toBe(false)
    expect(inPrag(100, 1000)).toBe(true)
    expect(inPrag(101, 1000)).toBe(false)
    expect(inPrag(123, 1234.5)).toBe(true)            // 123 ≤ 123,45
    expect(inPrag(124, 1234.5)).toBe(false)
    expect(inPrag(0, 0.1)).toBe(true)                 // 0,01 g prag
    expect(inPrag(1, 0.1)).toBe(false)
    expect(inPrag(-5, 1000)).toBe(true)
    expect(inPrag(1.5, 1000)).toBe(null)              // Δ ne-întreg = intrare invalidă
    expect(inPrag(10, null)).toBe(null)
  })
})

describe('verdictul propus (doar ultimul piston contează)', () => {
  const r = (cant, lungime_m = 1000) => ({ lungime_m, cantariri: cant })
  it('ultimul = numărul cel mai mare, indiferent de ordinea din listă; primul foarte ud nu contează', () => {
    const x = r([C(2, 1.25, 1.35), C(1, 1, 3)])
    expect(ultimulPiston(x).nr).toBe(2)
    expect(verdictPropus(x)).toMatchObject({ nr: 2, diferenta_g: 100, prag_g: 100, stare: 'trece', propus: 'uscat' })
    expect(verdictPropus(x).calcul).toBe('100 g/km × 1 km = 100 g')
  })
  it('un gram peste prag → umed; lungime fracționară arătată cu calculul', () => {
    expect(verdictPropus(r([C(1, 1.25, 1.351)]))).toMatchObject({ diferenta_g: 101, stare: 'nu_trece', propus: 'umed' })
    const f = verdictPropus(r([C(1, 2, 2.123)], 1234.5))
    expect(f).toMatchObject({ diferenta_g: 123, stare: 'trece', propus: 'uscat' })
    expect(f.calcul).toBe('100 g/km × 1,2345 km = 123,45 g')
    expect(verdictPropus(r([C(1, 2, 2.124)], 1234.5)).propus).toBe('umed')
  })
  it('greutate „negativă” (iese mai ușor): cel mult 1% din intrare = fără acumulare (uscat); peste = de verificat, fără propunere', () => {
    expect(verdictPropus(r([C(1, 1.25, 1.24)]))).toMatchObject({ diferenta_g: -10, stare: 'trece', propus: 'uscat' })   // 10 g ≤ 1% din 1250 g (12,5 g)
    expect(verdictPropus(r([C(1, 1.25, 1.238)]))).toMatchObject({ diferenta_g: -12, stare: 'trece', propus: 'uscat' })  // 12 g ≤ 12,5 g
    expect(verdictPropus(r([C(1, 1.25, 1.237)]))).toMatchObject({ diferenta_g: -13, stare: 'de_verificat', propus: null }) // 13 g > 12,5 g
    expect(verdictPropus(r([C(1, 1.25, 1.23)]))).toMatchObject({ diferenta_g: -20, stare: 'de_verificat', propus: null })
    // runda 3 (verdict P2-3): la limită, EXACT 1% trece; fără toleranță minimă de 1 g la greutăți mici
    expect(verdictPropus(r([C(1, 1.3, 1.287)]))).toMatchObject({ diferenta_g: -13, stare: 'trece', propus: 'uscat' })   // 13 g = exact 1% din 1300 g
    expect(verdictPropus(r([C(1, 1.3, 1.286)]))).toMatchObject({ diferenta_g: -14, stare: 'de_verificat' })             // un gram peste 1%
    expect(verdictPropus(r([C(1, 0.1, 0.099)]))).toMatchObject({ diferenta_g: -1, stare: 'trece', propus: 'uscat' })     // 1 g = exact 1% din 100 g
    expect(verdictPropus(r([C(1, 0.05, 0.049)]))).toMatchObject({ diferenta_g: -1, stare: 'de_verificat', propus: null }) // 1 g din 50 g = 2% (cazul recenzentului)
    expect(verdictPropus(r([C(1, 0.05, 0.049)])).motiv).toContain('peste 1% din greutate')
    expect(verdictPropus(r([C(1, 0.001, 0.001)]))).toMatchObject({ diferenta_g: 0, stare: 'trece', propus: 'uscat' })    // cea mai mică greutate acceptată: 0 g e în prag
  })
  it('nu se poate calcula: ultimul fără cântărire, greutate lipsă, lungime lipsă, niciun piston', () => {
    expect(verdictPropus(r([C(1, 1, 1.05), C(2, null, null, 'rămas în conductă')])).stare).toBe('necalculabil')
    expect(verdictPropus(r([C(1, 1, null)])).motiv).toContain('ieșire')
    expect(verdictPropus(r([C(1, 1, 1.05)], null))).toMatchObject({ stare: 'necalculabil', diferenta_g: 50, propus: null })
    expect(verdictPropus(r([])).stare).toBe('necalculabil')
  })
  it('omul contrazice calculul (sau alege fără propunere) → motiv cerut', () => {
    expect(contrazice('uscat', { propus: 'uscat' })).toBe(false)
    expect(contrazice('umed', { propus: 'uscat' })).toBe(true)
    expect(contrazice('uscat', { propus: null })).toBe(true)
    expect(contrazice('', { propus: 'uscat' })).toBe(false)
  })
  it('runda 3 (verdict P2-4): textul automat al trecerii noi NU e motiv pentru verdictul contrar; un motiv scris de om, da', () => {
    // textul EXACT pe care îl pune „Trecere nouă” în observații (scris aici de mână, nu luat din cod — L25)
    const auto = 'Trecerea 2 pe acest tronson (trecerea anterioară: raportul din 10.11.2026, ultimul piston nu a ieșit uscat).'
    const baza = { ora_inceput: 'a', ora_final: 'b', lungime_m: 1000, bureti_buc: 1, cantariri: [C(1, 1, 1.25)], piston_final_rezultat: 'uscat', concluzie: 'conform', observatii: auto }
    const poze = [P('cantar_iesire', 1), P('piston_final')]
    expect(verdictPropus(baza).propus).toBe('umed')                                                   // +250 g > 100 g
    expect(lipsaEtapa2(baza, poze)).toEqual([LIPSA_MOTIV])
    expect(lipsaEtapa2({ ...baza, observatii: `${auto}\n${MOTIV} cântărit cu buretele ud la exterior` }, poze)).toEqual([])
    expect(lipsaEtapa2({ ...baza, observatii: `${MOTIV} cântărit cu buretele ud la exterior` }, poze)).toEqual([])   // raport vechi / din birou, cu etichetă: recunoscut
    expect(lipsaEtapa2({ ...baza, observatii: '   ' }, poze)).toEqual([LIPSA_MOTIV])
  })
  it('proba din 17.11.2026 (defectul 2): observații preexistente oarecare NU sunt motiv; doar textul de sub eticheta motivului', () => {
    const baza = { ora_inceput: 'a', ora_final: 'b', lungime_m: 1000, bureti_buc: 1, cantariri: [C(1, 1, 1.25)], piston_final_rezultat: 'uscat', concluzie: 'conform' }
    const poze = [P('cantar_iesire', 1), P('piston_final')]
    for (const obs of ['TEST automat 17.11.2026 noaptea — de ignorat', 'buretele ud la exterior', 'motivul: nu', `${MOTIV}   `, `${MOTIV}\n`]) {
      expect(lipsaEtapa2({ ...baza, observatii: obs }, poze), JSON.stringify(obs)).toEqual([LIPSA_MOTIV])
    }
    expect(lipsaEtapa2({ ...baza, observatii: `TEST automat — de ignorat\n${MOTIV} apă de ploaie pe burete` }, poze)).toEqual([])
    expect(lipsaEtapa2({ ...baza, observatii: `${MOTIV} apă de ploaie\nnotă scrisă după, din birou` }, poze)).toEqual([])
  })
  it('concluzia din verdict: o singură definiție (uscat → conform, umed → neconform, altfel nimic)', () => {
    expect(concluzieDinVerdict('uscat')).toBe('conform')
    expect(concluzieDinVerdict('umed')).toBe('neconform')
    expect(concluzieDinVerdict(null)).toBe(null)
    expect(concluzieDinVerdict('')).toBe(null)
  })
})

describe('avertismentele greutăților (nu blochează)', () => {
  it('valoare în grame din greșeală, nefiresc de mare / mică, negativă, zecimale', () => {
    expect(avertismenteGreutate('1,25')).toEqual([])
    expect(avertismenteGreutate('')).toEqual([])
    const g = avertismenteGreutate('850')
    expect(g).toHaveLength(1)
    expect(g[0]).toContain('GRAME')
    expect(g[0]).toContain('scrie 0,85 kg')
    expect(avertismenteGreutate('60')[0]).toContain('nefiresc de mult')
    expect(avertismenteGreutate('0,05')[0]).toContain('nefiresc de puțin')
    expect(avertismenteGreutate('-1')[0]).toContain('mai mare ca zero')
    expect(avertismenteGreutate('abc')[0]).toContain('nu e un număr')
    expect(avertismenteGreutate('1,2345')[0]).toContain('3 zecimale')
  })
  it('perechea: ieșirea peste 3 × intrarea, diferența peste 20 × prag', () => {
    const a = avertismentePereche(C(1, 1, 3.5), 100)
    expect(a).toHaveLength(2)
    expect(avertismentePereche(C(1, 1, 1.1), 100)).toEqual([])
    expect(avertismentePereche(C(1, 1, null), 100)).toEqual([])
  })
})

describe('ce cere fiecare etapă și pasul dedus din date', () => {
  it('etapa 1 spune EXACT ce lipsește', () => {
    const r = { ora_inceput: null, bureti_buc: 2, cantariri: [C(1, 1.2), C(2, null)] }
    expect(lipsaEtapa1(r, [P('cantar_intrare', 1)])).toEqual([
      'ora introducerii', 'greutatea pistonului 2 la intrare', 'poza cântarului pentru pistonul 2 (intrare)', 'poza ansamblului de pistoane',
    ])
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: null, cantariri: [] }, [])).toEqual(['câte pistoane-burete'])
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 2, cantariri: [C(1, 1)] }, [P('cantar_intrare', 1), P('pistoane')])).toEqual(['rândurile de cântărire (câte unul pe piston)'])
    // „nu se aplică” (din formularul complet): fără greutate și fără poză cerute
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 2, cantariri: [C(1, 1), C(2, null, null, 'rupt')] }, [P('cantar_intrare', 1), P('pistoane')])).toEqual([])
    // runda 3 (verdict P1): pozele lipsă JUSTIFICATE nu mai sunt cerute (aceeași ieșire ca în formularul complet); greutățile, da
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 2, cantariri: [C(1, 1.2), C(2, null)], poze_justificare: 'cântarul fără ecran lizibil' }, [])).toEqual(['greutatea pistonului 2 la intrare'])
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 2, cantariri: [C(1, 1.2), C(2, 1.3)], poze_justificare: 'ceață' }, [])).toEqual([])
    // zero pistoane-burete = configurație permisă de regula comună (bureti_buc = 0, fără rânduri): nu e trimisă la etapa 1 pentru asta
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 0, cantariri: [] }, [P('pistoane')])).toEqual([])
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 0, cantariri: [C(1, 1)] }, [P('pistoane')])).toEqual(['rândurile de cântărire (câte unul pe piston)', 'poza cântarului pentru pistonul 1 (intrare)'])
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: -1, cantariri: [] }, [P('pistoane')])).toEqual(['câte pistoane-burete'])
  })
  it('etapa 2: presiunea nu blochează; verdictul contrar calculului cere motivul; poza ultimului piston doar la USCAT (dovada, ca regula comună)', () => {
    const baza = { ora_inceput: 'a', ora_final: 'b', lungime_m: 1000, bureti_buc: 1, cantariri: [C(1, 1, 1.05)], piston_final_rezultat: 'uscat', concluzie: 'conform', observatii: null, presiune_bar: null }
    const poze = [P('cantar_iesire', 1), P('piston_final')]
    expect(lipsaEtapa2(baza, poze)).toEqual([])
    expect(lipsaEtapa2({ ...baza, piston_final_rezultat: 'umed', concluzie: 'neconform' }, poze)).toEqual([LIPSA_MOTIV])
    expect(lipsaEtapa2({ ...baza, piston_final_rezultat: 'umed', concluzie: 'neconform', observatii: `${MOTIV} buretele avea urme de apă` }, poze)).toEqual([])
    expect(lipsaEtapa2({ ...baza, ora_final: null, piston_final_rezultat: null, concluzie: null }, [])).toEqual([
      'ora ieșirii', 'poza cântarului pentru pistonul 1 (ieșire)', 'verdictul ultimului piston (uscat / umed)',
    ])
    // runda 3 (verdict P1): USCAT fără poza ultimului piston = lipsește dovada; UMED (NECONFORM) nu o cere (regula existentă o cere doar pentru CONFORM)
    expect(lipsaEtapa2(baza, [P('cantar_iesire', 1)])).toEqual(['poza ultimului piston (dovada că iese uscat)'])
    expect(lipsaEtapa2({ ...baza, cantariri: [C(1, 1, 1.5)], piston_final_rezultat: 'umed', concluzie: 'neconform' }, [P('cantar_iesire', 1)])).toEqual([])
    // pozele cântarelor justificate: nu mai sunt cerute
    expect(lipsaEtapa2({ ...baza, cantariri: [C(1, 1, 1.5)], piston_final_rezultat: 'umed', concluzie: 'neconform', poze_justificare: 'ceață' }, [])).toEqual([])
    expect(lipsaEtapa2({ ...baza, poze_justificare: 'ceață' }, [])).toEqual(['poza ultimului piston (dovada că iese uscat)'])   // dovada nu se justifică
  })
  it('proba din 17.11.2026 (defectul 1): datele etapei 2 complete FĂRĂ concluzia din verdict (salvate pe parcurs / de pe alt telefon) = etapa 2 NU e terminată', () => {
    const baza = { ora_inceput: 'a', ora_final: 'b', lungime_m: 1000, bureti_buc: 1, cantariri: [C(1, 1, 1.05)], piston_final_rezultat: 'uscat', concluzie: null, observatii: null }
    const poze = [P('cantar_iesire', 1), P('piston_final')]
    expect(lipsaEtapa2(baza, poze)).toEqual([LIPSA_CONCLUZIE])
    expect(lipsaEtapa2({ ...baza, concluzie: 'neconform' }, poze)).toEqual([LIPSA_CONCLUZIE])          // concluzia nu urmează verdictul
    expect(lipsaEtapa2({ ...baza, concluzie: 'conform' }, poze)).toEqual([])
    expect(lipsaEtapa2({ ...baza, piston_final_rezultat: 'umed', concluzie: 'conform' }, poze)).toEqual([LIPSA_MOTIV, LIPSA_CONCLUZIE])
    expect(lipsaEtapa2({ ...baza, piston_final_rezultat: 'umed', concluzie: 'neconform', observatii: `${MOTIV} x` }, poze)).toEqual([])
    // ce trimite „Termină etapa 2” nu mai lasă nimic: formularul de pe ecran, judecat prin aceeași funcție
    const rand = { ...baza, ora_inceput: '2026-11-17T08:00:00Z', ora_final: '2026-11-17T09:00:00Z', id: 1, proiect_id: 1, stare: 'deschisa', tronson: 'T', km_de_la_m: 0, km_pana_la_m: 1000, utilaje: [] }
    const g = formularTerminaEtapa2(formularDinRand(rand), Date.UTC(2026, 10, 17, 9))
    expect(payloadDinFormular(g).erori).toEqual([])
    expect(lipsaEtapa2({ ...rand, ...payloadDinFormular(g).date }, poze)).toEqual([])
    // rândul blocat din probă (B1_22): etapa 2 completă, concluzia null → pasul e ETAPA 2 (de unde „Termină etapa 2” pune concluzia), nu rezumatul fără câmp de concluzie
    const blocat = { stare: 'deschisa', data_operatie: '2026-11-17', lungime_m: 500, bureti_buc: 2, ora_inceput: 'a', ora_final: 'b',
      cantariri: [C(1, 5.2, 5.23), C(2, 5.1, 5.12)], piston_final_rezultat: 'uscat', concluzie: null, timp_deplasare_min: null, constructor: 'C', utilaje: [] }
    const pozeB = [P('pistoane'), P('cantar_intrare', 1), P('cantar_intrare', 2), P('cantar_iesire', 1), P('cantar_iesire', 2), P('piston_final')]
    expect(lipsaDinRand(blocat, pozeB)).toContain('concluzie')
    expect(pasCurent(blocat, pozeB)).toBe('etapa2')
    expect(pasCurent({ ...blocat, concluzie: 'conform' }, pozeB)).toBe('rezumat')                       // timpul lipsă îl are rezumatul ca câmp
  })
  it('pasul AFIȘAT e ținut pe loc cât omul lucrează pe el; înainte doar prin butonul etapei; stările finale și întoarcerile nu se țin', () => {
    expect(pasTinut('etapa1', 'etapa2')).toBe('etapa1')
    expect(pasTinut('etapa1', 'rezumat')).toBe('etapa1')
    expect(pasTinut('etapa2', 'rezumat')).toBe('etapa2')
    expect(pasTinut('etapa2', 'etapa2')).toBe('etapa2')
    expect(pasTinut('etapa2', 'etapa1')).toBe('etapa1')                                                // datele au rămas în urmă: le urmează
    expect(pasTinut('etapa1', 'tronson')).toBe('tronson')
    for (const fin of ['inchis', 'anulat', null]) expect(pasTinut('etapa2', fin)).toBe(fin)
    for (const p of ['tronson', 'etapa1', 'etapa2', 'rezumat', 'inchis', 'anulat', null]) expect(pasTinut(null, p)).toBe(p)
  })
  // rândul COMPLET pentru regula comună (toate detaliile cerute de închidere), cu 2 pistoane, ultimul +50 g (în prag)
  const complet = (extra = {}) => ({
    stare: 'deschisa', data_operatie: '2026-11-17', lungime_m: 1000, temperatura_c: 8, constructor: 'Constructor SRL', utilaje: [{ denumire: 'Compresor', buc: 1 }],
    ora_inceput: '2026-11-17T08:00:00Z', ora_final: '2026-11-17T09:00:00Z', pig_metalic_buc: 0, piston_pu_buc: 0, bureti_buc: 2,
    cantariri: [C(1, 1.25, 1.4), C(2, 1.3, 1.35)], presiune_bar: 2.5, timp_deplasare_min: 60, piston_final_rezultat: 'uscat', concluzie: 'conform',
    poze_justificare: null, observatii: null, ...extra,
  })
  const pozeToate = [P('manometru'), P('temperatura'), P('pistoane'), P('cantar_intrare', 1), P('cantar_intrare', 2), P('cantar_iesire', 1), P('cantar_iesire', 2), P('piston_final')]
  it('runda 3 (verdict P1): dacă regula COMUNĂ a închiderii nu mai cere nimic, pasul e REZUMATUL — pe orice drum a fost completat raportul', () => {
    // (a) NECONFORM complet, cu toate pozele lipsă JUSTIFICATE (completat în formularul complet, la birou)
    const a = complet({ piston_final_rezultat: 'umed', concluzie: 'neconform', poze_justificare: 'aparatul foto defect; cântarul citit de doi martori' })
    expect(lipsaDinRand(a, [])).toEqual([])
    expect(pasCurent(a, [])).toBe('rezumat')
    // (b) NECONFORM complet, lipsește DOAR poza ultimului piston (regula existentă o cere doar pentru CONFORM)
    const b = complet({ piston_final_rezultat: 'umed', concluzie: 'neconform' })
    const pozeFaraFinal = pozeToate.filter(p => p.categorie !== 'piston_final')
    expect(lipsaDinRand(b, pozeFaraFinal)).toEqual([])
    expect(pasCurent(b, pozeFaraFinal)).toBe('rezumat')
    // (c) configurație cu ZERO bureți, restul complet, lipsa pozelor justificată
    const c = complet({ bureti_buc: 0, cantariri: [], piston_final_rezultat: 'umed', concluzie: 'neconform', poze_justificare: 'fără pistoane-burete, doar PIG metalic' })
    expect(lipsaDinRand(c, [])).toEqual([])
    expect(pasCurent(c, [])).toBe('rezumat')
    // după REDESCHIDERE (stare 'deschisa' din nou, datele neschimbate): tot rezumatul, nu etapa 1
    for (const r of [a, b, c]) {
      expect(pasCurent({ ...r, stare: 'inchisa' }, [])).toBe('inchis')
      expect(pasCurent({ ...r, stare: 'deschisa', revizie: 1 }, r === b ? pozeFaraFinal : [])).toBe('rezumat')
    }
    // CONFORM complet fără poza ultimului piston: regula comună cere dovada → NU e rezumat (etapa 2 o cere, ca dovadă), nici relaxat
    const d = complet()
    expect(lipsaDinRand(d, pozeFaraFinal)).toEqual(['dovada_conform'])
    expect(pasCurent(d, pozeFaraFinal)).toBe('etapa2')
    expect(pasCurent(d, pozeToate)).toBe('rezumat')
    // încărcările nelămurite intră în regula comună: cu una deschisă, raportul (d) nu e „gata”, dar etapele sunt complete → tot rezumatul (unde se lămurește);
    // la (a), verdictul contrar calculului fără motiv scris + încărcarea deschisă → etapa 2 (motivul), căci regula comună nu e goală
    expect(lipsaDinRand(d, pozeToate, 1)).toEqual(['incarcari_nelamurite'])
    expect(pasCurent(d, pozeToate, 1)).toBe('rezumat')
    expect(pasCurent(a, [], 1)).toBe('etapa2')
    // raport început în formularul complet (birou: tronson, detalii, justificare) și continuat pe pași: etapa 1 cere doar ce lipsește cu adevărat
    const birou = complet({ ora_inceput: null, ora_final: null, cantariri: [C(1, null, null), C(2, null, null)], piston_final_rezultat: null, concluzie: null, timp_deplasare_min: null, poze_justificare: 'cântarul nu are ecran lizibil' })
    expect(pasCurent(birou, [])).toBe('etapa1')
    expect(lipsaEtapa1(birou, [])).toEqual(['ora introducerii', 'greutatea pistonului 1 la intrare', 'greutatea pistonului 2 la intrare'])
    const birou2 = { ...birou, ora_inceput: '2026-11-17T08:00:00Z', cantariri: [C(1, 1.25), C(2, 1.3)] }
    expect(pasCurent(birou2, [])).toBe('etapa2')
    expect(lipsaEtapa2(birou2, [])).toEqual(['ora ieșirii', 'greutatea pistonului 1 la ieșire', 'greutatea pistonului 2 la ieșire', 'verdictul ultimului piston (uscat / umed)'])
  })
  it('pasul curent pe TOATE combinațiile celor 9 elemente ale etapelor + cele 6 excepții ale regulii comune (2^15), plus stările finale', () => {
    // elementele etapelor: [0] ora introducerii, [1] greutatea la intrare, [2] poza cântarului la intrare, [3] poza ansamblului,
    //   [4] ora ieșirii, [5] greutatea la ieșire, [6] poza cântarului la ieșire, [7] verdictul ales, [8] poza ultimului piston
    // excepțiile (runda 3): [9] lipsa pozelor JUSTIFICATĂ, [10] verdictul ales e UMED (altfel USCAT), [11] ZERO pistoane-burete,
    //   [12] un motiv scris de om în observații (cu eticheta lui), [13] detaliile cerute de închidere (temperatura, constructor, utilaje,
    //   configurația, presiunea, timpul, data) sunt complete, [14] concluzia din verdict e pusă („Termină etapa 2”; 17.11.2026, defectul 1)
    // Așteptările sunt calculate de mână din regula scrisă (V2 §3.1 + §3a + regula comună §5), nu din codul testat (L25):
    //   etapa 1 = ora intr. + (zero sau greutatea intr.) + (justificat sau (poza cântar intr. (dacă nu zero) + poza ansamblu))
    //   propus = (zero sau greutăți lipsă) ? nimic : USCAT (1,05 − 1 = 50 g ≤ 100 g); contrar = verdict ales ≠ propus → cere motiv scris
    //   etapa 2 = ora ieș. + (zero sau greutatea ieș.) + (justificat sau zero sau poza cântar ieș.) + verdict + (nu contrar sau motiv) + (UMED sau poza ultimului piston)
    //     + concluzia din verdict
    //   regula comună goală = detalii + concluzia + justificat (manometrul și termometrul nu sunt fotografiate aici) + ambele ore + (zero sau ambele greutăți)
    //     + verdict + (UMED sau poza ultimului piston, dovada CONFORM) → REZUMAT direct, indiferent de etape
    let numarate = { etapa1: 0, etapa2: 0, rezumat: 0, comun: 0 }
    for (let m = 0; m < 32768; m++) {
      const are = i => !!((m >> i) & 1)
      const zero = are(11), umed = are(10), just = are(9), obs = are(12), detalii = are(13), concl = are(14)
      const ales = are(7) ? (umed ? 'umed' : 'uscat') : null
      const r = { stare: 'deschisa', lungime_m: 1000, bureti_buc: zero ? 0 : 1, ora_inceput: are(0) ? '2026-11-17T08:00:00Z' : null, ora_final: are(4) ? '2026-11-17T09:00:00Z' : null,
        cantariri: zero ? [] : [C(1, are(1) ? 1 : null, are(5) ? 1.05 : null)], piston_final_rezultat: ales, observatii: obs ? `${MOTIV} buretele ud la exterior` : 'notă liberă',
        poze_justificare: just ? 'ceață' : null, concluzie: concl && ales ? (umed ? 'neconform' : 'conform') : null,
        ...(detalii ? { data_operatie: '2026-11-17', temperatura_c: 8, constructor: 'Constructor SRL', utilaje: [{ denumire: 'Compresor', buc: 1 }], pig_metalic_buc: 0, piston_pu_buc: 0,
          presiune_bar: 2, timp_deplasare_min: 60 }
          : { data_operatie: null, temperatura_c: null, constructor: null, utilaje: [], pig_metalic_buc: null, piston_pu_buc: null, presiune_bar: null, timp_deplasare_min: null }) }
      const poze = [!zero && are(2) && P('cantar_intrare', 1), are(3) && P('pistoane'), !zero && are(6) && P('cantar_iesire', 1), are(8) && P('piston_final')].filter(Boolean)
      const e1 = are(0) && (zero || are(1)) && (just || ((zero || are(2)) && are(3)))
      const propus = !zero && are(1) && are(5) ? 'uscat' : null
      const contrar = !!ales && ales !== propus
      const e2 = are(4) && (zero || are(5)) && (just || zero || are(6)) && !!ales && (!contrar || obs) && (umed || are(8)) && concl
      const comun = detalii && concl && just && are(0) && are(4) && (zero || (are(1) && are(5))) && !!ales && (umed || are(8))
      const asteptat = comun ? 'rezumat' : !e1 ? 'etapa1' : !e2 ? 'etapa2' : 'rezumat'
      const eticheta = `combinația ${m.toString(2).padStart(15, '0')}`
      expect(lipsaDinRand(r, poze).length === 0, eticheta + ' (regula comună)').toBe(comun)
      expect(pasCurent(r, poze), eticheta).toBe(asteptat)
      expect(pasCurent({ ...r, stare: 'inchisa' }, poze)).toBe('inchis')
      expect(pasCurent({ ...r, stare: 'anulata' }, poze)).toBe('anulat')
      numarate[asteptat] += 1
      if (comun) numarate.comun += 1
    }
    // numărate de mână: regula comună goală = 6 biți fixați (detalii, concluzia, justificat, cele două ore, verdictul) × 16 (pozele cântarelor,
    // ansamblului și motivul, libere) × 5 (zero cu greutățile libere: 4, sau ambele greutăți: 1) × 3 (UMED cu poza finală liberă: 2, sau USCAT cu poză: 1) = 240
    expect(numarate.comun).toBe(240)
    expect(numarate.rezumat).toBeGreaterThan(240)
    expect(numarate.etapa1 + numarate.etapa2 + numarate.rezumat).toBe(32768)
    expect(pasCurent(null, [])).toBe('tronson')
  })
})

describe('formularele propuse', () => {
  const rap = (id, extra = {}) => ({ id, proiect_id: 1, proba_id: null, tronson: 'T', km_de_la_m: 0, km_pana_la_m: 1000, lungime_m: 1000, stare: 'inchisa', constructor: null,
    utilaje: [], pig_metalic_buc: null, piston_pu_buc: null, bureti_buc: null, cantariri: [], data_operatie: '2026-11-10', ...extra })
  it('precompletarea vine din ULTIMUL raport neanulat; câmpurile goale nu se copiază', () => {
    const l = [rap(3, { constructor: 'Firma A', utilaje: [{ denumire: 'Compresor', buc: 1 }], pig_metalic_buc: 0, semn_constructor_nume: 'POPESCU ION' }),
      rap(4, { constructor: 'Firma B', utilaje: [] }), rap(5, { stare: 'anulata', constructor: 'Firma anulată' })]
    const p = precompletare(l)
    expect(p.sursa.id).toBe(4)
    expect(p.patch).toEqual({ constructor: 'Firma B' })
    expect(precompletare(l, 4).patch).toMatchObject({ constructor: 'Firma A', utilaje: [{ denumire: 'Compresor', buc: '1' }], pig_metalic_buc: '0', semn_constructor_nume: 'POPESCU ION' })
    expect(precompletare([]).sursa).toBe(null)
  })
  it('uscare nouă: 2 pistoane-burete, ziua de azi (ora României), detaliile precompletate', () => {
    const f = formularPasNou({ uscari: [rap(3, { constructor: 'Firma A' })], constructor: 'Implicit', acum: Date.UTC(2026, 10, 17, 22, 30) })
    expect(f.bureti_buc).toBe('2')
    expect(f.cantariri.map(c => c.nr)).toEqual([1, 2])
    expect(f.data_operatie).toBe('2026-11-18')          // 22:30 UTC = 00:30 în România
    expect(f.constructor).toBe('Firma A')
    expect(payloadDinFormular({ ...f, tronson: 'T', km_de_la: '0', km_pana_la: '1000' }).erori).toEqual([])
  })
  it('trecere nouă: tronsonul și configurația, FĂRĂ greutăți; observațiile spun a câta trecere (numărate doar cele NECONFORME, 17.11.2026)', () => {
    const u = rap(7, { proba_id: 2, stare: 'inchisa', bureti_buc: 3, constructor: 'Firma A', piston_final_rezultat: 'umed', concluzie: 'neconform', cantariri: [C(1, 1, 1.2), C(2, 1, 1.3), C(3, 1, 1.4)] })
    const alta = rap(6, { proba_id: 2, concluzie: 'neconform' }), alt_tronson = rap(5, { proba_id: 9, concluzie: 'neconform' }), anulat = rap(8, { proba_id: 2, stare: 'anulata', concluzie: 'neconform' })
    const conforma = rap(4, { proba_id: 2, concluzie: 'conform', piston_final_rezultat: 'uscat' }), inLucru = rap(9, { proba_id: 2, concluzie: null })
    expect(treceriPeTronson([u, alta, alt_tronson, anulat, conforma, inLucru], u)).toBe(2)
    // același interval de km, fără tronson de probă: la fel, doar cele neconforme
    const k = rap(11, { proba_id: null, concluzie: 'neconform' })
    expect(treceriPeTronson([k, rap(12, { proba_id: null, concluzie: 'conform' }), rap(13, { proba_id: null, concluzie: 'neconform', km_pana_la_m: 2000 }), rap(14, { proba_id: 3, concluzie: 'neconform' })], k)).toBe(1)
    const f = formularTrecereNoua(u, [u, alta, alt_tronson, anulat, conforma, inLucru], Date.UTC(2026, 10, 17, 8, 0))
    expect(f).toMatchObject({ proba_id: '2', tronson: 'T', lungime_m: '1000', bureti_buc: '3', constructor: 'Firma A', data_operatie: '2026-11-17' })
    expect(f.cantariri).toEqual([1, 2, 3].map(nr => ({ nr, intrare_kg: '', iesire_kg: '', motiv: '' })))
    expect(f.observatii).toBe('Trecerea 3 pe acest tronson (trecerea anterioară: raportul din 10.11.2026, ultimul piston nu a ieșit uscat).')
    expect(f.piston_final_rezultat).toBe('')
  })
})

describe('ora „ACUM” (Europe/Bucharest, L17) și timpul de deplasare', () => {
  it('ora goală = acum, la apăsare; ora scrisă rămâne', () => {
    const acum = Date.UTC(2026, 10, 17, 8, 30)
    expect(formularInregistreazaEtapa1({ ora_inceput: '', dst: {}, data_operatie: '2026-11-16' }, acum)).toMatchObject({ ora_inceput: '2026-11-17T10:30', data_operatie: '2026-11-17' })
    expect(formularInregistreazaEtapa1({ ora_inceput: '2026-11-17T07:15', dst: {}, data_operatie: '' }, acum)).toMatchObject({ ora_inceput: '2026-11-17T07:15', data_operatie: '2026-11-17' })
    expect(cuOraImplicita({ ora_final: '2026-11-17T09:00' }, 'ora_final', acum).ora_final).toBe('2026-11-17T09:00')
  })
  it('la ora care apare de două ori (25.10.2026, 03:30) „acum” alege apariția corectă', () => {
    for (const [ms, dst] of [[Date.UTC(2026, 9, 25, 0, 30), 'vara'], [Date.UTC(2026, 9, 25, 1, 30), 'iarna']]) {
      const p = momentAcum({ dst: {} }, 'ora_final', ms)
      expect(p.ora_final).toBe('2026-10-25T03:30')
      expect(p.dst.ora_final).toBe(dst)
      expect(isoDinOraLocala(p.ora_final, p.dst.ora_final)).toBe(new Date(ms).toISOString())
    }
  })
  it('timpul de deplasare se calculează din ore doar dacă e gol; concluzia urmează verdictul confirmat', () => {
    const f = { ora_inceput: '2026-11-17T10:00', ora_final: '', dst: {}, timp_deplasare_min: '', piston_final_rezultat: 'uscat', concluzie: '' }
    const g = formularTerminaEtapa2(f, Date.UTC(2026, 10, 17, 9, 12, 30))
    expect(g).toMatchObject({ ora_final: '2026-11-17T11:12', timp_deplasare_min: '72', concluzie: 'conform' })
    expect(formularTerminaEtapa2({ ...f, timp_deplasare_min: '65', piston_final_rezultat: 'umed', concluzie: 'conform' }, Date.UTC(2026, 10, 17, 9, 12)))
      .toMatchObject({ timp_deplasare_min: '65', concluzie: 'neconform' })
    expect(minuteIntre('2026-11-17T08:00:00Z', '2026-11-17T08:01:30Z')).toBe('1,5')
    expect(minuteIntre('2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z')).toBe('')
    expect(minuteIntre('2026-11-01T08:00:00Z', '2026-11-17T08:00:00Z')).toBe('')    // peste 10.000 min: nu se propune
  })
  it('rândul salvat → formular → pasul: aceleași chei ca formularul complet (o singură definiție a formularului)', () => {
    const r = { id: 1, proiect_id: 1, stare: 'deschisa', tronson: 'T', km_de_la_m: 0, km_pana_la_m: 1000, lungime_m: 1000, utilaje: [], bureti_buc: 2, cantariri: [C(1, 1.2), C(2, 1.3)], ora_inceput: '2026-11-17T08:00:00Z' }
    const f = formularDinRand(r)
    expect(pasCurent({ ...r, ...payloadDinFormular(f).date }, [P('cantar_intrare', 1), P('cantar_intrare', 2), P('pistoane')])).toBe('etapa2')
  })
})
