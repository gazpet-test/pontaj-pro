// Teste pentru citirea extraselor C6–C9 (materialele din ofertă, faza 2).
// Fixture SINTETIC: denumiri, coduri și prețuri inventate; valorile așteptate sunt calculate de mână (L25),
// nu din codul testat. Fișierul se scrie ca .xls (BIFF8), ca extrasele reale din programul de devize.
// Fixture-ul de bază (`complet()`) e structural COMPLET; fiecare test de completitudine strică un singur lucru
// și verifică lista EXACTĂ de motive, ca fiecare control să fie dovedit separat (mutanții din raport).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  citesteExtras, citesteC6, citesteC9, citesteResurse, umCanonic, aplicaParitate, tsvMateriale, tsvResurse, COLOANE_MATERIALE, verificaProdus,
  clasificaSubsol, umFormaImport, omisiuneAdmisa, MOTIV_DUPA_TOTAL,
} from './extrase_lib.mjs'
import { ruleaza } from './citeste_extrase.mjs'
import { parseExtrasMateriale } from '../../src/devizParser.js'

let XLSX
beforeAll(async () => { const _x = await import('xlsx-js-style'); XLSX = _x.default?.read ? _x.default : _x })

const ANTET_C6 = ['Nr.\ncrt.', 'Denumirea resursei materiale  ', 'U.M.', 'Consumuri\ncuprinse\nin oferta', 'Pret unitar\n(exclusiv TVA)\n- RON -', 'Valoare\n(exclusiv TVA)\n- RON -', 'Furnizor', 'Greutate\n(tone)']
// rândurile 1..19 din Excel (indicele 0 = rândul 1); TOTAL pe rândul 17 (indicele 16)
const c6 = () => [
  ['', '', '', '', '', '', '', 'FORMULAR C6'],
  ['Lista consumurilor de resurse materiale'],
  ['Lucrarea :', 'LUCRARE DE TEST'],
  [],
  ANTET_C6,
  [0, 1, 2, 3, 4, 5, 6, 7],
  ['1', '1000001 MATERIAL TEST A', 'KG', 10, 2.5, 25, '', 0.01],
  ['2', '1000002 MATERIAL TEST B', 'M.C.', 4, 100, 400, 'FURNIZOR TEST', 0],
  ['3', '1000003 MATERIAL TEST C', 'BUC.', 0, 7, 0, '', 0],
  ['4', '1000004 MATERIAL TEST D', 'MP', 2, 3, 6, '', 0],
  ['5', '1000001 MATERIAL TEST A BIS', 'KG', 1, 2.5, 2.5, '', 0],
  ['6', '1000006 MATERIAL TEST F', 'L', 3, 2, 7, '', 0],
  ['7', 'MATERIAL MARUNT.', 'LEI.', '', '', 12.5, '', 0],
  ['8', '1000008', 'BUC.', 1, 1, 1, '', 0],
  ['9', '1000009 MATERIAL TEST I', 'BUC.', -1, 5, -5, '', 0],
  ['10', '1000010 MATERIAL TEST J', '100 MC', 2, 50, 100, '', 0],
  ['', 'TOTAL', '', '', '  RON', '549.00', '', ''],
  ['', '', '', '', '  EURO', '110.00', '', ''],
  ['', '', '', '', '', '', 'Ofertant', ''],
]
const c7 = () => [
  ['', '', '', '', '', 'FORMULAR C7'], [' Lista consumurilor cu mana de lucru '], [],
  ['Nr.\ncrt.', 'Denumirea meseriei ', 'Consumuri \n(om-ore)cu \nmanopera directa', 'Tarif mediu\n-RON/ora-', 'Valoare(exclusiv TVA)\n- RON -\n( 2 x 3 )', ' Procent \n100% '],
  [0, 1, 2, 3, 4, 5],
  ['1', 'MESERIE TEST', 10, 20, 200, 100],
  ['2', 'DIFERENTA PRET MANOPERA - MII LEI', '', '', 50, 100],
  ['', 'TOTAL', '', '  RON', '250.00'],
  ['Lucrarea se incadreaza in grupa:'],
  ['', '', '', '', '', 'Ofertant'],
]
const c8 = () => [
  ['', '', '', '', 'FORMULAR C8'], ['Lista consumurilor de ore de functionare a Utilajelor de constructii'], [],
  ['Nr.\ncrt.', 'Denumirea utilajului de constructii', 'Consumuri\n- ore de functionare -', 'Tarif orar\n- RON/ora functionare -', 'Valoare (exclusiv TVA)\n -   RON   -\n ( 2 x 3 )'],
  [0, 1, 2, 3, 4],
  ['1', 'UTILAJ TEST', 5, 30, 150],
  ['', 'TOTAL', '', '  RON', '150.00'],
  ['', '', '', '', 'Ofertant'],
  ['', '', '', '', 'SC FIRMA TEST SRL'],
]
const c9 = () => [
  ['', '', '', '', '', '', 'FORMULAR C9'], ['Lista consumurilor privind transporturile '], [],
  ['Nr.\ncrt.', 'Tip \nde transport ', 'Elemente rezultate din analiza lucrarilor\n ce urmeaza a fi executate ', '', '', 'Tarif unitar \n-RON/tona-', 'Valoare \n(exclusiv TVA) \n- RON -'],
  ['', '', 'Tone\ntransportate', 'km.\nparcursi', 'ore de\nfunctionare', '', ''],
  [0, 1, 2, 3, 4, 5, 6],
  ['1', 'Transport auto (total) din care,pe categorii', 30, '', '', '', 75],
  ['1.001', 'TRANSPORT TEST X', 10, '', '', 2, 20],
  ['1.002', 'TRANSPORT TEST Y', 20, '', '', 2.5, 50],
  ['1.003', 'Diferenta pret transport auto', '', '', '', '', 5],
  ['2', 'Transport pe cale ferata (total) din care,pe categorii', 0, '', '', '', 0],
  ['', 'TOTAL', '', '', '', '  RON', '75.00'],
]
// foaia de lucru: același antet și același TOTAL ca C6, dar fără marcajul „FORMULAR” → ignorată
const deComandat = () => [['', 'Lista consumurilor de resurse materiale'], [], ANTET_C6, ['1', '1000001 MATERIAL TEST A', 'KG', '10.000', '2.50', '25.00', 'X', 'comanda'], ['', 'TOTAL', '', '', '  RON', '549.00']]

