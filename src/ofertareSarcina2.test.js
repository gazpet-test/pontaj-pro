// R5 sarcina 2 (Copilot, închiderea R4/R5, 26.09.2026) — consumatorii: (a) conflictele transferului fără rând ajung la poartă chiar cu
// zero rânduri nevalidate; (c) citirea eșuată a view-ului / istoricului = „nu putem verifica”, NU zero restanțe; (d) mesajele de lipsă
// nu agregă „X m” peste unități diferite. Rândurile = lic. 3 reale (SELECT 26.09.2026: 2, 3, 4 validate), cu variații.
import { describe, it, expect } from 'vitest'
import { calculeazaPoartaGrafic } from './graficPoartaCalcul.js'
import { campuriCantitatiNevalidate, controlCantitatiGrafic, controlFronturiGrafic, fronturiDinCantitati, grupeDinRanduri, grupeDinView,
  randuriLipsa, stareSursa, textCantitatiPeUnitati, textLipsa } from './ofertareCantitatiAprobare.js'
import { controlCantitati } from './ofertareControale.js'
import { evalueazaPoarta } from './ofertarePoarta.js'

const R = (id, den, m, status = 'validat', um = 'm') => ({ id, obiect: null, categorie: 'Conducte și montaj', denumire: den, um, cantitate: m, cantitate_plansa: m, status, diferenta_nota: null, sursa: 'Memoriu' })
// lic. 3: rețeaua de memoriu, TOATE validate (0 rânduri nevalidate)
const VALIDATE = [R(2, 'Țeavă PE100 SDR11 Dn180 — extravilan Mănăstirea→Coconi', 1100), R(3, 'Țeavă PE100 SDR11 Dn160 — Coconi', 5250)]
const SURSA_OK = { conflicte: [], eroare_conflicte: null, eroare_istoric: null }
// rândul din v_ofertare_transfer_conflicte pentru doc 130 (planșa 1.1 a lic. 3): transferul a lăsat 2 conflicte fără niciun rând scris
const CONFLICT_130 = { document_id: 130, licitatie_id: 3, nume_original: '8.1. PT - 1.1 Schema tehnologica - Pl. 1.pdf', stare: 'conflicte', n: 2, deschis: true, in_curs: false, token: 't1' }
const p = { tip_lucrare: 'retea_pehd', mod: 'oferta', data_start: '2026-10-01', durata_luni: 10, cantitati_asumate: '', echipe: 2, mediu: 'sat',
  include_bransamente: false, nr_bransamente: 0, ferestre_operator: 'x', fronturi: fronturiDinCantitati(VALIDATE, '').fronturi }
const norme = [{ cod: 'PE', tip_lucrare: 'retea_pehd', um: 'm', productie_zi: 100, incredere: 'validat' }]
const cerinte = [{ id: 1, text_cerinta: 'Durata maximă de execuție este de 12 luni.' }]
const poarta = (sursa, cantitati = VALIDATE) => calculeazaPoartaGrafic({ p, cantitati, norme, cerinte, durataMax: 12, ...(sursa === undefined ? {} : { sursa }) })
const rand = (g, k) => g.find(r => r.k === k)

