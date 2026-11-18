// Redări — anunțul de afișare la primărie (convocarea pe UAT; planul procedurii de predare rev. 1, pct. 4.3 + cap. 8).
// Șablonul real (public/redari/sabloane/anunt_afisare.docx), textul-sursă (docs/redari/TEXT_ANUNT_AFISARE.md) și generatorul din docx.js.
// Date fictive, fără persoane reale. Valorile așteptate vin din text, din plan și din fixture, nu din generator.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
// notificari.js → ui/comune.jsx importă clientul Supabase; testul nu face cereri (ca în sabloaneFinalV2.test.js)
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import {
  CHEI_ANUNT_AFISARE, CAMPURI_PARCELA_ANUNT, COL_PARCELA_ANUNT, LINK_INFORMARE_PUBLIC, SABLON_ANUNT_AFISARE, MESAJ_ANUNT_FARA_PARCELE,
  MESAJ_ANUNT_INFORMARE_NEVERIFICATA, verificaDateAnuntAfisare, randuriAnuntAfisare, genereazaAnuntAfisare, genereazaAdresaUat,
  genereazaConvocator, campuriSesiuniUat, campuriContractProiect, campuriContactGazpet, ETICHETA_CAMP_PROIECT, CHEI_ADRESA_UAT, CHEI_CONVOCATOR,
} from './docx.js'
import { MOTIV_INFORMARE_NEPUBLICATA, TEXT_INFORMARE_LOT1 } from './informareGdpr.js'
import { ORIGINE_PUBLICA_REDARI } from './domeniuPublic.js'
import { ghidModele } from './notificari.js'
import { parseazaText, PAGINA, LATIME_UTILA } from '../../scripts/redari_sablon_anunt_afisare.mjs'
import { PROIECT_MODEL, UAT_MODEL, PARCELE_MODEL, parceleExemplu, textDocx, DATA_MODEL } from '../../scripts/redari_model_anunt_afisare.mjs'
import { partiXmlDocx } from './xmlBineFormat.testutil.js'

const SABLON = resolve(process.cwd(), 'public/redari/sabloane/anunt_afisare.docx')
const SURSA = resolve(process.cwd(), 'docs/redari/TEXT_ANUNT_AFISARE.md')
const sablon = () => readFileSync(SABLON)
const RX_P = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
const RX_T = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const dez = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const textWt = xml => [...xml.matchAll(RX_T)].map(m => dez(m[1]))
const paragrafe = xml => [...xml.matchAll(RX_P)].map(m => textWt(m[0]).join('')).filter(t => t.trim())
const docDin = async blob => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  return { zip, xml: await zip.file('word/document.xml').async('string') }
}

// Fixture complet (fictiv): proiectul cu informarea publicată de server, UAT-ul cu 3 zile
const PROIECT = {
  cod: 'TEST-FICTIV', denumire: 'Conductă FICTIVĂ de test, Lot 0', contract_nr: 'TEST-30', contract_data: '2025-01-22',
  imputernicire_nr: 'IMP-TEST', imputernicire_data: '2026-11-01', contact_nume: 'Contact FICTIV', contact_telefon: '0700 000 000',
  contact_email: 'test@example.invalid', reprezentant_tgz_nume: 'Delegat FICTIV', reprezentant_tgz_functie: 'ofițer de legătură',
  reprezentant_tgz_telefon: '0700 000 001', reprezentant_gazpet_nume: 'Semnatar FICTIV', reprezentant_gazpet_functie: 'coordonator',
  text_gdpr: 'Text GDPR fictiv.', informare_publicata: true,
}
const UAT = { id: 'uat-fictiv', nume: 'Comuna FICTIVĂ', uat3: 'FIC', judet: 'Județ FICTIV', versiune: 1,
  sesiune_zi1: '2026-12-10', sesiune_zi2: '2026-12-11', sesiune_zi3: '2026-12-12',
  program_zi1: '09:00 – 16:00', program_zi2: '09:00 – 19:00 (program prelungit)', program_zi3: '09:00 – 16:00',
  sate_zi1: 'Satul A, tarlalele 1–5', sate_zi2: 'Satul B', sate_zi3: 'restul',
  afisare_data_start: '2026-11-20', afisare_data_end: '2026-12-12', termen_confirmare: '2026-12-01' }