function carte(foi) {
  const wb = XLSX.utils.book_new()
  for (const [n, aoa] of foi) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n)
  return XLSX.write(wb, { type: 'array', bookType: 'biff8' })
}
const complet = ({ m = c6(), mo = c7(), u = c8(), t = c9() } = {}) => [['materiale', m], ['materiale de comandat', deComandat()], ['manopera', mo], ['utilaj', u], ['transport', t]]
const peNr = (foaie, nr) => foaie.linii.find((l) => l.nr_crt === nr)
const extras = (opt) => citesteExtras(carte(complet(opt)))
// C6 modificat (doar foaia materiale): f(rows) schimbă rândurile pe loc
const cuC6 = (f) => { const m = c6(); f(m); return extras({ m }) }

describe('citesteExtras — extras complet (.xls)', () => {
  let rez
  beforeAll(async () => { rez = await extras() })

  it('recunoaște formularele după marcaj, ignoră foaia de lucru; extrasul de bază e complet', () => {
    expect(Object.keys(rez.foi).sort()).toEqual(['C6', 'C7', 'C8', 'C9'])
    expect(rez.ignorate.map((g) => g.foaie)).toEqual(['materiale de comandat'])
    expect(rez.erori).toEqual([])
    expect(rez.motive_incomplet).toEqual([])
    expect(rez.completa).toBe(true)
  })

  it('C6: linii, sursa pe rând, total tipărit RON + EURO, concordanță, subsol admis', () => {
    const m = rez.foi.C6
    expect(m.linii).toHaveLength(10)
    expect(m.rand_antet).toBe(5)
    expect(m.linii[0].rand).toBe(7)
    expect(m.linii.at(-1).rand).toBe(16)
    expect(m.randuri_index).toEqual([6])
    expect(m.suma).toBe(549) // 25+400+0+6+2,5+7+12,5+1−5+100
    expect(m.total_tiparit).toBe(549)
    expect(m.total_euro).toBe(110)
    expect(m.rand_total).toBe(17)
    expect(m.concorda).toBe(true)
    expect(m.nr_crt).toEqual({ primul: 1, ultimul: 10, lipsa: [], repetate: [], orfane: [] })
    expect(m.coloana_h).toBe('Greutate (tone)')
    expect(m.subsol.map((s) => [s.rand, s.tip])).toEqual([[18, 'euro'], [19, 'ofertant']])
    expect(m.nerecunoscute).toEqual([])
    expect(m.completa).toBe(true)
  })

  it('C6: cod, denumire, UM normalizat ca în devizParser', () => {
    const m = rez.foi.C6
    expect(peNr(m, '1')).toMatchObject({ cod: '1000001', denumire: 'MATERIAL TEST A', um_sursa: 'KG', um: 'kg', factor_um: 1, cantitate: 10, pret_unitar: 2.5, valoare: 25 })
    expect(peNr(m, '2')).toMatchObject({ um: 'mc', furnizor: 'FURNIZOR TEST', stare: 'ok' })
    expect(peNr(m, '10')).toMatchObject({ um: 'mc', factor_um: 100, cantitate: 2, cantitate_um_baza: 200, stare: 'ok' })
    expect(peNr(m, '6').um).toBe('l')
  })

  it('C6: liniile suspecte sunt de_verificat, cu motivul exact (fără să facă extrasul incomplet)', () => {
    const m = rez.foi.C6
    const mot = (nr) => peNr(m, nr).motive.join(' | ')
    expect(mot('3')).toContain('cantitate 0')
    expect(mot('1')).toContain('cod duplicat (rândurile 7, 11)')
    expect(mot('5')).toContain('cod duplicat (rândurile 7, 11)')
    expect(mot('6')).toContain('valoare ≠ cantitate × preț (dif. -1)')
    expect(mot('6')).not.toContain('UM necunoscut')
    expect(peNr(m, '7').tip).toBe('valoric')
    expect(mot('7')).toContain('linie valorică fără cantitate')
    expect(mot('7')).toContain('importul din ERP sare rândul (fără cantitate')
    expect(mot('8')).toContain('denumire goală')
    expect(mot('8')).toContain('fără cod de resursă')
    expect(mot('8')).toContain('importul din ERP sare rândul (denumire fără litere')
    expect(mot('9')).toContain('cantitate negativ')
    expect(mot('9')).toContain('valoare negativ')
    expect(m.linii.filter((l) => l.stare === 'ok').map((l) => l.nr_crt)).toEqual(['2', '4', '10'])
  })

  it('paritate cu parseExtrasMateriale: aceleași linii, omisiunile admise listate, forma UM a importului păstrată separat', () => {
    expect(rez.paritate.ok).toBe(true)
    expect(rez.paritate.linii_import).toBe(8) // fără 7 (fără cantitate) și 8 (denumire fără litere)
    expect(rez.paritate.valoare_import).toBe(535.5) // 549 − 12,5 − 1
    expect(rez.paritate.omise_admise).toEqual([{ rand: 13, nr: '7', motiv: 'fără cantitate' }, { rand: 14, nr: '8', motiv: 'denumire fără litere' }])
    expect(rez.paritate.linii_lipsa).toEqual([])
    expect(peNr(rez.foi.C6, '2').import_erp.um).toBe('m.c')
    expect(peNr(rez.foi.C6, '7').import_erp).toBe(null)
  })

  it('C7 / C8: resurse, linie valorică, subsol admis (grupa, ofertant, firma)', () => {
    expect(rez.foi.C7.suma).toBe(250)
    expect(rez.foi.C7.concorda).toBe(true)
    expect(peNr(rez.foi.C7, '2').tip).toBe('valoric')
    expect(peNr(rez.foi.C7, '1')).toMatchObject({ um: 'om-ore', cantitate: 10, stare: 'ok' })
    expect(rez.foi.C7.subsol.map((s) => s.tip)).toEqual(['grupa', 'ofertant'])
    expect(rez.foi.C8.subsol.map((s) => s.tip)).toEqual(['ofertant', 'firma'])
    expect(rez.foi.C8.concorda).toBe(true)
  })

  it('C9: detalii + subtotaluri verificate, subtotalurile nu intră în total, numerotare continuă', () => {
    const t = rez.foi.C9
    expect(t.linii.filter((l) => l.tip === 'subtotal').map((l) => l.nr_crt)).toEqual(['1', '2'])
    expect(t.linii.filter((l) => l.tip === 'subtotal').every((l) => l.stare === 'ok')).toBe(true)
    expect(peNr(t, '1.002')).toMatchObject({ cantitate: 20, pret_unitar: 2.5, valoare: 50, stare: 'ok' })
    expect(peNr(t, '1.003').tip).toBe('valoric')
    expect(t.suma).toBe(75)
    expect(t.concorda).toBe(true)
    expect(t.nr_crt).toEqual({ primul: 1, ultimul: 2, lipsa: [], repetate: [], orfane: [] })
  })
})

