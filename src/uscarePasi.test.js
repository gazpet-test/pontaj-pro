// Teste pentru logica PURĂ a ecranului pe pași (uscarePasi.js). Valorile așteptate sunt calculate de mână din regula scrisă în brief /
// V2 §3.1 (100 g pe km × lungimea; egalitatea trece), nu din codul testat (L25). Date SINTETICE.
import { describe, it, expect } from 'vitest'
import {
  PRAG_G_PE_KM, grame, diferentaGrame, pragGrame, inPrag, ultimulPiston, verdictPropus, contrazice, avertismenteGreutate, avertismentePereche,
  lipsaEtapa1, lipsaEtapa2, pasCurent, precompletare, formularPasNou, formularTrecereNoua, treceriPeTronson, momentAcum, cuOraImplicita,
  minuteIntre, formularInregistreazaEtapa1, formularTerminaEtapa2,
} from './uscarePasi.js'
import { isoDinOraLocala, formularDinRand, payloadDinFormular } from './uscareLogica.js'

const C = (nr, intrare_kg, iesire_kg = null, motiv = null) => ({ nr, intrare_kg, iesire_kg, motiv })
const P = (categorie, burete_nr = null) => ({ categorie, burete_nr })

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
  it('greutate „negativă” (iese mai ușor): mic = fără acumulare (uscat); mare = de verificat, fără propunere', () => {
    expect(verdictPropus(r([C(1, 1.25, 1.24)]))).toMatchObject({ diferenta_g: -10, stare: 'trece', propus: 'uscat' })   // 10 g ≤ 1% din 1250 g
    expect(verdictPropus(r([C(1, 1.25, 1.23)]))).toMatchObject({ diferenta_g: -20, stare: 'de_verificat', propus: null })
    expect(verdictPropus(r([C(1, 0.05, 0.049)]))).toMatchObject({ diferenta_g: -1, stare: 'trece' })                     // toleranța minimă: 1 g
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
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: null, cantariri: [] }, [])).toEqual(['câte pistoane-burete (cel puțin unul)'])
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 2, cantariri: [C(1, 1)] }, [P('cantar_intrare', 1), P('pistoane')])).toEqual(['rândurile de cântărire (câte unul pe piston)'])
    // „nu se aplică” (din formularul complet): fără greutate și fără poză cerute
    expect(lipsaEtapa1({ ora_inceput: 'x', bureti_buc: 2, cantariri: [C(1, 1), C(2, null, null, 'rupt')] }, [P('cantar_intrare', 1), P('pistoane')])).toEqual([])
  })
  it('etapa 2: presiunea nu blochează; verdictul contrar calculului cere motivul', () => {
    const baza = { ora_inceput: 'a', ora_final: 'b', lungime_m: 1000, bureti_buc: 1, cantariri: [C(1, 1, 1.05)], piston_final_rezultat: 'uscat', observatii: null, presiune_bar: null }
    const poze = [P('cantar_iesire', 1), P('piston_final')]
    expect(lipsaEtapa2(baza, poze)).toEqual([])
    expect(lipsaEtapa2({ ...baza, piston_final_rezultat: 'umed' }, poze)).toEqual(['motivul (în observații) pentru verdictul diferit de calcul'])
    expect(lipsaEtapa2({ ...baza, piston_final_rezultat: 'umed', observatii: 'buretele avea urme de apă' }, poze)).toEqual([])
    expect(lipsaEtapa2({ ...baza, ora_final: null, piston_final_rezultat: null }, [])).toEqual([
      'ora ieșirii', 'poza cântarului pentru pistonul 1 (ieșire)', 'verdictul ultimului piston (uscat / umed)', 'poza ultimului piston',
    ])
  })
  it('pasul curent pe TOATE combinațiile celor 9 elemente ale etapelor (2^9), plus stările finale', () => {
    // elementele: [0] ora introducerii, [1] greutatea la intrare, [2] poza cântarului la intrare, [3] poza ansamblului,
    //             [4] ora ieșirii, [5] greutatea la ieșire, [6] poza cântarului la ieșire, [7] verdictul, [8] poza ultimului piston
    let numarate = { etapa1: 0, etapa2: 0, rezumat: 0 }
    for (let m = 0; m < 512; m++) {
      const are = i => (m >> i) & 1
      const r = { stare: 'deschisa', lungime_m: 1000, bureti_buc: 1, ora_inceput: are(0) ? '2026-11-17T08:00:00Z' : null, ora_final: are(4) ? '2026-11-17T09:00:00Z' : null,
        cantariri: [C(1, are(1) ? 1 : null, are(5) ? 1.05 : null)], piston_final_rezultat: are(7) ? 'uscat' : null, observatii: null }
      const poze = [are(2) && P('cantar_intrare', 1), are(3) && P('pistoane'), are(6) && P('cantar_iesire', 1), are(8) && P('piston_final')].filter(Boolean)
      const e1 = are(0) && are(1) && are(2) && are(3), e2 = are(4) && are(5) && are(6) && are(7) && are(8)
      const asteptat = !e1 ? 'etapa1' : !e2 ? 'etapa2' : 'rezumat'
      expect(pasCurent(r, poze), `combinația ${m.toString(2).padStart(9, '0')}`).toBe(asteptat)
      expect(pasCurent({ ...r, stare: 'inchisa' }, poze)).toBe('inchis')
      expect(pasCurent({ ...r, stare: 'anulata' }, poze)).toBe('anulat')
      numarate[asteptat] += 1
    }
    expect(numarate).toEqual({ etapa1: 480, etapa2: 31, rezumat: 1 })
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
  it('trecere nouă: tronsonul și configurația, FĂRĂ greutăți; observațiile spun a câta trecere', () => {
    const u = rap(7, { proba_id: 2, stare: 'inchisa', bureti_buc: 3, constructor: 'Firma A', piston_final_rezultat: 'umed', cantariri: [C(1, 1, 1.2), C(2, 1, 1.3), C(3, 1, 1.4)] })
    const alta = rap(6, { proba_id: 2 }), alt_tronson = rap(5, { proba_id: 9 }), anulat = rap(8, { proba_id: 2, stare: 'anulata' })
    expect(treceriPeTronson([u, alta, alt_tronson, anulat], u)).toBe(2)
    const f = formularTrecereNoua(u, [u, alta, alt_tronson, anulat], Date.UTC(2026, 10, 17, 8, 0))
    expect(f).toMatchObject({ proba_id: '2', tronson: 'T', lungime_m: '1000', bureti_buc: '3', constructor: 'Firma A', data_operatie: '2026-11-17' })
    expect(f.cantariri).toEqual([1, 2, 3].map(nr => ({ nr, intrare_kg: '', iesire_kg: '', motiv: '' })))
    expect(f.observatii).toContain('Trecerea 3')
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
