import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { citesteFisierPostal, ghicesteMaparea, parseazaData, clasificaEveniment, motivRetur, propune, aplica } from './importPostal.js'
import { confirmariAplicare } from './importPostal.js'
import { reevalueazaTermene, confirmareTermeneSchimbate } from './importPostal.js'

const mapare = { nr_document: 'doc', nr_tracking: 'awb', data: 'data', eveniment: 'status', motiv: 'motiv' }
const plic = (extra = {}) => ({ id: 'plic-fictiv-1', proiect_id: 'proiect-fictiv', nr_plic: 'PL-HUS-0001', lot_id: 'lot-fictiv', opis_path: 'plicuri/plic-fictiv-1/opis-1.docx', awb: null,
  data_expediere: null, data_ar: null, retur: null, retur_data: null, stare: 'activ', versiune: 3, ...extra })
const rand = (extra = {}) => ({ doc: 'PL-HUS-0001', awb: 'AB123', data: '02.11.2026', __rand: 7, ...extra })
const propunere = (r = {}, p = {}, mod = 'expediere') => propune([rand(r)], mapare, mod, [plic(p)])
const bytes = s => new TextEncoder().encode(s).buffer

describe('citesteFisierPostal', () => {
  it('detecteaza separatorii, trim, ghilimele si numarul fizic al randului', () => {
    for (const sep of [';', ',']) {
      const r = citesteFisierPostal(bytes(`\n Document${sep}Data${sep}Observatii\n C-0012 ${sep}02.11.2026${sep}"un${sep}text\ncontinuat"\nC-0013${sep}03.11.2026${sep}ok`), 'test.csv')
      expect(r.coloane).toEqual(['Document', 'Data', 'Observatii'])
      expect(r.randuri[0]).toMatchObject({ __rand: 3, Document: 'C-0012', Observatii: `un${sep}text\ncontinuat` })
      expect(r.randuri[1].__rand).toBe(5)
    }
  })
  it('citeste prima foaie XLSX si pastreaza serialul Excel', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], ['Doc', 'Data'], ['C-0012', 46023]]), 'Prima')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ignorat']]), 'A doua')
    const r = citesteFisierPostal(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'test.xlsx')
    expect(r.coloane).toEqual(['Doc', 'Data'])
    expect(r.randuri[0]).toMatchObject({ Doc: 'C-0012', Data: 46023, __rand: 3 })
  })
  it('refuza antete duplicate, date fara antet, CSV invalid, extensii si depasirea limitei', () => {
    for (const s of ['Doc;Doc\na;b', 'Doc\na;b', 'Doc;Data\n"neinchis', 'Doc;Data\n"a"text;b']) {
      expect(() => citesteFisierPostal(bytes(s), 'test.csv')).toThrow()
    }
    expect(() => citesteFisierPostal(bytes('Doc\na'), 'test.txt')).toThrow()
    expect(() => citesteFisierPostal(bytes('Doc\n' + 'C-0012\n'.repeat(20001)), 'test.csv')).toThrow(/20000/)
    expect(citesteFisierPostal(bytes('Doc\n' + 'C-0012\n'.repeat(20000)), 'test.csv').randuri).toHaveLength(20000)
  })
})

