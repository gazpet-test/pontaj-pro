import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { grupeazaPentruPlicuri, textAR, docxSimplu, genereazaOpis, genereazaPvPlicuire, csvEtichete } from './plicuri.js'
import { termenExpediere, textTermenExpediere, avertismentExpediere } from './plicuri.js'
import { vi } from 'vitest'
import { confirmaExpediereRecitita } from './plicuri.js'
import { convocareDeRegenerat } from './plicuri.js'

// Test weekend 06.11.2026: RD008 la „Creează plicuri” — convocările fără calitate în document / cu calitate schimbată nu se mai propun.
describe('grupeazaPentruPlicuri — convocări de regenerat (RD008)', () => {
  const c = extra => conv({ calitate_document: 'proprietar', calitate_detinator: 'proprietar', ...extra })
  it('calitate egală → plic propus', () => {
    const r = grupeazaPentruPlicuri([c()])
    expect(r.grupuri).toHaveLength(1); expect(r.de_regenerat).toEqual([])
  })
  it('calitate_document NULL (legacy, dinainte de 20261131c) → de regenerat, nu propus', () => {
    const r = grupeazaPentruPlicuri([c({ calitate_document: null })])
    expect(r.grupuri).toEqual([]); expect(r.de_regenerat).toHaveLength(1)
  })
  it('calitatea deținătorului s-a schimbat după generare → de regenerat', () => {
    expect(grupeazaPentruPlicuri([c({ calitate_detinator: 'coproprietar' })]).de_regenerat).toHaveLength(1)
  })
  it('o singură convocare de regenerat oprește tot plicul persoanei (serverul cere toate convocările persoanei din UAT)', () => {
    const r = grupeazaPentruPlicuri([c(), c({ conv_id: 'conv-fictiva-2', id_parcela: 'ABC-0002', nr_document: 'C-0013', calitate_document: null })])
    expect(r.grupuri).toEqual([]); expect(r.de_regenerat).toHaveLength(1); expect(r.de_regenerat[0].convocari).toHaveLength(2)
    expect(r.de_regenerat[0].convocari.filter(convocareDeRegenerat).map(x => x.nr_document)).toEqual(['C-0013'])
  })
  it('alte persoane rămân propuse', () => {
    const r = grupeazaPentruPlicuri([c(), c({ conv_id: 'x2', nume_normalizat: 'ALTA PERSOANA', calitate_document: null })])
    expect(r.grupuri).toHaveLength(1); expect(r.de_regenerat).toHaveLength(1)
  })
  it('rând fără câmpul calitate_document (apelant vechi) → necunoscut, nu se exclude', () => {
    expect(convocareDeRegenerat(conv())).toBe(false)
  })
})

// Exclusiv date fictive, fără identificatori de persoane reale.
const conv = extra => ({ conv_id: 'conv-fictiva-1', nr_document: 'C-0012', uat_id: 'uat-fictiv-1', uat3: 'ABC', uat_nume: 'Comuna Fictivă',
  id_parcela: 'ABC-0001', tarla: '7', nr_cadastral: '123', poz_hg: '9', detinator_nume: 'Persoană Fictivă', nume_normalizat: 'PERSOANA FICTIVA',
  adresa: { strada: 'Strada Fictivă 1', sat: 'Sat Fictiv', comuna: 'Comuna Fictivă', judet: 'Fictiv', cod_postal: '000000', cunoscuta: true }, ...extra })
const plic = { id: 'plic-fictiv', nr_plic: 'PL-ABC-0001', destinatar_nume: 'Persoană Fictivă', uat_nume: 'Comuna Fictivă' }
const proiect = { denumire: 'Conducta fictivă, Lot 1' }
async function documentXml(blob) { const zip = await JSZip.loadAsync(await blob.arrayBuffer()); return zip.file('word/document.xml').async('string') }

