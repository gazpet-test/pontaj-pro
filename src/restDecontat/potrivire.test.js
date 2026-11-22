// Teste pentru potrivirea liniilor situației cu baza (v_executie_rest_decontat_baza) — baza sintetică, fără date reale.
import { describe, it, expect } from 'vitest'
import { potrivesteLinii, cheieClient, parteCheie, similaritate, tokeniDenumire, rezumatPotrivire, PRAG_DESCRIERE, NIVELURI } from './potrivire.js'

const b = (cheie, extra) => ({
  cheie, tip_rand: 'articol', obiect_cod: '01', deviz_cod: '0101', nr: '1', cod: '', denumire: '', um: 'MC', um_incert: false, cantitate: 1, valoare: 1, ...extra,
})
// rândurile vederii (um deja normalizat de BD: M / MC / MP / BUC / KG)
const BAZA = [
  b('01|0101|TSA01A1', { cod: 'TSA01A1', denumire: 'Săpătură manuală în spații limitate' }),
  b('01|0101|TSD01B1', { nr: '2', cod: 'TSD01B1', denumire: 'Umplutură compactată' }),
  b('01|0101|RPCU01', { nr: '3', cod: 'RPCU01', denumire: 'Montaj țeavă', um: 'M' }),
  b('01|0101|UNIC1', { nr: '4', cod: 'UNIC1', denumire: 'Articol unic în proiect', um: 'M' }),
  b('02|0201|TSA01A1|#1', { obiect_cod: '02', deviz_cod: '0201', nr: '1', cod: 'TSA01A1', denumire: 'Săpătură manuală în teren tare' }),
  b('02|0201|TSA01A1|#2', { obiect_cod: '02', deviz_cod: '0201', nr: '2', cod: 'TSA01A1', denumire: 'Săpătură manuală în teren tare, partea 2' }),
  b('03|0301|IZF01', { obiect_cod: '03', deviz_cod: '0301', cod: 'IZF01', denumire: 'Izolație anticorozivă', um: 'MP' }),
  b('03|0301|PRB01', { obiect_cod: '03', deviz_cod: '0301', nr: '2', cod: 'PRB01', denumire: 'Proba de presiune a conductei', um: 'BUC' }),
  b('03|0301|INC01', { obiect_cod: '03', deviz_cod: '0301', nr: '3', cod: 'INC01', denumire: 'Articol cu UM incert', um: 'M', um_incert: true }),
  b('04|0401|GEM1', { obiect_cod: '04', deviz_cod: '0401', nr: '1', cod: 'GEM1', denumire: 'Curățare traseu conductă', um: 'M' }),
  b('04|0401|GEM2', { obiect_cod: '04', deviz_cod: '0401', nr: '2', cod: 'GEM2', denumire: 'Curățare traseu conductă', um: 'M' }),
  b('|OS|OS', { tip_rand: 'os', obiect_cod: '', deviz_cod: 'OS', nr: '1', cod: 'OS', denumire: 'Organizare de șantier', um: 'LEI' }),
]
const L = (extra) => ({ obiect_cod: '', deviz_cod: '', nr: '', cod: '', denumire: '', um: 'mc', cantitate_perioada: 1, cantitate_cumulat_doc: null, pret_unitar: 1, valoare: 1, tip_rand: 'articol', ...extra })
const una = linie => potrivesteLinii([linie], BAZA)[0]

describe('cheieClient (oglinda fn_rest_decontat_cheie, doar pentru afișare)', () => {
  it('trim, majuscule, spații multiple → unul, nr doar când nu e null', () => {
    expect(parteCheie('  a\t b\n\nc ')).toBe('A B C')
    expect(cheieClient('01', '0101', 'tsa01a1', null)).toBe('01|0101|TSA01A1')
    expect(cheieClient('01', '0101', 'tsa01a1', '2')).toBe('01|0101|TSA01A1|#2')
    expect(cheieClient('', '', 'os', null)).toBe('||OS')
    // cheia BAZEI sintetice e exact ce ar da funcția pe câmpurile rândului
    for (const r of BAZA) expect(r.cheie).toBe(cheieClient(r.obiect_cod, r.deviz_cod, r.cod, r.cheie.includes('|#') ? r.nr : null))
  })
})

describe('similaritate pe denumire (tokeni, Dice)', () => {
  it('fără diacritice și majuscule; identic = 1; disjunct = 0; aproape identic peste prag', () => {
    expect(tokeniDenumire('Săpătură manuală, în spații limitate!')).toEqual(['sapatura', 'manuala', 'in', 'spatii', 'limitate'])
    expect(similaritate('Proba de presiune a conductei', 'PROBA DE PRESIUNE A CONDUCTEI')).toBe(1)
    expect(similaritate('Montaj țeavă', 'Umplutură compactată')).toBe(0)
    expect(similaritate('Săpătură manuală în teren tare', 'Săpătură manuală în teren tare, partea 2')).toBe(0.909)
    expect(similaritate('', 'x')).toBe(0)
    expect(PRAG_DESCRIERE).toBe(0.85)
  })
})

