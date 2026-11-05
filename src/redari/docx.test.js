// Redări teren — teste pentru src/redari/docx.js (contract §6 + §8). Date fictive, fără persoane reale.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, TextRun, Header } from 'docx'
import {
  completeazaDocx, genereazaQr, hashBlob, borderouCsv, celulaCsv, genereazaConvocator, verificaDateConvocator, salveazaConvocator,
  reincarcaConvocator, caleConvocator, versiuneDinCale, versiuneMaximaInBucket, formatDataRo, formatNumarRo, linkRaspuns, linkRaspunsCu, adresaDetinator, textGdprPentruUat,
  textGdprFataConvocator, TRIMITERE_VERSO_GDPR, VERSO_INFORMARE_INCLUS, FRAZE_VERSO, EroareTrimitereGdpr, adresaProprieInDocx, adresaWebNepermisa,
  MIME_DOCX, COLOANE_BORDEROU, CHEI_CONVOCATOR, ETICHETA_CALITATE, xmlVersoInformare, MESAJ_INFORMARE_NEGATA, MESAJ_INFORMARE_VERIFICARE_ESUATA,
} from './docx.js'
import { TEXT_INFORMARE_LOT1, autorizareTgzCompleta, informarePublicataPeProiect } from './informareGdpr.js'

const SABLON = resolve(process.cwd(), 'public/redari/sabloane/convocator.docx') // Model_1 v6, 35 placeholder-e (SABLOANE.md §2.1)
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

  it('șablonul REAL convocator.docx: cele 34 de câmpuri text + qr se completează strict, niciun {{ rămas', async () => {
    const chei = CHEI_CONVOCATOR.filter(k => k !== 'qr' && k !== 'id_parcela')
    expect(chei).toHaveLength(34)
    // decizia 03.11 seara: convocatorul prin poștă are doar QR, fără link tipărit
    expect(chei).not.toContain('link')
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
  it('linkRaspunsCu (doar teste) taie slash-ul final', () => {
    expect(linkRaspunsCu('https://pontaj-pro-sooty.vercel.app/', 'tok')).toBe('https://pontaj-pro-sooty.vercel.app/redari/raspuns/tok')
  })
  it('linkRaspuns(token) → mereu domeniul public redari.gazpet.ro', () => {
    expect(linkRaspuns('tok')).toBe('https://redari.gazpet.ro/redari/raspuns/tok')
    expect(linkRaspuns.length).toBe(1)
  })
})