describe('P1 r2: rândurile de după TOTAL nu dispar tacit (L12, L13)', () => {
  it('rând cu denumire, UM, cantitate și valoare, dar FĂRĂ număr, după TOTAL → nerecunoscut, extras incomplet', async () => {
    const rez = await cuC6((m) => m.push(['', '1000011 MATERIAL TEST K', 'KG', 1, 1, 1]))
    expect(rez.foi.C6.nerecunoscute).toEqual([{ rand: 20, motiv: MOTIV_DUPA_TOTAL, brut: '["","1000011 MATERIAL TEST K","KG",1,1,1,"",""]' }])
    expect(rez.motive_incomplet).toEqual(['C6: 1 rânduri nerecunoscute (rândurile 20)'])
    expect(rez.completa).toBe(false)
  })

  it('rând de articol numerotat după TOTAL → nerecunoscut (și importul îl ia: paritate eșuată)', async () => {
    const rez = await cuC6((m) => m.push(['11', '1000011 MATERIAL TEST K', 'KG', 1, 1, 1]))
    expect(rez.foi.C6.nerecunoscute.map((n) => n.rand)).toEqual([20])
    expect(rez.paritate.fara_pereche).toEqual(['011'])
    expect(rez.completa).toBe(false)
  })

  it('subsolurile admise rămân admise: firma, celule doar în afara formularului (col. H)', async () => {
    const rez = await cuC6((m) => { m.push(['', '', '', '', '', '', 'S.C. FIRMA TEST S.R.L.']); m.push(['', '', '', '', '', '', '', 0.98]) })
    expect(rez.foi.C6.subsol.map((s) => [s.rand, s.tip])).toEqual([[18, 'euro'], [19, 'ofertant'], [20, 'firma'], [21, 'coloane_suplimentare']])
    expect(rez.completa).toBe(true)
  })

  it.each([
    ['al doilea rând EURO', ['', '', '', '', 'EURO', '1.00']],
    ['al doilea TOTAL', ['', 'TOTAL', '', '', 'RON', '549.00']],
    ['„Ofertant” cu altă celulă alături', ['', '', '', '', '', 7, 'Ofertant']],
    ['text care doar începe cu „Ofertant”', ['', '', '', '', '', '', 'Ofertant si altceva']],
    ['număr singur în coloana valorii', ['', '', '', '', '', 12]],
    ['text liber', ['', 'OBSERVATIE']],
  ])('%s după TOTAL → nerecunoscut, extras incomplet', async (_n, rand) => {
    const rez = await cuC6((m) => m.push(rand))
    expect(rez.foi.C6.nerecunoscute.map((n) => [n.rand, n.motiv])).toEqual([[20, MOTIV_DUPA_TOTAL]])
    expect(rez.completa).toBe(false)
  })

  it('clasificaSubsol: pozitiv + negativ, pe lățimea fiecărui formular', () => {
    expect(clasificaSubsol(['', '', '', '', 'EURO', '1.00'], 'C6')).toBe('euro')
    expect(clasificaSubsol(['', '', '', '', 'EURO', '1.00'], 'C6', { euroVazut: true })).toBe(null)
    expect(clasificaSubsol(['', '', '', 'EURO', '1.00'], 'C6')).toBe(null) // EURO pe coloana greșită
    expect(clasificaSubsol(['', '', '', '', 'EURO', 'abc'], 'C6')).toBe(null)
    expect(clasificaSubsol(['', '', '', 'EURO', '1.00'], 'C7')).toBe('euro')
    expect(clasificaSubsol(['', '', '', '', '', 'EURO', '1.00'], 'C9')).toBe('euro')
    expect(clasificaSubsol(['', '', '', '', '', 'Ofertant'], 'C7')).toBe('ofertant')
    expect(clasificaSubsol(['', '', '', '', '', 'Ofertant'], 'C8')).toBe('coloane_suplimentare') // C8 are 5 coloane
    expect(clasificaSubsol(['', '', '', '', 'Ofertant:'], 'C8')).toBe('ofertant')
    expect(clasificaSubsol(['SC FIRMA TEST SRL'], 'C6')).toBe('firma')
    expect(clasificaSubsol(['FIRMA TEST SRL'], 'C6')).toBe(null)
    expect(clasificaSubsol(['SC FIRMA TEST'], 'C6')).toBe(null)
    expect(clasificaSubsol(['Lucrarea se incadreaza in grupa:'], 'C7')).toBe('grupa')
    expect(clasificaSubsol(['Lucrarea se incadreaza in grupa: A'], 'C7')).toBe(null)
    expect(clasificaSubsol(['', '', '', '', '', '', 'Ofertant', 5], 'C6')).toBe('ofertant') // H e în afara formularului
    expect(clasificaSubsol([12], 'C6')).toBe(null) // număr, nu text
  })
})