describe('potrivesteLinii — ordinea: cod + obiect → cod singur → denumire; nimic nesigur nu trece', () => {
  it('cod + obiect (+ deviz) → exact; codul scris cu spații / litere mici', () => {
    const r = una(L({ obiect_cod: '01', deviz_cod: '0101', cod: ' tsa01a1 ', denumire: 'altceva', um: 'mc' }))
    expect(r).toMatchObject({ cheie_propusa: '01|0101|TSA01A1', nivel: 'exact', scor: 1, motiv: null })
    // fără deviz pe linie: obiectul + codul ajung
    expect(una(L({ obiect_cod: '01', cod: 'TSD01B1' })).nivel).toBe('exact')
    // deviz diferit de cel din bază: nu e „exact” în obiect; codul e unic în proiect → 'cod'
    expect(una(L({ obiect_cod: '01', deviz_cod: '0199', cod: 'TSD01B1' }))).toMatchObject({ cheie_propusa: '01|0101|TSD01B1', nivel: 'cod' })
  })
  it('cod existent doar în alt obiect (unic în proiect) → cod', () => {
    const r = una(L({ obiect_cod: '05', cod: 'UNIC1', um: 'ml' }))
    expect(r).toMatchObject({ cheie_propusa: '01|0101|UNIC1', nivel: 'cod', scor: 1 })
  })
  it('cod în mai multe obiecte, fără obiectul liniei → de_verificat', () => {
    const r = una(L({ obiect_cod: '09', cod: 'TSA01A1' }))
    expect(r).toMatchObject({ cheie_propusa: null, nivel: 'de_verificat' })
    expect(r.motiv).toMatch(/există în 3 obiecte/)
  })
  it('cod inexistent în bază → de_verificat (nu cădem pe denumire când linia ARE cod)', () => {
    const r = una(L({ obiect_cod: '03', cod: 'XXX99', denumire: 'Proba de presiune a conductei', um: 'buc' }))
    expect(r).toMatchObject({ cheie_propusa: null, nivel: 'de_verificat', scor: 0 })
    expect(r.motiv).toMatch(/codul XXX99 nu există în bază/)
  })
  it('cod repetat în același deviz (chei cu #nr): poziția decide; fără poziție → de_verificat, nu se contopește', () => {
    expect(una(L({ obiect_cod: '02', deviz_cod: '0201', nr: '2', cod: 'TSA01A1' }))).toMatchObject({ cheie_propusa: '02|0201|TSA01A1|#2', nivel: 'exact' })
    expect(una(L({ obiect_cod: '02', deviz_cod: '0201', nr: '1', cod: 'TSA01A1' }))).toMatchObject({ cheie_propusa: '02|0201|TSA01A1|#1', nivel: 'exact' })
    const fara = una(L({ obiect_cod: '02', deviz_cod: '0201', nr: '', cod: 'TSA01A1' }))
    expect(fara).toMatchObject({ cheie_propusa: null, nivel: 'de_verificat' })
    expect(fara.motiv).toMatch(/se repetă în același deviz \(2 poziții\)/)
    const gresit = una(L({ obiect_cod: '02', deviz_cod: '0201', nr: '7', cod: 'TSA01A1' }))
    expect(gresit.nivel).toBe('de_verificat')
  })
  it('fără cod: denumire aproape identică → descriere (cu scor); sub prag → de_verificat cu cel mai apropiat ca sugestie', () => {
    const r = una(L({ obiect_cod: '03', cod: '', denumire: 'Proba de presiune a conductei', um: 'buc' }))
    expect(r).toMatchObject({ cheie_propusa: '03|0301|PRB01', nivel: 'descriere', scor: 1, motiv: null })
    const r2 = una(L({ obiect_cod: '02', cod: '', denumire: 'Săpătură manuală în teren tare', um: 'mc' }))
    expect(r2).toMatchObject({ cheie_propusa: '02|0201|TSA01A1|#1', nivel: 'descriere', scor: 1 })
    const slab = una(L({ obiect_cod: '03', cod: '', denumire: 'Proba de etanșeitate', um: 'buc' }))
    expect(slab.nivel).toBe('de_verificat')
    expect(slab.scor).toBeLessThan(PRAG_DESCRIERE)
    expect(slab.cheie_propusa).toBe('03|0301|PRB01') // doar sugestie, nivelul rămâne de verificat
    expect(slab.motiv).toMatch(/< 0\.85/)
    const nimic = una(L({ obiect_cod: '03', cod: '', denumire: 'Vopsitorie', um: 'buc' }))
    expect(nimic).toMatchObject({ cheie_propusa: null, nivel: 'de_verificat', scor: 0 })
  })
  it('fără cod, două denumiri la fel de apropiate → de_verificat (ambiguu, nu alegem noi)', () => {
    const r = una(L({ obiect_cod: '04', cod: '', denumire: 'Curățare traseu conductă', um: 'm' }))
    expect(r.nivel).toBe('de_verificat')
    expect(r.motiv).toMatch(/două denumiri la fel de apropiate/)
  })
  it('UM diferit după normalizare → de_verificat indiferent de nivel (păstrează cheia ca sugestie, cu motivul um_diferit)', () => {
    const r = una(L({ obiect_cod: '01', deviz_cod: '0101', cod: 'RPCU01', um: 'MC' })) // baza: M
    expect(r).toMatchObject({ cheie_propusa: '01|0101|RPCU01', nivel: 'de_verificat' })
    expect(r.motiv).toMatch(/UM diferit: situația „MC” \(MC\) vs baza „M” \(M\) — um_diferit/)
    // același lucru pe nivelul 'cod' și pe 'descriere'
    expect(una(L({ obiect_cod: '05', cod: 'UNIC1', um: 'buc' })).nivel).toBe('de_verificat')
    expect(una(L({ obiect_cod: '03', cod: '', denumire: 'Proba de presiune a conductei', um: 'm' })).nivel).toBe('de_verificat')
    // UM gol pe linie = diferit (nu „egal cu orice”)
    expect(una(L({ obiect_cod: '01', deviz_cod: '0101', cod: 'RPCU01', um: '' })).nivel).toBe('de_verificat')
  })
  it('UM egal după normalizare (HM / ML = M; 100 MP = MP; „M.C.” = MC) → rămâne exact', () => {
    expect(una(L({ obiect_cod: '01', deviz_cod: '0101', cod: 'RPCU01', um: 'HM' })).nivel).toBe('exact')
    expect(una(L({ obiect_cod: '01', deviz_cod: '0101', cod: 'RPCU01', um: 'ml' })).nivel).toBe('exact')
    expect(una(L({ obiect_cod: '03', deviz_cod: '0301', cod: 'IZF01', um: '100 MP' })).nivel).toBe('exact')
    expect(una(L({ obiect_cod: '01', deviz_cod: '0101', cod: 'TSA01A1', um: 'M.C.' })).nivel).toBe('exact')
  })
  it('UM-ul bazei incert → de_verificat chiar la cod + obiect', () => {
    const r = una(L({ obiect_cod: '03', deviz_cod: '0301', cod: 'INC01', um: 'm' }))
    expect(r.nivel).toBe('de_verificat')
    expect(r.motiv).toMatch(/UM-ul articolului din bază e incert/)
  })
  it('OS / diverse: rândul special din bază; lipsă → de_verificat (articol nou?)', () => {
    expect(una(L({ tip_rand: 'os', cod: 'OS', denumire: 'Organizare de șantier', um: 'lei' }))).toMatchObject({ cheie_propusa: '|OS|OS', nivel: 'exact' })
    const d = una(L({ tip_rand: 'diverse', denumire: 'Diverse și neprevăzute', um: 'lei' }))
    expect(d).toMatchObject({ cheie_propusa: null, nivel: 'de_verificat' })
    expect(d.motiv).toMatch(/baza nu are rând „diverse”/)
  })
  it('același articol din bază propus pentru două linii → ambele de_verificat (RPC-ul refuză dublurile)', () => {
    const r = potrivesteLinii([L({ obiect_cod: '01', cod: 'TSD01B1' }), L({ obiect_cod: '01', cod: 'TSD01B1', nr: '9' }), L({ obiect_cod: '01', cod: 'RPCU01', um: 'm' })], BAZA)
    expect(r.map(x => x.nivel)).toEqual(['de_verificat', 'de_verificat', 'exact'])
    expect(r[0].motiv).toMatch(/propus pentru 2 linii/)
    expect(r[0].cheie_propusa).toBe('01|0101|TSD01B1')
  })
  it('linia păstrează toate câmpurile ei; baza goală = tot de_verificat; rezumatul numără pe niveluri', () => {
    const l = L({ obiect_cod: '01', deviz_cod: '0101', cod: 'TSA01A1', foaie: 'S', rand: 10 })
    expect(una(l)).toMatchObject({ ...l, nivel: 'exact' })
    const gol = potrivesteLinii([l, L({ cod: '', denumire: 'x' })], [])
    expect(gol.map(x => x.nivel)).toEqual(['de_verificat', 'de_verificat'])
    expect(rezumatPotrivire(gol)).toEqual({ exact: 0, cod: 0, descriere: 0, de_verificat: 2 })
    expect(NIVELURI).toEqual(['exact', 'cod', 'descriere', 'de_verificat'])
  })
})
