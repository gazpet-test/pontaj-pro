// Redări teren — teste pentru src/redari/docx.js (contract §6 + §8). Date fictive, fără persoane reale.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, TextRun, Header } from 'docx'
import {
  completeazaDocx, genereazaQr, hashBlob, borderouCsv, celulaCsv, genereazaConvocator, verificaDateConvocator, salveazaConvocator,
  reincarcaConvocator, caleConvocator, versiuneDinCale, formatDataRo, formatNumarRo, linkRaspuns, adresaDetinator, textGdprPentruUat,
  MIME_DOCX, COLOANE_BORDEROU, CHEI_CONVOCATOR, ETICHETA_CALITATE,
} from './docx.js'

const SABLON = resolve(process.cwd(), 'public/redari/sabloane/convocator.docx') // Model_1 v5, 36 placeholder-e (SABLOANE.md §2.1)
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const citesteSablon = () => { const b = readFileSync(SABLON); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

// DOCX de test: un placeholder rupt în două run-uri („{{nu” + „me}}”), unul întreg, unul necunoscut (opțional), unul în antet
const docxTest = async ({ cuNecunoscut = true } = {}) => {
  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun('Antet {{nr_document}}')] })] }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Către {{nu', bold: true }), new TextRun('me}}, parcela {{id_parcela}}')] }),
        new Paragraph({ children: [new TextRun(cuNecunoscut ? 'Sat: {{sat}} / lipsă: [{{inexistent}}]' : 'Sat: {{sat}}')] }),
        new Paragraph({ children: [new TextRun('{{qr}}')] }),
        new Paragraph({ children: [new TextRun('Fără placeholder <neatins>')] }),
      ],
    }],
  })
  return Packer.toBuffer(doc)
}

const xmlDin = async (blob, cale) => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const f = zip.file(cale)
  return { zip, xml: f ? await f.async('string') : null }
}
const textDin = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
const pauza = (ms) => new Promise(r => setTimeout(r, ms))