describe('P1 r2: completitudinea cere toate controalele structurale (L11, L12, L18)', () => {
  it('numerotare 1, 3, ... (lipsește 2; totalul ajustat ca să concorde) → incomplet', async () => {
    const rez = await cuC6((m) => { m.splice(7, 1); m[15] = ['', 'TOTAL', '', '', '  RON', '149.00'] })
    expect(rez.foi.C6.concorda).toBe(true)
    expect(rez.paritate.ok).toBe(true)
    expect(rez.motive_incomplet).toEqual(['C6: numerotare cu goluri: lipsesc 2'])
    expect(rez.completa).toBe(false)
  })

  it('nr. crt. repetat (valoare 0, totalul neschimbat) → incomplet', async () => {
    const rez = await cuC6((m) => m.splice(16, 0, ['10', '1000011 MATERIAL TEST K', 'KG', 0, 1, 0]))
    expect(rez.motive_incomplet).toEqual(['C6: numere repetate: 10'])
    expect(rez.completa).toBe(false)
  })

  it('linie nerecunoscută cu valoare 0 (fără cantitate, UM de material) → incomplet chiar dacă totalul concordă', async () => {
    const rez = await cuC6((m) => m.splice(16, 0, ['11', '1000011 MATERIAL TEST K', 'BUC.', '', '', 0]))
    expect(peNr(rez.foi.C6, '11').tip).toBe('nerecunoscut')
    expect(rez.foi.C6.concorda).toBe(true)
    expect(rez.paritate.ok).toBe(true) // importul o sare prin regula lui (fără cantitate)
    expect(rez.motive_incomplet).toEqual(['C6: 1 linii nerecunoscute (rândurile 17)'])
    expect(rez.completa).toBe(false)
  })

  it('UM necunoscut (XYZ) → linie de_verificat și extras incomplet', async () => {
    const rez = await cuC6((m) => { m[9][2] = 'XYZ' })
    expect(peNr(rez.foi.C6, '4').motive).toContain('UM necunoscut (XYZ)')
    expect(rez.motive_incomplet).toEqual(['C6: UM necunoscut sau lipsă pe 1 linie (rândurile 10)'])
    expect(rez.completa).toBe(false)
  })

  it('UM lipsă → incomplet; importul o sare prin regula lui (UM gol), paritatea o listează ca omisiune admisă', async () => {
    const rez = await cuC6((m) => { m[9][2] = '' })
    expect(rez.paritate.ok).toBe(true)
    expect(rez.paritate.omise_admise.map((o) => [o.nr, o.motiv])).toContainEqual(['4', 'UM gol'])
    expect(rez.motive_incomplet).toEqual(['C6: UM necunoscut sau lipsă pe 1 linie (rândurile 10)'])
  })

  it.each([
    ['în USD', ['', 'TOTAL', '', '', '  USD', '549.00'], ['C6: moneda TOTAL = USD (aștept RON)']],
    ['fără monedă', ['', 'TOTAL', '', '', '', '549.00'], ['C6: moneda TOTAL = lipsă (aștept RON)']],
    ['nenumeric', ['', 'TOTAL', '', '', '  RON', 'cinci sute'], ['C6: TOTAL tipărit nenumeric', 'C6: comparația cu TOTAL necunoscută (fără total numeric)']],
    ['cu altă celulă în formular', ['', 'TOTAL', 'x', '', '  RON', '549.00'], ['C6: rândul TOTAL are și alte celule (coloanele 2)']],
  ])('TOTAL %s → incomplet, motivul exact', async (_n, total, motive) => {
    const rez = await cuC6((m) => { m[16] = total })
    expect(rez.motive_incomplet).toEqual(motive)
    expect(rez.completa).toBe(false)
  })

  it('TOTAL cu celule doar în afara formularului (col. H, J) rămâne valid', async () => {
    const rez = await cuC6((m) => { m[16] = ['', 'TOTAL', '', '', '  RON', '549.00', '', 1.5, '', 7] })
    expect(rez.completa).toBe(true)
  })

  it('fără TOTAL tipărit → comparația e necunoscută, nu „concordă”', () => {
    const m = citesteC6(c6().slice(0, 16))
    expect(m.total_tiparit).toBe(null)
    expect(m.concorda).toBe(null)
    expect(m.motive_incomplet).toEqual(['fără rând TOTAL tipărit', 'comparația cu TOTAL necunoscută (fără total numeric)'])
    expect(m.completa).toBe(false)
  })

  it('total C6 care nu concordă → diferența exactă, extras incomplet', async () => {
    const rez = await cuC6((m) => { m[16] = ['', 'TOTAL', '', '', '  RON', '550.00'] })
    expect(rez.foi.C6.diferenta).toBe(-1)
    expect(rez.motive_incomplet).toEqual(['C6: suma liniilor diferă de TOTAL cu -1'])
  })

  it('C8 cu TOTAL care nu concordă → extrasul întreg e incomplet (motivul pe C8)', async () => {
    const u = c8(); u[6] = ['', 'TOTAL', '', '  RON', '160.00']
    const rez = await extras({ u })
    expect(rez.foi.C8.concorda).toBe(false)
    expect(rez.foi.C8.diferenta).toBe(-10)
    expect(rez.motive_incomplet).toEqual(['C8: suma liniilor diferă de TOTAL cu -10'])
    expect(rez.completa).toBe(false)
  })

  it('C7 cu gol de numerotare → incomplet (motivul pe C7)', async () => {
    const mo = c7(); mo[6][0] = '3'
    const rez = await extras({ mo })
    expect(rez.motive_incomplet).toEqual(['C7: numerotare cu goluri: lipsesc 2'])
  })

  it('C9: detaliu lipsă (1.002) și detaliu fără categorie (3.001) → incomplet', async () => {
    const t = c9(); t[8][0] = '1.004'; t.splice(11, 0, ['3.001', 'TRANSPORT TEST Z', 0, '', '', 1, 0])
    const rez = await extras({ t })
    expect(rez.foi.C9.nr_crt.lipsa).toEqual(['1.002'])
    expect(rez.foi.C9.nr_crt.orfane).toEqual(['3.001'])
    expect(rez.motive_incomplet).toEqual(['C9: numerotare cu goluri: lipsesc 1.002', 'C9: detalii fără categorie: 3.001'])
  })

  it('rând nerecunoscut între antet și TOTAL → păstrat, extras incomplet', async () => {
    const rez = await cuC6((m) => m.splice(9, 0, ['SUBTOTAL PAGINA', '', '', '', '', 431]))
    expect(rez.foi.C6.nerecunoscute).toHaveLength(1)
    expect(rez.foi.C6.nerecunoscute[0].rand).toBe(10)
    expect(rez.completa).toBe(false)
  })

  it('antet cu coloanele în altă ordine → eroare, nu citire pe poziții greșite', async () => {
    const rez = await cuC6((m) => { m[4] = ['Nr.', 'Denumirea resursei materiale', 'Consumuri', 'U.M.', 'Pret unitar', 'Valoare', 'Furnizor'] })
    expect(rez.foi.C6).toBeUndefined()
    expect(rez.erori.map((e) => e.mesaj).join(' ')).toMatch(/antetul C6 nu are coloanele/)
    expect(rez.completa).toBe(false)
  })

  it('importul din ERP nu găsește antetul (caută doar în primele 20 de rânduri nevide) → eroare în erori, nu doar în paritate', async () => {
    const rez = await cuC6((m) => m.splice(3, 0, ...Array.from({ length: 17 }, (_, k) => ['Nota', `rand ${k + 1}`])))
    expect(rez.foi.C6.rand_antet).toBe(22)
    expect(rez.paritate.eroare).toMatch(/Nu găsesc antetul C6/)
    expect(rez.erori.map((e) => e.mesaj)).toEqual([expect.stringMatching(/^importul din ERP \(parseExtrasMateriale\) nu citește fișierul: Nu găsesc antetul C6/)])
    expect(rez.completa).toBe(false)
  })

  it('două foi C6 → eroare, nu aleg singur; fără C6 → eroare', async () => {
    const doua = await citesteExtras(carte([['materiale', c6()], ['materiale2', c6()]]))
    expect(doua.erori.map((e) => e.mesaj).join(' ')).toMatch(/al doilea C6/)
    const lipsa = await citesteExtras(carte([['manopera', c7()]]))
    expect(lipsa.erori.map((e) => e.mesaj)).toContain('lipsește formularul C6 (materiale)')
    expect(lipsa.completa).toBe(false)
  })

  it('nr. crt. lipsă și articol după TOTAL nu dispar tacit', () => {
    const rows = c6(); rows.splice(10, 1) // scoate nr. 5 (indicele 10 = rândul 11)
    rows.push(['11', '1000011 MATERIAL TEST K', 'KG', 1, 1, 1])
    const m = citesteC6(rows)
    expect(m.nr_crt.lipsa).toEqual([5])
    expect(m.nerecunoscute.map((n) => n.motiv)).toContain(MOTIV_DUPA_TOTAL)
  })

  it('C9: subtotal diferit de suma detaliilor e marcat; sub-antetul lipsă = eroare', () => {
    const rows = c9(); rows[6] = ['1', 'Transport auto (total)', 30, '', '', '', 80]
    const t = citesteC9(rows)
    expect(peNr(t, '1').motive.join()).toContain('subtotal ≠ suma detaliilor (80 vs 75)')
    const fara = c9(); fara.splice(4, 1)
    expect(() => citesteC9(fara)).toThrow(/sub-antetul C9/)
  })

  it('C7 citit singur: completitudine proprie', () => {
    expect(citesteResurse(c7(), 'C7').completa).toBe(true)
  })

  it('cantitate scrisă ca text „1,5”: parseNumar citește 1,5, importul vechi 15 → paritate eșuată, nu tăcere (L17)', async () => {
    const rez = await cuC6((m) => { m[6] = ['1', '1000001 MATERIAL TEST A', 'KG', '1,5', 2.5, 3.75, '', 0]; m[16] = ['', 'TOTAL', '', '', '  RON', '527.75'] })
    expect(peNr(rez.foi.C6, '1').cantitate).toBe(1.5)
    expect(rez.foi.C6.concorda).toBe(true)
    expect(rez.paritate.ok).toBe(false)
    expect(peNr(rez.foi.C6, '1').motive.join()).toContain('importul din ERP citește altfel: cantitate')
    expect(rez.completa).toBe(false)
  })
})