describe('date, mapare si clasificare', () => {
  it.each([[46023, '2026-01-01'], [46023.5, '2026-01-01'], ['02.11.2026', '2026-11-02'],
    ['02/11/2026 14:05', '2026-11-02'], ['2026-11-02T14:05:00Z', '2026-11-02'],
    ['29.02.2028', '2028-02-29'], ['29.02.2026', null], ['31/04/2026', null],
    ['01.01.2024', null], ['2031-01-01', null], ['02.11.2026 25:00', null],
    ['2026-11-02junk', null], ['', null], [NaN, null]])('parseazaData %s', (v, expected) => {
    expect(parseazaData(v)).toBe(expected)
  })
  it('Excel cu baza 1904: serialul se decaleaza cu 1462 de zile (Copilot f9 r1 P3-01)', () => {
    expect(parseazaData(46328)).toBe('2026-11-02')
    expect(parseazaData(46328 - 1462, { date1904: true })).toBe('2026-11-02')
  })

  it('ghiceste antete cu diacritice si majuscule', () => {
    expect(ghicesteMaparea(['Referință', 'Cod trimitere', 'DATA', 'Status', 'Observații'])).toEqual({
      nr_document: 'Referință', nr_tracking: 'Cod trimitere', data: 'DATA', eveniment: 'Status', motiv: 'Observații',
    })
    expect(ghicesteMaparea(['Nume']).data).toBe('')
  })
  it.each([['destinatar necunoscut', 'destinatar_necunoscut'], ['plecat', 'mutat'], ['mutat', 'mutat'],
    ['avizat', 'avizat_neridicat'], ['expirat', 'avizat_neridicat'], ['neridicat', 'avizat_neridicat'],
    ['refuz', 'refuz'], ['adresă greșită', 'adresa_incompleta'], ['insuficient', 'adresa_incompleta'], ['altceva', null]])('motiv %s', (v, expected) => {
    expect(motivRetur(v)).toBe(expected)
  })
  it.each([['predat la poștă', 'expediere'], ['preluat', 'expediere'], ['depus', 'expediere'], ['expediat', 'expediere'],
    ['predat', 'ar'], ['AR', 'ar'], ['livrat', 'ar'], ['confirmat', 'ar'], ['retur AR', 'retur'],
    ['returnat', 'retur'], ['refuz', 'retur'], ['necunoscut', 'retur'], ['mutat', 'retur'],
    ['incomplet', 'retur'], ['neridicat', 'retur'], ['parcare', 'expediere'], ['', 'expediere']])('eveniment %s', (v, expected) => {
    expect(clasificaEveniment(v, 'expediere')).toBe(expected)
  })
  it('foloseste modul implicit necunoscutului', () => expect(clasificaEveniment('alt status', 'retur')).toBe('retur'))
})