describe('completeazaDocx — înlocuire placeholder-e', () => {
  const campuri = { nume: 'POPESCU ION (fictiv)', id_parcela: 'T3-HUS-0001', sat: 'A & B <"test">', nr_document: 'C-0001' }

  it('placeholder rupt între run-uri + întreg + lipsă → gol (mod permisiv); antetul se completează', async () => {
    const blob = await completeazaDocx(await docxTest(), campuri)
    expect(blob.type).toBe(MIME_DOCX)
    const { xml } = await xmlDin(blob, 'word/document.xml')
    const text = textDin(xml)
    expect(text).toContain('Către POPESCU ION (fictiv), parcela T3-HUS-0001')
    expect(text).toContain('lipsă: []')
    expect(text).not.toMatch(/\{\{|\}\}/)
    expect(xml).toContain('Fără placeholder &lt;neatins&gt;')
    const { xml: antet } = await xmlDin(blob, 'word/header1.xml')
    expect(textDin(antet)).toBe('Antet C-0001')
  })

  it('strict: placeholder necunoscut ⇒ Error cu numele lui; fără necunoscute trece', async () => {
    await expect(completeazaDocx(await docxTest(), campuri, { strict: true, imagini: { qr: PNG_1x1 } })).rejects.toThrow(/\{\{inexistent\}\}/)
    // {{qr}} fără imagine și fără cheie e tot necunoscut în strict
    await expect(completeazaDocx(await docxTest({ cuNecunoscut: false }), campuri, { strict: true })).rejects.toThrow(/\{\{qr\}\}/)
    const blob = await completeazaDocx(await docxTest({ cuNecunoscut: false }), campuri, { strict: true, imagini: { qr: PNG_1x1 } })
    expect(textDin((await xmlDin(blob, 'word/document.xml')).xml)).not.toMatch(/\{\{/)
  })

  it('escape XML pe valori; XML-ul rămâne bine format', async () => {
    const { xml } = await xmlDin(await completeazaDocx(await docxTest(), campuri), 'word/document.xml')
    expect(xml).toContain('Sat: A &amp; B &lt;&quot;test&quot;&gt;')
    expect(xml).not.toContain('A & B')
    expect(xml.match(/<w:p[\s>]/g).length).toBe(xml.match(/<\/w:p>/g).length)
  })

  it('consolidarea păstrează formatarea primului run (bold) și golește restul <w:t>', async () => {
    const { xml } = await xmlDin(await completeazaDocx(await docxTest(), campuri), 'word/document.xml')
    const p1 = /<w:p[\s>][\s\S]*?<\/w:p>/.exec(xml)[0]
    expect(p1).toMatch(/<w:b\/>[\s\S]*Către POPESCU ION/)
    expect(p1).toContain('<w:t/>')
  })

  it('\\n din valoare devine <w:br/>; fără imagini, {{qr}} → gol', async () => {
    const { xml, zip } = await xmlDin(await completeazaDocx(await docxTest(), { ...campuri, sat: 'linia 1\nlinia 2' }), 'word/document.xml')
    expect(xml).toContain('linia 1</w:t><w:br/><w:t xml:space="preserve">linia 2')
    expect(zip.file('word/media/qr.png')).toBeNull()
    expect(xml).not.toContain('<w:drawing>')
  })

  it('{{qr}} cu imagine → media/qr.png + relație + content type + <w:drawing> de 3 cm în locul paragrafului', async () => {
    const blob = await completeazaDocx(await docxTest(), campuri, { imagini: { qr: PNG_1x1 } })
    const { xml, zip } = await xmlDin(blob, 'word/document.xml')
    expect(zip.file('word/media/qr.png')).not.toBeNull()
    expect(await zip.file('[Content_Types].xml').async('string')).toMatch(/Extension="png"/)
    const rels = await zip.file('word/_rels/document.xml.rels').async('string')
    const rId = /Id="(rId\d+)"[^>]*Target="media\/qr\.png"/.exec(rels)?.[1]
    expect(rId).toBeTruthy()
    expect(xml).toContain(`r:embed="${rId}"`)
    expect(xml).toContain('<wp:extent cx="1080000" cy="1080000"/>')
    expect(textDin(xml)).not.toContain('{{qr}}')
  })

  it('dataURL care nu e PNG → eroare; fișier care nu e DOCX → eroare', async () => {
    await expect(completeazaDocx(await docxTest(), campuri, { imagini: { qr: 'data:image/jpeg;base64,AAAA' } })).rejects.toThrow(/PNG/)
    const zip = new JSZip(); zip.file('a.txt', 'x')
    await expect(completeazaDocx(await zip.generateAsync({ type: 'arraybuffer' }), {})).rejects.toThrow(/document\.xml/)
  })

  it('șablonul REAL convocator.docx: cele 35 de câmpuri text + qr se completează strict, niciun {{ rămas', async () => {
    const chei = CHEI_CONVOCATOR.filter(k => k !== 'qr' && k !== 'id_parcela')
    expect(chei).toHaveLength(35)
    const campuriToate = Object.fromEntries(chei.map(k => [k, `<${k}>`]))
    const blob = await completeazaDocx(citesteSablon(), campuriToate, { imagini: { qr: PNG_1x1 }, strict: true })
    const { zip } = await xmlDin(blob, 'word/document.xml')
    let tot = ''
    for (const cale of Object.keys(zip.files).filter(f => f === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(f))) {
      const xml = await zip.file(cale).async('string')
      expect(xml, cale).not.toMatch(/\{\{|\}\}/)
      tot += xml
    }
    for (const k of chei) expect(tot, k).toContain(`&lt;${k}&gt;`)
    expect(tot).toContain('<w:drawing>')
    // fără una dintre chei, strict refuză și spune care
    const { contract_nr, ...faraUna } = campuriToate
    await expect(completeazaDocx(citesteSablon(), faraUna, { imagini: { qr: PNG_1x1 }, strict: true })).rejects.toThrow(/\{\{contract_nr\}\}/)
  })
})

describe('hashBlob / genereazaQr / determinism', () => {
  it('sha256 hex, determinist pe același conținut; conținut diferit → hash diferit', async () => {
    const h1 = await hashBlob(new Blob(['abc']))
    expect(h1).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await hashBlob(new Blob(['abc']))).toBe(h1)
    expect(await hashBlob(new Blob(['abd']))).not.toBe(h1)
  })
  it('același șablon + câmpuri + QR → același hash și la 1,1 s distanță (fără intrări de director cu data curentă)', async () => {
    const t = citesteSablon()
    const c = { nume: 'X', id_parcela: 'T1-PRU-0001' }
    const b1 = await completeazaDocx(t, c, { imagini: { qr: PNG_1x1 } })
    await pauza(1100)
    const b2 = await completeazaDocx(t, c, { imagini: { qr: PNG_1x1 } })
    expect(await hashBlob(b1)).toBe(await hashBlob(b2))
    // niciun director NOU față de șablon (word/media/ ar fi primit data curentă); cele din șablon rămân cu datele lor
    const dirs = (zip) => Object.values(zip.files).filter(f => f.dir).map(f => f.name).sort()
    const { zip } = await xmlDin(b2, 'word/document.xml')
    expect(dirs(zip)).toEqual(dirs(await JSZip.loadAsync(t)))
    expect(dirs(zip)).not.toContain('word/media/')
    expect(zip.file('word/media/qr.png')).not.toBeNull()
    expect(await hashBlob(await completeazaDocx(t, { ...c, nume: 'Y' }, { imagini: { qr: PNG_1x1 } }))).not.toBe(await hashBlob(b1))
  }, 10000)
  it('QR → dataURL PNG', async () => {
    const d = await genereazaQr('https://exemplu.test/redari/raspuns/abc123')
    expect(d.startsWith('data:image/png;base64,')).toBe(true)
    expect(d.length).toBeGreaterThan(200)
  })
})

describe('borderouCsv', () => {
  it('BOM, antet fix, separator ;, ghilimele dublate, CRLF', async () => {
    const blob = borderouCsv([
      { nr_document: 'C-0001', nume: 'POPESCU ION', adresa: 'Str. Lungă; nr. 1', cod_postal: '227001', localitate: 'Husnicioara', judet: 'Mehedinți', id_parcela: 'T3-HUS-0001' },
      { nr_document: 'C-0002', nume: 'Ion "Zis" Vasile', adresa: null, id_parcela: 'T3-HUS-0002' },
    ])
    // Blob.text() scoate BOM-ul la decodare → verificăm octeții bruți (EF BB BF) și decodăm cu ignoreBOM
    const octeti = new Uint8Array(await blob.arrayBuffer())
    expect([...octeti.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(octeti)
    expect(text.charCodeAt(0)).toBe(0xFEFF)
    const linii = text.slice(1).split('\r\n')
    expect(linii[0]).toBe(COLOANE_BORDEROU.join(';'))
    expect(linii[0]).toBe('nr_document;nume;adresa;cod_postal;localitate;judet;id_parcela')
    expect(linii[1]).toBe('C-0001;POPESCU ION;"Str. Lungă; nr. 1";227001;Husnicioara;Mehedinți;T3-HUS-0001')
    expect(linii[2]).toBe('C-0002;"Ion ""Zis"" Vasile";;;;;T3-HUS-0002')
    expect(linii[3]).toBe('')
    expect(blob.type).toMatch(/text\/csv/)
  })
  it('fără rânduri → doar antetul', async () => {
    const octeti = new Uint8Array(await borderouCsv().arrayBuffer())
    expect([...octeti.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
    expect(new TextDecoder().decode(octeti)).toBe(COLOANE_BORDEROU.join(';') + '\r\n')
  })
  it('anti formula injection: = + - @ TAB CR (și după spații/caractere de control) → prefix apostrof + ghilimele', () => {
    expect(celulaCsv('=1+1')).toBe(`"'=1+1"`)
    expect(celulaCsv('@SUM(1)')).toBe(`"'@SUM(1)"`)
    expect(celulaCsv('-2')).toBe(`"'-2"`)
    expect(celulaCsv('+40722000000')).toBe(`"'+40722000000"`)
    expect(celulaCsv(' =x')).toBe(`"' =x"`)
    expect(celulaCsv('\u0000=cmd')).toBe(`"'\u0000=cmd"`)
    expect(celulaCsv('\t=1')).toBe(`"'\t=1"`)
    expect(celulaCsv('\r=1')).toBe(`"'\r=1"`)
    expect(celulaCsv('=a"b')).toBe(`"'=a""b"`)
    // valori normale neatinse
    expect(celulaCsv('POPESCU ION')).toBe('POPESCU ION')
    expect(celulaCsv('T3-HUS-0001')).toBe('T3-HUS-0001')
    expect(celulaCsv('Str. 1 Mai, nr. 2')).toBe('Str. 1 Mai, nr. 2')
    expect(celulaCsv(0)).toBe('0')
    expect(celulaCsv(null)).toBe('')
  })
  it('borderoul aplică protecția pe fiecare celulă', async () => {
    const text = new TextDecoder().decode(await borderouCsv([{ nr_document: 'C-1', nume: '=HYPERLINK("x")', adresa: '-str', id_parcela: 'P' }]).arrayBuffer())
    expect(text.split('\r\n')[1]).toBe(`C-1;"'=HYPERLINK(""x"")";"'-str";;;;P`)
  })
})

describe('formatări + link', () => {
  it('formatDataRo fără decalaj de fus orar; formatNumarRo ro-RO', () => {
    expect(formatDataRo('2026-11-03')).toBe('03.11.2026')
    expect(formatDataRo('2026-11-03T00:00:00+00:00')).toBe('03.11.2026')
    expect(formatDataRo(new Date(2026, 0, 5))).toBe('05.01.2026')
    expect(formatDataRo(null)).toBe('')
    expect(formatNumarRo(1234.5)).toBe('1.234,5')
    expect(formatNumarRo('')).toBe('')
  })
  it('linkRaspuns taie slash-ul final', () => {
    expect(linkRaspuns('https://pontaj-pro-sooty.vercel.app/', 'tok')).toBe('https://pontaj-pro-sooty.vercel.app/redari/raspuns/tok')
  })
})

describe('genereazaConvocator', () => {
  const complet = () => ({
    detinator: { nume: 'POPESCU ION (fictiv)', calitate: 'mostenitor', cota: '1/2' },
    contactDetinator: { adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: '', adresa_comuna: 'Husnicioara', adresa_judet: 'Mehedinți', cod_postal: '227001', adresa_cunoscuta: true },
    contact: { nume: 'Operator Test', telefon: '0700000000', email: 'redari@exemplu.test' },
    parcela: { id_parcela: 'T3-HUS-0001', sat: 'Satul Test', tarla: '12', nr_cadastral: '5001', poz_hg: '117', tronson: 3, suprafata_temporara_mp: 1500.25 },
    uat: { nume: 'Husnicioara', sesiune_zi1: '2026-11-10', sesiune_zi2: '2026-11-11', program_zi1: '09-12 Sat A', program_zi2: '09-12 Sat B', sate_zi1: 'Sat A, Sat B' },
    proiect: {
      denumire: 'Conductă test Lot 1', contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: '12', imputernicire_data: '2026-10-15',
      reprezentant_tgz_nume: 'Reprezentant Test', reprezentant_tgz_functie: 'inginer', reprezentant_tgz_telefon: '0711111111',
      reprezentant_gazpet_nume: 'Administrator Test', reprezentant_gazpet_functie: 'administrator',
      text_gdpr: 'Operatori: Gazpet și Primăria {uat}.\nDestinatari: Primăria [UAT].',
    },
    nrDocument: 'C-0001', token: 'tokenfictiv1234567890abcdefghijk', origin: 'https://exemplu.test', dataDocument: '2026-11-02',
  })

  it('construiește toate cele 36 de chei (SABLOANE.md §2.1), link + QR, hash; șablonul real completat strict, 0 placeholder-e rămase', async () => {
    const r = await genereazaConvocator({ ...complet(), templateArrayBuffer: citesteSablon() })
    expect(r.link).toBe('https://exemplu.test/redari/raspuns/tokenfictiv1234567890abcdefghijk')
    expect(r.lipsuri).toEqual([])
    for (const k of CHEI_CONVOCATOR.filter(k => k !== 'qr')) expect(r.campuri, k).toHaveProperty(k)
    expect(r.campuri).toMatchObject({
      contract_nr: '30', contract_data: '22.01.2025', proiect_denumire: 'Conductă test Lot 1', imputernicire_nr: '12', imputernicire_data: '15.10.2026',
      nume: 'POPESCU ION (fictiv)', calitate: 'moștenitor', adresa: 'Str. Fictivă nr. 1, Husnicioara, Mehedinți, 227001',
      id_parcela: 'T3-HUS-0001', uat: 'Husnicioara', sat: 'Satul Test', tarla: '12', nr_cadastral: '5001', poz_hg: '117', tronson: 3, suprafata: '1.500,25',
      zi1: '10.11.2026', program1: '09-12 Sat A', sate_zi1: 'Sat A, Sat B', zi2: '11.11.2026', sate_zi2: '', zi3: '', program3: '', sate_zi3: '',
      nr_document: 'C-0001', data: '02.11.2026', contact_nume: 'Operator Test', contact_telefon: '0700000000', contact_email: 'redari@exemplu.test',
      text_gdpr: 'Operatori: Gazpet și Primăria Husnicioara.\nDestinatari: Primăria Husnicioara.',
      reprezentant_tgz: 'Reprezentant Test, inginer', reprezentant_tgz_telefon: '0711111111',
      semnatar_gazpet: 'Administrator Test, administrator', semnatar_tgz: 'Reprezentant Test, inginer',
    })
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.hash).toBe(await hashBlob(r.blob))
    const { zip, xml } = await xmlDin(r.blob, 'word/document.xml')
    expect(zip.file('word/media/qr.png')).not.toBeNull()
    expect(xml).toContain('<w:drawing>')
    const text = textDin(xml)
    expect(text).not.toMatch(/\{\{|\}\}/)
    expect(text).toContain('POPESCU ION (fictiv) (moștenitor)')
    expect(text).toContain('Primăria Husnicioara')
    expect(text).not.toMatch(/\{uat\}|\[UAT\]/)
  })

  it('helper-e: etichete calitate, adresa pe o linie, {uat}/[UAT] în GDPR', () => {
    expect(ETICHETA_CALITATE).toMatchObject({ proprietar: 'proprietar', coproprietar: 'coproprietar', mostenitor: 'moștenitor', arendas: 'arendaș', utilizator: 'utilizator' })
    expect(adresaDetinator({ adresa_strada: ' Str. X ', adresa_sat: null, adresa_comuna: 'C', adresa_judet: '', cod_postal: '227001' })).toBe('Str. X, C, 227001')
    expect(adresaDetinator(null)).toBe('')
    expect(adresaDetinator({})).toBe('')
    expect(textGdprPentruUat('Primăria {uat} / Primăria [UAT] / {UAT}', 'Godeanu')).toBe('Primăria Godeanu / Primăria Godeanu / Godeanu')
    expect(textGdprPentruUat(null, 'X')).toBe('')
    // reprezentant_tgz_telefon și sate_zi lipsă → gol, fără eroare
    const l = verificaDateConvocator({ ...complet(), uat: { ...complet().uat, sate_zi1: undefined }, proiect: { ...complet().proiect, reprezentant_tgz_telefon: null } })
    expect(l).toEqual([])
  })

  it('verificaDateConvocator listează toate lipsurile, inclusiv cele noi (contract, împuternicire, calitate, adresă)', () => {
    expect(verificaDateConvocator(complet())).toEqual([])
    const l = verificaDateConvocator({ nrDocument: '', token: null, uat: { sesiune_zi1: '2026-11-10' }, contact: {}, proiect: {}, detinator: null })
    expect(l).toHaveLength(9)
    expect(l.join(' | ')).toMatch(/nr_document.*token.*contract.*împuternicir.*deținătorul.*zi de sesiune cu program.*contact.*GDPR.*Transgaz/)
    // zi fără program nu e suficientă; contactul poate veni din proiect
    expect(verificaDateConvocator({ ...complet(), uat: { sesiune_zi1: '2026-11-10', program_zi2: 'x' } })).toHaveLength(1)
    expect(verificaDateConvocator({ ...complet(), contact: null, proiect: { ...complet().proiect, contact_telefon: '07' } })).toEqual([])
    // contract / împuternicire: ambele părți (nr + dată)
    expect(verificaDateConvocator({ ...complet(), proiect: { ...complet().proiect, contract_data: null } }).join()).toMatch(/contract_nr \+ contract_data/)
    expect(verificaDateConvocator({ ...complet(), proiect: { ...complet().proiect, imputernicire_nr: '' } }).join()).toMatch(/fără împuternicire nu se trimite/)
    // calitate
    expect(verificaDateConvocator({ ...complet(), detinator: { nume: 'X', calitate: 'neidentificat' } }).join()).toMatch(/neidentificat — nu primește convocator/)
    expect(verificaDateConvocator({ ...complet(), detinator: { nume: 'X', calitate: 'altceva' } }).join()).toMatch(/calitatea deținătorului/)
    // adresa: fără contact / contact gol / adresa_cunoscuta=false; adresa poate veni și din detinator.contact
    expect(verificaDateConvocator({ ...complet(), contactDetinator: null }).join()).toMatch(/deținător fără adresă — convocare prin afișare/)
    expect(verificaDateConvocator({ ...complet(), contactDetinator: { adresa_strada: '', cod_postal: null } }).join()).toMatch(/fără adresă/)
    expect(verificaDateConvocator({ ...complet(), contactDetinator: { ...complet().contactDetinator, adresa_cunoscuta: false } }).join()).toMatch(/fără adresă/)
    expect(verificaDateConvocator({ ...complet(), contactDetinator: undefined, detinator: { ...complet().detinator, contact: complet().contactDetinator } })).toEqual([])
  })

  it('date obligatorii lipsă ⇒ Error în română cu lista; permiteIncomplet le lasă goale și întoarce lipsurile', async () => {
    const t = citesteSablon()
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, uat: { nume: 'Husnicioara' } })).rejects.toThrow(/lipsesc: cel puțin o zi de sesiune cu program/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, proiect: { reprezentant_tgz_nume: 'R' } })).rejects.toThrow(/GDPR/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, proiect: { text_gdpr: 'g' } })).rejects.toThrow(/Transgaz/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, contact: null })).rejects.toThrow(/contact/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, nrDocument: null })).rejects.toThrow(/nr_document/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, token: '' })).rejects.toThrow(/token/)
    await expect(genereazaConvocator({ ...complet() })).rejects.toThrow(/șablonul/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, detinator: { nume: 'X', calitate: 'neidentificat' } })).rejects.toThrow(/neidentificat — nu primește convocator/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, contactDetinator: null })).rejects.toThrow(/deținător fără adresă — convocare prin afișare/)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, proiect: { ...complet().proiect, imputernicire_data: null } })).rejects.toThrow(/împuternicir/)
    const prev = await genereazaConvocator({ ...complet(), templateArrayBuffer: t, uat: { nume: 'Husnicioara' }, proiect: {}, contactDetinator: null, permiteIncomplet: true })
    expect(prev.lipsuri.length).toBe(6) // contract, împuternicire, adresă, zi cu program, GDPR, reprezentant TGZ
    expect(prev.campuri.zi1).toBe('')
    expect(prev.campuri.adresa).toBe('')
    expect(prev.blob.size).toBeGreaterThan(0)
    // previzualizarea fără token nu are sens (nici link, nici QR)
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t, token: '', permiteIncomplet: true })).rejects.toThrow(/token/)
  })

  it('placeholder necunoscut în șablon ⇒ Error (strict), nu dispare tăcut; cu permiteIncomplet trece', async () => {
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: await docxTest() })).rejects.toThrow(/\{\{inexistent\}\}/)
    const r = await genereazaConvocator({ ...complet(), templateArrayBuffer: await docxTest({ cuNecunoscut: false }) })
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/)
    const prev = await genereazaConvocator({ ...complet(), templateArrayBuffer: await docxTest(), permiteIncomplet: true })
    expect(prev.blob.size).toBeGreaterThan(0)
  })
})