// Deținători sintetici cu date personale (fictive), lipiți de parcele exact cum ar veni dintr-o citire greșită (rândul vederii +
// relațiile): nimic din ei nu are voie să ajungă în anunț
const PII = { nume: 'POPESCU Ion (fictiv)', adresa_strada: 'Str. Fictivă nr. 7', telefon: '0711 111 111', email: 'ion.fictiv@example.invalid', cnp: '1800101000000', cota: '1/2', token_raspuns: 'tok-fictiv-123' }
const parcela = (i, extra = {}) => ({
  id_parcela: `T1-FIC-${String(i).padStart(4, '0')}`, sat: `Satul ${i % 2 ? 'A' : 'B'}`, tarla: `T${1 + (i % 7)}`, nr_cadastral: `${100 + i}`,
  poz_hg: `${i}`, tronson: 1 + (i % 3), sters_la: null, uat_id: 'uat-fictiv', proiect_id: 'p',
  // câmpuri personale lipite de rând (fictive): deținător, contact, cotă, token
  ...PII, detinatori: [{ ...PII }], red_detinatori_contact: { ...PII }, ...extra,
})

describe('șablonul anunt_afisare.docx (textul-sursă = adevărul)', () => {
  it('textul din <w:t> e exact textul-sursă, în ordine; cheile = CHEI_ANUNT_AFISARE (32); placeholder-e întregi; fără relații externe', async () => {
    const zip = await JSZip.loadAsync(sablon())
    const xml = await zip.file('word/document.xml').async('string')
    const { texte, chei } = parseazaText(readFileSync(SURSA, 'utf8'))
    expect(textWt(xml).filter(Boolean)).toEqual(texte.filter(Boolean))
    const inDoc = [...new Set([...xml.matchAll(/\{\{([\w.]+)\}\}/g)].map(m => m[1]))].sort()
    expect(inDoc).toHaveLength(32)
    expect([...CHEI_ANUNT_AFISARE].sort()).toEqual(inDoc)
    expect([...chei].sort()).toEqual(inDoc)
    // fiecare placeholder stă întreg într-un singur <w:t> (docx.js înlocuiește local)
    for (const t of textWt(xml)) for (const m of t.matchAll(/\{\{/g)) expect(t.slice(m.index)).toMatch(/^\{\{[\w.]+\}\}/)
    for (const f of Object.keys(zip.files).filter(f => f.endsWith('.rels'))) expect(await zip.file(f).async('string')).not.toContain('TargetMode="External"')
    expect(zip.file('docProps/core.xml')).toBeNull()
  })
  it('conține cerințele planului: fără date personale, publicitate suplimentară ≠ acceptare tacită, cele 3 opțiuni, terminologia „predare”, fără link personal', async () => {
    const { texte } = parseazaText(readFileSync(SURSA, 'utf8'))
    const t = texte.join('\n')
    expect(t).toContain('CONVOCARE la predarea terenului')
    expect(t).toContain('nu valorează acceptare tacită')
    expect(t).toContain('publicitate suplimentară')
    expect(t).toContain('Prezentul anunț nu conține date personale')
    expect(t).toContain('particip la sesiune')
    expect(t).toContain('nu particip și nu am obiecții')
    expect(t).toContain('solicit constatarea pe teren')
    expect(t).toContain('inclusiv cei cărora convocarea nu le-a putut fi transmisă prin poștă')
    // niciun câmp de persoană: fără nume / adresă / telefon de deținător, fără token / link personal, fără cotă
    for (const interzis of ['{{nume}}', '{{adresa}}', '{{calitate}}', '{{link}}', '{{token}}', '{{cota}}', 'rand.nume', 'rand.adresa', 'rand.telefon', 'rand.cota']) expect(t).not.toContain(interzis)
    expect(CHEI_ANUNT_AFISARE.filter(k => k.startsWith('rand.')).map(k => k.slice(5))).toEqual(['nr', ...CAMPURI_PARCELA_ANUNT])
    // Prezentul anunț nu pomenește de „verso” (nu are verso) și nu tipărește adrese web în afara placeholder-ului informării
    expect(t.toLowerCase()).not.toMatch(/\bverso\b/)
    expect(t).not.toMatch(/https?:\/\/|www\./)
  })
  it('pagină A4 cu marginile convocatorului, antetul-imagine doar pe prima pagină, tabelele cu antet repetat și rânduri care nu se rup', async () => {
    const zip = await JSZip.loadAsync(sablon())
    const xml = await zip.file('word/document.xml').async('string')
    const sect = xml.match(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/g)
    expect(sect).toHaveLength(1)
    expect(sect[0]).toContain(`<w:pgSz w:w="${PAGINA.w}" w:h="${PAGINA.h}"/>`)
    expect([PAGINA.w, PAGINA.h]).toEqual([11906, 16838])
    expect(sect[0]).toMatch(/<w:headerReference w:type="first" r:id="[^"]+"\/>/)
    expect(sect[0]).toContain('<w:titlePg/>')
    expect(Object.keys(zip.files).filter(p => /^word\/header\d*\.xml$/.test(p))).toEqual(['word/header1.xml'])
    expect(Buffer.compare(Buffer.from(await zip.file('word/media/antet_gazpet.jpg').async('uint8array')), readFileSync('docs/redari/referinta/antet_gazpet.jpg'))).toBe(0)
    const tabele = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0])
    expect(tabele).toHaveLength(3)   // zilele, semnătura, lista parcelelor
    for (const tbl of tabele) {
      expect(tbl.slice(7)).not.toMatch(/<w:tbl>/)
      expect([...tbl.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].reduce((a, m) => a + Number(m[1]), 0)).toBe(LATIME_UTILA)
      for (const tr of tbl.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
        expect(tr[0]).toContain('<w:cantSplit/>')
        expect([...tr[0].matchAll(/<w:tcW w:w="(\d+)" w:type="dxa"\/>/g)].reduce((a, m) => a + Number(m[1]), 0)).toBe(LATIME_UTILA)
      }
    }
    // lista parcelelor: antetul repetat pe fiecare pagină + un singur rând-șablon
    const lista = tabele[2]
    const randuri = [...lista.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => m[0])
    expect(randuri).toHaveLength(2)
    expect(randuri[0]).toContain('<w:tblHeader/>')
    expect(textWt(randuri[0])).toEqual(['Nr.', 'Sat', 'Tarla', 'Nr. cadastral / parcelă', 'Poz. HG', 'Tronson'])
    expect(textWt(randuri[1])).toEqual(['{{rand.nr}}', '{{rand.sat}}', '{{rand.tarla}}', '{{rand.nr_cadastral}}', '{{rand.poz_hg}}', '{{rand.tronson}}'])
    // {{qr}} singur în paragraful lui, într-un cadru aliniat la dreapta (ca la convocator)
    const pQr = [...xml.matchAll(RX_P)].map(m => m[0]).filter(p => p.includes('{{qr}}'))
    expect(pQr).toHaveLength(1)
    expect(textWt(pQr[0])).toEqual(['{{qr}}'])
    expect(pQr[0]).toMatch(/<w:framePr [^>]*w:xAlign="right"[^>]*\/>/)
    expect(SABLON_ANUNT_AFISARE).toBe('/redari/sabloane/anunt_afisare.docx')
  })
})