describe('grupeazaPentruPlicuri', () => {
  it('aceeași persoană pe două parcele este un plic; normalizează câmpurile adresei', () => {
    const a = conv(), b = conv({ conv_id: 'conv-fictiva-2', id_parcela: 'ABC-0002', nr_document: 'C-0013', nume_normalizat: ' persoana fictiva ',
      adresa: { ...a.adresa, strada: '  strada   fictivă 1 ' } })
    const r = grupeazaPentruPlicuri([a, b])
    expect(r.grupuri).toHaveLength(1); expect(r.grupuri[0].convocari).toHaveLength(2); expect(r.fara_adresa).toEqual([]); expect(r.prea_mari).toEqual([])
  })
  it('adrese diferite, persoană diferită și alt UAT nu se unesc', () => {
    const a = conv()
    const r = grupeazaPentruPlicuri([a, conv({ adresa: { ...a.adresa, strada: 'Altă stradă' } }), conv({ nume_normalizat: 'ALTA PERSOANA' }), conv({ uat_id: 'uat-fictiv-2', uat3: 'ZZZ' })])
    expect(r.grupuri).toHaveLength(4)
    expect(r.grupuri.at(-1).uat3).toBe('ZZZ')
  })
  it('adresă necunoscută sau goală nu devine plic', () => {
    const rs = [conv({ adresa: { cunoscuta: false } }), conv({ adresa: { cunoscuta: true, strada: ' ' } }), conv({ adresa: null })]
    expect(grupeazaPentruPlicuri(rs)).toEqual({ grupuri: [], fara_adresa: rs, prea_mari: [], de_regenerat: [] })
  })
  it('200 convocări = un plic; 201 = blocaj explicit (fără împărțire, serverul refuză plicurile parțiale)', () => {
    const fa = n => Array.from({ length: n }, (_, i) => conv({ conv_id: `fictiv-${i}`, nr_document: `C-${String(i + 1).padStart(4, '0')}` }))
    expect(grupeazaPentruPlicuri(fa(200)).grupuri.map(g => g.convocari.length)).toEqual([200])
    const r = grupeazaPentruPlicuri(fa(201))
    expect(r.grupuri).toEqual([]); expect(r.prea_mari).toHaveLength(1); expect(r.prea_mari[0].convocari).toHaveLength(201)
  })
})

describe('textAR (juridic#021)', () => {
  const pr = { cod: 'LOT1-PRUNISOR-JUPA', imputernicire_nr: 'TEST-1', imputernicire_data: '2026-11-01' }
  const p = { nr_plic: 'PL-ABC-0001', uat_nume: 'Comuna Fictivă' }
  const cs = (nume) => nume.map(n => ({ nr_document: n, id_parcela: 'ABC-0001' }))
  const coada = 'pentru constatarea readucerii terenului la starea inițială, UAT Comuna Fictivă – conducta Prunișor–Jupa, Lot 1'
  const exp = 'Expeditor: Gazpet Instal SRL, pentru S.N.T.G.N. Transgaz S.A.'
  it('fără împuternicire nu se generează AR', () => {
    expect(() => textAR(p, cs(['C-0001']), { proiect: {} })).toThrow()
    expect(() => textAR(p, cs(['C-0001']), { proiect: { imputernicire_nr: 'X' } })).toThrow()
    expect(() => textAR(p, cs(['C-0001']), { proiect: { cod: 'ALT-PROIECT', imputernicire_nr: 'X', imputernicire_data: '2026-11-01' } })).toThrow(/nu e validat/)
  })
  it('până la 6 convocări: enumerate, cu N, UAT și plicul', () => {
    expect(textAR(p, cs(['C-0003', 'C-0001']), { proiect: pr })).toBe(`Conține: 2 convocări (nr. C-0001, C-0003) ${coada}. Plic PL-ABC-0001. ${exp}`)
    expect(textAR(p, cs(['C-0007']), { proiect: pr })).toBe(`Conține: 1 convocare (nr. C-0007) ${coada}. Plic PL-ABC-0001. ${exp}`)
  })
  it('peste 6 consecutive: interval + opis; peste 6 neconsecutive: doar opis', () => {
    const consec = Array.from({ length: 9 }, (_, i) => `C-00${12 + i}`)
    expect(textAR(p, cs(consec), { proiect: pr })).toBe(`Conține: 9 convocări (nr. C-0012 – C-0020) ${coada}, enumerate în opisul plicului PL-ABC-0001. ${exp}`)
    const sarite = ['C-0001', 'C-0003', 'C-0005', 'C-0007', 'C-0009', 'C-0011', 'C-0013']
    expect(textAR(p, cs(sarite), { proiect: pr })).toBe(`Conține: 7 convocări ${coada}, enumerate în opisul plicului PL-ABC-0001. ${exp}`)
  })
})