describe('sarcina 2 (a): conflict FĂRĂ rând, cu toate rândurile validate — poarta îl vede', () => {
  it('control: sursa curată => poarta graficului fără block pe „cant” / „front”', () => {
    const g = poarta(SURSA_OK)
    expect([rand(g, 'cant').stare, rand(g, 'front').stare]).toEqual(['ok', 'ok'])
  })
  it('conflict deschis pe planșă, 0 rânduri nevalidate => „cant” BLOCK (sursă incompletă), „front” INCOMPLET (nu ok)', () => {
    const g = poarta({ ...SURSA_OK, conflicte: [CONFLICT_130] })
    const cant = rand(g, 'cant'), front = rand(g, 'front')
    expect(cant.stare).toBe('block')
    expect(cant.detalii).toBe('2 rânduri rețea, toate validate · sursă incompletă: 2 conflicte nerezolvate la transferul din 1 planșă („8.1. PT - 1.1 Schema tehnologica - Pl. 1.pdf” (2)) — ' +
      'nescrise în cantități, deci neaprobate de nimeni; recitește planșa sau confirmă explicit (✋ „confirmă conflictele”) în Documente')
    expect([front.stare, front.incomplet]).toEqual(['warn', true])
    expect(front.detalii).toMatch(/^INCOMPLET, de reverificat — sursă incompletă: 2 conflicte/)
  })
  it('conflictul CONFIRMAT de om / închis prin recitire (deschis=false) => nu mai blochează; transferul în curs => blochează până se termină', () => {
    expect(rand(poarta({ ...SURSA_OK, conflicte: [{ ...CONFLICT_130, deschis: false, stare: 'conflicte' }] }), 'cant').stare).toBe('ok')
    const c = rand(poarta({ ...SURSA_OK, conflicte: [{ ...CONFLICT_130, deschis: false, in_curs: true }] }), 'cant')
    expect([c.stare, /transfer în curs pe „8\.1\. PT/.test(c.detalii)]).toEqual(['block', true])
  })
  it('„Propune din cantități” numește sursa incompletă (fronturile nu sunt prezentate drept complete)', () => {
    const f = fronturiDinCantitati(VALIDATE, '', { ...SURSA_OK, conflicte: [CONFLICT_130] })
    expect(f.fronturi).toHaveLength(2)
    expect(f.text_sursa).toMatch(/^sursă incompletă: 2 conflicte nerezolvate/)
    expect(fronturiDinCantitati(VALIDATE, '', SURSA_OK).text_sursa).toBe('')
  })
  it('H2: F3 validată = fronturi, 0 rânduri nevalidate, dar o planșă cu conflicte deschise => WARN „INCOMPLET” (nu ok); evalueazaPoarta: rezervă, nu verde', () => {
    const st = { lista_f3_m: 700, grafic_fronturi_m: 700, ...campuriCantitatiNevalidate({ data: { licitatie_id: 3, lista_f3_nevalidate: 0, fara_tip_nevalidate: 0,
      invalidate_in_afara_retea: 0, total_invalidate: 0, unitate_schimbata_in_afara_retea: 0, um_de_normalizat: 0,
      transfer_conflicte_docs: 1, transfer_conflicte_n: 2, transfer_conflicte_lista: '8.1. PT - 1.1 Schema tehnologica - Pl. 1.pdf (2)', transfer_in_curs: 0 }, error: null }) }
    const h = controlCantitati(st)
    expect(h.stare).toBe('warn')
    expect(h.detalii).toBe('700 m în F3 și în grafic · INCOMPLET, de reverificat — sursă incompletă: 2 conflicte nerezolvate la transferul din 1 planșă ' +
      '(8.1. PT - 1.1 Schema tehnologica - Pl. 1.pdf (2)) — nescrise în cantități; recitește planșa sau confirmă explicit (✋) în Documente')
    expect(controlCantitati({ ...st, transfer_conflicte_docs: 0, transfer_conflicte_n: 0 }).stare).toBe('ok')
  })
})

describe('sarcina 2 (c): view / istoric indisponibil => „nu putem verifica”, NU zero restanțe', () => {
  it('poarta graficului fără sursă citită => „cant” BLOCK „nu putem verifica sursa”', () => {
    const g = poarta(undefined)
    expect(rand(g, 'cant').stare).toBe('block')
    expect(rand(g, 'cant').detalii).toMatch(/nu putem verifica sursa cantităților/)
    expect(rand(g, 'front').stare).not.toBe('ok')
  })
  it('view-ul conflictelor inexistent (cod nou publicat înainte de migrarea 2) => BLOCK cu motivul; istoricul indisponibil => BLOCK', () => {
    const e1 = rand(poarta({ conflicte: [], eroare_conflicte: 'relation "public.v_ofertare_transfer_conflicte" does not exist', eroare_istoric: null }), 'cant')
    expect([e1.stare, e1.detalii]).toEqual(['block', '2 rânduri rețea, toate validate · nu putem verifica sursa (conflictele transferului din planșe indisponibile: relation "public.v_ofertare_transfer_conflicte" does not exist)'])
    const e2 = rand(poarta({ conflicte: [], eroare_conflicte: null, eroare_istoric: 'timeout' }), 'cant')
    expect([e2.stare, /nu putem verifica invalidările \(istoricul aprobărilor indisponibil: timeout\)/.test(e2.detalii)]).toEqual(['block', true])
    expect(stareSursa(null)).toMatchObject({ verificata: false, blocheaza: true })
  })
  it('H2: v_ofertare_cantitati_nevalidate cu eroare => BLOCK „nu putem verifica” și cu F3 validată = fronturi, și fără F3', () => {
    const err = campuriCantitatiNevalidate({ error: { message: 'relation "public.v_ofertare_cantitati_nevalidate" does not exist' }, data: null })
    for (const baza of [{ lista_f3_m: 700, grafic_fronturi_m: 700 }, { lista_f3_m: null, grafic_fronturi_m: 700 }]) {
      const h = controlCantitati({ ...baza, ...err })
      expect(h.stare).toBe('block')
      expect(h.detalii).toMatch(/nu putem verifica cantitățile nevalidate și sursa \(planșele\): v_ofertare_cantitati_nevalidate indisponibil \(relation "public\.v_ofertare_cantitati_nevalidate" does not exist\) — nu înseamnă zero restanțe/)
    }
  })
  it('poarta propunerii: H2 indisponibil => block pe „cantitati”', () => {
    const ev = evalueazaPoarta({ capitole: 5, capitole_goale: 0, lista_f3_m: 700, grafic_fronturi_m: 700, cantitati_nevalidate_indisponibil: 'eroare de rețea' })
    expect(ev.randuri.find(r => r.k === 'cantitati').stare).toBe('block')
  })
})