describe('propune pe plicuri', () => {
  it('expediere completă, PL normalizat, snapshot de versiune/proiect/lot', () => {
    expect(propunere({ doc: ' pl-hus-0001 ', awb: ' ab 123 ' }).aplicabile[0]).toMatchObject({
      plic_id: 'plic-fictiv-1', nr_document: 'PL-HUS-0001', rand: 7,
      patch: { awb: 'AB123', data_expediere: '2026-11-02' },
      conditii: { versiune: 3, proiect_id: 'proiect-fictiv', lot_id: 'lot-fictiv', awb: null, data_expediere: null },
    })
    expect(propunere({}, { lot_id: null }).exceptii[0].motiv).toBe('plicul nu are PV de plicuire (lot)')
    expect(propunere({}, { opis_path: null }).exceptii[0].motiv).toMatch(/opisul atașat la dosar/)
    expect(propune([rand()], mapare, 'expediere', [plic()], { imputernicire: false }).exceptii[0].motiv).toMatch(/împuternicirea Beneficiarului/)
    expect(propunere({ awb: '' }).exceptii[0].motiv).toMatch(/AWB obligatoriu/)
    expect(propunere({}, { stare: 'anulat' }).exceptii[0].motiv).toBe('plic anulat')
    expect(propunere({}, { versiune: null }).exceptii[0].motiv).toMatch(/snapshot incomplet/)
  })
  it('deja versus conflict, AWB izolat nu se suprascrie', () => {
    expect(propunere({}, { awb: 'AB123', data_expediere: '2026-11-02' }).deja).toHaveLength(1)
    expect(propunere({}, { awb: 'ALT', data_expediere: '2026-11-02' }).exceptii[0].motiv).toMatch(/conflict/)
    expect(propunere({}, { awb: 'AB123' }).exceptii[0].motiv).toMatch(/AWB existent/)
    expect(propunere({}, { data_ar: '2026-11-02' }).exceptii[0].motiv).toMatch(/AR sau retur/)
    expect(propunere({ data: 'invalid' }).exceptii).toHaveLength(1)
  })
  it.each(['ar', 'retur'])('%s devine excepție cu scan, indiferent de snapshot sau motiv', mod => {
    for (const p of [{}, { data_expediere: '2026-11-01', awb: 'AB123' }, { data_ar: '2026-11-02', retur: 'refuz' }]) {
      const r = propunere({ motiv: 'refuz' }, p, mod)
      expect(r.aplicabile).toEqual([]); expect(r.deja).toEqual([])
      expect(r.exceptii[0].motiv).toBe('Se înregistrează pe plic, cu scanul (Plicuri -> AR / Retur).')
    }
    expect(propunere({ status: mod === 'ar' ? 'livrat' : 'returnat' }).exceptii[0].motiv).toMatch(/cu scanul/)
  })
  it('statusul decedat nu poate fi confundat cu o expediere implicită', () => {
    expect(propunere({ status: 'Decedat' }).exceptii[0].motiv).toMatch(/cu scanul/)
    expect(propunere({ status: 'Decedat' }).aplicabile).toEqual([])
  })
  it('AWB ca rezervă, document greșit nu cade pe AWB, conflicte și ambiguități', () => {
    expect(propunere({ doc: '', awb: 'AB123' }, { awb: 'AB123', data_expediere: '2026-11-02' }).deja).toHaveLength(1)
    expect(propunere({ doc: 'C-0012' }).exceptii[0].motiv).toMatch(/inexistent/)
    expect(propunere({ doc: 'PL-HUS-9999' }, { awb: 'AB123' }).exceptii[0].motiv).toMatch(/inexistent/)
    const ps = [plic(), plic({ id: 'plic-fictiv-2', nr_plic: 'PL-HUS-0002', awb: 'AB123' })]
    expect(propune([rand()], mapare, 'expediere', ps).exceptii[0].motiv).toMatch(/altui plic/)
    const ambigue = [plic({ awb: 'AB123' }), plic({ id: 'plic-fictiv-2', nr_plic: 'PL-HUS-0002', awb: 'AB123' })]
    expect(propune([rand({ doc: '' })], mapare, 'expediere', ambigue).exceptii[0].motiv).toMatch(/mai multe/)
  })
  it('două treceri: duplicatele sunt toate excepții; invalidul nu rezervă plicul', () => {
    const r = propune([rand(), rand({ __rand: 8 })], mapare, 'expediere', [plic()])
    expect(r.aplicabile).toEqual([]); expect(r.exceptii).toHaveLength(2)
    expect(r.exceptii.every(e => /același plic/.test(e.motiv))).toBe(true)
    const r2 = propune([rand({ data: 'invalid' }), rand({ __rand: 8 })], mapare, 'expediere', [plic()])
    expect(r2.aplicabile).toHaveLength(1); expect(r2.exceptii).toHaveLength(1)
    const ps = [plic(), plic({ id: 'plic-fictiv-2', nr_plic: 'PL-HUS-0002' })]
    const r3 = propune([rand(), rand({ doc: 'PL-HUS-0002', __rand: 8 })], mapare, 'expediere', ps)
    expect(r3.aplicabile).toEqual([]); expect(r3.exceptii.every(e => /același AWB/.test(e.motiv))).toBe(true)
    expect(() => propune([], {}, 'expediere', [])).toThrow()
    expect(() => propune([], mapare, 'invalid', [])).toThrow()
  })
})

function fakeSupabase(responses = [], apres = () => {}, alte = []) {
  const calls = [], pre = []
  return { calls, pre, from(table) {
    const call = { table, filtre: [] }, q = {
      update(patch) { call.patch = patch; calls.push(call); return q },
      eq(k, v) { call.filtre.push(['eq', k, v]); return q },
      neq(k, v) { call.filtre.push(['neq', k, v]); return q },
      is(k, v) { call.filtre.push(['is', k, v]); return q },
      limit() { return q },
      select(cols) { call.select = cols; if (!call.patch) return q; apres(calls.length); const r = responses.shift(); return r instanceof Error ? Promise.reject(r) : Promise.resolve(r || { data: [{ id: 'plic-fictiv-1' }] }) },
      then(ok, ko) { pre.push(call); return Promise.resolve({ data: alte }).then(ok, ko) },
    }; return q
  } }
}