describe('P2 r2: paritatea (mutanți pe ieșirea importului)', () => {
  let buf, m
  beforeAll(() => {
    buf = carte([['materiale', c6()]])
    m = () => citesteC6(XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(buf), { type: 'array' }).Sheets.materiale, { header: 1, blankrows: true, defval: '', raw: true }))
  })
  const imp = () => parseExtrasMateriale({ arrayBuffer: async () => buf })

  it('importul nemodificat → ok', async () => {
    const p = aplicaParitate(m(), await imp())
    expect(p).toMatchObject({ ok: true, diferente: [], linii_lipsa: [], fara_pereche: [] })
  })
  it('importul cu o cantitate schimbată → paritate eșuată pe acel rând', async () => {
    const i = await imp(); i[1] = { ...i[1], cantitate: 5 }
    const p = aplicaParitate(m(), i)
    expect(p.ok).toBe(false)
    expect(p.diferente).toEqual([{ rand: 8, campuri: ['cantitate'] }])
  })
  it('un rând importat în plus → fără pereche', async () => {
    const i = await imp(); i.push({ ...i[0], nr: '099' })
    const p = aplicaParitate(m(), i)
    expect(p.ok).toBe(false)
    expect(p.fara_pereche).toEqual(['099'])
  })
  it('ultima linie importată eliminată → linie lipsă, paritate eșuată', async () => {
    const i = await imp(); i.pop()
    const p = aplicaParitate(m(), i)
    expect(p.ok).toBe(false)
    expect(p.linii_lipsa).toEqual([{ rand: 16, nr: '10' }])
  })
  it('o linie din mijloc eliminată → doar ea lipsă, restul rămân perechi', async () => {
    const i = await imp(); i.splice(2, 1) // nr 003
    const p = aplicaParitate(m(), i)
    expect(p.ok).toBe(false)
    expect(p.linii_lipsa).toEqual([{ rand: 9, nr: '3' }])
    expect(p.diferente).toEqual([])
  })
  it.each([
    ['um', { um: 'mc' }],
    ['furnizor', { furnizor: null }],
    ['cod', { cod: '1000099' }],
    ['valoare', { valoare: 401 }],
    ['pret_unitar', { pret_unitar: 101 }],
    ['obiect_nume', { obiect_nume: 'ALTCEVA' }],
    ['chei', { sursa: 'x' }],
  ])('importul cu %s schimbat → paritate eșuată pe acel câmp', async (camp, schimb) => {
    const i = await imp(); i[1] = { ...i[1], ...schimb }
    const p = aplicaParitate(m(), i)
    expect(p.ok).toBe(false)
    expect(p.diferente).toEqual([{ rand: 8, campuri: [camp] }])
  })
  it('importul cu denumirea schimbată → rândul nu se mai leagă (lipsă + fără pereche)', async () => {
    const i = await imp(); i[7] = { ...i[7], denumire: 'ALTA DENUMIRE' }
    const p = aplicaParitate(m(), i)
    expect(p.ok).toBe(false)
    expect(p.linii_lipsa).toEqual([{ rand: 16, nr: '10' }])
    expect(p.fara_pereche).toEqual(['010'])
  })
  it('umFormaImport: contractul importului pe cazuri scrise de mână', () => {
    expect(umFormaImport('M.C.')).toBe('m.c')
    expect(umFormaImport(' BUC. ')).toBe('buc')
    expect(umFormaImport('100 MC')).toBe('100 mc')
    expect(umFormaImport('KG')).toBe('kg')
    expect(umFormaImport('')).toBe('')
    expect(umFormaImport(undefined)).toBe('')
  })
  it('omisiuneAdmisa: doar cele trei reguli ale importului', () => {
    const baza = { cantitate: 1, denumire_sursa: '1000001 MATERIAL', um_forma_import: 'kg' }
    expect(omisiuneAdmisa(baza)).toBe(null)
    expect(omisiuneAdmisa({ ...baza, cantitate: null })).toBe('fără cantitate')
    expect(omisiuneAdmisa({ ...baza, cantitate: 0 })).toBe(null)
    expect(omisiuneAdmisa({ ...baza, cantitate: NaN })).toBe(null) // cantitate nenumerică nu e omisiune admisă
    expect(omisiuneAdmisa({ ...baza, denumire_sursa: '1000001' })).toBe('denumire fără litere')
    expect(omisiuneAdmisa({ ...baza, um_forma_import: '' })).toBe('UM gol')
  })
})