// informare de test „aprobată”: textul real cu câmpurile [ ] completate fictiv și marcată publicată
const INFORMARE_APROBATA = { text: TEXT_INFORMARE_LOT1.replace(/\[[^\]]*\]/g, 'COMPLETAT'), publicata: true }
// #939 r2: câmpurile autorizării + indicatorul calculat de server (cuInformarePublicata → fn_red_informare_publicata), fără parametrul `informare`
const CAMPURI_AUT = { autorizare_tgz_nr: 'A-1 (fictiv)', autorizare_tgz_data: '2026-11-05', autorizare_tgz_fisier: 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_fictiv.pdf' }
const AUTORIZARE = { ...CAMPURI_AUT, informare_publicata: true }

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
    // calea „aprobată”; refuzul PROIECT are testele lui în blocul „verso”
    informare: INFORMARE_APROBATA,
  })

  it('linkul și QR-ul sunt pe https://redari.gazpet.ro: fără origin, cu origin străin, cu window.location.origin pe alt domeniu', async () => {
    const vechi = globalThis.window
    globalThis.window = { location: { origin: 'https://pontaj-pro-sooty.vercel.app', hostname: 'pontaj-pro-sooty.vercel.app' } }
    try {
      const { origin, ...faraOrigin } = complet()
      const asteptat = 'https://redari.gazpet.ro/redari/raspuns/tokenfictiv1234567890abcdefghijk'
      // QR-ul așteptat e generat independent, pentru linkul așteptat
      const qrAsteptat = (await genereazaQr(asteptat)).split(',')[1]
      const qrAltceva = (await genereazaQr('https://altceva/redari/raspuns/tokenfictiv1234567890abcdefghijk')).split(',')[1]
      for (const extra of [{}, { origin: 'https://altceva' }, { origin: 'https://pontaj-pro-sooty.vercel.app' }]) {
        const r = await genereazaConvocator({ ...faraOrigin, ...extra, templateArrayBuffer: citesteSablon() })
        expect(r.link, JSON.stringify(extra)).toBe(asteptat)
        // linkul nu mai intră în document (03.11 seara): nici cheie în câmpuri, nici text tipărit
        expect(r.campuri).not.toHaveProperty('link')
        const { zip, xml } = await xmlDin(r.blob, 'word/document.xml')
        expect(textDin(xml)).not.toContain(asteptat)
        expect(textDin(xml)).not.toMatch(/redari\.gazpet\.ro|https?:\/\//)
        const pngDoc = await zip.file('word/media/qr.png').async('base64')
        expect(pngDoc).toBe(qrAsteptat)
        expect(pngDoc).not.toBe(qrAltceva)
      }
    } finally {
      if (vechi === undefined) delete globalThis.window
      else globalThis.window = vechi
    }
  }, 10000)

  // #970 r2 + r6 + r18 + #939: fața poștală nu tipărește linkul informării; versoul se generează (#939), deci fața scoate frazele cunoscute
  // și pune O SINGURĂ trimitere la verso (textul avea o frază sau proiectul are informarea configurată). r18: orice altă trimitere oprește generarea
  it('VERSO_INFORMARE_INCLUS = true (#939): frazele cunoscute se scot, trimiterea la verso apare o singură dată pe față; QR-ul e același', async () => {
    expect(VERSO_INFORMARE_INCLUS).toBe(true)
    const asteptat = 'https://redari.gazpet.ro/redari/raspuns/tokenfictiv1234567890abcdefghijk'
    const qrAsteptat = (await genereazaQr(asteptat)).split(',')[1]
    const baza = complet()
    const cazuri = [
      [baza.proiect.text_gdpr, `Operatori: Gazpet și Primăria Husnicioara.\nDestinatari: Primăria Husnicioara.\n${TRIMITERE_VERSO_GDPR}`],
      [`Operatori: Gazpet și Primăria {uat}. ${FRAZE_VERSO[0]} Drepturi: acces.`, `Operatori: Gazpet și Primăria Husnicioara. Drepturi: acces.\n${TRIMITERE_VERSO_GDPR}`],
      ['Operatori: Gazpet. Informarea completă se află pe verso.', `Operatori: Gazpet.\n${TRIMITERE_VERSO_GDPR}`],
    ]
    for (const [text_gdpr, fata] of cazuri) {
      for (const permiteIncomplet of [false, true]) {
        const r = await genereazaConvocator({ ...baza, proiect: { ...baza.proiect, text_gdpr, link_informare_gdpr: 'https://example.invalid/informare' }, templateArrayBuffer: citesteSablon(), permiteIncomplet })
        expect(r.link).toBe(asteptat)
        expect(r.campuri.text_gdpr, text_gdpr).toBe(fata)
        const { zip, xml } = await xmlDin(r.blob, 'word/document.xml')
        const tot = textDin(xml), iVerso = tot.indexOf('Informare privind folosirea datelor personale')
        expect(iVerso).toBeGreaterThan(0)
        const fataDoc = tot.slice(0, iVerso)
        expect(tot).not.toMatch(/https?:\/\/|redari\.gazpet\.ro|example\.invalid/)
        expect(fataDoc).not.toMatch(/www\.|Informarea completă/)
        expect(fataDoc.split(TRIMITERE_VERSO_GDPR).length - 1).toBe(1)
        expect(await zip.file('word/media/qr.png').async('base64')).toBe(qrAsteptat)
      }
    }
    // fără frază cunoscută și fără informare configurată: textul rămâne cel din BD (doar UAT-ul înlocuit)
    expect(textGdprFataConvocator('Operatori: Primăria {uat}.', 'Godeanu', null)).toBe('Operatori: Primăria Godeanu.')
  }, 20000)

  // #970 r18: frazele cunoscute se recunosc literal (majuscule, diacritice, spații albe), restul textului rămâne NEATINS
  it('r18: frazele din FRAZE_VERSO se scot exact; câmpurile GDPR din jur rămân (pe rânduri, cu e-mailuri, cu litere mici)', () => {
    const cazuri = [
      [`Operatori: Transgaz\n${FRAZE_VERSO[0]}\nDrepturi: acces și opoziție.`, 'Operatori: Transgaz\nDrepturi: acces și opoziție.'],
      ['Operatori: Transgaz. PE VERSO GASITI INFORMATIILE COMPLETE DESPRE FOLOSIREA DATELOR SI DREPTURILE DUMNEAVOASTRA. drepturi: acces.', 'Operatori: Transgaz. drepturi: acces.'],
      ['Operatori: Transgaz.\r\nPe verso găsiți informațiile\r\ncomplete despre folosirea datelor și drepturile dumneavoastră.\r\nContact DPO: dpo@exemplu.ro', 'Operatori: Transgaz.\nContact DPO: dpo@exemplu.ro'],
      ['Operatori: Transgaz. Informarea  completă se află pe verso. scop: convocarea.', 'Operatori: Transgaz. scop: convocarea.'],
      ['Operatori: Transgaz. Informarea completa se afla pe verso.', 'Operatori: Transgaz.'],
      // fără frază: identic, inclusiv rândurile și „Versoix” (nu e cuvântul „verso”)
      ['Operatori: Gazpet.\nDrepturi: acces.', 'Operatori: Gazpet.\nDrepturi: acces.'],
      ['Sediul: Versoix. Drepturi: acces.', 'Sediul: Versoix. Drepturi: acces.'],
    ]
    // regula literală de scoatere, cu versoul oprit (cu versoul pornit se adaugă trimiterea; vezi testul „versoInclus = true”)
    for (const [text, fata] of cazuri) expect(textGdprFataConvocator(text, 'G', 'https://x.invalid', { versoInclus: false }), text).toBe(fata)
  })

  it('r18: orice altă trimitere la verso / la „Informarea completă” oprește generarea (nimic nu se taie pe ghicite)', async () => {
    const refuzate = [
      'Operatori: Gazpet. Informarea completă: https://x.invalid/a. Drepturi: acces.',
      'Operatori: Transgaz\nInformarea completă:\ndrepturi: acces și opoziție.',
      'Operatori: Transgaz\nInformarea completă:\nContact DPO: dpo@exemplu.ro\nDrepturi: acces.',
      'Operatori: Gazpet.\nInformarea completă:\nConsultați www.dataprotection.ro pentru informare.',
      'Operatori: Gazpet. Informarea completă: [link scurt] poate fi consultată la primărie.',
      'Operatori: Gazpet. Pe verso găsiți informațiile complete.',
      'Operatori: Gazpet. Informații despre date: PE VERSO!',
      'Operatori: Gazpet. Informarea completă se află\npe verso, la pagina 2.',
      // r19 (Copilot r18 P2-01): formele articulate și „reversul”
      'Operatori: Gazpet. Pe versoul convocatorului găsiți informațiile privind utilizarea datelor.',
      'Operatori: Gazpet. Detalii în VERSOUL scrisorii.', 'Operatori: Gazpet. Pe reversul documentului găsiți detalii.',
      `Operatori: Gazpet. ${FRAZE_VERSO[0]}x`,
    ]
    for (const text of refuzate) {
      expect(() => textGdprFataConvocator(text, 'G', null), text).toThrow(EroareTrimitereGdpr)
      expect(() => textGdprFataConvocator(text, 'G', null, { versoInclus: true }), text).toThrow(/trimite la informarea completă sau la verso/)
    }
    const baza = complet()
    for (const permiteIncomplet of [false, true]) {
      await expect(genereazaConvocator({ ...baza, proiect: { ...baza.proiect, text_gdpr: refuzate[1] }, templateArrayBuffer: citesteSablon(), permiteIncomplet }))
        .rejects.toThrow(/Scoateți fraza din text/)
    }
  }, 10000)

  it('versoInclus = true (#939): trimiterea la verso se adaugă o singură dată, la final, cu fraza cunoscută sau cu informarea configurată', () => {
    const v = { versoInclus: true }
    expect(textGdprFataConvocator(`A. ${FRAZE_VERSO[0]} B.`, 'G', null, v)).toBe(`A. B.\n${TRIMITERE_VERSO_GDPR}`)
    expect(textGdprFataConvocator('Operatori: {uat}.', 'G', 'https://x.invalid', v)).toBe(`Operatori: G.\n${TRIMITERE_VERSO_GDPR}`)
    expect(textGdprFataConvocator('Operatori: {uat}.', 'G', null, v)).toBe('Operatori: G.')
    expect(textGdprFataConvocator(`A. ${TRIMITERE_VERSO_GDPR}`, 'G', 'https://x.invalid', v)).toBe(`A.\n${TRIMITERE_VERSO_GDPR}`)
    expect(textGdprFataConvocator(TRIMITERE_VERSO_GDPR, 'G', null, v)).toBe(TRIMITERE_VERSO_GDPR)
  })

  // #970 r6–r8: politica adreselor web (regula literală din r8), prin genereazaConvocator, strict și cu permiteIncomplet
  it('politica adreselor: domeniile / căile noastre și orice alt URL refuzate; e-mailurile și excepțiile literale dataprotection.ro permise', async () => {
    const baza = complet()
    const gen = (text_gdpr, permiteIncomplet) => genereazaConvocator({ ...baza, proiect: { ...baza.proiect, text_gdpr }, templateArrayBuffer: citesteSablon(), permiteIncomplet })
    const PROPRII = /adrese web proprii/
    const EXTERNE = /adrese web externe neaprobate.*permise doar: dataprotection\.ro, www\.dataprotection\.ro/
    const refuzate = [
      ['Detalii: gazpet.ro/gdpr oricând.', /adrese web proprii.*„gazpet\.ro”, în word\/document\.xml/],
      ['Detalii: www.gazpet.ro/x.', PROPRII],
      ['Documente pe portal.gazpet.ro.', PROPRII],
      ['Răspuns la https://redari.gazpet.ro/redari/raspuns/abc.', PROPRII],
      ['Detalii la https://pontaj-pro-sooty.vercel.app/x.', /adrese web proprii.*„vercel\.app”/],
      ['Vezi alt-proiect.vercel.app.', PROPRII],
      ['Formular: https://exemplu.invalid/redari/raspuns/tok.', /adrese web proprii.*„\/redari\/raspuns”/],
      ['Informare: exemplu.invalid/redari/informare.', /adrese web proprii.*„\/redari\/informare”/],
      ['Sistem pontaj-pro intern.', /adrese web proprii.*„pontaj-pro”/],
      ['Detalii la https://exemplu.com.', /adrese web externe neaprobate.*„:\/\/”/],
      ['Detalii la www.alt-site.ro.', /adrese web externe neaprobate.*„www”/],
      // #970 r8 (Jakarinos P2-01 + P2-02): schemă, port, utilizator, IP, userinfo, domeniu lipit după excepție
      ['Detalii la ftp://dataprotection.ro/x.', EXTERNE],
      ['Detalii la custom://dataprotection.ro/x.', EXTERNE],
      ['Detalii la https://dataprotection.ro:443/x.', EXTERNE],
      ['Detalii la https://www.dataprotection.ro:8443/x.', EXTERNE],
      ['Detalii la https://ion@dataprotection.ro/x.', EXTERNE],
      ['Detalii la https://192.168.1.10/x.', EXTERNE],
      // r15: urmat de cale nu e e-mail, deci „gazpet.ro” e adresă proprie
      ['Detalii la https://gazpet.ro@example.com/x.', PROPRII],
      ['Detalii la https://dataprotection.ro.example.com/x.', EXTERNE],
      ['Detalii la xhttps://dataprotection.ro/x.', EXTERNE],
      // #970 r12: tokenuri — URL-uri externe fără schemă, terminații oarecare
      ['Detalii la exemplu.ro.xyz/gdpr.', EXTERNE],
      ['Detalii la portal.com.uk/gdpr.', EXTERNE],
      ['Detalii la dataprotection.ro.a.com/gdpr.', EXTERNE],
      ['Detalii la a.ro și x.y.com.', EXTERNE],
      // #970 r13
      ['Detalii la exemplu.ro?formular=1 sau exemplu.ro#informare.', EXTERNE],
      ['Site:www.exemplu.ro', EXTERNE],
      ['Info:https://exemplu.ro', EXTERNE],
      // #970 r14
      ['Detalii la https://dataprotection.ro:parola@exemplu.ro', EXTERNE],
      ['Detalii la Site:exemplu.ro și exemplu.ro#informare.', EXTERNE],
      // #970 r9: URL lipit de un e-mail cu virgulă / punct și virgulă
      ['Site: www.gazpet.ro,contact@example.com', PROPRII],
      ['Site: www.exemplu.ro,contact@example.com', EXTERNE],
      ['Site: www.gazpet.ro;a@b.ro', PROPRII],
    ]
    for (const [text_gdpr, eroare] of refuzate) {
      for (const permiteIncomplet of [false, true]) await expect(gen(text_gdpr, permiteIncomplet), `${text_gdpr} ${permiteIncomplet}`).rejects.toThrow(eroare)
    }
    const permise = [
      'Întrebări la redari@gazpet.ro sau la ion.popescu@portal.gazpet.ro.',
      'Întrebări la redari@www.gazpet.ro sau la ion@www.dataprotection.ro.',
      'Contact: contact@example.com',
      'Aveți dreptul să depuneți plângere la ANSPDCP (www.dataprotection.ro) sau la https://www.dataprotection.ro.',
      'Plângere la ANSPDCP: HTTPS://WWW.DATAPROTECTION.RO sau https://dataprotection.ro/index.jsp?page=plangeri.',
      'Plângere la http://www.dataprotection.ro, „https://dataprotection.ro”; detalii: www.dataprotection.ro/legislatie!',
      'Operatori: S.N.T.G.N. Transgaz S.A. și Gazpet Instal S.R.L., art. 6 alin. (1) lit. c din Regulamentul (UE) 2016/679.',
    ]
    for (const text_gdpr of permise) {
      for (const permiteIncomplet of [false, true]) {
        const r = await gen(text_gdpr, permiteIncomplet)
        // fără marcaj „Informarea completă”, textul rămâne neschimbat
        expect(r.campuri.text_gdpr).toBe(text_gdpr)
        const { xml } = await xmlDin(r.blob, 'word/document.xml')
        expect(textDin(xml)).toContain(text_gdpr)
      }
    }
  }, 30000)

  it('adresaWebNepermisa (regula literală r15): proprii, e-mailuri, excepții cu margini stricte, apoi „://” / „www” / domeniu', () => {
    // adresele proprii: subșir pe textul fără e-mailuri, înaintea excepțiilor (și în calea unui URL permis)
    for (const t of ['www.gazpet.ro', 'Site: www.gazpet.ro,contact@example.com', 'www.gazpet.ro;a@b.ro', 'https://dataprotection.ro/redari.gazpet.ro/x',
      'Vezi https://dataprotection.ro/redirect?next=www.gazpet.ro pentru informare.', 'https://dataprotection.ro/redari/raspuns/abc', 'www.dataprotection.ro/x/pontaj-pro',
      'Detalii la https://pontaj-pro-sooty.vercel.app/x']) {
      expect(adresaWebNepermisa(t)?.categorie, t).toBe('proprie')
    }
    expect(adresaWebNepermisa('www.gazpet.ro')).toEqual({ adresa: 'gazpet.ro', categorie: 'proprie' })
    // refuzate (r8–r15): orice altă adresă web, inclusiv lista albă cu margini nepermise
    const refuzate = [
      // r15 (Jakarinos): „www” lipit, utilizator, parolă, port, etichetă lipită de domeniu
      'evil.www.dataprotection.ro/x', 'evilwww.dataprotection.ro', 'user@www.dataprotection.ro/x', 'https://dataprotection.ro:parola@exemplu.ro',
      'https://dataprotection.ro:443/x', 'exemplu.ro:dataprotection.ro', 'exemplu.ro:detalii', 'exemplu.ro?x', 'Site:www.exemplu.ro',
      'dataprotection.ro.a.com', 'portal.com.uk',
      // rundele anterioare
      'https://ion@dataprotection.ro/x', 'https://gazpet.ro@example.com/x', 'https://192.168.1.10/x', 'ftp://dataprotection.ro/x', 'custom://dataprotection.ro/x',
      'http://[::1]/x', 'https://dataprotection.ro:parola@dataprotection.ro/x', 'Info:xhttps://dataprotection.ro/x', 'www.dataprotection.ro:8080', 'www.ion@dataprotection.ro/x',
      'dataprotection.ro.xyz/gdpr.', 'evil-dataprotection.ro.', 'www.dataprotection.ro.evil.com', 'https://dataprotection.ro.x.ro/', 'exemplu.ro.xyz/gdpr',
      'exemplu.ro?formular=1', 'exemplu.ro#informare', 'Site:exemplu.ro', 'Info:https://exemplu.ro', 'dataprotection.ro:443/x', 'Info:www.dataprotection.ro.evil.com',
      'Politica la portal.transgaz.ro/gdpr.', 'Vezi exemplu.ro/pagina', 'Vezi EXEMPLU.COM.', 'Detalii: anpc.gov.ro', 'Detalii la site.info', 'a.ro', 'x.y.com',
      'dataprotection.ro-evil.ro', 'www.exemplu.ro,contact@example.com', 'Scrieți la www.x@exemplu.ro', 'Primăria.Comuna',
      // margini stricte (r15): lipite de „:” — nu e un caz real în textul GDPR, se scrie cu spațiu după „:”
      'Plângere:dataprotection.ro.', 'Vezi Info:https://www.dataprotection.ro/a#b:c.ro',
      // r16 (Jakarinos P2-01): e-mail urmat de port / interogare / ancoră nu mai e e-mail
      'user@www.exemplu.ro:8080/x', 'user@www.exemplu.ro?formular=1', 'user@www.exemplu.ro#informare', 'a@exemplu.ro:443', 'a@exemplu.ro).x',
      // r17 (Copilot P2-01): IPv4 fără schemă
      'Detalii la 192.168.1.10/gdpr.', '10.0.0.1', 'Vezi 255.255.255.255:8080', '(8.8.8.8)',
      // r18 (Copilot r17 P2-02): domenii internaționalizate fără schemă
      'Detalii la primărie.ro/gdpr', 'Vezi пример.рф', 'Detalii: exemplu.ελ.', 'Vezi ex.ăîș',
      // r19 (Jakarinos r18 P2-01 + Copilot r18 P2-02): IDN cu semne combinante, separatoare IDNA, caractere lățite
      'Detalii: example.भारत/gdpr', 'Vezi example.বাংলা', 'redari。gazpet。ro', 'ｐｏｒｔａｌ．ｃｏｍ', 'portal｡com', 'ｗｗｗ.exemplu.ro',
    ]
    // refuzate: neaprobate sau proprii („https://gazpet.ro@example.com/x” — nu e e-mail, deci „gazpet.ro” e adresă proprie)
    for (const t of refuzate) expect(adresaWebNepermisa(t), t).not.toBeNull()
    // permise
    const permise = [
      '(www.dataprotection.ro)', 'Plângere: www.dataprotection.ro.', 'https://dataprotection.ro/legislatie/art:exemplu.ro', 'HTTPS://WWW.DATAPROTECTION.RO',
      'redari@www.gazpet.ro', 'ion@www.dataprotection.ro', 'contact@example.com', 'https://dataprotection.ro/index.jsp?page=plangeri',
      'Scrieți la (contact@example.com), „redari@gazpet.ro”; ion@www.dataprotection.ro.', 'Plângere la ANSPDCP (dataprotection.ro).', 'Plângere la dataprotection.ro',
      'Vezi www.dataprotection.ro/legislatie', 'Vezi dataprotection.ro/legislatie, apoi acces.', 'Vezi dataprotection.ro/legislatie/dataprotection.ro.pdf.',
      'Vezi https://dataprotection.ro/?referinta=art:exemplu.ro', 'Info:(www.dataprotection.ro)', 'Plângere la ANSPDCP (www.dataprotection.ro).',
      // r15 (Copilot P3-01): etichete lipite de un e-mail valid
      'E-mail:redari@gazpet.ro', 'Email:redari@gazpet.ro', 'Contact:ion@exemplu.ro', 'E-mail:contact@example.com',
      // r16: e-mail urmat de semne de punctuație și spațiu / final rămâne e-mail
      'Scrieți la ion@exemplu.ro: luni-vineri.', 'Scrieți la ion@exemplu.ro?', '(ion@exemplu.ro).', '„ion@exemplu.ro”, apoi', 'ion@exemplu.ro!',
    ]
    for (const t of permise) expect(adresaWebNepermisa(t), t).toBeNull()
    // fără alarme false pe textul juridic: abrevieri, articole, numere, default-ul text_gdpr din BD (migrarea 20261126a) și
    // textul scurt din Model_1 v6
    const juridic = [
      'S.N.T.G.N. S.R.L. A.P.M. H.G. lit.c art.6 pct.5.2 Nr.:12 03.11.2026 13.00 13.00–16.00 ș.a. [UAT].',
      'Data:03.11.2026 Tel:0244 435 005 ora:13.00 Nr.:12',
      'Operatori: S.N.T.G.N. TRANSGAZ S.A. și GAZPET INSTAL S.R.L., art. 6 alin. (1) lit. c din Regulamentul (UE) 2016/679.',
      'Nr. 123/2026 din 03.11.2026; Primăria Comunei X. A.P.M. Mehedinți; lit.c; art.6; H.G. nr. 1.234/2022; pct. 5.2.',
      'Operatori: S.N.T.G.N. TRANSGAZ S.A. (inițiatorul proiectului) și GAZPET INSTAL S.R.L. (împuternicit pentru organizarea convocării). Scop: constatarea readucerii terenului la starea inițială. Temei: Legea nr. 185/2016, art. 11 alin. (4), și interesul public al proiectului de importanță națională. Sursa datelor: baza de date a TRANSGAZ privind deținătorii de teren. Destinatari: Primăria [UAT], A.P.M. Mehedinți. Păstrare: pe durata contractului și a termenelor legale de arhivare. Drepturi: acces, rectificare, opoziție, plângere la ANSPDCP (www.dataprotection.ro).',
      'Transgaz folosește datele dumneavoastră ca să organizeze verificarea terenului după lucrările la conducta de gaze. Gazpet Instal vă trimite această convocare în numele Transgaz. Datele nu sunt folosite pentru reclamă.',
    ]
    for (const t of juridic) expect(adresaWebNepermisa(t), t).toBeNull()
    // pe textul concatenat (doarProprii) contează doar adresele proprii
    expect(adresaWebNepermisa('https://exemplu.com', { doarProprii: true })).toBeNull()
    expect(adresaWebNepermisa('https://redari.gazpet.ro', { doarProprii: true })).toEqual({ adresa: 'gazpet.ro', categorie: 'proprie' })
  })

  // #970 r15 (Copilot P2-02) + #939: cu versoul generat, un text_gdpr format doar din trimiteri la verso lasă pe față O trimitere (nu se golește);
  // cu versoul oprit, regula veche dă fața goală (postcondiția din genereazaConvocator rămâne plasă de siguranță)
  it('#939: text_gdpr format doar din trimiteri la verso → pe față rămâne o singură trimitere (strict și la previzualizare)', async () => {
    const baza = complet()
    for (const text_gdpr of [FRAZE_VERSO[0], TRIMITERE_VERSO_GDPR, `${FRAZE_VERSO[0]}
${TRIMITERE_VERSO_GDPR}`]) {
      for (const permiteIncomplet of [false, true]) {
        const r = await genereazaConvocator({ ...baza, proiect: { ...baza.proiect, text_gdpr }, templateArrayBuffer: citesteSablon(), permiteIncomplet })
        expect(r.campuri.text_gdpr, text_gdpr).toBe(TRIMITERE_VERSO_GDPR)
      }
      expect(textGdprFataConvocator(text_gdpr, 'G', null, { versoInclus: false }), text_gdpr).toBe('')
    }
  }, 10000)

  it('P3-03: mesajul de eroare nu conține text din document, doar partea și domeniul', async () => {
    const baza = complet()
    const text_gdpr = 'Date fictive POPESCU ION, CNP-fictiv 000, detalii la https://redari.gazpet.ro/redari/raspuns/tokenSecret.'
    const e = await genereazaConvocator({ ...baza, proiect: { ...baza.proiect, text_gdpr }, templateArrayBuffer: citesteSablon() }).catch(x => x)
    expect(e.message).toMatch(/„gazpet\.ro”, în word\/document\.xml/)
    expect(e.message).not.toMatch(/POPESCU|CNP|tokenSecret|raspuns/)
  }, 10000)

  // #970 r4 / r5 / r6: garda citește textul decodat și reunit pe paragraf, în toate părțile tipăribile, și casetele de text
  const sablonCu = async (parti) => {
    const zip = await JSZip.loadAsync(citesteSablon())
    for (const [cale, f] of Object.entries(parti)) zip.file(cale, f(await zip.file(cale)?.async('string')))
    return zip.generateAsync({ type: 'arraybuffer' })
  }
  const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const inainteDeSect = p => x => x.replace(/<w:sectPr[\s>]/, m => p + m)
  // fiecare run luat separat nu conține nicio adresă; reunite pe paragraf dau https://redari.gazpet.ro/redari/raspuns/abc
  const P_SPART = '<w:p><w:r><w:t>Răspuns: https://redari.</w:t></w:r><w:r><w:t>gazpet.ro/redari/</w:t></w:r><w:r><w:t>raspuns/abc</w:t></w:r></w:p>'
  const caseta = text => `<w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>`

  it('garda: adresă proprie spartă în 3 run-uri în corp → refuzată (și găsită de adresaProprieInDocx); entitățile XML se decodează', async () => {
    const t = await sablonCu({ 'word/document.xml': inainteDeSect(P_SPART) })
    expect(await adresaProprieInDocx(t)).toEqual({ parte: 'word/document.xml', adresa: 'gazpet.ro', categorie: 'proprie' })
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t })).rejects.toThrow(/adrese web proprii.*gazpet\.ro.*word\/document\.xml/)
    const ent = await sablonCu({ 'word/document.xml': inainteDeSect('<w:p><w:r><w:t>pontaj&#45;pro</w:t></w:r></w:p>') })
    expect((await adresaProprieInDocx(ent))?.adresa).toBe('pontaj-pro')
  }, 10000)

  // #970 r7 (Jakarinos P2-03): mc:Fallback și w:pict se verifică separat (nu doar se scot din fluxul exterior); un URL extern
  // neaprobat doar în Fallback (în afara unei casete) e prins de verificarea lor, nu de textul concatenat
  it('garda: URL extern neaprobat / adresă proprie doar în mc:Fallback sau w:pict → refuzate; dataprotection.ro acolo trece', async () => {
    const alternativ = text => '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Text curat</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>' +
      `<mc:Fallback><w:pict><v:shape><w:r><w:t>${text}</w:t></w:r></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`
    const doarPict = text => `<w:p><w:r><w:pict><v:shape><w:r><w:t>${text}</w:t></w:r></v:shape></w:pict></w:r></w:p>`
    for (const [p, adresa, categorie] of [[alternativ('Vezi https://exemplu.com/x'), '://', 'neaprobata'], [alternativ('Vezi portal.gazpet.ro'), 'gazpet.ro', 'proprie'], [doarPict('Vezi https://exemplu.com/x'), '://', 'neaprobata']]) {
      const t = await sablonCu({ 'word/document.xml': inainteDeSect(p) })
      expect(await adresaProprieInDocx(t), p).toEqual({ parte: 'word/document.xml', adresa, categorie })
      await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t })).rejects.toThrow(/Convocatorul poștal nu poate tipări adrese web/)
    }
    const ok = await sablonCu({ 'word/document.xml': inainteDeSect(alternativ('Plângere la ANSPDCP (www.dataprotection.ro)')) })
    expect(await adresaProprieInDocx(ok)).toBeNull()
  }, 10000)

  it('garda: casete de text — paragraf exterior cu adresă + casetă, adresă spartă ÎN JURUL casetei, adresă în casetă → refuzate; dataprotection.ro trece', async () => {
    const refuzate = [
      ['<w:p><w:r><w:t>Răspuns: https://redari.gazpet.ro/x</w:t></w:r>' + caseta('Text caseta') + '</w:p>', 'gazpet.ro'],
      // Jakarinos r5: https://redari.gaz + caseta + pet.ro/x (concatenarea completă dă „gazText casetapet.ro”)
      ['<w:p><w:r><w:t>https://redari.gaz</w:t></w:r>' + caseta('Text caseta') + '<w:r><w:t>pet.ro/x</w:t></w:r></w:p>', 'gazpet.ro'],
      ['<w:p><w:r><w:t>Text exterior</w:t></w:r>' + caseta('Vezi portal.gazpet.ro') + '</w:p>', 'gazpet.ro'],
    ]
    for (const [p, adresa] of refuzate) {
      const t = await sablonCu({ 'word/document.xml': inainteDeSect(p) })
      expect(await adresaProprieInDocx(t), p).toEqual({ parte: 'word/document.xml', adresa, categorie: 'proprie' })
      await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t })).rejects.toThrow(/adrese web proprii.*word\/document\.xml/)
    }
    const ok = await sablonCu({ 'word/document.xml': inainteDeSect('<w:p><w:r><w:t>Plângere la ANSPDCP (www.data</w:t></w:r>' + caseta('Text caseta') + '<w:r><w:t>protection.ro)</w:t></w:r></w:p>') })
    expect(await adresaProprieInDocx(ok)).toBeNull()
    expect((await genereazaConvocator({ ...complet(), templateArrayBuffer: ok })).blob.size).toBeGreaterThan(0)
  }, 10000)

  it('garda: antet (prin câmp, completeazaDocx), subsol, note și comentarii → găsite / refuzate; altChunk → refuzat', async () => {
    // antet completat printr-un câmp, pe un șablon de test construit în memorie
    const zip = new JSZip()
    zip.file('word/document.xml', `<w:document ${NS_W}><w:body><w:p><w:r><w:t>Corp curat</w:t></w:r></w:p></w:body></w:document>`)
    zip.file('word/header1.xml', `<w:hdr ${NS_W}><w:p><w:r><w:t>{{adresa_web}}</w:t></w:r></w:p></w:hdr>`)
    const completat = await completeazaDocx(await zip.generateAsync({ type: 'arraybuffer' }), { adresa_web: 'https://pontaj-pro-sooty.vercel.app/x' }, { strict: true })
    expect(await adresaProprieInDocx(completat)).toEqual({ parte: 'word/header1.xml', adresa: 'vercel.app', categorie: 'proprie' })
    const curat = await completeazaDocx(await zip.generateAsync({ type: 'arraybuffer' }), { adresa_web: 'www.dataprotection.ro' }, { strict: true })
    expect(await adresaProprieInDocx(curat)).toBeNull()
    // subsol, note de subsol / final și comentarii pe convocatorul real: genereazaConvocator refuză și numește partea
    for (const parte of ['word/footer1.xml', 'word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml']) {
      const t = await sablonCu({ [parte]: () => `<w:ftr ${NS_W}>${P_SPART}</w:ftr>` })
      await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: t }), parte).rejects.toThrow(new RegExp(`adrese web proprii.*${parte.replace(/[./]/g, '\\$&')}`))
    }
    const alt = await sablonCu({ 'word/document.xml': inainteDeSect('<w:altChunk r:id="rIdX"/>') })
    expect((await adresaProprieInDocx(alt))?.categorie).toBe('neverificat')
    await expect(genereazaConvocator({ ...complet(), templateArrayBuffer: alt })).rejects.toThrow(/nu poate fi verificat.*altChunk/)
  }, 20000)

  it('construiește toate cele 35 de chei (SABLOANE.md §2.1), QR (linkul doar în rezultat), hash; șablonul real completat strict, 0 placeholder-e rămase', async () => {
    const r = await genereazaConvocator({ ...complet(), templateArrayBuffer: citesteSablon() })
    // origin din complet() e ignorat: linkul e mereu pe domeniul public
    expect(r.link).toBe('https://redari.gazpet.ro/redari/raspuns/tokenfictiv1234567890abcdefghijk')
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
    // sate_zi lipsă → gol, fără eroare (reprezentant_tgz_telefon e obligatoriu din D3: șablonul tipărește „tel. {{reprezentant_tgz_telefon}}”)
    const l = verificaDateConvocator({ ...complet(), uat: { ...complet().uat, sate_zi1: undefined } })
    expect(l).toEqual([])
  })

  it('verificaDateConvocator listează toate lipsurile, inclusiv cele noi (contract, împuternicire, calitate, adresă)', () => {
    expect(verificaDateConvocator(complet())).toEqual([])
    const l = verificaDateConvocator({ nrDocument: '', token: null, uat: { sesiune_zi1: '2026-11-10' }, contact: {}, proiect: {}, detinator: null, informare: INFORMARE_APROBATA })
    expect(l).toHaveLength(12)   // D3: nume, telefon și e-mail de contact + telefonul TGZ, fiecare separat
    expect(l.join(' | ')).toMatch(/nr_document.*token.*contract.*împuternicir.*deținătorul.*zi de sesiune cu program.*persoana de contact.*telefonul de contact.*e-mailul de contact.*GDPR.*Transgaz.*telefonul reprezentantului Transgaz/)
    // zi fără program nu e suficientă; contactul poate veni din proiect
    expect(verificaDateConvocator({ ...complet(), uat: { sesiune_zi1: '2026-11-10', program_zi2: 'x' } })).toHaveLength(1)
    expect(verificaDateConvocator({ ...complet(), contact: null, proiect: { ...complet().proiect, contact_nume: 'N', contact_telefon: '07', contact_email: 'a@b.test' } })).toEqual([])
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

  it('D3: garda cere exact câmpurile de contact tipărite de șablon (fără „la telefon  sau…” / „tel. ,”) și spune unde se completează', async () => {
    const t = citesteSablon()
    const sablon = textDin((await xmlDin(new Blob([t]), 'word/document.xml')).xml)
    // șablonul tipărește fiecare câmp — de aceea fiecare e obligatoriu
    expect(sablon).toContain('la telefon {{contact_telefon}} sau')
    expect(sablon).toContain('Contact GAZPET INSTAL: {{contact_nume}}, tel. {{contact_telefon}}, e-mail {{contact_email}}')
    expect(sablon).toContain('{{reprezentant_tgz}}, tel. {{reprezentant_tgz_telefon}}')
    const faraContact = { ...complet(), contact: null }
    const pr = complet().proiect
    for (const [cheie, rx] of [['contact_nume', /persoana de contact Gazpet/], ['contact_telefon', /telefonul de contact Gazpet/], ['contact_email', /e-mailul de contact Gazpet/]]) {
      const proiect = { ...pr, contact_nume: 'N', contact_telefon: '07', contact_email: 'a@b.test', [cheie]: '  ' }
      const l = verificaDateConvocator({ ...faraContact, proiect })
      expect(l, cheie).toHaveLength(1)
      expect(l[0]).toMatch(rx)
      expect(l[0]).toMatch(/Setări proiect/)
      await expect(genereazaConvocator({ ...faraContact, proiect, templateArrayBuffer: t })).rejects.toThrow(rx)
    }
    // contactul trimis explicit are prioritate; un câmp gol acolo NU e completat din proiect (e exact ce s-ar tipări)
    expect(verificaDateConvocator({ ...complet(), contact: { ...complet().contact, telefon: '' }, proiect: { ...pr, contact_telefon: '07' } }).join()).toMatch(/telefonul de contact/)
    const l = verificaDateConvocator({ ...complet(), proiect: { ...pr, reprezentant_tgz_telefon: ' ' } })
    expect(l).toHaveLength(1)
    expect(l[0]).toMatch(/telefonul reprezentantului Transgaz.*Setări proiect/)
    // cu toate câmpurile: nicio frază ruptă în documentul completat
    const r = await genereazaConvocator({ ...complet(), templateArrayBuffer: t })
    const text = textDin((await xmlDin(r.blob, 'word/document.xml')).xml)
    expect(text).not.toMatch(/la telefon\s+sau|tel\.\s*,|e-mail\s*Contact TRANSGAZ/)
    expect(text).toContain('la telefon 0700000000 sau')
    expect(text).toContain('Contact GAZPET INSTAL: Operator Test, tel. 0700000000, e-mail redari@exemplu.test')
    expect(text).toContain('Reprezentant Test, inginer, tel. 0711111111')
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
    expect(prev.lipsuri.length).toBe(7) // contract, împuternicire, adresă, zi cu program, GDPR, reprezentant TGZ, telefon reprezentant TGZ
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

// XML bine format (fără parser în mediul node): fiecare tag deschis se închide în ordine, iar & apare doar ca entitate
const xmlBineFormat = (xml) => {
  const corp = xml.replace(/^<\?xml[^>]*\?>/, '')
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(corp)) return false
  const stiva = []
  for (const m of corp.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (m[3]) continue
    if (!m[1]) stiva.push(m[2])
    else if (stiva.pop() !== m[2]) return false
  }
  return stiva.length === 0 && !/<[^>]*</.test(corp.replace(/<[^<>]*>/g, ''))
}

describe('verso convocator: informarea GDPR completă', () => {
  const baza = () => ({
    detinator: { nume: 'POPESCU ION (fictiv)', calitate: 'proprietar' },
    contactDetinator: { adresa_strada: 'Str. Fictivă nr. 1', adresa_comuna: 'Husnicioara', adresa_judet: 'Mehedinți', cod_postal: '227001', adresa_cunoscuta: true },
    contact: { nume: 'Operator Test', telefon: '0700000000', email: 'redari@exemplu.test' },
    parcela: { id_parcela: 'T3-HUS-0001', tronson: 3 },
    uat: { nume: 'Husnicioara', sesiune_zi1: '2026-11-10', program_zi1: '09-12' },
    proiect: { denumire: 'Conductă test Lot 1', contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: '12', imputernicire_data: '2026-10-15',
      reprezentant_tgz_nume: 'Reprezentant Test', reprezentant_tgz_telefon: '0711111111', text_gdpr: 'Text scurt de pe față {uat}.' },
    nrDocument: 'C-0001', token: 'tokenfictiv1234567890abcdefghijk', origin: 'https://exemplu.test', dataDocument: '2026-11-02',
  })

  it('cât informarea e PROIECT: verificarea și generarea strictă refuză (înainte de numărul de document), previzualizarea merge cu marcaj', async () => {
    expect(autorizareTgzCompleta(baza().proiect)).toBe(false)
    expect(verificaDateConvocator(baza())).toEqual([MESAJ_INFORMARE_NEGATA])
    await expect(genereazaConvocator({ ...baza(), templateArrayBuffer: citesteSablon() })).rejects.toThrow(/informarea GDPR de pe verso nu e publicată: lipsește autorizarea Transgaz/)
    // publicată, dar cu câmpuri [ ] rămase → tot refuz (v3.2 nu mai are câmpuri: se adaugă unul de test)
    const cuCamp = `${TEXT_INFORMARE_LOT1}\n\nSursa [de confirmat].`
    expect(verificaDateConvocator({ ...baza(), informare: { text: cuCamp, publicata: true } })).toEqual([MESAJ_INFORMARE_NEGATA])
    const prev = await genereazaConvocator({ ...baza(), templateArrayBuffer: citesteSablon(), permiteIncomplet: true })
    expect(prev.lipsuri).toEqual([MESAJ_INFORMARE_NEGATA])
    const { xml } = await xmlDin(prev.blob, 'word/document.xml')
    expect(textDin(xml)).toContain('PROIECT – nu se tipărește')
    // v3.2: textul real nu mai are câmpuri [ ], deci nimic evidențiat; un câmp rămas ar fi evidențiat
    expect(xml).not.toContain('<w:highlight')
    const prevCamp = await genereazaConvocator({ ...baza(), informare: { text: cuCamp, publicata: false }, templateArrayBuffer: citesteSablon(), permiteIncomplet: true })
    expect((await xmlDin(prevCamp.blob, 'word/document.xml')).xml).toContain('<w:highlight w:val="yellow"/>')
  })

  it('#939 r2: doar indicatorul calculat de server publică informarea; câmpurile autorizării singure NU (PDF mutat / proiect inactiv)', async () => {
    const pr = { ...baza().proiect, ...AUTORIZARE }
    expect(informarePublicataPeProiect(pr)).toBe(true)
    expect(verificaDateConvocator({ ...baza(), proiect: pr })).toEqual([])
    const r = await genereazaConvocator({ ...baza(), proiect: pr, templateArrayBuffer: citesteSablon() })
    expect(textDin((await xmlDin(r.blob, 'word/document.xml')).xml)).not.toContain('PROIECT – nu se tipărește')
    // câmpurile completate, dar serverul spune „nu” (PDF mutat, proiect inactiv) sau indicatorul lipsește (proiect din memorie) → refuz
    const doarCampuri = { ...baza().proiect, ...CAMPURI_AUT }
    expect(autorizareTgzCompleta(doarCampuri)).toBe(true)
    // r4: verificarea eșuată pe server → refuz, cu mesaj propriu
    expect(verificaDateConvocator({ ...baza(), proiect: { ...doarCampuri, informare_publicata: null } })).toEqual([MESAJ_INFORMARE_VERIFICARE_ESUATA])
    for (const proiect of [doarCampuri, { ...doarCampuri, informare_publicata: false }, { ...doarCampuri, informare_publicata: 'true' }]) {
      expect(verificaDateConvocator({ ...baza(), proiect }), JSON.stringify(proiect.informare_publicata)).toEqual([MESAJ_INFORMARE_NEGATA])
      await expect(genereazaConvocator({ ...baza(), proiect, templateArrayBuffer: citesteSablon() })).rejects.toThrow(/nu e publicată/)
    }
  })

  it('versoul vine după un salt de pagină, înaintea sectPr-ului final, cu elementele cheie; fața rămâne neschimbată', async () => {
    const r = await genereazaConvocator({ ...baza(), informare: INFORMARE_APROBATA, templateArrayBuffer: citesteSablon() })
    const { xml } = await xmlDin(r.blob, 'word/document.xml')
    expect(xmlBineFormat(xml)).toBe(true)
    const iSalt = xml.lastIndexOf('<w:br w:type="page"/>')
    const iVerso = xml.indexOf('Informare privind folosirea datelor personale')
    expect(iSalt).toBeGreaterThan(0)
    expect(iVerso).toBeGreaterThan(iSalt)
    // sectPr-ul de corp rămâne ultimul
    expect(xml.indexOf('<w:sectPr', iVerso)).toBeGreaterThan(iVerso)
    expect(xml).toMatch(/<\/w:sectPr><\/w:body>/)
    const verso = textDin(xml.slice(iSalt))
    expect(verso).toContain('S.N.T.G.N. TRANSGAZ S.A.')
    expect(verso).toContain('dpo@transgaz.ro')
    expect(verso).toContain('SMSLink (ASTINVEST COM S.R.L.)')
    expect(verso).toContain('6. Drepturile dumneavoastră')
    expect(verso).toContain('ANSPDCP')
    expect(verso).not.toContain('PROIECT – nu se tipărește')
    // markdown-ul nu ajunge în document
    expect(verso).not.toMatch(/\*\*|###/)
    expect(xml).not.toContain('<w:highlight')
    // fața: textul scurt din BD, neschimbat
    expect(textDin(xml.slice(0, iSalt))).toContain('Text scurt de pe față Husnicioara.')
    // determinism: aceleași intrări ⇒ același hash
    const r2 = await genereazaConvocator({ ...baza(), informare: INFORMARE_APROBATA, templateArrayBuffer: citesteSablon() })
    expect(r2.hash).toBe(r.hash)
  })

  it('xmlVersoInformare: XML bine format și cu caractere speciale escapate; liste cu tab, titluri îngroșate', () => {
    const x = xmlVersoInformare('### 1. A & B\n\n- x <y>\n- z\n\nPar **b** [c]', { proiect: true })
    expect(xmlBineFormat(`<w:body>${x}</w:body>`)).toBe(true)
    expect(x).toContain('A &amp; B')
    expect(x).toContain('x &lt;y&gt;')
    expect(x).toContain('<w:tab/>')
    expect(x.startsWith('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')).toBe(true)
    // controlul verificatorului
    expect(xmlBineFormat('<w:p><w:r></w:p></w:r>')).toBe(false)
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
        // listarea folderului: numele fișierelor (fără prefix) din `existente` aflate direct în folder, PAGINATĂ după
        // o.limit / o.offset (ca Supabase Storage, sortat după nume); opt.eList → eroare (opt.eListPagina = doar pagina cu acel index)
        list: async (folder, o = {}) => {
          apeluri.push({ tip: 'list', bucket, folder, o })
          const idx = Math.floor((o.offset || 0) / (o.limit || 100))
          if (opt.eList && (opt.eListPagina === undefined || opt.eListPagina === idx)) return { data: null, error: { message: opt.eList } }
          const pref = folder.replace(/\/?$/, '/')
          const toate = [...existente].filter(p => p.startsWith(pref) && !p.slice(pref.length).includes('/')).map(p => ({ name: p.slice(pref.length) })).sort((a, b) => a.name.localeCompare(b.name))
          return { data: toate.slice(o.offset || 0, (o.offset || 0) + (o.limit || 100)), error: null }
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

  // #970 r10 (Copilot P3-02): circuitul real Redari.jsx (generare → salvare) și FisaParcela.jsx (regenerare → reîncărcare),
  // cu supabase fals: fișierele încărcate respectă garda, hash-ul legat de rând e al fișierului, QR-ul e cel independent
  it('cap-coadă: generare + salveazaConvocator, apoi regenerare + reincarcaConvocator — fără link / URL în text, QR identic, hash corect; garda oprește înainte de orice scriere', async () => {
    const { supabase, apeluri } = fake()
    const incarcate = new Map()
    const din = supabase.storage.from
    supabase.storage.from = (bucket) => {
      const o = din(bucket)
      return { ...o, upload: async (path, blob, opt) => { incarcate.set(path, blob); return o.upload(path, blob, opt) } }
    }
    const token = 'tokenfictiv1234567890abcdefghijk'
    const intrare = {
      detinator: { nume: 'POPESCU ION (fictiv)', calitate: 'proprietar' }, contactDetinator: { adresa_strada: 'Str. Fictivă nr. 1', adresa_comuna: 'Husnicioara', cod_postal: '227001' },
      contact: null, parcela: { id_parcela: 'T3-HUS-0001', sat: 'Sat', tarla: '1', nr_cadastral: '1', poz_hg: '1', suprafata_temporara_mp: 10, tronson: 3 },
      uat: { nume: 'Husnicioara', sesiune_zi1: '2026-11-20', program_zi1: '09:00 – 16:00' },
      proiect: { cod: 'LOT1-PRUNISOR-JUPA', denumire: 'Lot 1 (fictiv)', contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: '1', imputernicire_data: '2026-10-01', contact_nume: 'Operator', contact_email: 'redari@exemplu.test',
        contact_telefon: '0700000000', reprezentant_tgz_nume: 'Reprezentant', reprezentant_tgz_telefon: '0711111111', link_informare_gdpr: 'https://example.invalid/informare',
        text_gdpr: 'Operatori: Transgaz și Primăria {uat}. Pe verso găsiți informațiile complete despre folosirea datelor și drepturile dumneavoastră. Drepturi: plângere la ANSPDCP (www.dataprotection.ro).', ...AUTORIZARE },
      token, templateArrayBuffer: citesteSablon(),
    }
    const qrAsteptat = (await genereazaQr(`https://redari.gazpet.ro/redari/raspuns/${token}`)).split(',')[1]
    const verifica = async (blob, hashRand) => {
      expect(await hashBlob(blob)).toBe(hashRand)
      expect(await adresaProprieInDocx(blob)).toBeNull()
      const { zip, xml } = await xmlDin(blob, 'word/document.xml')
      const text = textDin(xml)
      const fataDoc = text.slice(0, text.indexOf('Informare privind folosirea datelor personale'))
      expect(fataDoc.length).toBeGreaterThan(0)
      expect(text).not.toContain(token)
      expect(text).not.toMatch(/redari\.gazpet\.ro|example\.invalid|Informarea completă/)
      // #939: pe față o singură trimitere la verso (fraza din text_gdpr scoasă, trimiterea standard pusă la final)
      expect(fataDoc.split(TRIMITERE_VERSO_GDPR).length - 1).toBe(1)
      expect(fataDoc).toContain('Drepturi: plângere la ANSPDCP (www.dataprotection.ro).')
      expect(await zip.file('word/media/qr.png').async('base64')).toBe(qrAsteptat)
    }
    // Redari.jsx: genereazaConvocator({ ...intrare, nrDocument }) → salveazaConvocator
    const g1 = await genereazaConvocator({ ...intrare, nrDocument: 'C-0001' })
    const s = await salveazaConvocator(supabase, { blob: g1.blob, hash: g1.hash, proiectCod: 'LOT1-PRUNISOR-JUPA', uat3: 'HUS', idParcela: 'T3-HUS-0001', nrDocument: 'C-0001', detinatorId: 'det-1' })
    await verifica(incarcate.get(s.path), apeluri.find(a => a.tip === 'update').rand.continut_hash)
    // FisaParcela.jsx: aceeași convocare regenerată (data originală) → reincarcaConvocator, versiune nouă
    const g2 = await genereazaConvocator({ ...intrare, nrDocument: 'C-0001', dataDocument: '2026-11-03' })
    const r = await reincarcaConvocator(supabase, { convocareId: s.convocareId, blob: g2.blob, hash: g2.hash, proiectCod: 'LOT1-PRUNISOR-JUPA', uat3: 'HUS', idParcela: 'T3-HUS-0001', nrDocument: 'C-0001' })
    expect(r.path).toBe('LOT1-PRUNISOR-JUPA/HUS/T3-HUS-0001/C-0001-v2.docx')
    await verifica(incarcate.get(r.path), apeluri.filter(a => a.tip === 'update').at(-1).rand.continut_hash)
    // o adresă proprie în text_gdpr: garda oprește la generare, deci nu se ajunge la nicio scriere (insert / upload / update)
    const inainte = apeluri.length
    const rau = { ...intrare, proiect: { ...intrare.proiect, text_gdpr: 'Răspundeți la portal.gazpet.ro.' } }
    await expect(genereazaConvocator({ ...rau, nrDocument: 'C-0002' })).rejects.toThrow(/adrese web proprii/)
    expect(apeluri.length).toBe(inainte)
  }, 20000)

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
    expect(a.apeluri.map(x => x.tip)).toEqual(['select', 'list', 'list', 'upload', 'update'])
    expect(a.apeluri.find(x => x.tip === 'upload').path).toBe(`${BAZA}-v3.docx`) // un singur upload, fără bâjbâit pe v1/v2; C-0002 și .pdf nu contează
    expect(a.apeluri.at(-1).rand.fisier_convocator_path).toBe(`${BAZA}-v3.docx`)
    // rândul spune v5 dar bucket-ul are max v2 → câștigă maximul dintre ele (v6)
    const b = fake({ caleCurenta: `${BAZA}-v5.docx`, existente: [`${BAZA}-v1.docx`, `${BAZA}-v2.docx`] })
    expect((await reincarcaConvocator(b.supabase, argRe)).versiune).toBe(6)
  })
  it('P2-6: listarea e paginată (limit + offset până la pagina incompletă) — maximul e real și peste o pagină', async () => {
    // 1.003 obiecte în folder: 1.000 de PDF-uri cu nume mici alfabetic + C-0001-v1..v2 și, la coada listei, C-0001-v7
    const multe = Array.from({ length: 1000 }, (_, i) => `${BAZA.replace(/C-0001$/, 'A-')}${String(i).padStart(4, '0')}.pdf`)
    const existente = [...multe, `${BAZA}-v1.docx`, `${BAZA}-v2.docx`, `${BAZA}-v7.docx`]
    const a = fake({ existente })
    const cheie = { proiectCod: arg.proiectCod, uat3: arg.uat3, idParcela: arg.idParcela, nrDocument: arg.nrDocument }
    expect(await versiuneMaximaInBucket(a.supabase, cheie)).toBe(7)
    const listari = a.apeluri.filter(x => x.tip === 'list')
    expect(listari.map(x => [x.o.limit, x.o.offset])).toEqual([[1000, 0], [1000, 1000], [1000, 1003]]) // până la pagina goală, inclusiv când serverul plafonează
    // și prin reincarcaConvocator: direct pe v8, un singur upload
    const b = fake({ caleCurenta: null, existente })
    const r = await reincarcaConvocator(b.supabase, argRe)
    expect(r.versiune).toBe(8)
    expect(b.apeluri.filter(x => x.tip === 'list')).toHaveLength(3)
    expect(b.apeluri.filter(x => x.tip === 'upload').map(x => x.path)).toEqual([`${BAZA}-v8.docx`])
    // pagină mică (3) cu exact 6 obiecte: a treia pagină vine goală și oprește bucla; maximul tot real
    const c = fake({ existente: [`${BAZA}-v1.docx`, `${BAZA}-v2.docx`, `${BAZA}-v3.docx`, `${BAZA}-v4.docx`, `${BAZA}-v5.docx`, `${BAZA}-v6.docx`] })
    expect(await versiuneMaximaInBucket(c.supabase, cheie, { pagina: 3 })).toBe(6)
    expect(c.apeluri.filter(x => x.tip === 'list').map(x => x.o.offset)).toEqual([0, 3, 6])
    // eroare pe a doua pagină → null (nu un maxim parțial) → reincarcaConvocator cade pe încercări succesive
    const d = fake({ existente, eList: 'timeout', eListPagina: 1 })
    expect(await versiuneMaximaInBucket(d.supabase, cheie)).toBeNull()
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

// Felia 2: sursele așteptate sunt șablonul real și valorile explicite ale fixture-ului.
import { repetaRand, verificaDateAdresaUat, genereazaAdresaUat, CHEI_ADRESA_UAT, caleAdresaUat, salveazaAdresaUat, zileSesiuneText, aziBucuresti } from './docx.js'
import { CHEI_CERERE_IMPUTERNICIRE, ANTREPRENOR, verificaDateCerereImputernicire, genereazaCerereImputernicire } from './docx.js'

const PR_CERERE = {
  beneficiar: 'Beneficiar FICTIV', reprezentant_tgz_nume: 'Delegat FICTIV', contract_nr: 'TEST-1',
  contract_data: '2025-01-22', denumire: 'Proiect FICTIV', reprezentant_gazpet_nume: 'Semnatar FICTIV',
  reprezentant_gazpet_functie: 'coordonator', contact_email: 'test@example.invalid',
}
const sablonCerere = () => readFileSync(resolve(process.cwd(), 'public/redari/sabloane/cerere_imputernicire.docx'))
describe('cererea de imputernicire', () => {
  it('sablonul real are exact cele 12 chei, textul Juridic integral si zero relatii externe', async () => {
    const zip = await JSZip.loadAsync(sablonCerere())
    const xml = await zip.file('word/document.xml').async('string')
    const chei = [...new Set([...xml.matchAll(/\{\{([\w.]+)\}\}/g)].map(m => m[1]))].sort()
    expect(chei).toHaveLength(12)
    expect([...CHEI_CERERE_IMPUTERNICIRE].sort()).toEqual(chei)
    const sursa = readFileSync(resolve(process.cwd(), 'docs/redari/TEXT_CERERE_IMPUTERNICIRE.md'), 'utf8').split(/^---[ \t]*\r?$/m)[1]
    const texte = [...xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map(m => m[1])
    expect(texte).toEqual(sursa.split(/\r?\n/).map(l => l.trim()).filter(Boolean))
    for (const f of Object.keys(zip.files).filter(f => f.endsWith('.rels'))) expect(await zip.file(f).async('string')).not.toContain('TargetMode="External"')
  })
  it.each(Object.keys(PR_CERERE))('lipsa sau spatii in %s blocheaza', async cheie => {
    for (const valoare of [null, '', '   ']) {
      const proiect = { ...PR_CERERE, [cheie]: valoare }
      expect(verificaDateCerereImputernicire({ proiect, uats: [{ nume: 'Test' }] })).toHaveLength(1)
      await expect(genereazaCerereImputernicire({ proiect, uats: [{ nume: 'Test' }] })).rejects.toThrow('Lipseste')
    }
  })
  it('fara UAT sau cu nume lipsa blocheaza; nr documentului este optional', () => {
    expect(verificaDateCerereImputernicire({ proiect: PR_CERERE, uats: [] })).toHaveLength(1)
    expect(verificaDateCerereImputernicire({ proiect: PR_CERERE, uats: [{ nume: ' ' }] })).toHaveLength(1)
    expect(verificaDateCerereImputernicire({ proiect: PR_CERERE, uats: [{ nume: 'Test' }] })).toEqual([])
  })
  it.each([undefined, '   ', ' REG-7 '])('genereaza real, sorteaza RO fara mutare, nr %s', async nrDocument => {
    const uats = [{ nume: 'Zorile' }, { nume: 'Șimian' }, { nume: 'Alba' }]
    const r = await genereazaCerereImputernicire({ proiect: PR_CERERE, uats, nrDocument, dataDocument: '2026-11-02', templateArrayBuffer: sablonCerere() })
    const { xml } = await xmlDin(r.blob, 'word/document.xml')
    expect(xml).not.toContain('{{')
    expect(r.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(r.campuri).toEqual({ nr_document: nrDocument?.trim() || '___', data: '02.11.2026', beneficiar: 'Beneficiar FICTIV', reprezentant_tgz: 'Delegat FICTIV', contract_nr: 'TEST-1', contract_data: '22.01.2025', proiect_denumire: 'Proiect FICTIV', antreprenor: 'GAZPET INSTAL S.R.L.', uat_lista: 'Alba, Șimian, Zorile', contact_email: 'test@example.invalid', reprezentant_gazpet: 'Semnatar FICTIV', functie: 'coordonator' })
    expect(ANTREPRENOR).toBe('GAZPET INSTAL S.R.L.')
    expect(xml).toContain('Alba, Șimian, Zorile')
    expect(xml).toContain(nrDocument?.trim() || '___')
    expect(uats[0].nume).toBe('Zorile')
  })
  it('spațiile de la capetele valorilor nu intră în document (Gemini f3a r1 P3)', async () => {
    const r = await genereazaCerereImputernicire({ proiect: { ...PR_CERERE, beneficiar: '  Beneficiar FICTIV  ', contract_nr: ' TEST-1 ' }, uats: [{ nume: ' Alba ' }], dataDocument: '2026-11-02', templateArrayBuffer: sablonCerere() })
    expect(r.campuri.beneficiar).toBe('Beneficiar FICTIV')
    expect(r.campuri.contract_nr).toBe('TEST-1')
    expect(r.campuri.uat_lista).toBe('Alba')
  })
})
const PR_ADRESA = { contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: 'TEST-IMP', imputernicire_data: '2026-11-01', reprezentant_gazpet_nume: 'Semnatar FICTIV', reprezentant_gazpet_functie: 'coordonator', contact_email: 'test@example.invalid' }
const UAT_ADRESA = { id: 'uat-fictiv', nume: 'UAT FICTIV', uat3: 'TST', judet: 'Test', versiune: 7, sesiune_zi1: '2026-12-10', sesiune_zi2: '2026-12-11', sesiune_zi3: '2026-12-12', program_zi1: '09:00 – 16:00', program_zi2: '09:00 – 19:00', program_zi3: '09:00 – 16:00', afisare_data_start: '2026-11-10', afisare_data_end: '2026-12-12', termen_confirmare: '2026-12-01', afisare_ora: '09:30' }
const sablonAdresa = () => readFileSync(resolve(process.cwd(), 'public/redari/sabloane/adresa_uat.docx'))
const pTest = i => ({ id_parcela: `T1-TST-000${i}`, sat: `Sat ${i} <&>`, tarla: `Tarla ${i}`, nr_cadastral: `CAD-${i}`, poz_hg: `HG-${i}`, tronson: 1, sters_la: null })

describe('Model 4: adresă UAT', () => {
  it('CHEI_ADRESA_UAT coincide exact cu cele 43 de chei din șablonul real (antetul firmei repus, excepția (9)); fără link și relații externe', async () => {
    const zip = await JSZip.loadAsync(sablonAdresa())
    const xml = await zip.file('word/document.xml').async('string')
    const chei = [...new Set([...xml.matchAll(/\{\{([\w.]+)\}\}/g)].map(m => m[1]))].sort()
    expect(chei).toHaveLength(43)
    expect([...CHEI_ADRESA_UAT].sort()).toEqual(chei)
    expect(xml).not.toContain('link_afisare')
    for (const f of Object.keys(zip.files).filter(f => f.endsWith('.rels'))) expect(await zip.file(f).async('string')).not.toContain('TargetMode="External"')
  })
  it.each([0, 1, 3])('repetaRand %i rânduri, escapare XML și câmp simplu păstrat', async n => {
    const tr = '<w:tr><w:tc><w:p><w:r><w:t>{{rand.nr}} {{rand.sat}} {{uat}}</w:t></w:r></w:p></w:tc></w:tr>'
    const xml = repetaRand(`<w:tbl>${tr}</w:tbl>`, Array.from({ length: n }, (_, i) => ({ nr: i + 1, sat: '<&>' })))
    expect((xml.match(/<w:tr>/g) || []).length).toBe(n || 1)
    expect(xml.includes('(nicio parcela importata)')).toBe(n === 0)
    if (n) { expect(xml).toContain('&lt;&amp;&gt;'); expect(xml.match(/\{\{uat\}\}/g)).toHaveLength(n) }
    expect(xml).not.toContain('{{rand.')
    const zip = new JSZip()
    zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{uat}}</w:t></w:r></w:p></w:tc></w:tr>${tr}</w:tbl></w:document>`)
    const blob = await completeazaDocx(await zip.generateAsync({ type: 'uint8array' }), { uat: 'UAT FICTIV' }, { randuri: { rand: Array.from({ length: n }, (_, i) => ({ nr: i + 1, sat: '<&>' })) }, strict: true })
    const { xml: complet } = await xmlDin(blob, 'word/document.xml')
    expect(complet.match(/UAT FICTIV/g)).toHaveLength(n + 1)
    expect(complet).not.toContain('{{')
  })
  it('strict refuză rand.* necompletat, inclusiv cheie de rând necunoscută', async () => {
    const z = new JSZip()
    z.file('word/document.xml', '<w:document><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{rand.necunoscut}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>')
    const b = await z.generateAsync({ type: 'uint8array' })
    await expect(completeazaDocx(b, {}, { strict: true })).rejects.toThrow('rand.necunoscut')
    await expect(completeazaDocx(b, {}, { randuri: { rand: [{ nr: 1 }] }, strict: true })).rejects.toThrow('rand.necunoscut')
  })
  it.each([0, 1, 3])('generează șablonul real cu %i parcele și zip recitibil', async n => {
    const { blob, hash, campuri } = await genereazaAdresaUat({ proiect: PR_ADRESA, uat: UAT_ADRESA, parcele: Array.from({ length: n }, (_, i) => pTest(n - i)), nrDocument: 'AU-0001', templateArrayBuffer: sablonAdresa() })
    const { xml } = await xmlDin(blob, 'word/document.xml')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(xml).not.toContain('{{')
    expect(campuri.numar_parcele).toBe(n)
    expect(campuri.zile_sesiune_text).toBe('10, 11 și 12 decembrie 2026')
    expect(campuri.program_text).toBe('09:00 – 16:00, ziua 2 până la 19:00')
    expect(campuri.contract_data).toBe('22.01.2025')
    expect(campuri.termen_confirmare).toBe('01.12.2026')
    expect(campuri.afisare_ora).toBe('09:30')
    expect(campuri.reprezentant_gazpet).toBe('Semnatar FICTIV, coordonator')
    expect(campuri.semnatar_uat).toBe('')
    if (n) expect(xml).toContain('Sat 1 &lt;&amp;&gt;')
    if (n === 3) expect(xml.indexOf('CAD-1')).toBeLessThan(xml.indexOf('CAD-3'))
  })
  it('parcelele șterse nu intră în număr sau tabel', async () => {
    const r = await genereazaAdresaUat({ proiect: PR_ADRESA, uat: UAT_ADRESA, parcele: [{ ...pTest(1), sters_la: '2026-11-01T00:00:00Z' }], nrDocument: 'AU-0001', templateArrayBuffer: sablonAdresa() })
    expect(r.campuri.numar_parcele).toBe(0)
    expect((await xmlDin(r.blob, 'word/document.xml')).xml).not.toContain('CAD-1')
  })
  it('fără parcele este legitim; toate lipsurile obligatorii blochează, împuternicirea inclusă', () => {
    const complet = { proiect: PR_ADRESA, uat: UAT_ADRESA, parcele: [], nrDocument: 'AU-0001' }
    expect(verificaDateAdresaUat(complet)).toEqual([])
    for (const k of ['contract_nr', 'contract_data', 'imputernicire_nr', 'imputernicire_data', 'reprezentant_gazpet_nume', 'contact_email']) {
      expect(verificaDateAdresaUat({ ...complet, proiect: { ...PR_ADRESA, [k]: '' } }).length, k).toBeGreaterThan(0)
    }
    for (const k of ['nume', 'judet', 'afisare_data_start', 'afisare_data_end', 'termen_confirmare']) {
      expect(verificaDateAdresaUat({ ...complet, uat: { ...UAT_ADRESA, [k]: '' } }).length, k).toBeGreaterThan(0)
    }
    expect(verificaDateAdresaUat({ ...complet, nrDocument: null })).toContain('Lipsește nr. documentului')
    expect(verificaDateAdresaUat({ ...complet, uat: {} })).toContain('Lipsește o zi de sesiune cu program')
  })
  it('plan pct. 4.3: adresa nu se generează cu afișarea sub 10 zile libere înainte de ziua 1 (textul ei promite „cel puțin 10 zile”)', async () => {
    const complet = { proiect: PR_ADRESA, parcele: [], nrDocument: 'AU-0001' }
    // ziua 1 = 10.12.2026 → afișarea începe cel târziu pe 29.11.2026 (ziua 1 − 11 = 10 zile libere, numărat în calendar)
    expect(verificaDateAdresaUat({ ...complet, uat: { ...UAT_ADRESA, afisare_data_start: '2026-11-29' } })).toEqual([])
    const tarziu = { ...UAT_ADRESA, afisare_data_start: '2026-11-30' }
    expect(verificaDateAdresaUat({ ...complet, uat: tarziu })).toEqual(['Afișarea la primărie începe pe 30.11.2026, sub 10 zile libere înainte de ziua 1 (10.12.2026): trebuie să înceapă cel târziu pe 29.11.2026 (plan pct. 4.3)'])
    await expect(genereazaAdresaUat({ ...complet, uat: tarziu, templateArrayBuffer: sablonAdresa() })).rejects.toThrow('cel târziu pe 29.11.2026')
  })
  it('zile din luni/ani diferiți sunt explicite', () => {
    expect(zileSesiuneText({ sesiune_zi1: '2026-12-31', sesiune_zi2: '2027-01-02' })).toBe('31 decembrie 2026 și 2 ianuarie 2027')
  })
  it('GDPR: omite propoziția fără link și păstrează UAT-ul; link configurat', () => {
    const text = 'Operator {uat}. Informarea completă: [link]'
    expect(textGdprPentruUat(text, 'UAT TEST', null)).toBe('Operator UAT TEST.')
    expect(textGdprPentruUat(text, 'UAT TEST', 'https://example.invalid')).toBe('Operator UAT TEST. Informarea completă: https://example.invalid')   // pe loc, unde era [link]
    expect(textGdprPentruUat('Operator {uat}.', 'UAT TEST', 'https://example.invalid')).toBe('Operator UAT TEST.\nInformarea completă: https://example.invalid')   // lipsea → la final
    // Gemini f2b r1 P2: propoziția existentă (cu [link] sau URL vechi) se înlocuiește PE LOC, nu se dublează la final
    const mijloc = 'Operatori: X. Informarea completă: [link]. Drepturi: acces.'
    expect(textGdprPentruUat(mijloc, 'U', 'https://a.b/gdpr')).toBe('Operatori: X. Informarea completă: https://a.b/gdpr. Drepturi: acces.')   // punctul rămâne (Copilot f2b r2 P3-02)
    expect(textGdprPentruUat('A. Informarea completă: https://vechi.ro/x. B.', 'U', 'https://nou.ro/y')).toBe('A. Informarea completă: https://nou.ro/y. B.')
    expect(textGdprPentruUat('A. Informarea completă: https://vechi.ro/x\nB.', 'U', 'https://nou.ro/y')).toBe('A. Informarea completă: https://nou.ro/y\nB.')
    expect(textGdprPentruUat(mijloc, 'U', null)).toBe('Operatori: X. Drepturi: acces.')
    expect((textGdprPentruUat(mijloc, 'U', 'https://a.b/gdpr').match(/Informarea completă/g) || []).length).toBe(1)
  })
  it('calea este validată și folosește _v', () => {
    expect(caleAdresaUat({ proiectCod: 'TEST', uat3: 'TST', nrDocument: 'AU-0001', versiune: 3 })).toBe('TEST/TST/adresa/AU-0001_v3.docx')
    expect(() => caleAdresaUat({ proiectCod: '../TEST', uat3: 'TST', nrDocument: 'AU-0001' })).toThrow()
  })
})

function storageAdresa({ coliziune = false, eroareUpload = false, eroareListare = false, plafon = 1000 } = {}) {
  const apeluri = []
  const fisiere = new Set(['AU-0001_v1.docx', 'AU-0001_v3.docx', 'AU-0002_v90.docx'])
  let colizionat = false
  const client = {
    storage: { from: bucket => ({
      list: async (folder, { offset, limit }) => {
        apeluri.push(['list', folder, offset])
        return eroareListare ? { error: { message: 'Test eroare' } } : { data: [...fisiere].sort().slice(offset, offset + Math.min(limit, plafon)).map(name => ({ name })), error: null }
      },
      upload: async (path, blob, opt) => {
        apeluri.push(['upload', path, opt])
        if (eroareUpload) return { error: { statusCode: '500' } }
        if (coliziune && !colizionat) { colizionat = true; return { error: { statusCode: '409' } } }
        fisiere.add(path.split('/').at(-1)); return { error: null }
      },
      remove: () => { throw new Error('Nu se șterg fișierele') },
    }) },
    from: () => { throw new Error('salveazaAdresaUat nu mai scrie în BD (numărul e rezervat de fn_red_adresa_uat_rezerva)') },
  }
  return { client, apeluri, fisiere }
}
const argAdresa = { blob: new Blob(['DOCX FICTIV']), proiectCod: 'TEST', uat: UAT_ADRESA, nrDocument: 'AU-0001' }
describe('salvarea adresei: doar upload versionat (numărul e deja pe UAT — Copilot f2b r1 P2-1)', () => {
  it('maxim real pe pagini plafonate; upload fără upsert; fără scriere în BD', async () => {
    const f = storageAdresa({ plafon: 1 })
    const r = await salveazaAdresaUat(f.client, argAdresa)
    expect(r).toEqual({ path: 'TEST/TST/adresa/AU-0001_v4.docx', versiune: 4 })
    expect(f.apeluri.filter(x => x[0] === 'list').map(x => x[2])).toEqual([0, 1, 2, 3])
    expect(f.apeluri.find(x => x[0] === 'upload')[2].upsert).toBe(false)
    expect(f.apeluri.some(x => x[0] === 'update')).toBe(false)
  })
  it('coliziune deterministă: încearcă următoarea versiune cu același AU', async () => {
    const f = storageAdresa({ coliziune: true })
    expect((await salveazaAdresaUat(f.client, argAdresa)).path).toBe('TEST/TST/adresa/AU-0001_v5.docx')
  })
  it.each([{ eroareListare: true }, { eroareUpload: true }])('eroarea e explicită și spune că numărul rămâne pe UAT %j', async opt => {
    const f = storageAdresa(opt)
    await expect(salveazaAdresaUat(f.client, argAdresa)).rejects.toThrow(opt.eroareUpload ? 'numărul rămâne pe UAT' : 'Nu pot lista')
    expect(f.apeluri.filter(x => x[0] === 'upload').length).toBe(opt.eroareListare ? 0 : 1)
  })
  it('operație expirată: abandonează înainte de upload', async () => {
    const f = storageAdresa()
    await expect(salveazaAdresaUat(f.client, { ...argAdresa, esteCurent: () => false })).rejects.toThrow('abandonată')
    expect(f.apeluri.some(x => x[0] === 'upload')).toBe(false)
  })
  it('data civilă Europe/Bucharest la miezul nopții, iarnă și vară', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-02T22:30:00Z'))
      expect(aziBucuresti()).toBe('2026-11-03')
      vi.setSystemTime(new Date('2026-07-02T21:30:00Z'))
      expect(aziBucuresti()).toBe('2026-07-03')
    } finally { vi.useRealTimers() }
  })
})

describe('repetaRand — structuri nesuportate (Copilot f2b r1 P3)', () => {
  it('tabel imbricat cu rand.* → eroare explicită, nu document cu placeholder-e rămase', () => {
    const xml = '<w:tbl><w:tr><w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{rand.sat}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>'
    expect(() => repetaRand(xml, [{ sat: 'A' }])).toThrow('imbricate')
  })
  it('tabele imbricate FĂRĂ rand.* sunt lăsate în pace', () => {
    const xml = '<w:tbl><w:tr><w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{uat}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>'
    expect(repetaRand(xml, [])).toBe(xml)
  })
})