describe('documente DOCX', () => {
  it('ZIP valid, relație și content types, escape XML pentru toate metacaracterele și rânduri cu borduri', async () => {
    const blob = await docxSimplu({ titlu: `A&B <C> "D" 'E'\u000B\u0001`, paragrafe: ['Paragraf'], tabel: { cap: ['Col 1', 'Col 2'], randuri: [['r1', 'x&y'], ['r2', '<z>']] }, semnaturi: ['Semnătură'] })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']))
    const xml = await zip.file('word/document.xml').async('string')
    expect(xml).toContain('A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;')
    expect(xml).toContain('x&amp;y'); expect(xml).toContain('&lt;z&gt;')
    expect(xml.match(/<w:tr>/g)).toHaveLength(3); expect(xml.match(/<w:tc>/g)).toHaveLength(6)
    expect(xml).toContain('<w:tblBorders>'); expect(xml).toContain('Times New Roman'); expect(xml).toContain('w:val="22"')
  })
  it('opis cu adresa, datele parcelei și mențiunea QR', async () => {
    const xml = await documentXml(await genereazaOpis(plic, [conv()], { proiect, uat: { nume: 'Comuna Fictivă' } }))
    expect(xml).toContain('Informarea privind datele personale se află pe verso-ul fiecărei convocări.')
    for (const s of ['Opis - plicul PL-ABC-0001', 'Strada Fictivă 1', 'C-0012', 'ABC-0001', 'Plicul conține 1 convocări.', 'cod QR personal', 'Întocmit: Gazpet Instal SRL']) expect(xml).toContain(s)
  })
  it('PV cu numărul lotului, plicuri, convocări și doi semnatari', async () => {
    const xml = await documentXml(await genereazaPvPlicuire({ nr_lot: 'PP-0001', data_plicuire: '2026-11-03', semnatar1_nume: 'Semnatar Fictiv' }, [plic], { [plic.id]: [conv()] }, { proiect }))
    for (const s of ['PP-0001 din 03.11.2026', 'PL-ABC-0001', 'C-0012', 'Semnatar Fictiv', '2. Nume (verifică):', 'cartonașul AR']) expect(xml).toContain(s)
  })
  it('plicul anulat după creare lot este menționat separat, fără rând de expediere', async () => {
    const xml = await documentXml(await genereazaPvPlicuire({ nr_lot: 'PP-0001', data_plicuire: '2026-11-03' }, [{ ...plic, stare: 'anulat' }], {}, { proiect }))
    expect(xml).toContain('Plicuri anulate, excluse de la expediere: PL-ABC-0001.')
    expect(xml.match(/<w:tr>/g)).toHaveLength(1)
  })
})

describe('csvEtichete', () => {
  it('BOM, separator ;, ghilimele escapate și formule neutralizate inclusiv după whitespace', () => {
    for (const s of ['=1+1', '+SUM(A1)', '-1', '@cmd', ' \t\n=1']) {
      const csv = csvEtichete([{ ...plic, destinatar_nume: s, proiect: { cod: 'LOT1-PRUNISOR-JUPA', imputernicire_nr: 'T', imputernicire_data: '2026-11-01' } }], { [plic.id]: [conv()] })
      expect(csv.charCodeAt(0)).toBe(0xFEFF); expect(csv).toContain(`;"'${s}";`)
      expect(csv).toContain('Text AR'); expect(csv).toContain('Strada Fictivă 1')
    }
    expect(csvEtichete([{ ...plic, destinatar_nume: 'Fictiv "Test"', proiect: { cod: 'LOT1-PRUNISOR-JUPA', imputernicire_nr: 'T', imputernicire_data: '2026-11-01' } }], { [plic.id]: [conv()] })).toContain('Fictiv ""Test""')
    expect(() => csvEtichete([plic], { [plic.id]: [conv()] })).toThrow()   // fără împuternicire nu se generează AR
  })
  // Test 08.11.2026: forma reală a apelului din PlicuriEcran — rândurile plicurilor NU au `proiect`, proiectul vine ca parametru
  it('apelul din ecran (proiect ca parametru, rânduri fără proiect) → CSV cu textul AR; fără proiect → refuz', () => {
    const pr = { cod: 'LOT1-PRUNISOR-JUPA', imputernicire_nr: 'T', imputernicire_data: '2026-11-01' }
    const csv = csvEtichete([plic], { [plic.id]: [conv()] }, { proiect: pr })
    expect(csv).toContain(plic.nr_plic); expect(csv).toMatch(/Conține: 1 convocare/)
    expect(() => csvEtichete([plic], { [plic.id]: [conv()] })).toThrow(/împuternicirea/)
    expect(() => csvEtichete([plic], { [plic.id]: [conv()] }, { proiect: { ...pr, cod: 'TEST-RAZVAN' } })).toThrow(/nu e validat juridic/)
  })
})

