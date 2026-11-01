// Redări teren — teste pentru src/redari/docx.js (contract §6 + §8). Date fictive, fără persoane reale.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, TextRun, Header } from 'docx'
import {
  completeazaDocx, genereazaQr, hashBlob, borderouCsv, genereazaConvocator, salveazaConvocator, caleConvocator,
  formatDataRo, formatNumarRo, linkRaspuns, MIME_DOCX, COLOANE_BORDEROU,
} from './docx.js'

const SABLON = resolve(process.cwd(), 'public/redari/sabloane/convocator_provizoriu.docx')
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// DOCX de test: un placeholder rupt în două run-uri („{{nu” + „me}}”), unul întreg, unul lipsă, unul în antet
const docxTest = async () => {
  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun('Antet {{nr_document}}')] })] }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Către {{nu', bold: true }), new TextRun('me}}, parcela {{id_parcela}}')] }),
        new Paragraph({ children: [new TextRun('Sat: {{sat}} / lipsă: [{{inexistent}}]')] }),
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

describe('completeazaDocx — înlocuire placeholder-e', () => {
  const campuri = { nume: 'POPESCU ION (fictiv)', id_parcela: 'T3-HUS-0001', sat: 'A & B <"test">', nr_document: 'C-0001' }

  it('placeholder rupt între run-uri + întreg + lipsă → gol; antetul se completează', async () => {
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

  it('șablonul provizoriu din repo: toate cele 22 de câmpuri se completează, niciun {{ rămas', async () => {
    const sablon = readFileSync(SABLON)
    const campuriToate = Object.fromEntries(['nume', 'id_parcela', 'uat', 'sat', 'tarla', 'nr_cadastral', 'suprafata', 'zi1', 'program1', 'zi2', 'program2',
      'zi3', 'program3', 'link', 'nr_document', 'data', 'contact_nume', 'contact_telefon', 'contact_email', 'reprezentant_tgz', 'text_gdpr'].map(k => [k, `<${k}>`]))
    const blob = await completeazaDocx(sablon.buffer.slice(sablon.byteOffset, sablon.byteOffset + sablon.byteLength), campuriToate, { imagini: { qr: PNG_1x1 } })
    const { zip } = await xmlDin(blob, 'word/document.xml')
    for (const cale of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']) {
      const xml = await zip.file(cale).async('string')
      expect(xml, cale).not.toMatch(/\{\{|\}\}/)
    }
    const doc = await zip.file('word/document.xml').async('string')
    for (const k of Object.keys(campuriToate)) expect(doc + await zip.file('word/header1.xml').async('string') + await zip.file('word/footer1.xml').async('string')).toContain(`&lt;${k}&gt;`)
    expect(doc).toContain('<w:drawing>')
  })
})

describe('hashBlob / genereazaQr', () => {
  it('sha256 hex, determinist pe același conținut; conținut diferit → hash diferit', async () => {
    const h1 = await hashBlob(new Blob(['abc']))
    expect(h1).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await hashBlob(new Blob(['abc']))).toBe(h1)
    expect(await hashBlob(new Blob(['abd']))).not.toBe(h1)
  })
  it('același șablon + aceleași câmpuri → același DOCX → același hash (datele intrărilor din zip sunt fixe)', async () => {
    const t = await docxTest()
    const c = { nume: 'X', id_parcela: 'T1-PRU-0001' }
    const h1 = await hashBlob(await completeazaDocx(t, c, { imagini: { qr: PNG_1x1 } }))
    const h2 = await hashBlob(await completeazaDocx(t, c, { imagini: { qr: PNG_1x1 } }))
    expect(h1).toBe(h2)
    expect(await hashBlob(await completeazaDocx(t, { ...c, nume: 'Y' }))).not.toBe(h1)
  })
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
  it('construiește câmpurile din contract §8, link + QR, hash', async () => {
    const r = await genereazaConvocator({
      detinator: { nume: 'POPESCU ION (fictiv)' },
      contact: { nume: 'Operator Test', telefon: '0700000000', email: 'redari@exemplu.test' },
      parcela: { id_parcela: 'T3-HUS-0001', sat: 'Satul Test', tarla: '12', nr_cadastral: '5001', suprafata_temporara_mp: 1500.25 },
      uat: { nume: 'Husnicioara', sesiune_zi1: '2026-11-10', sesiune_zi2: '2026-11-11', program_zi1: '09-12 Sat A', program_zi2: '09-12 Sat B' },
      proiect: { reprezentant_tgz_nume: 'Reprezentant Test', reprezentant_tgz_functie: 'inginer', text_gdpr: 'Text GDPR.\nRând 2' },
      nrDocument: 'C-0001', token: 'tokenfictiv1234567890abcdefghijk', origin: 'https://exemplu.test',
      templateArrayBuffer: await docxTest(), dataDocument: '2026-11-02',
    })
    expect(r.link).toBe('https://exemplu.test/redari/raspuns/tokenfictiv1234567890abcdefghijk')
    expect(r.campuri).toMatchObject({
      nume: 'POPESCU ION (fictiv)', id_parcela: 'T3-HUS-0001', uat: 'Husnicioara', suprafata: '1.500,25', zi1: '10.11.2026', program1: '09-12 Sat A',
      zi3: '', program3: '', nr_document: 'C-0001', data: '02.11.2026', contact_email: 'redari@exemplu.test', reprezentant_tgz: 'Reprezentant Test, inginer',
    })
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.hash).toBe(await hashBlob(r.blob))
    const { zip } = await xmlDin(r.blob, 'word/document.xml')
    expect(zip.file('word/media/qr.png')).not.toBeNull()
  })
  it('fără token / fără șablon → eroare în română', async () => {
    await expect(genereazaConvocator({ nrDocument: 'C-1', templateArrayBuffer: await docxTest() })).rejects.toThrow(/token/)
    await expect(genereazaConvocator({ nrDocument: 'C-1', token: 't' })).rejects.toThrow(/șablonul/)
  })
})