// Copilot f-v2 r3 P2-01: importul CSV nu ocolește termenul de 10 zile libere (plan pct. 4.2). Ziua 1 = 10.12.2026 → limita 29.11.2026 (ziua 1 − 11, numărat în calendar).
describe('termenul de expediere la import', () => {
  const uats = [{ id: 'uat-fictiv-a', nume: 'Comuna Fictivă', sesiune_zi1: '2026-12-10' }, { id: 'uat-fictiv-b', nume: 'Fără zile', sesiune_zi1: null }]
  const plicuri = [
    plic({ id: 'p-in-termen', nr_plic: 'PL-HUS-0001', uat_id: 'uat-fictiv-a' }),
    plic({ id: 'p-tardiv', nr_plic: 'PL-HUS-0002', uat_id: 'uat-fictiv-a' }),
    plic({ id: 'p-pe-limita', nr_plic: 'PL-HUS-0003', uat_id: 'uat-fictiv-a' }),
    plic({ id: 'p-fara-zi1', nr_plic: 'PL-HUS-0004', uat_id: 'uat-fictiv-b' }),
  ]
  const fisier = [
    rand({ doc: 'PL-HUS-0001', awb: 'AA1', data: '20.11.2026', __rand: 2 }),
    rand({ doc: 'PL-HUS-0002', awb: 'AA2', data: '02.12.2026', __rand: 3 }),
    rand({ doc: 'PL-HUS-0003', awb: 'AA3', data: '29.11.2026', __rand: 4 }),
    rand({ doc: 'PL-HUS-0004', awb: 'AA4', data: '05.12.2026', __rand: 5 }),
  ]
  it('import mixt: avertisment DOAR pe rândul tardiv, care rămâne aplicabil (expedierea e un fapt)', () => {
    const r = propune(fisier, mapare, 'expediere', plicuri, { uats })
    expect(r.exceptii).toEqual([])
    expect(r.aplicabile.map(a => a.nr_document)).toEqual(['PL-HUS-0001', 'PL-HUS-0002', 'PL-HUS-0003', 'PL-HUS-0004'])
    expect(r.aplicabile.filter(a => a.avertisment).map(a => a.nr_document)).toEqual(['PL-HUS-0002'])
    expect(r.aplicabile[1].avertisment).toBe('Data expedierii (02.12.2026) e după termen: pentru Comuna Fictivă convocările trebuie expediate cu cel puțin 10 zile libere înainte de ziua 1 (10.12.2026), adică până la 29.11.2026 (plan pct. 4.2).')
    expect(r.aplicabile[1].patch).toEqual({ awb: 'AA2', data_expediere: '2026-12-02' })
  })
  it('confirmarea înainte de „Aplică” numără rândurile tardive; fără tardive rămâne o singură confirmare', () => {
    const r = propune(fisier, mapare, 'expediere', plicuri, { uats })
    const m = confirmariAplicare(r, 'TEST-PR')
    expect(m).toHaveLength(2)
    expect(m[1]).toMatch(/^1 din 4 expedieri sunt DUPĂ termenul de convocare \(cu cel puțin 10 zile libere înainte de ziua 1, plan pct\. 4\.2\): PL-HUS-0002\./)
    const inTermen = propune([fisier[0], fisier[2]], mapare, 'expediere', plicuri, { uats })
    expect(confirmariAplicare(inTermen, 'TEST-PR')).toHaveLength(1)
  })
  it('recitirea înainte de aplicare (Copilot f-v2 r4 P2): termene recalculate pe ziua 1 de acum, schimbarea semnalată, UAT lipsă = eroare', () => {
    const r = propune(fisier, mapare, 'expediere', plicuri, { uats })
    expect(reevalueazaTermene(r.aplicabile, uats).schimbat).toBe(false)
    // ziua 1 mutată la 05.12 → limita 24.11: 29.11 și 02.12 devin tardive; patch-urile nu se schimbă
    const mutat = reevalueazaTermene(r.aplicabile, [{ ...uats[0], sesiune_zi1: '2026-12-05' }, uats[1]])
    expect(mutat.schimbat).toBe(true)
    expect(mutat.aplicabile.filter(a => a.avertisment).map(a => a.nr_document)).toEqual(['PL-HUS-0002', 'PL-HUS-0003'])
    expect(mutat.aplicabile.map(a => a.patch)).toEqual(r.aplicabile.map(a => a.patch))
    expect(confirmareTermeneSchimbate(mutat.aplicabile)).toContain('2 din 4 expedieri')
    expect(() => reevalueazaTermene(r.aplicabile, [uats[0]])).toThrow(/nu s-a aplicat nimic/)
  })
  it('fără UAT-uri transmise (ecranul Plicuri, care are propriul avertisment) nu se inventează termenul', () => {
    expect(propune(fisier, mapare, 'expediere', plicuri).aplicabile.some(a => a.avertisment)).toBe(false)
  })
})

