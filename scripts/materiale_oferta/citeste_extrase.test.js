// Teste pentru citirea extraselor C6–C9 (materialele din ofertă, faza 2).
// Fixture SINTETIC: denumiri, coduri și prețuri inventate; valorile așteptate sunt calculate de mână (L25),
// nu din codul testat. Fișierul se scrie ca .xls (BIFF8), ca extrasele reale din programul de devize.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { citesteExtras, citesteC6, citesteC9, umCanonic, aplicaParitate, tsvMateriale, tsvResurse, COLOANE_MATERIALE, verificaProdus } from './extrase_lib.mjs'
import { ruleaza } from './citeste_extrase.mjs'
import { parseExtrasMateriale } from '../../src/devizParser.js'

let XLSX
beforeAll(async () => { const _x = await import('xlsx-js-style'); XLSX = _x.default?.read ? _x.default : _x })

const ANTET_C6 = ['Nr.\ncrt.', 'Denumirea resursei materiale  ', 'U.M.', 'Consumuri\ncuprinse\nin oferta', 'Pret unitar\n(exclusiv TVA)\n- RON -', 'Valoare\n(exclusiv TVA)\n- RON -', 'Furnizor', 'Greutate\n(tone)']
// rândurile 1..19 din Excel (indicele 0 = rândul 1)
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
  ['4', '1000004 MATERIAL TEST D', 'XYZ', 2, 3, 6, '', 0],
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
]
const c8 = () => [
  ['', '', '', '', 'FORMULAR C8'], ['Lista consumurilor de ore de functionare a Utilajelor de constructii'], [],
  ['Nr.\ncrt.', 'Denumirea utilajului de constructii', 'Consumuri\n- ore de functionare -', 'Tarif orar\n- RON/ora functionare -', 'Valoare (exclusiv TVA)\n -   RON   -\n ( 2 x 3 )'],
  [0, 1, 2, 3, 4],
  ['1', 'UTILAJ TEST', 5, 30, 150],
  ['', 'TOTAL', '', '  RON', '160.00'],
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
const complet = () => [['materiale', c6()], ['materiale de comandat', deComandat()], ['manopera', c7()], ['utilaj', c8()], ['transport', c9()]]
const peNr = (foaie, nr) => foaie.linii.find((l) => l.nr_crt === nr)

describe('citesteExtras — extras complet (.xls)', () => {
  let rez
  beforeAll(async () => { rez = await citesteExtras(carte(complet())) })

  it('recunoaște formularele după marcaj, ignoră foaia de lucru', () => {
    expect(Object.keys(rez.foi).sort()).toEqual(['C6', 'C7', 'C8', 'C9'])
    expect(rez.ignorate.map((g) => g.foaie)).toEqual(['materiale de comandat'])
    expect(rez.erori).toEqual([])
  })

  it('C6: linii, sursa pe rând, total tipărit RON + EURO, concordanță', () => {
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
    expect(m.nr_crt).toEqual({ primul: 1, ultimul: 10, lipsa: [] })
    expect(m.coloana_h).toBe('Greutate (tone)')
  })

  it('C6: cod, denumire, UM normalizat ca în devizParser', () => {
    const m = rez.foi.C6
    expect(peNr(m, '1')).toMatchObject({ cod: '1000001', denumire: 'MATERIAL TEST A', um_sursa: 'KG', um: 'kg', factor_um: 1, cantitate: 10, pret_unitar: 2.5, valoare: 25 })
    expect(peNr(m, '2')).toMatchObject({ um: 'mc', furnizor: 'FURNIZOR TEST', stare: 'ok' })
    expect(peNr(m, '10')).toMatchObject({ um: 'mc', factor_um: 100, cantitate: 2, cantitate_um_baza: 200, stare: 'ok' })
    expect(peNr(m, '6').um).toBe('l')
  })

  it('C6: liniile suspecte sunt de_verificat, cu motivul exact', () => {
    const m = rez.foi.C6
    const mot = (nr) => peNr(m, nr).motive.join(' | ')
    expect(mot('3')).toContain('cantitate 0')
    expect(mot('4')).toContain('UM necunoscut (XYZ)')
    expect(mot('1')).toContain('cod duplicat (rândurile 7, 11)')
    expect(mot('5')).toContain('cod duplicat (rândurile 7, 11)')
    expect(mot('6')).toContain('valoare ≠ cantitate × preț (dif. -1)')
    expect(mot('6')).not.toContain('UM necunoscut')
    expect(peNr(m, '7').tip).toBe('valoric')
    expect(mot('7')).toContain('linie valorică fără cantitate')
    expect(mot('7')).toContain('importul din ERP sare rândul')
    expect(mot('8')).toContain('denumire goală')
    expect(mot('8')).toContain('fără cod de resursă')
    expect(mot('8')).toContain('importul din ERP ar sări rândul')
    expect(mot('9')).toContain('cantitate negativ')
    expect(mot('9')).toContain('valoare negativ')
    expect(m.linii.filter((l) => l.stare === 'ok').map((l) => l.nr_crt)).toEqual(['2', '10'])
  })

  it('paritate cu parseExtrasMateriale: aceleași linii, forma UM a importului păstrată separat', () => {
    expect(rez.paritate.ok).toBe(true)
    expect(rez.paritate.linii_import).toBe(8) // fără 7 (fără cantitate) și 8 (denumire fără litere)
    expect(rez.paritate.valoare_import).toBe(535.5) // 549 − 12,5 − 1
    expect(peNr(rez.foi.C6, '2').import_erp.um).toBe('m.c')
    expect(peNr(rez.foi.C6, '7').import_erp).toBe(null)
    expect(rez.completa).toBe(true)
  })

  it('C7 / C8: resurse, linie valorică, total care nu concordă', () => {
    expect(rez.foi.C7.suma).toBe(250)
    expect(rez.foi.C7.concorda).toBe(true)
    expect(peNr(rez.foi.C7, '2').tip).toBe('valoric')
    expect(peNr(rez.foi.C7, '1')).toMatchObject({ um: 'om-ore', cantitate: 10, stare: 'ok' })
    expect(rez.foi.C8.concorda).toBe(false)
    expect(rez.foi.C8.diferenta).toBe(-10)
  })

  it('C9: detalii + subtotaluri verificate, subtotalurile nu intră în total', () => {
    const t = rez.foi.C9
    expect(t.linii.filter((l) => l.tip === 'subtotal').map((l) => l.nr_crt)).toEqual(['1', '2'])
    expect(t.linii.filter((l) => l.tip === 'subtotal').every((l) => l.stare === 'ok')).toBe(true)
    expect(peNr(t, '1.002')).toMatchObject({ cantitate: 20, pret_unitar: 2.5, valoare: 50, stare: 'ok' })
    expect(peNr(t, '1.003').tip).toBe('valoric')
    expect(t.suma).toBe(75)
    expect(t.concorda).toBe(true)
  })
})

describe('completitudine și erori explicite (L12, L13)', () => {
  it('rând nerecunoscut între antet și TOTAL → păstrat, extras incomplet', async () => {
    const rows = c6(); rows.splice(9, 0, ['SUBTOTAL PAGINA', '', '', '', '', 431])
    const rez = await citesteExtras(carte([['materiale', rows]]))
    expect(rez.foi.C6.nerecunoscute).toHaveLength(1)
    expect(rez.foi.C6.nerecunoscute[0].rand).toBe(10)
    expect(rez.completa).toBe(false)
  })

  it('fără TOTAL tipărit → comparația e necunoscută, nu „concordă”', () => {
    const m = citesteC6(c6().slice(0, 16))
    expect(m.total_tiparit).toBe(null)
    expect(m.concorda).toBe(null)
    expect(m.motive).toContain('fără rând TOTAL tipărit')
  })

  it('total care nu concordă → diferența exactă, extras incomplet', async () => {
    const rows = c6(); rows[16] = ['', 'TOTAL', '', '', '  RON', '550.00']
    const rez = await citesteExtras(carte([['materiale', rows]]))
    expect(rez.foi.C6.diferenta).toBe(-1)
    expect(rez.completa).toBe(false)
  })

  it('antet cu coloanele în altă ordine → eroare, nu citire pe poziții greșite', async () => {
    const rows = c6(); rows[4] = ['Nr.', 'Denumirea resursei materiale', 'Consumuri', 'U.M.', 'Pret unitar', 'Valoare', 'Furnizor']
    const rez = await citesteExtras(carte([['materiale', rows]]))
    expect(rez.foi.C6).toBeUndefined()
    expect(rez.erori.map((e) => e.mesaj).join(' ')).toMatch(/antetul C6 nu are coloanele/)
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
    expect(m.nerecunoscute.map((n) => n.motiv)).toContain('rând de articol după TOTAL')
  })

  it('C9: subtotal diferit de suma detaliilor e marcat; sub-antetul lipsă = eroare', () => {
    const rows = c9(); rows[6] = ['1', 'Transport auto (total)', 30, '', '', '', 80]
    const t = citesteC9(rows)
    expect(peNr(t, '1').motive.join()).toContain('subtotal ≠ suma detaliilor (80 vs 75)')
    const fara = c9(); fara.splice(4, 1)
    expect(() => citesteC9(fara)).toThrow(/sub-antetul C9/)
  })

  it('cantitate scrisă ca text „1,5”: parseNumar citește 1,5, importul vechi 15 → paritate eșuată, nu tăcere (L17)', async () => {
    const rows = c6(); rows[6] = ['1', '1000001 MATERIAL TEST A', 'KG', '1,5', 2.5, 3.75, '', 0]; rows[16] = ['', 'TOTAL', '', '', '  RON', '527.75']
    const rez = await citesteExtras(carte([['materiale', rows]]))
    expect(peNr(rez.foi.C6, '1').cantitate).toBe(1.5)
    expect(rez.foi.C6.concorda).toBe(true)
    expect(rez.paritate.ok).toBe(false)
    expect(peNr(rez.foi.C6, '1').motive.join()).toContain('importul din ERP citește altfel: cantitate')
    expect(rez.completa).toBe(false)
  })
})

describe('paritatea (mutanți pe ieșirea importului)', () => {
  const ab = () => carte([['materiale', c6()]])
  it('importul cu o cantitate schimbată → paritate eșuată pe acel rând', async () => {
    const buf = ab()
    const imp = await parseExtrasMateriale({ arrayBuffer: async () => buf })
    imp[1] = { ...imp[1], cantitate: 5 }
    const m = citesteC6(XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(buf), { type: 'array' }).Sheets.materiale, { header: 1, blankrows: true, defval: '', raw: true }))
    const p = aplicaParitate(m, imp)
    expect(p.ok).toBe(false)
    expect(p.diferente).toEqual([{ rand: 8, campuri: ['cantitate'] }])
  })
  it('un rând importat în plus → fără pereche', async () => {
    const buf = ab()
    const imp = await parseExtrasMateriale({ arrayBuffer: async () => buf })
    imp.push({ ...imp[0], nr: '099' })
    const m = citesteC6(XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(buf), { type: 'array' }).Sheets.materiale, { header: 1, blankrows: true, defval: '', raw: true }))
    const p = aplicaParitate(m, imp)
    expect(p.ok).toBe(false)
    expect(p.fara_pereche).toEqual(['099'])
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
    const rows = c6(); rows[7] = ['2', '1000002 MATERIAL\tTEST B', 'M.C.', 4, 100, 400, '', 0]
    rows.splice(9, 0, ['X', 'RAND\nCIUDAT'])
    const rez = await citesteExtras(carte([['materiale', rows]]))
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
    const rez = await citesteExtras(carte(complet()))
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

  it('scrie TSV + rezumat + manifest; proiectul cu două fișiere = eroare, restul merge', async () => {
    const surse = path.join(rad, 'surse'), iesire = path.join(rad, 'iesire')
    const buf = Buffer.from(carte(complet()))
    fs.mkdirSync(path.join(surse, 'P10'), { recursive: true })
    fs.mkdirSync(path.join(surse, 'P2'), { recursive: true })
    fs.writeFileSync(path.join(surse, 'P10', 'extrase.xls'), buf)
    fs.writeFileSync(path.join(surse, 'P2', 'a.xls'), buf)
    fs.writeFileSync(path.join(surse, 'P2', 'b.xls'), buf)
    fs.mkdirSync(iesire, { recursive: true })
    fs.writeFileSync(path.join(iesire, 'altcineva.txt'), 'nu se sterge')
    const r = await ruleaza({ surse, iesire, acum: new Date('2026-11-22T10:00:00Z') })
    expect(r.ok).toBe(false)
    expect(r.proiecte.map((x) => x.proiect)).toEqual(['P2', 'P10'])
    expect(r.proiecte[0].eroare).toMatch(/exact un extras/)
    const man = JSON.parse(fs.readFileSync(path.join(iesire, 'manifest.json'), 'utf8'))
    const p10 = man.proiecte.find((x) => x.proiect === 'P10')
    expect(p10.sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'))
    expect(p10.materiale).toMatchObject({ linii: 10, suma: 549, total_tiparit: 549, concorda: true, linii_import: 8, paritate_ok: true })
    expect(fs.existsSync(path.join(iesire, 'P10.tsv'))).toBe(true)
    expect(fs.existsSync(path.join(iesire, 'P10_resurse.tsv'))).toBe(true)
    expect(fs.existsSync(path.join(iesire, 'P2.tsv'))).toBe(false)
    expect(fs.readFileSync(path.join(iesire, 'altcineva.txt'), 'utf8')).toBe('nu se sterge')
    const md = fs.readFileSync(path.join(iesire, 'rezumat.md'), 'utf8')
    expect(md).toContain('| P10 | 10 | 549,00 | 549,00 | 0 |')
    expect(md).toContain('Foaie ignorată „materiale de comandat”')
  })
})