describe('salveazaConvocator (fake supabase)', () => {
  const fake = (opt = {}) => {
    const apeluri = []
    const supabase = {
      storage: { from: (bucket) => ({ upload: async (path, blob, o) => { apeluri.push({ tip: 'upload', bucket, path, size: blob.size, o }); return opt.eUp ? { error: { message: opt.eUp } } : { data: { path }, error: null } } }) },
      from: (tabel) => ({ insert: (rand) => ({ select: (col) => ({ single: async () => { apeluri.push({ tip: 'insert', tabel, rand, col }); return opt.eIns ? { data: null, error: { message: opt.eIns } } : { data: { id: 'uuid-fictiv-1' }, error: null } } }) }) }),
    }
    return { supabase, apeluri }
  }
  const arg = { blob: new Blob(['docx']), hash: 'ab'.repeat(32), proiectCod: 'LOT1-PRUNISOR-JUPA', uat3: 'HUS', idParcela: 'T3-HUS-0001', nrDocument: 'C-0001', detinatorId: 'det-1' }

  it('calea §6, upload cu upsert false + contentType docx, apoi rândul în red_convocari', async () => {
    const { supabase, apeluri } = fake()
    const r = await salveazaConvocator(supabase, arg)
    expect(r).toEqual({ path: 'LOT1-PRUNISOR-JUPA/HUS/T3-HUS-0001/C-0001.docx', convocareId: 'uuid-fictiv-1' })
    expect(apeluri[0]).toMatchObject({ tip: 'upload', bucket: 'redari', path: r.path, size: 4, o: { contentType: MIME_DOCX, upsert: false } })
    expect(apeluri[1]).toMatchObject({ tip: 'insert', tabel: 'red_convocari', col: 'id',
      rand: { detinator_id: 'det-1', canal: 'posta', nr_document: 'C-0001', continut_hash: arg.hash, fisier_convocator_path: r.path } })
    expect(apeluri).toHaveLength(2)
  })
  it('canal explicit; segment invalid în cale → eroare fără apeluri', async () => {
    const { supabase, apeluri } = fake()
    await salveazaConvocator(supabase, { ...arg, canal: 'email' })
    expect(apeluri[1].rand.canal).toBe('email')
    await expect(salveazaConvocator(supabase, { ...arg, idParcela: '../x' })).rejects.toThrow(/id_parcela/)
    expect(() => caleConvocator({ proiectCod: 'A', uat3: 'H/S', idParcela: 'P', nrDocument: 'C' })).toThrow(/uat3/)
    expect(apeluri).toHaveLength(2)
  })
  it('eroare la upload → nu se inserează; eroare la insert → mesaj cu calea', async () => {
    const a = fake({ eUp: 'bucket inexistent' })
    await expect(salveazaConvocator(a.supabase, arg)).rejects.toThrow(/storage.*bucket inexistent/)
    expect(a.apeluri).toHaveLength(1)
    const b = fake({ eIns: 'duplicate key' })
    await expect(salveazaConvocator(b.supabase, arg)).rejects.toThrow(/red_convocari.*duplicate key/)
  })
})