describe('umCanonic și verificaProdus', () => {
  it('UM: aceleași reguli ca devizParser + unitățile de resurse; restul necunoscut', () => {
    expect(umCanonic('M.C.')).toEqual({ um: 'mc', factor: 1, cunoscut: true })
    expect(umCanonic('BUC.')).toEqual({ um: 'buc', factor: 1, cunoscut: true })
    expect(umCanonic('HM')).toEqual({ um: 'm', factor: 100, cunoscut: true })
    expect(umCanonic('100 MP')).toEqual({ um: 'mp', factor: 100, cunoscut: true })
    expect(umCanonic('KWH.')).toEqual({ um: 'kwh', factor: 1, cunoscut: true })
    expect(umCanonic('M.STER')).toEqual({ um: 'm.ster', factor: 1, cunoscut: true })
    expect(umCanonic('%.').cunoscut).toBe(false)
    expect(umCanonic('ORA').cunoscut).toBe(false)
    expect(umCanonic('MX').cunoscut).toBe(false) // nu „M” prin prefix
    expect(umCanonic('').cunoscut).toBe(false)
  })
  it('toleranța produsului: 1 ban sau 1 ppm din valoare', () => {
    const m = []
    verificaProdus(3, 2, 6.009, m); expect(m).toEqual([])
    verificaProdus(3, 2, 6.02, m); expect(m).toHaveLength(1)
    const mare = []
    verificaProdus(1000, 1000, 1000000.5, mare); expect(mare).toEqual([]) // 0,5 ≤ 1 ppm × 1.000.000
    verificaProdus(1000, 1000, 1000002, mare); expect(mare).toHaveLength(1)
  })
})