describe('aplica CAS pe plic', () => {
  const a = () => propunere().aplicabile[0]
  it('WHERE pe proiect, lot, versiune, activ și ambele NULL; zero rânduri = conflict', async () => {
    const db = fakeSupabase([{ data: [] }]), r = await aplica(db, [a()])
    expect(r.conflicte).toHaveLength(1)
    expect(db.calls[0]).toMatchObject({ table: 'red_plicuri', select: 'id', patch: { awb: 'AB123', data_expediere: '2026-11-02' } })
    expect(db.calls[0].filtre).toEqual(expect.arrayContaining([
      ['eq', 'id', 'plic-fictiv-1'], ['eq', 'proiect_id', 'proiect-fictiv'], ['eq', 'lot_id', 'lot-fictiv'], ['eq', 'versiune', 3], ['eq', 'opis_path', 'plicuri/plic-fictiv-1/opis-1.docx'],
      ['eq', 'stare', 'activ'], ['is', 'awb', null], ['is', 'data_expediere', null], ['is', 'data_ar', null], ['is', 'retur', null],
    ]))
  })
  it('AWB preluat între timp: fără UPDATE', async () => {
    const db = fakeSupabase([], () => {}, [{ id: 'plic-fictiv-2' }])
    expect((await aplica(db, [a()])).conflicte).toHaveLength(1)
    expect(db.calls).toEqual([])
    expect(db.pre[0].filtre).toEqual([['eq', 'awb', 'AB123'], ['neq', 'id', 'plic-fictiv-1']])
  })
  it('oprește la cinci erori, nu reîncearcă automat, succesul resetează contorul', async () => {
    const err = { error: { message: 'fictiv' } }
    const db = fakeSupabase([err, new Error('rețea'), { data: [{ id: 'plic-fictiv-1' }] }, ...Array(6).fill(err)])
    const r = await aplica(db, Array.from({ length: 10 }, a))
    expect(r.aplicate).toHaveLength(1); expect(r.erori).toHaveLength(7); expect(r.neprocesate).toHaveLength(2)
    expect(db.calls).toHaveLength(8)
  })
  it('lipsa listei este rezultat necunoscut, nu succes', async () => {
    const r = await aplica(fakeSupabase([{ data: null }]), [a()])
    expect(r.aplicate).toEqual([]); expect(r.erori).toHaveLength(1)
  })
  it('anularea sesiunii oprește înainte de scriere și între rânduri', async () => {
    const db = fakeSupabase()
    expect((await aplica(db, [a()], { esteCurent: () => false })).neprocesate).toHaveLength(1)
    expect(db.calls).toEqual([])
    let curent = true
    const db2 = fakeSupabase([], () => { curent = false })
    const r = await aplica(db2, [a(), a(), a()], { esteCurent: () => curent })
    expect(r.aplicate).toHaveLength(1); expect(r.neprocesate).toHaveLength(2)
    let citiri = 0
    const db3 = fakeSupabase()
    const r3 = await aplica(db3, [a()], { esteCurent: () => ++citiri < 2 })
    expect(r3.neprocesate).toHaveLength(1); expect(db3.calls).toEqual([])
  })
  it('nu acceptă intenții AR/retur construite în afara propune', async () => {
    const db = fakeSupabase()
    expect((await aplica(db, [{ ...a(), tip: 'ar' }])).erori).toHaveLength(1)
    expect(db.calls).toEqual([])
  })
})