describe('verificaDateAnuntAfisare — lipsurile blochează generarea', () => {
  it('fixture-ul complet trece; fiecare câmp tipărit lipsă blochează (și la generare)', async () => {
    expect(verificaDateAnuntAfisare({ proiect: PROIECT, uat: UAT })).toEqual([])
    const campuriProiect = ['contract_nr', 'contract_data', 'denumire', 'imputernicire_nr', 'imputernicire_data', 'contact_nume', 'contact_telefon', 'contact_email', 'reprezentant_tgz_nume', 'reprezentant_tgz_telefon', 'reprezentant_gazpet_nume']
    for (const k of campuriProiect) {
      for (const gol of ['', '   ', null]) {
        const l = verificaDateAnuntAfisare({ proiect: { ...PROIECT, [k]: gol }, uat: UAT })
        expect(l, `${k}=${JSON.stringify(gol)}`).toHaveLength(1)
        expect(l[0]).toMatch(/^Lipsește /)
      }
      await expect(genereazaAnuntAfisare({ proiect: { ...PROIECT, [k]: '' }, uat: UAT, parcele: [parcela(1)], templateArrayBuffer: sablon() })).rejects.toThrow(/lipsesc: Lipsește/)
    }
    for (const k of ['nume', 'judet']) expect(verificaDateAnuntAfisare({ proiect: PROIECT, uat: { ...UAT, [k]: '' } })).toHaveLength(1)
    // etichetele contactului sunt cele comune (Setări proiect), nu texte noi
    expect(verificaDateAnuntAfisare({ proiect: { ...PROIECT, contact_telefon: '' }, uat: UAT })).toEqual([`Lipsește ${ETICHETA_CAMP_PROIECT.contact_telefon}`])
  })
  it('zilele: cel puțin o zi CU program (aceeași regulă ca la convocator / adresa UAT); o zi fără program nu ajunge', () => {
    expect(verificaDateAnuntAfisare({ proiect: PROIECT, uat: { ...UAT, sesiune_zi1: null, sesiune_zi2: null, sesiune_zi3: null } })).toEqual(['Lipsește o zi de sesiune cu program'])
    expect(verificaDateAnuntAfisare({ proiect: PROIECT, uat: { ...UAT, program_zi1: '', program_zi2: ' ', program_zi3: null } })).toEqual(['Lipsește o zi de sesiune cu program'])
    expect(verificaDateAnuntAfisare({ proiect: PROIECT, uat: { ...UAT, sesiune_zi2: null, sesiune_zi3: null, program_zi2: '', program_zi3: '' } })).toEqual([])
  })
  it('informarea GDPR (anunțul tipărește adresa ei): nepublicată = blocat, verificare eșuată = blocat (L18), necunoscută aici = nu se judecă', () => {
    expect(verificaDateAnuntAfisare({ proiect: { ...PROIECT, informare_publicata: false }, uat: UAT })).toEqual([MOTIV_INFORMARE_NEPUBLICATA])
    expect(verificaDateAnuntAfisare({ proiect: { ...PROIECT, informare_publicata: null }, uat: UAT })).toEqual([MESAJ_ANUNT_INFORMARE_NEVERIFICATA])
    const { informare_publicata, ...faraIndicator } = PROIECT
    expect(verificaDateAnuntAfisare({ proiect: faraIndicator, uat: UAT })).toEqual([])
  })
  it('fără parcele active anunțul nu se generează (strict); cu strict=false (previzualizare) iese cu rândul „nicio parcela”', async () => {
    await expect(genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: [], templateArrayBuffer: sablon() })).rejects.toThrow(MESAJ_ANUNT_FARA_PARCELE)
    await expect(genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: [parcela(1, { sters_la: '2026-11-01T00:00:00Z' })], templateArrayBuffer: sablon() })).rejects.toThrow(MESAJ_ANUNT_FARA_PARCELE)
    const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: [], templateArrayBuffer: sablon(), strict: false })
    expect(r.randuri).toBe(0)
    expect(paragrafe((await docDin(r.blob)).xml).join('\n')).toContain('(nicio parcela importata)')
    await expect(genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: [parcela(1)] })).rejects.toThrow(/șablonul/)
  })
})