describe('ieșirile TSV', () => {
  it('materiale: antet fix, un rând pe linie + nerecunoscute, fără tab/linie nouă în celule', async () => {
    const rez = await cuC6((rows) => { rows[7] = ['2', '1000002 MATERIAL\tTEST B', 'M.C.', 4, 100, 400, '', 0]; rows.splice(9, 0, ['X', 'RAND\nCIUDAT']) })
    const t = tsvMateriale('P9', 'extras test.xls', rez.foi.C6).trimEnd().split('\n')
    expect(t[0].split('\t')).toEqual(COLOANE_MATERIALE)
    expect(t).toHaveLength(1 + 10 + 1)
    for (const l of t) expect(l.split('\t')).toHaveLength(COLOANE_MATERIALE.length)
    const b = t.find((l) => l.includes('1000002')).split('\t')
    expect(b[COLOANE_MATERIALE.indexOf('denumire')]).toBe('MATERIAL TEST B')
    expect(b[COLOANE_MATERIALE.indexOf('um_import')]).toBe('m.c')
    expect(b[COLOANE_MATERIALE.indexOf('import_erp')]).toBe('da')
    expect(t.at(-1)).toContain('nerecunoscut')
  })
  it('resurse: C7 + C8 + C9 într-un singur fișier, cu categoria', async () => {
    const rez = await extras()
    const t = tsvResurse('P9', 'x.xls', rez.foi).trimEnd().split('\n').slice(1).map((l) => l.split('\t')[3])
    expect(t.filter((c) => c === 'manopera')).toHaveLength(2)
    expect(t.filter((c) => c === 'utilaj')).toHaveLength(1)
    expect(t.filter((c) => c === 'transport')).toHaveLength(5)
  })
})