describe('salveazaConvocator / reincarcaConvocator (fake supabase)', () => {
  // fake minimal: insert().select().single(), select().eq().single(), update().eq().select().single(), storage.from().upload()
  // opt.existente = căi deja ocupate în bucket (upload pe ele → 409 „already exists”); opt.caleCurenta = fisier_convocator_path din rând
  const fake = (opt = {}) => {
    const apeluri = []
    const existente = new Set(opt.existente || [])
    const supabase = {
      storage: { from: (bucket) => ({
        upload: async (path, blob, o) => {
          apeluri.push({ tip: 'upload', bucket, path, size: blob.size, o })
          if (opt.eUp) return { error: { message: opt.eUp } }
          if (existente.has(path)) return { error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } }
          existente.add(path); return { data: { path }, error: null }
        },
        // listarea folderului: numele fișierelor (fără prefix) din `existente` aflate direct în folder; opt.eList → eroare
        list: async (folder, o) => {
          apeluri.push({ tip: 'list', bucket, folder, o })
          if (opt.eList) return { data: null, error: { message: opt.eList } }
          const pref = folder.replace(/\/?$/, '/')
          return { data: [...existente].filter(p => p.startsWith(pref) && !p.slice(pref.length).includes('/')).map(p => ({ name: p.slice(pref.length) })), error: null }
        },
      }) },
      from: (tabel) => ({
        insert: (rand) => ({ select: (col) => ({ single: async () => { apeluri.push({ tip: 'insert', tabel, rand, col }); return opt.eIns ? { data: null, error: { message: opt.eIns } } : { data: { id: 'uuid-fictiv-1' }, error: null } } }) }),
        select: (col) => ({ eq: (c, val) => ({ single: async () => { apeluri.push({ tip: 'select', tabel, col, filtru: [c, val] }); return opt.eSel ? { data: null, error: { message: opt.eSel } } : { data: { id: val, fisier_convocator_path: opt.caleCurenta ?? null }, error: null } } }) }),
        update: (rand) => ({ eq: (col, val) => ({ select: (c2) => ({ single: async () => { apeluri.push({ tip: 'update', tabel, rand, filtru: [col, val], col: c2 }); return opt.eUpd ? { data: null, error: { message: opt.eUpd } } : opt.updZero ? { data: null, error: null } : { data: { id: val }, error: null } } }) }) }),
      }),
    }
    return { supabase, apeluri }
  }
  const arg = { blob: new Blob(['docx']), hash: 'ab'.repeat(32), proiectCod: 'LOT1-PRUNISOR-JUPA', uat3: 'HUS', idParcela: 'T3-HUS-0001', nrDocument: 'C-0001', detinatorId: 'det-1' }
  const BAZA = 'LOT1-PRUNISOR-JUPA/HUS/T3-HUS-0001/C-0001'
  const PATH = `${BAZA}-v1.docx`
  const argRe = { convocareId: 'uuid-vechi', blob: arg.blob, hash: arg.hash, proiectCod: arg.proiectCod, uat3: arg.uat3, idParcela: arg.idParcela, nrDocument: arg.nrDocument }

  it('caleConvocator versionată; versiuneDinCale', () => {
    expect(caleConvocator({ proiectCod: 'P', uat3: 'HUS', idParcela: 'T3-HUS-0001', nrDocument: 'C-0001' })).toBe('P/HUS/T3-HUS-0001/C-0001-v1.docx')
    expect(caleConvocator({ proiectCod: 'P', uat3: 'HUS', idParcela: 'T3-HUS-0001', nrDocument: 'C-0001', versiune: 7 })).toBe('P/HUS/T3-HUS-0001/C-0001-v7.docx')
    expect(() => caleConvocator({ proiectCod: 'P', uat3: 'HUS', idParcela: 'X', nrDocument: 'C', versiune: 0 })).toThrow(/Versiune/)
    expect(() => caleConvocator({ proiectCod: 'P', uat3: 'HUS', idParcela: 'X', nrDocument: 'C', versiune: 1.5 })).toThrow(/Versiune/)
    expect(versiuneDinCale(null)).toBe(0)
    expect(versiuneDinCale('P/HUS/X/C-0001.docx')).toBe(0)
    expect(versiuneDinCale('P/HUS/X/C-0001-v3.docx')).toBe(3)
    expect(versiuneDinCale('P/HUS/X/C-0001-v12.pdf')).toBe(12)
  })

  it('ordinea: (1) insert fără path/hash → (2) upload v1 upsert false → (3) update cu path + hash', async () => {
    const { supabase, apeluri } = fake()
    const r = await salveazaConvocator(supabase, arg)
    expect(r).toEqual({ path: PATH, convocareId: 'uuid-fictiv-1' })
    expect(apeluri.map(a => a.tip)).toEqual(['insert', 'upload', 'update'])
    expect(apeluri[0]).toMatchObject({ tabel: 'red_convocari', col: 'id', rand: { detinator_id: 'det-1', canal: 'posta', nr_document: 'C-0001' } })
    expect(apeluri[0].rand).not.toHaveProperty('fisier_convocator_path')
    expect(apeluri[0].rand).not.toHaveProperty('continut_hash')
    expect(apeluri[1]).toMatchObject({ bucket: 'redari', path: PATH, size: 4, o: { contentType: MIME_DOCX, upsert: false } })
    expect(apeluri[2]).toMatchObject({ tabel: 'red_convocari', filtru: ['id', 'uuid-fictiv-1'], col: 'id', rand: { fisier_convocator_path: PATH, continut_hash: arg.hash } })
  })
  it('canal explicit; segment invalid în cale → eroare ÎNAINTE de orice apel (numărul nu se consumă)', async () => {
    const { supabase, apeluri } = fake()
    await salveazaConvocator(supabase, { ...arg, canal: 'email' })
    expect(apeluri[0].rand.canal).toBe('email')
    await expect(salveazaConvocator(supabase, { ...arg, idParcela: '../x' })).rejects.toThrow(/id_parcela/)
    expect(() => caleConvocator({ proiectCod: 'A', uat3: 'H/S', idParcela: 'P', nrDocument: 'C' })).toThrow(/uat3/)
    await expect(salveazaConvocator(supabase, { ...arg, hash: '' })).rejects.toThrow(/hash/)
    expect(apeluri).toHaveLength(3)
  })
  it('eroare la insert → niciun upload, mesaj în română', async () => {
    const a = fake({ eIns: 'duplicate key' })
    await expect(salveazaConvocator(a.supabase, arg)).rejects.toThrow(/red_convocari.*duplicate key/)
    expect(a.apeluri.map(x => x.tip)).toEqual(['insert'])
  })
  it('eroare la upload → rândul rămâne fără path (fără update), eroarea poartă convocareId + path', async () => {
    const a = fake({ eUp: 'bucket inexistent' })
    const e = await salveazaConvocator(a.supabase, arg).catch(x => x)
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toMatch(/uuid-fictiv-1.*storage.*bucket inexistent.*Reluați/)
    expect(e).toMatchObject({ convocareId: 'uuid-fictiv-1', path: PATH, pas: 'upload' })
    expect(a.apeluri.map(x => x.tip)).toEqual(['insert', 'upload'])
  })
  it('eroare la update (sau 0 rânduri) → mesaj cu calea și id-ul', async () => {
    const a = fake({ eUpd: 'permission denied' })
    const e = await salveazaConvocator(a.supabase, arg).catch(x => x)
    expect(e.message).toMatch(new RegExp(`${PATH}.*uuid-fictiv-1.*permission denied`))
    expect(e).toMatchObject({ pas: 'update' })
    const b = fake({ updZero: true })
    await expect(salveazaConvocator(b.supabase, arg)).rejects.toThrow(/niciun rând actualizat/)
  })
  it('reincarcaConvocator pe rând FĂRĂ fișier (path NULL): citește rândul, încarcă v1 (upsert false), update pe id-ul dat', async () => {
    const { supabase, apeluri } = fake({ caleCurenta: null })
    const r = await reincarcaConvocator(supabase, argRe)
    expect(r).toEqual({ path: PATH, convocareId: 'uuid-vechi', versiune: 1 })
    expect(apeluri.map(a => a.tip)).toEqual(['select', 'list', 'upload', 'update'])
    expect(apeluri[0]).toMatchObject({ tabel: 'red_convocari', filtru: ['id', 'uuid-vechi'] })
    expect(apeluri[0].col).toMatch(/fisier_convocator_path/)
    expect(apeluri[1]).toMatchObject({ bucket: 'redari', folder: 'LOT1-PRUNISOR-JUPA/HUS/T3-HUS-0001' })
    expect(apeluri[2]).toMatchObject({ bucket: 'redari', path: PATH, o: { contentType: MIME_DOCX, upsert: false } })
    expect(apeluri[3]).toMatchObject({ filtru: ['id', 'uuid-vechi'], rand: { fisier_convocator_path: PATH, continut_hash: arg.hash } })
    await expect(reincarcaConvocator(supabase, { blob: arg.blob, hash: arg.hash })).rejects.toThrow(/id-ul convocării/)
  })
  it('reincarcaConvocator pe rând CU fișier: versiunea următoare, calea veche nu se atinge (niciun upsert:true nicăieri)', async () => {
    const { supabase, apeluri } = fake({ caleCurenta: `${BAZA}-v3.docx`, existente: [`${BAZA}-v1.docx`, `${BAZA}-v2.docx`, `${BAZA}-v3.docx`] })
    const r = await reincarcaConvocator(supabase, argRe)
    expect(r).toEqual({ path: `${BAZA}-v4.docx`, convocareId: 'uuid-vechi', versiune: 4 })
    expect(apeluri.filter(a => a.tip === 'upload').map(a => a.path)).toEqual([`${BAZA}-v4.docx`])
    expect(apeluri.filter(a => a.tip === 'upload').every(a => a.o.upsert === false)).toBe(true)
    expect(apeluri.at(-1)).toMatchObject({ tip: 'update', rand: { fisier_convocator_path: `${BAZA}-v4.docx`, continut_hash: arg.hash } })
    // cale veche fără sufix de versiune (fișier dinainte de versionare) → prima versiune e v1
    const b = fake({ caleCurenta: `${BAZA}.docx` })
    expect((await reincarcaConvocator(b.supabase, argRe)).path).toBe(`${BAZA}-v1.docx`)
  })
  it('P2-1: două orfane (v1, v2) în bucket, rând fără path → listarea folderului dă max=2 → upload DIRECT pe v3', async () => {
    const a = fake({ caleCurenta: null, existente: [`${BAZA}-v1.docx`, `${BAZA}-v2.docx`, `${BAZA}-v1.pdf`, 'LOT1-PRUNISOR-JUPA/HUS/T3-HUS-0001/C-0002-v9.docx'] })
    const r = await reincarcaConvocator(a.supabase, argRe)
    expect(r).toEqual({ path: `${BAZA}-v3.docx`, convocareId: 'uuid-vechi', versiune: 3 })
    expect(a.apeluri.map(x => x.tip)).toEqual(['select', 'list', 'upload', 'update'])
    expect(a.apeluri[2].path).toBe(`${BAZA}-v3.docx`) // un singur upload, fără bâjbâit pe v1/v2; C-0002 și .pdf nu contează
    expect(a.apeluri.at(-1).rand.fisier_convocator_path).toBe(`${BAZA}-v3.docx`)
    // rândul spune v5 dar bucket-ul are max v2 → câștigă maximul dintre ele (v6)
    const b = fake({ caleCurenta: `${BAZA}-v5.docx`, existente: [`${BAZA}-v1.docx`, `${BAZA}-v2.docx`] })
    expect((await reincarcaConvocator(b.supabase, argRe)).versiune).toBe(6)
  })
  it('P2-1: listarea eșuează → încercări succesive cu upsert false; peste 20 ⇒ eroare clară, fără update', async () => {
    const a = fake({ caleCurenta: null, eList: 'list indisponibil', existente: [`${BAZA}-v1.docx`, `${BAZA}-v2.docx`] })
    const r = await reincarcaConvocator(a.supabase, argRe)
    expect(r).toEqual({ path: `${BAZA}-v3.docx`, convocareId: 'uuid-vechi', versiune: 3 })
    expect(a.apeluri.filter(x => x.tip === 'upload').map(x => x.path)).toEqual([`${BAZA}-v1.docx`, `${BAZA}-v2.docx`, `${BAZA}-v3.docx`])
    expect(a.apeluri.filter(x => x.tip === 'upload').every(x => x.o.upsert === false)).toBe(true)
    // 20 versiuni ocupate și listarea picată → exact 20 încercări, apoi eroare cu mesaj clar
    const ocupate = Array.from({ length: 25 }, (_, i) => `${BAZA}-v${i + 1}.docx`)
    const b = fake({ caleCurenta: null, eList: 'list indisponibil', existente: ocupate })
    const e = await reincarcaConvocator(b.supabase, argRe).catch(x => x)
    expect(e.message).toMatch(/20 versiuni consecutive/)
    expect(e).toMatchObject({ convocareId: 'uuid-vechi', path: `${BAZA}-v20.docx`, pas: 'upload' })
    expect(b.apeluri.filter(x => x.tip === 'upload')).toHaveLength(20)
    expect(b.apeluri.some(x => x.tip === 'update')).toBe(false)
    // listarea dă max=25 → direct v26, un singur upload
    const c = fake({ caleCurenta: null, existente: ocupate })
    expect((await reincarcaConvocator(c.supabase, argRe)).versiune).toBe(26)
    expect(c.apeluri.filter(x => x.tip === 'upload')).toHaveLength(1)
    // altă eroare de upload (nu „already exists”) → nu se reîncearcă
    const d = fake({ caleCurenta: null, eUp: 'bucket inexistent' })
    await expect(reincarcaConvocator(d.supabase, argRe)).rejects.toThrow(/bucket inexistent/)
    expect(d.apeluri.filter(x => x.tip === 'upload')).toHaveLength(1)
  })
  it('reincarcaConvocator: eroare la citirea rândului sau segment invalid ⇒ niciun upload', async () => {
    const a = fake({ eSel: 'permission denied' })
    await expect(reincarcaConvocator(a.supabase, argRe)).rejects.toThrow(/uuid-vechi.*permission denied/)
    expect(a.apeluri.map(x => x.tip)).toEqual(['select'])
    const b = fake()
    await expect(reincarcaConvocator(b.supabase, { ...argRe, uat3: 'H/S' })).rejects.toThrow(/uat3/)
    expect(b.apeluri).toHaveLength(0)
  })
  it('salveazaConvocator: v1 deja existentă (orfan) ⇒ eroare de upload cu convocareId, fără reîncercare (reluarea se face din reincarcaConvocator)', async () => {
    const a = fake({ existente: [PATH] })
    const e = await salveazaConvocator(a.supabase, arg).catch(x => x)
    expect(e).toMatchObject({ convocareId: 'uuid-fictiv-1', path: PATH, pas: 'upload' })
    expect(a.apeluri.map(x => x.tip)).toEqual(['insert', 'upload'])
  })
})