describe('genereazaAnuntAfisare — conținutul', () => {
  it('generează din șablonul real: niciun placeholder rămas, QR-ul = imagine, link-ul informării publice, semnatarul, data, numărul de parcele', async () => {
    const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: [parcela(2), parcela(1)], templateArrayBuffer: sablon(), dataDocument: '2026-11-18' })
    const { zip, xml } = await docDin(r.blob)
    const text = paragrafe(xml).join('\n')
    expect(text).not.toMatch(/\{\{|\}\}/)
    expect(r.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(r.randuri).toBe(2)
    expect(r.lipsuri).toEqual([])
    expect(r.campuri).toMatchObject({ contract_nr: 'TEST-30', contract_data: '22.01.2025', proiect_denumire: PROIECT.denumire, uat: 'Comuna FICTIVĂ', judet: 'Județ FICTIV',
      imputernicire_nr: 'IMP-TEST', imputernicire_data: '01.11.2026', zi1: '10.12.2026', program2: '09:00 – 19:00 (program prelungit)', sate_zi3: 'restul',
      contact_nume: 'Contact FICTIV', contact_telefon: '0700 000 000', contact_email: 'test@example.invalid', reprezentant_tgz: 'Delegat FICTIV, ofițer de legătură',
      reprezentant_tgz_telefon: '0700 000 001', semnatar_gazpet: 'Semnatar FICTIV, coordonator', data: '18.11.2026', numar_parcele: '2', link_informare: 'https://redari.gazpet.ro/redari/informare' })
    expect(LINK_INFORMARE_PUBLIC).toBe(`${ORIGINE_PUBLICA_REDARI}/redari/informare`)
    expect(text).toContain('https://redari.gazpet.ro/redari/informare')
    expect(text).toContain('Comuna FICTIVĂ, județul Județ FICTIV')
    expect(text).toContain('(număr de parcele: 2; fără date personale)')
    // QR-ul (pagina publică a informării, nu un link personal) e imagine, în cadrul de la dreapta
    expect(zip.file('word/media/qr.png')).not.toBeNull()
    const cuDesen = [...xml.matchAll(RX_P)].map(m => m[0]).filter(p => p.includes('<w:drawing>'))
    expect(cuDesen).toHaveLength(1)
    expect(cuDesen[0]).toMatch(/<w:framePr [^>]*w:xAlign="right"/)
    // antetul-imagine rămâne (prima pagină), relația QR-ului e separată
    expect(await zip.file('word/_rels/document.xml.rels').async('string')).toMatch(/Target="media\/qr\.png"/)
    expect(await zip.file('word/_rels/header1.xml.rels').async('string')).toContain('antet_gazpet.jpg')
  })
  it('NICIODATĂ date personale: deținători sintetici cu nume / adresă / telefon / e-mail / CNP / cotă / token lipiți de parcele → nimic din ei în document sau în câmpuri', async () => {
    const parcele = Array.from({ length: 9 }, (_, i) => parcela(i + 1))
    const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon() })
    const { zip } = await docDin(r.blob)
    // tot ce e text în arhivă (document, antet, relații, proprietăți), nu doar corpul
    const totText = (await Promise.all(Object.keys(zip.files).filter(f => /\.(xml|rels)$/.test(f)).map(f => zip.file(f).async('string')))).join('\n')
    for (const v of Object.values(PII)) {
      expect(totText, v).not.toContain(v)
      expect(JSON.stringify(r.campuri), v).not.toContain(v)
    }
    expect(totText).not.toMatch(/POPESCU|Fictivă nr\. 7|0711|cnp|token/i)
    // rândurile au exact coloanele din lista albă
    const rand = randuriAnuntAfisare(parcele)
    expect(rand).toHaveLength(9)
    for (const x of rand) expect(Object.keys(x).sort()).toEqual(['nr', ...CAMPURI_PARCELA_ANUNT].sort())
    // selectul din UI nu cere coloane de persoană
    expect(COL_PARCELA_ANUNT.split(',').map(s => s.trim())).toEqual(['id_parcela', ...CAMPURI_PARCELA_ANUNT, 'sters_la'])
  })
  it('tabel pe mai multe pagini: 150 de parcele → 150 de rânduri după antetul repetat, numerotate 1..150, ordonate (tarla, nr. cadastral) natural; cele șterse lipsesc', async () => {
    const parcele = Array.from({ length: 150 }, (_, i) => parcela(150 - i, { tarla: `T${(i % 12) + 1}`, nr_cadastral: `${(i * 37) % 200 + 1}` }))
    parcele.push(parcela(999, { sters_la: '2026-11-01T00:00:00Z', tarla: 'T0', nr_cadastral: 'STEARSA' }))
    const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon() })
    expect(r.randuri).toBe(150)
    const { xml } = await docDin(r.blob)
    const lista = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0]).at(-1)
    const randuri = [...lista.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => textWt(m[0]))
    expect(randuri).toHaveLength(151)
    expect(randuri[0]).toEqual(['Nr.', 'Sat', 'Tarla', 'Nr. cadastral / parcelă', 'Poz. HG', 'Tronson'])
    expect(lista.match(/<w:tblHeader\/>/g)).toHaveLength(1)
    expect(lista.match(/<w:cantSplit\/>/g)).toHaveLength(151)
    expect(randuri.slice(1).map(c => c[0])).toEqual(Array.from({ length: 150 }, (_, i) => String(i + 1)))
    expect(xml).not.toContain('STEARSA')
    // ordinea naturală: T1 < T2 < … < T10 < T11 < T12; în aceeași tarla, nr. cadastral numeric crescător
    const tarlale = randuri.slice(1).map(c => c[2])
    const ordine = t => Number(t.slice(1))
    for (let i = 1; i < tarlale.length; i++) expect(ordine(tarlale[i]) >= ordine(tarlale[i - 1]), `${tarlale[i - 1]} → ${tarlale[i]}`).toBe(true)
    const cad = randuri.slice(1).filter(c => c[2] === 'T1').map(c => Number(c[3]))
    expect(cad).toEqual([...cad].sort((a, b) => a - b))
    expect(randuriAnuntAfisare([parcela(1, { tarla: 'T10' }), parcela(2, { tarla: 'T2' })]).map(x => x.tarla)).toEqual(['T2', 'T10'])
  })
})