describe('ruleaza (CLI) pe foldere temporare', () => {
  let rad
  beforeAll(() => { rad = fs.mkdtempSync(path.join(os.tmpdir(), 'extrase-')) })
  afterAll(() => { fs.rmSync(rad, { recursive: true, force: true }) })
  const pregateste = (nume, proiecte) => {
    const surse = path.join(rad, nume, 'surse'), iesire = path.join(rad, nume, 'iesire')
    for (const [p, fisiere] of Object.entries(proiecte)) {
      fs.mkdirSync(path.join(surse, p), { recursive: true })
      for (const [f, b] of Object.entries(fisiere)) fs.writeFileSync(path.join(surse, p, f), b)
    }
    fs.mkdirSync(surse, { recursive: true })
    return { surse, iesire }
  }

  it('scrie TSV + rezumat + manifest; proiectul cu două fișiere = eroare, restul merge', async () => {
    const buf = Buffer.from(carte(complet()))
    const { surse, iesire } = pregateste('a', { P10: { 'extrase.xls': buf }, P2: { 'a.xls': buf, 'b.xls': buf } })
    fs.mkdirSync(iesire, { recursive: true })
    fs.writeFileSync(path.join(iesire, 'altcineva.txt'), 'nu se sterge')
    const r = await ruleaza({ surse, iesire, acum: new Date('2026-11-22T10:00:00Z') })
    expect(r.ok).toBe(false)
    expect(r.proiecte.map((x) => x.proiect)).toEqual(['P2', 'P10'])
    expect(r.proiecte[0].eroare).toMatch(/exact un extras/)
    const man = JSON.parse(fs.readFileSync(path.join(iesire, 'manifest.json'), 'utf8'))
    const p10 = man.proiecte.find((x) => x.proiect === 'P10')
    expect(p10.sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'))
    expect(p10.completa).toBe(true)
    expect(p10.motive_incomplet).toEqual([])
    expect(p10.materiale).toMatchObject({ linii: 10, suma: 549, total_tiparit: 549, concorda: true, linii_import: 8, paritate_ok: true, linii_lipsa_import: 0, omise_admise: 2, completa: true })
    expect(fs.existsSync(path.join(iesire, 'P10.tsv'))).toBe(true)
    expect(fs.existsSync(path.join(iesire, 'P10_resurse.tsv'))).toBe(true)
    expect(fs.existsSync(path.join(iesire, 'P2.tsv'))).toBe(false)
    expect(fs.readFileSync(path.join(iesire, 'altcineva.txt'), 'utf8')).toBe('nu se sterge')
    const md = fs.readFileSync(path.join(iesire, 'rezumat.md'), 'utf8')
    expect(md).toContain('| P10 | 10 | 549,00 | 549,00 | 0 |')
    expect(md).toContain('Foaie ignorată „materiale de comandat”')
  })

  it('toate citite fără erori → ok, chiar dacă un extras e incomplet', async () => {
    const m = c6(); m[9][2] = 'XYZ'
    const { surse, iesire } = pregateste('b', { P1: { 'x.xls': Buffer.from(carte(complet())) }, P3: { 'x.xls': Buffer.from(carte(complet({ m }))) } })
    const r = await ruleaza({ surse, iesire })
    expect(r.ok).toBe(true)
    expect(r.proiecte.map((x) => x.completa)).toEqual([true, false])
  })

  it.each([
    ['fără C6', () => carte([['manopera', c7()]]), /lipsește formularul C6/],
    ['antet C6 invalid', () => { const m = c6(); m[4] = ['Nr.', 'Altceva']; return carte([['materiale', m]]) }, /antetul C6 nu are coloanele/],
    ['sub-antet C9 lipsă', () => { const t = c9(); t.splice(4, 1); return carte(complet({ t })) }, /sub-antetul C9/],
    ['import ERP ilizibil', () => { const m = c6(); m.splice(3, 0, ...Array.from({ length: 17 }, () => ['Nota', 'x'])); return carte(complet({ m })) }, /importul din ERP/],
  ])('eroare de parsare în rez.erori (%s) → ok = false, chiar fără eroare de fișier', async (_n, f, re) => {
    const { surse, iesire } = pregateste(`c${_n.length}`, { P1: { 'x.xls': Buffer.from(f()) } })
    const r = await ruleaza({ surse, iesire })
    expect(r.proiecte[0].eroare).toBeUndefined()
    expect(r.proiecte[0].erori.map((e) => e.mesaj).join(' ')).toMatch(re)
    expect(r.ok).toBe(false)
  })

  it('niciun folder P<id> → ok = false', async () => {
    const { surse, iesire } = pregateste('gol', {})
    const r = await ruleaza({ surse, iesire })
    expect(r.proiecte).toEqual([])
    expect(r.ok).toBe(false)
  })

  it('procesul CLI: cod de ieșire 1 la C6 lipsă, 0 pe extrasul bun', () => {
    const script = fileURLToPath(new URL('./citeste_extrase.mjs', import.meta.url))
    const rau = pregateste('proc_rau', { P1: { 'x.xls': Buffer.from(carte([['manopera', c7()]])) } })
    const bun = pregateste('proc_bun', { P1: { 'x.xls': Buffer.from(carte(complet())) } })
    const r1 = spawnSync(process.execPath, [script, '--surse', rau.surse, '--iesire', rau.iesire], { encoding: 'utf8' })
    expect(r1.stdout).toMatch(/P1: EROARE .*lipsește formularul C6/)
    expect(r1.status).toBe(1)
    const r0 = spawnSync(process.execPath, [script, '--surse', bun.surse, '--iesire', bun.iesire], { encoding: 'utf8' })
    expect(r0.stdout).toMatch(/P1: 10 linii C6, .* completă/)
    expect(r0.status).toBe(0)
  })
})