describe('sarcina 2 (d): unitățile — fără „X m” peste unități diferite', () => {
  it('textCantitatiPeUnitati: o unitate => „1.000 m”; mai multe => pe clase, fiecare unitate separat (fără m ↔ ml); fără cantitate numărat separat', () => {
    expect(textCantitatiPeUnitati({ peUm: { m: 1000 } })).toBe('1.000 m')
    expect(textCantitatiPeUnitati(grupeDinRanduri([{ um: 'm', cantitate: 1000 }, { um: 'ml', cantitate: 300 }, { um: 'BUCATA', cantitate: 2 }, { um: 'buc', cantitate: 1 },
      { um: 'mp', cantitate: 20 }, { um: 'm cub', cantitate: 1.5 }, { um: 'sute mc', cantitate: 2 }, { um: 'kg', cantitate: 5 }, { um: null, cantitate: 7 }, { um: 'm', cantitate: null }])))
      .toBe('lungimi 1.000 m + 300 ml; suprafețe 20 mp; volume 1,5 mc + 2 sute mc; bucăți 3 buc; alte unități 5 kg; fără unitate 7 (fără unitate); 1 poziție fără cantitate determinată')
    expect(textCantitatiPeUnitati(grupeDinRanduri([{ um: 'm', cantitate: null }, { um: 'buc', cantitate: null }]))).toBe('2 poziții fără cantitate determinată')
  })
  it('randuriLipsa / textLipsa (poarta graficului): rețea în m + invalidat ieșit în ml + invalidat în buc + fără cantitate => nicio sumă peste unități', () => {
    const inv = (id, den, q, um) => ({ ...R(id, den, q, 'diferenta', um), diferenta_nota: 'Rândul era VALIDAT — aprobarea veche (…) nu mai e valabilă: … Valoarea și aprobarea veche rămân în istoric; validarea se reface.' })
    const c = [R(2, 'Țeavă PE100 SDR11 Dn180 — extravilan', 1100, 'extras'), R(3, 'Țeavă PE100 SDR11 Dn160 — Coconi', null, 'extras'),
      inv(4, 'Țeavă PE100 SDR11 Dn110 — Făgului', 300, 'ml'), inv(5, 'Robinet Dn110', 3, 'buc')]
    const L = randuriLipsa(c, '')
    expect([L.lipsa.map(x => x.id), L.peUm, L.faraCantitate]).toEqual([[2, 3, 4, 5], { m: 1100, ml: 300, buc: 3 }, 1])
    expect(textLipsa(L)).toMatch(/^lipsesc 4 rânduri necesare nevalidate \(lungimi 1\.100 m \+ 300 ml; bucăți 3 buc; 1 poziție fără cantitate determinată\): #2 /)
    expect(textLipsa(L)).toMatch(/#3 „Țeavă PE100 SDR11 Dn160 — Coconi” \(extras, fără cantitate determinată\)/)
    expect(controlCantitatiGrafic(c, '').detalii).not.toMatch(/1\.403 m|1\.400 m/)
  })
  it('H2: defalcarea pe unitate din view (*_pe_um), nu *_m; view vechi (fără *_pe_um) => spune că e doar partea în m', () => {
    const baza = { lista_f3_m: 700, grafic_fronturi_m: 700, lista_f3_nevalidate: 0, fara_tip_nevalidate: 0, total_invalidate: 0, unitate_schimbata_in_afara_retea: 0, um_de_normalizat: 0, transfer_conflicte_docs: 0 }
    const h = controlCantitati({ ...baza, invalidate_in_afara_retea: 3, invalidate_in_afara_retea_m: null,
      invalidate_in_afara_retea_pe_um: { ml: { suma: 300, randuri: 1, fara_cantitate: 0 }, bucata: { suma: 3, randuri: 1, fara_cantitate: 0 }, '': { suma: null, randuri: 1, fara_cantitate: 1 } } })
    expect(h.detalii).toMatch(/3 rânduri INVALIDATE au ieșit din setul de rețea \(lungimi 300 ml; bucăți 3 buc; 1 poziție fără cantitate determinată; aprobarea veche/)
    expect(grupeDinView({ ml: { suma: 300, randuri: 1, fara_cantitate: 0 } })).toEqual({ peUm: { ml: 300 }, faraCantitate: 0 })
    const vechi = controlCantitati({ ...baza, invalidate_in_afara_retea: 1, invalidate_in_afara_retea_m: 300 })
    expect(vechi.detalii).toMatch(/\(300 m \(doar rândurile în m; restul unităților necunoscut\); aprobarea veche/)
    // rețeaua fără tip, cu un rând fără cantitate: „(48.195 m; 1 poziție fără cantitate determinată)”, nu „6 rânduri (48.195 m)”
    const ft = controlCantitati({ ...baza, fara_tip_nevalidate: 6, fara_tip_nevalidate_m: 48195, fara_tip_nevalidate_fara_cant: 1 })
    expect(ft.detalii).toMatch(/6 rânduri de rețea fără tip de sursă, nevalidate \(48\.195 m; 1 poziție fără cantitate determinată\)/)
  })
})