describe('XML bine format și modelul pentru Transgaz', () => {
  it('șablonul și documentele generate (2 și 150 de parcele): fiecare parte .xml / .rels e bine formată (verificator cu stivă)', async () => {
    const asteapta = async zip => { for (const p of await partiXmlDocx(zip)) expect(p.eroare, p.nume).toBeNull() }
    await asteapta(await JSZip.loadAsync(sablon()))
    for (const n of [2, 150]) {
      const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: Array.from({ length: n }, (_, i) => parcela(i + 1, { sat: 'Sat <&> "x"' })), templateArrayBuffer: sablon() })
      const { zip, xml } = await docDin(r.blob)
      await asteapta(zip)
      expect(xml).toContain('Sat &lt;&amp;&gt; &quot;x&quot;')
    }
  })
  it('modelul (scripts/redari_model_anunt_afisare.mjs): date de MODEL fără nimic real, datele „__.__.____” rămân necompletate, textul copiat conține tabelele', async () => {
    const r = await genereazaAnuntAfisare({ proiect: PROIECT_MODEL, uat: UAT_MODEL, parcele: PARCELE_MODEL, templateArrayBuffer: sablon(), dataDocument: DATA_MODEL })
    expect(r.randuri).toBe(6)
    expect([r.campuri.imputernicire_data, r.campuri.zi1, r.campuri.zi3, r.campuri.data]).toEqual([DATA_MODEL, DATA_MODEL, DATA_MODEL, DATA_MODEL])
    expect(r.campuri.contract_nr).toBe('30')   // contractul din planul transmis Transgaz (public în plan)
    for (const v of [r.campuri.uat, r.campuri.imputernicire_nr, r.campuri.reprezentant_tgz, r.campuri.semnatar_gazpet, r.campuri.contact_telefon]) expect(v).toMatch(/^_+$/)
    const text = await textDocx(r.blob)
    expect(text).toContain('Ziua 1 | __.__.____ | 09:00 – 16:00 | ____________________')
    expect(text).toContain('Nr. | Sat | Tarla | Nr. cadastral / parcelă | Poz. HG | Tronson')
    expect(text).toContain('[cod QR: pagina publică a informării]')
    expect(text).not.toMatch(/\d\d\.\d\d\.20(?!25)\d\d/)   // singura dată reală: contractul 22.01.2025
    // exemplul sintetic de paginare: 150 de rânduri, fără nume de persoane
    expect(parceleExemplu(150)).toHaveLength(150)
    expect(JSON.stringify(parceleExemplu(150))).not.toMatch(/nume|adresa|telefon/)
  })
})