// Plan A1 rev49 pct. 4.2: recomandata se expediază „cu cel puțin 10 zile înainte de prima zi de sesiune” (zile calendaristice).
// Lectura „10 zile libere” (ZILE_EXCLUSE_DIN_TERMEN = 1): nu se numără ziua expedierii și nici ziua 1 → limita = ziua 1 − 11.
// Datele așteptate sunt numărate în calendar, nu calculate cu funcția testată.
describe('termenul de expediere (plan pct. 4.2)', () => {
  const uat = { nume: 'Comuna Fictivă', sesiune_zi1: '2026-12-10' }
  it('data-limită = ziua 1 minus 11 zile (10 zile libere); pe limită e în termen, a doua zi e după termen', () => {
    expect(termenExpediere(uat)).toEqual({ limita: '2026-11-29', depasit: false })
    expect(termenExpediere(uat, '2026-11-29').depasit).toBe(false)
    expect(termenExpediere(uat, '2026-11-02').depasit).toBe(false)
    expect(termenExpediere(uat, '2026-11-30').depasit).toBe(true)
    expect(termenExpediere({ sesiune_zi1: '2027-01-05' }, '2026-12-26')).toEqual({ limita: '2026-12-25', depasit: true })
  })
  it('fără ziua 1 sau cu dată invalidă nu se judecă (nu inventăm termenul)', () => {
    expect(termenExpediere({}, '2026-12-01')).toEqual({ limita: null, depasit: false })
    expect(termenExpediere(undefined, '2026-12-01')).toEqual({ limita: null, depasit: false })
    expect(termenExpediere(uat, '01.12.2026').depasit).toBe(false)
    expect(termenExpediere(uat, '').depasit).toBe(false)
  })
  // Copilot f-v2 r4 P2: modalul de expediere recitește UAT-ul înainte de salvare; confirmarea se calculează pe valoarea recitită
  const client = (rand, error = null) => {
    const apeluri = []
    return { apeluri, from(t) { const q = { select: c => { apeluri.push([t, 'select', c]); return q }, eq: (k, v) => { apeluri.push([t, 'eq', k, v]); return q }, maybeSingle: async () => ({ data: rand, error }) }; return q } }
  }
  it('modal: ziua 1 mutată de alt admin după deschidere → confirmarea se cere pe valoarea recitită', async () => {
    // în ecran (cache) ziua 1 = 20.12 → limita 09.12, deci 03.12 ar fi în termen; în BD acum ziua 1 = 10.12 → limita 29.11
    const inEcran = { nume: 'Comuna Fictivă', sesiune_zi1: '2026-12-20' }
    expect(avertismentExpediere(inEcran, '2026-12-03')).toBeNull()
    const db = client({ id: 'uat-fictiv', nume: 'Comuna Fictivă', sesiune_zi1: '2026-12-10' })
    const confirm = vi.fn(() => false)
    const r = await confirmaExpediereRecitita(db, { uatId: 'uat-fictiv', data: '2026-12-03', confirm })
    expect(db.apeluri).toContainEqual(['red_uat', 'eq', 'id', 'uat-fictiv'])
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('ziua 1 (10.12.2026), adică până la 29.11.2026')
    expect(r).toEqual({ ok: false, avertisment: expect.stringContaining('03.12.2026') })
    expect((await confirmaExpediereRecitita(db, { uatId: 'uat-fictiv', data: '2026-12-03', confirm: () => true })).ok).toBe(true)
  })
  it('modal: în termen pe valoarea recitită → fără confirmare; recitire eșuată sau UAT invizibil → eroare, nu se salvează', async () => {
    const confirm = vi.fn(() => false)
    expect(await confirmaExpediereRecitita(client({ id: 'u', nume: 'U', sesiune_zi1: '2026-12-20' }), { uatId: 'u', data: '2026-12-03', confirm })).toEqual({ ok: true, avertisment: null })
    expect(confirm).not.toHaveBeenCalled()
    await expect(confirmaExpediereRecitita(client(null, { message: 'retea' }), { uatId: 'u', data: '2026-12-03', confirm })).rejects.toMatchObject({ code: 'P0001' })
    await expect(confirmaExpediereRecitita(client(null), { uatId: 'u', data: '2026-12-03', confirm })).rejects.toMatchObject({ message: expect.stringContaining('nu s-a salvat') })
    expect(confirm).not.toHaveBeenCalled()
  })
  it('dată de expediere imposibilă în calendar: limita se calculează, termenul nu se judecă, fără eroare (Jakarinos f-v2 r2 P3)', () => {
    expect(termenExpediere(uat, '2026-12-40')).toEqual({ limita: '2026-11-29', depasit: false })
    expect(termenExpediere(uat, '2026-02-30')).toEqual({ limita: '2026-11-29', depasit: false })
    expect(avertismentExpediere(uat, '2026-12-40')).toBeNull()
  })
  it('textul afișat și avertismentul vizibil', () => {
    expect(textTermenExpediere(uat)).toBe('expediați până la 29.11.2026')
    expect(textTermenExpediere({ nume: 'Fără zile' })).toBe('termen de expediere necunoscut (ziua 1 de sesiune necompletată)')
    expect(avertismentExpediere(uat, '2026-11-29')).toBeNull()
    expect(avertismentExpediere(uat, '2026-12-03')).toBe('Data expedierii (03.12.2026) e după termen: pentru Comuna Fictivă convocările trebuie expediate cu cel puțin 10 zile libere înainte de ziua 1 (10.12.2026), adică până la 29.11.2026 (plan pct. 4.2).')
    expect(avertismentExpediere({}, '2026-12-03')).toBeNull()
  })
})