describe('L19 — aceeași sursă a zilelor / programului / contractului / contactului ca la convocator și adresa UAT', () => {
  const cazuri = [
    UAT,
    { ...UAT, sesiune_zi2: null, program_zi2: null, sate_zi2: null, sesiune_zi3: null, program_zi3: null, sate_zi3: null },
    { ...UAT, program_zi1: '08:30 – 12:00', sate_zi1: '', sesiune_zi3: '2027-01-02' },
    { ...UAT, sesiune_zi1: null, program_zi1: '', sesiune_zi2: '2026-12-11', program_zi2: '10:00 – 14:00' },
  ]
  const CHEI_SESIUNI = ['zi1', 'program1', 'sate_zi1', 'zi2', 'program2', 'sate_zi2', 'zi3', 'program3', 'sate_zi3']
  const CHEI_CONTRACT = ['contract_nr', 'contract_data', 'proiect_denumire', 'imputernicire_nr', 'imputernicire_data']
  const CHEI_CONTACT = ['contact_nume', 'contact_telefon', 'contact_email']
  const alege = (o, chei) => Object.fromEntries(chei.map(k => [k, o[k]]))
  it('paritate pe același tabel de cazuri: anunț = adresa UAT = helper-ul comun (zile, program, sate, contract, împuternicire, contact)', async () => {
    const sablonAdresa = readFileSync('public/redari/sabloane/adresa_uat.docx')
    for (const uat of cazuri) {
      const anunt = await genereazaAnuntAfisare({ proiect: PROIECT, uat, parcele: [parcela(1)], templateArrayBuffer: sablon(), strict: false })
      const adresa = await genereazaAdresaUat({ proiect: PROIECT, uat, parcele: [parcela(1)], nrDocument: 'AU-TEST', templateArrayBuffer: sablonAdresa, strict: false })
      expect(alege(anunt.campuri, CHEI_SESIUNI)).toEqual(campuriSesiuniUat(uat))
      expect(alege(adresa.campuri, CHEI_SESIUNI)).toEqual(campuriSesiuniUat(uat))
      expect(alege(anunt.campuri, CHEI_CONTRACT)).toEqual(campuriContractProiect(PROIECT))
      expect(alege(adresa.campuri, CHEI_CONTRACT)).toEqual(campuriContractProiect(PROIECT))
      expect(alege(anunt.campuri, CHEI_CONTACT)).toEqual(campuriContactGazpet(PROIECT))
      expect(alege(adresa.campuri, CHEI_CONTACT)).toEqual(campuriContactGazpet(PROIECT))
    }
    // valorile așteptate ale helper-ului, independent (din fixture): dată RO, lipsă → ''
    expect(campuriSesiuniUat(cazuri[1])).toEqual({ zi1: '10.12.2026', program1: '09:00 – 16:00', sate_zi1: 'Satul A, tarlalele 1–5', zi2: '', program2: '', sate_zi2: '', zi3: '', program3: '', sate_zi3: '' })
    expect(campuriContractProiect(PROIECT)).toEqual({ contract_nr: 'TEST-30', contract_data: '22.01.2025', proiect_denumire: PROIECT.denumire, imputernicire_nr: 'IMP-TEST', imputernicire_data: '01.11.2026' })
    expect(campuriContactGazpet(PROIECT, { telefon: '0700 999 999' })).toEqual({ contact_nume: 'Contact FICTIV', contact_telefon: '0700 999 999', contact_email: 'test@example.invalid' })
  })
  it('și convocatorul (Model 1) ia zilele / contractul / contactul din același loc', async () => {
    const detinator = { id: 'd-fictiv', nume: 'DEȚINĂTOR FICTIV', calitate: 'proprietar' }
    const contactDetinator = { adresa_strada: 'Str. Fictivă 1', adresa_sat: 'Satul A', adresa_comuna: 'Comuna FICTIVĂ', adresa_judet: 'Județ FICTIV', cod_postal: '000000' }
    const informare = { text: TEXT_INFORMARE_LOT1, publicata: true }
    for (const uat of cazuri) {
      const r = await genereazaConvocator({ detinator, contactDetinator, parcela: parcela(1), uat, proiect: PROIECT, nrDocument: 'C-TEST', token: 'tokenfictiv00000000000000000000',
        templateArrayBuffer: readFileSync('public/redari/sabloane/convocator.docx'), permiteIncomplet: true, informare })
      expect(alege(r.campuri, CHEI_SESIUNI)).toEqual(campuriSesiuniUat(uat))
      expect(alege(r.campuri, CHEI_CONTRACT)).toEqual(campuriContractProiect(PROIECT))
      expect(alege(r.campuri, CHEI_CONTACT)).toEqual(campuriContactGazpet(PROIECT))
    }
  })
  it('mutant: cele trei generatoare apelează helper-ele comune (nu își construiesc singure zilele / contractul / contactul)', () => {
    const src = readFileSync('src/redari/docx.js', 'utf8')
    const corp = nume => { const i = src.indexOf(`export async function ${nume}(`); const j = src.indexOf('\nexport ', i + 1); return src.slice(i, j < 0 ? undefined : j) }
    for (const g of ['genereazaConvocator', 'genereazaAdresaUat', 'genereazaAnuntAfisare']) {
      const c = corp(g)
      for (const h of ['campuriSesiuniUat(', 'campuriContractProiect(', 'campuriContactGazpet(']) expect(c, `${g} → ${h}`).toContain(h)
      // nicio reconstrucție locală a zilelor / contractului / contactului în corpul generatorului
      expect(c).not.toMatch(/zi1:\s*formatDataRo|contract_nr:\s*p|contact_nume:\s*c\.|contact_telefon:\s*p/)
    }
    // regula „o zi cu program” e una singură (setari.js) — convocator, adresa UAT, anunț, „Gata de convocare?”
    expect(src.match(/areZiCuProgram\(/g).length).toBeGreaterThanOrEqual(3)
    expect(src).not.toMatch(/\[1, 2, 3\]\.some\(i => plin\(u(?:at)?\[`sesiune_zi/)
    expect(readFileSync('src/redari/ui/comune.jsx', 'utf8')).toContain('areZiCuProgram(uat)')
    expect(readFileSync('src/redari/setari.js', 'utf8')).toContain('export const areZiCuProgram')
  })
  it('cheile comune au aceleași nume în cele trei șabloane (CHEI_*), deci helper-ele chiar le acoperă', () => {
    for (const k of [...CHEI_SESIUNI, ...CHEI_CONTRACT, ...CHEI_CONTACT]) {
      expect(CHEI_ANUNT_AFISARE, k).toContain(k)
      expect(CHEI_ADRESA_UAT, k).toContain(k)
      expect(CHEI_CONVOCATOR, k).toContain(k)
    }
  })
})

describe('📬 Notificări — modelul „afisare” reflectă generatorul', () => {
  const pe = l => Object.fromEntries(l.map(m => [m.cod, m]))
  it('aceleași lipsuri ca butonul (verificaDateAnuntAfisare) + consemnarea afișării (perioadă, nr. PV); complet = gata', () => {
    const uatGata = { ...UAT, afisare_pv_nr: 'PV-1' }
    const m = pe(ghidModele({ proiect: PROIECT, uats: [uatGata] })).afisare
    expect([m.stare, m.lipsuri]).toEqual(['gata', []])
    expect(m.unde).toContain('Anunț de afișare (DOCX)')
    expect(m.ce).toMatch(/fără date personale/)
    const lipsa = pe(ghidModele({ proiect: { ...PROIECT, contact_telefon: '' }, uats: [{ ...uatGata, afisare_pv_nr: null }] })).afisare
    expect(lipsa.stare).toBe('blocat')
    expect(lipsa.lipsuri).toEqual([`Lipsește ${ETICHETA_CAMP_PROIECT.contact_telefon}: Comuna FICTIVĂ`, 'nr. PV de afișare: Comuna FICTIVĂ'])
  })
})
