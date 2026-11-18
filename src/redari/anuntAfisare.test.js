// Redări — anunțul de afișare la primărie (convocarea pe UAT; planul procedurii de predare rev. 1, pct. 4.3 + cap. 8).
// Șablonul real (public/redari/sabloane/anunt_afisare.docx), textul-sursă (docs/redari/TEXT_ANUNT_AFISARE.md) și generatorul din docx.js.
// Date fictive, fără persoane reale. Valorile așteptate vin din text, din plan și din fixture, nu din generator.
import { describe, it, expect, vi, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
// notificari.js → ui/comune.jsx importă clientul Supabase; testul nu face cereri (ca în sabloaneFinalV2.test.js)
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import {
  CHEI_ANUNT_AFISARE, CAMPURI_PARCELA_ANUNT, COL_PARCELA_ANUNT, LINK_INFORMARE_PUBLIC, SABLON_ANUNT_AFISARE, MESAJ_ANUNT_FARA_PARCELE,
  MESAJ_ANUNT_INFORMARE_NEVERIFICATA, verificaDateAnuntAfisare, randuriAnuntAfisare, genereazaAnuntAfisare, genereazaAdresaUat,
  genereazaConvocator, campuriSesiuniUat, campuriContractProiect, campuriContactGazpet, ETICHETA_CAMP_PROIECT, CHEI_ADRESA_UAT, CHEI_CONVOCATOR,
  verificaDateAdresaUat, verificaDateConvocator,
} from './docx.js'
import { MOTIV_INFORMARE_NEPUBLICATA, TEXT_INFORMARE_LOT1 } from './informareGdpr.js'
import { ORIGINE_PUBLICA_REDARI } from './domeniuPublic.js'
import { ghidModele } from './notificari.js'
import { parseazaText, PAGINA, LATIME_UTILA } from '../../scripts/redari_sablon_anunt_afisare.mjs'
import { PROIECT_MODEL, UAT_MODEL, UAT_EXEMPLU, PARCELE_MODEL, parceleExemplu, textDocx, DATA_MODEL } from '../../scripts/redari_model_anunt_afisare.mjs'
import { partiXmlDocx } from './xmlBineFormat.testutil.js'
import { areFormaIdentificator, sateDeclarate, verificaIdentificatoriPublicati, textProblemeIdentificatori, MESAJ_IDENTIFICATORI_REFUZATI, MESAJ_SAT_NEDECLARAT, RE_NECOMPLETAT, LUNGIME_MAX_IDENTIFICATOR } from './identificatoriPublici.js'
import { tronsonOptional } from './importTgz.js'

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
// Tabelul de cazuri de UAT pentru paritate (zile / programe / sate lipsă sau diferite) — folosit de L19 și de paritatea cu origin/main
const cazuri = [
  UAT,
  { ...UAT, sesiune_zi2: null, program_zi2: null, sate_zi2: null, sesiune_zi3: null, program_zi3: null, sate_zi3: null },
  { ...UAT, program_zi1: '08:30 – 12:00', sate_zi1: '', sesiune_zi3: '2027-01-02' },
  { ...UAT, sesiune_zi1: null, program_zi1: '', sesiune_zi2: '2026-12-11', program_zi2: '10:00 – 14:00' },
]

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
  it('lista albă: coloanele de deținător lipite de rândul parcelei (nume / adresă / telefon / e-mail / CNP / cotă / token) nu ajung în arhivă, în câmpuri sau în select (contaminarea câmpurilor publicate: secțiunea „identificatorii publicați”)', async () => {
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
      // caracterele speciale XML într-un câmp liber (programul zilei); identificatorii parcelelor nu pot conține „<&>” (forma lor e strictă)
      const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: { ...UAT, program_zi1: '09:00 <&> "x"' }, parcele: Array.from({ length: n }, (_, i) => parcela(i + 1)), templateArrayBuffer: sablon() })
      const { zip, xml } = await docDin(r.blob)
      await asteapta(zip)
      expect(xml).toContain('09:00 &lt;&amp;&gt; &quot;x&quot;')
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
    // marcajul „____” al modelului trece de forma identificatorilor (nu poartă informație), dar „___x” nu
    for (const p of PARCELE_MODEL) for (const k of CAMPURI_PARCELA_ANUNT) expect(RE_NECOMPLETAT.test(String(p[k])), `${k}=${p[k]}`).toBe(true)
    expect(areFormaIdentificator('sat', '___x', { uat: UAT_MODEL })).toBe(false)
    expect(areFormaIdentificator('tarla', '_')).toBe(false)
    // exemplul sintetic de paginare: 150 de rânduri, fără nume de persoane; satele lui sunt declarate pe UAT_EXEMPLU (altfel e refuzat)
    expect(parceleExemplu(150)).toHaveLength(150)
    expect(JSON.stringify(parceleExemplu(150))).not.toMatch(/nume|adresa|telefon/)
    expect((await genereazaAnuntAfisare({ proiect: PROIECT_MODEL, uat: UAT_EXEMPLU, parcele: parceleExemplu(150), templateArrayBuffer: sablon(), dataDocument: '2026-11-18' })).randuri).toBe(150)
    const refuz = await genereazaAnuntAfisare({ proiect: PROIECT_MODEL, uat: UAT_MODEL, parcele: parceleExemplu(3), templateArrayBuffer: sablon() }).catch(e => e)
    expect(refuz.probleme).toEqual([1, 2, 3].map(i => ({ id_parcela: `T0-EXE-000${i}`, camp: 'sat' })))
  })
})

// ── Încărcarea generatorului (docx.js + închiderea importurilor lui locale) dintr-o altă sursă: origin/main (referință INDEPENDENTĂ de
// ramură, ca la mailTrimitereF2b.test.js) sau arborele de lucru cu o MUTAȚIE (validarea scoasă). Fișierele merg în .tmp/ (ignorat de git). ──
const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
const foldere = []
afterAll(() => { for (const f of foldere) rmSync(f, { recursive: true, force: true }) })
const RX_IMPORT_LOCAL = /from\s+'\.\/([\w.-]+\.js)'/g
const sursaModul = (nume, ref) => (ref === 'lucru'
  ? readFileSync(resolve('src/redari', nume), 'utf8')
  : execFileSync('git', ['show', `${ref}:src/redari/${nume}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).replace(/\r\n/g, '\n')
async function incarcaDocx(ref, mutatie = null) {
  const dir = mkdtempSync(join(TMP, 'anunt_docx_')); foldere.push(dir)
  const surse = new Map(); const coada = ['docx.js']
  while (coada.length) {
    const n = coada.shift(); if (surse.has(n)) continue
    let t = sursaModul(n, ref)
    if (mutatie && mutatie.fisier === n) {
      if (t.split(mutatie.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${n}: ${mutatie.din}`)
      t = t.replace(mutatie.din, mutatie.in)
    }
    surse.set(n, t)
    for (const m of t.matchAll(RX_IMPORT_LOCAL)) coada.push(m[1])
  }
  for (const [n, t] of surse) writeFileSync(join(dir, n), t)
  const mod = await import(pathToFileURL(join(dir, 'docx.js')).href + `?v=${Date.now()}${Math.random()}`)
  return { mod, fisiere: [...surse.keys()] }
}
const areOriginMain = (() => { try { execFileSync('git', ['rev-parse', '--verify', 'origin/main^{commit}'], { stdio: ['ignore', 'pipe', 'ignore'] }); return true } catch { return false } })()

describe('identificatorii publicați (review #1137 P1): forma fiecărui câmp, o singură definiție, refuz cu lista parcelelor', () => {
  // valori contaminate (fictive), câte una pe câmp: nume în sat, adresă în tarla, CNP în nr_cadastral, cotă în poz_hg, telefon în tronson
  const CONTAMINATE = { sat: 'POPESCU Ion', tarla: 'Str. Fictivă nr. 7', nr_cadastral: '1800101000000', poz_hg: '1/2', tronson: '0711 111 111' }
  const genereaza = (parcele, extra = {}) => genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon(), ...extra })
  it('un nume în sat / o adresă în tarla / un CNP în nr_cadastral / o cotă în poz_hg / un telefon în tronson → generarea e BLOCATĂ (și cu strict=false), cu lista exactă (id_parcela + câmp) și FĂRĂ valoarea în mesaj', async () => {
    for (const [camp, valoare] of Object.entries(CONTAMINATE)) {
      for (const strict of [true, false]) {
        const err = await genereaza([parcela(1), parcela(2, { [camp]: valoare })], { strict }).catch(e => e)
        expect(err, `${camp} strict=${strict}`).toBeInstanceOf(Error)
        expect(err.probleme).toEqual([{ id_parcela: 'T1-FIC-0002', camp }])
        expect(err.message).toContain(MESAJ_IDENTIFICATORI_REFUZATI)
        expect(err.message).toContain('T1-FIC-0002')
        expect(err.message).not.toContain(valoare)
        expect(JSON.stringify(err.probleme)).not.toContain(valoare)
      }
    }
    // toate cinci pe parcele diferite + o parcelă bună → lista are exact cele cinci, în ordinea parcelelor, apoi a coloanelor
    const parcele = [parcela(1), ...Object.entries(CONTAMINATE).map(([camp, valoare], i) => parcela(i + 2, { [camp]: valoare })), parcela(9, { sat: 'POPESCU Ion', tronson: '0711 111 111' })]
    const err = await genereaza(parcele).catch(e => e)
    expect(err.probleme).toEqual([...Object.keys(CONTAMINATE).map((camp, i) => ({ id_parcela: `T1-FIC-000${i + 2}`, camp })), { id_parcela: 'T1-FIC-0009', camp: 'sat' }, { id_parcela: 'T1-FIC-0009', camp: 'tronson' }])
    expect(textProblemeIdentificatori(err.probleme)).toBe(`sat: T1-FIC-0002, T1-FIC-0009; tarla: T1-FIC-0003; nr. cadastral / parcelă: T1-FIC-0004; poz. HG: T1-FIC-0005; tronson: T1-FIC-0006, T1-FIC-0009; (${MESAJ_SAT_NEDECLARAT})`)
    // o parcelă ȘTEARSĂ cu valori contaminate nu intră în listă (nu se publică oricum)
    expect((await genereaza([parcela(1), parcela(2, { ...CONTAMINATE, sters_la: '2026-11-01T00:00:00Z' })])).randuri).toBe(1)
  })
  it('valorile reale de formă din fixture-urile importului (TGZ / Anexa 7 / CONTRACT_SCHEMA) trec: tarla „T12” „T 12” „12” „T12/1” „12A”, cadastru „CF 1001” „52#” „#44#” „50029#30#” „##” „123/4” „DE”, poz. HG „117” „12A” „HG 1”, tronson 1..11, gol', async () => {
    const BUNE = {
      tarla: ['T12', 'T 12', 'T.12', 'Tarla 1', '12', 'T12/1', 'T13-2', '12A', 'T20', 'T1'],
      nr_cadastral: ['CF 1001', 'cf 1010', 'CF 1', '100', '5001', '52#', '#44#', '50029#30#', '##', '123/4', '1234/2/1', 'DE', '12A', ''],
      poz_hg: ['117', '1', '12A', '12 A', '12 BIS', 'HG 1', 'hg  9', 'HG 117'],
      tronson: [1, 3, 11, '3', '11', null, undefined, ''],
      sat: ['Satul A', 'Satul B', 'satul a', 'SATUL B', ' Satul A ', null, ''],
    }
    for (const [camp, valori] of Object.entries(BUNE)) for (const v of valori) expect(areFormaIdentificator(camp, v, { uat: UAT }), `${camp}=${JSON.stringify(v)}`).toBe(true)
    // tronsonul = exact regula importului (tronsonOptional), nu una nouă (L19)
    for (const v of [0, 12, '0', '12', '3x', 2.5, true, '0711 111 111']) { expect(tronsonOptional(v)).toBeNull(); expect(areFormaIdentificator('tronson', v)).toBe(false) }
    // documentul se generează cu aceste forme (TGZ: cadastrul compus cu „#” rămâne ca în BD)
    const r = await genereaza([parcela(1, { sat: 'Satul B', tarla: 'T 12', nr_cadastral: '50029#30#', poz_hg: '117', tronson: 11 }), parcela(2, { sat: null, tarla: '12A', nr_cadastral: '##', poz_hg: 'HG 1', tronson: null })])
    const lista = [...(await docDin(r.blob)).xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0]).at(-1)
    const randuri = [...lista.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => textWt(m[0]))
    expect(randuri.slice(1)).toEqual([['1', '', '12A', '##', 'HG 1', ''], ['2', 'Satul B', 'T 12', '50029#30#', '117', '11']])
  })
  it('refuzuri pe formă, pe fiecare câmp: tarla cu litere / peste 4 cifre, cadastru cu 13 cifre sau cuvânt, poz. HG cu „/” „%” sau cuvânt, tronson în afara 1..11, orice valoare peste 40 de caractere sau obiect', () => {
    const RELE = {
      tarla: ['Str. Fictivă nr. 7', 'T12345', 'Ion', 'T', 'T12/1/1', 'POPESCU', '12 A B'],
      nr_cadastral: ['1800101000000', 'Ion', 'DEX', 'CF 1001 2', '1234567', 'POPESCU ION', '50029#Ion#'],
      poz_hg: ['1/2', '50%', '123456', '12345/1', 'POPESCU', 'HG', '12 A B'],
      tronson: ['0711 111 111', 0, 12, '3x', 2.5, true, 'unu'],
      sat: ['POPESCU Ion (fictiv)', 'Peri Nou', 'Satul C', 'Satul A 2', 'restul', 'tarlalele 1–5', 'A'],
    }
    for (const [camp, valori] of Object.entries(RELE)) for (const v of valori) expect(areFormaIdentificator(camp, v, { uat: UAT }), `${camp}=${JSON.stringify(v)}`).toBe(false)
    for (const camp of CAMPURI_PARCELA_ANUNT) {
      expect(areFormaIdentificator(camp, '1'.repeat(LUNGIME_MAX_IDENTIFICATOR + 1), { uat: UAT })).toBe(false)
      expect(areFormaIdentificator(camp, { x: 1 }, { uat: UAT })).toBe(false)
      expect(areFormaIdentificator(camp, ['1'], { uat: UAT })).toBe(false)
    }
    expect(areFormaIdentificator('nume', 'T12')).toBe(false)   // câmp necunoscut = nu se publică
    expect(verificaIdentificatoriPublicati([{ id_parcela: 'X-1', sat: 'POPESCU Ion' }, null, { sat: 'Y' }], ['sat'], UAT)).toEqual([{ id_parcela: 'X-1', camp: 'sat' }, { id_parcela: '?', camp: 'sat' }])
  })
  it('satul: doar unul dintre satele DECLARATE la „Sate / tarlale ziua 1–3” (fără diacritice / majuscule, cu sau fără „Satul”); indicațiile de program („tarlalele 1–5”, „restul”, parantezele) nu devin sate', () => {
    expect([...sateDeclarate(UAT)]).toEqual(['SATUL A', 'SATUL B'])   // „tarlalele 1–5” și „restul” nu sunt sate; „A” singur e prea scurt
    const u = { sate_zi1: 'sat Peri (tarlalele 1–5); Husnicioara și Gârnița', sate_zi2: 'Marga – T7-T9, Dumbrava de Jos', sate_zi3: 'toate satele' }
    expect([...sateDeclarate(u)].sort()).toEqual(['DUMBRAVA DE JOS', 'GARNITA', 'HUSNICIOARA', 'MARGA', 'PERI', 'SAT PERI'])
    for (const sat of ['Peri', 'PERI', 'Gârnița', 'Garnita', 'sat Peri', 'Satul Peri', 'Dumbrava de Jos', 'Marga']) expect(areFormaIdentificator('sat', sat, { uat: u }), sat).toBe(true)
    for (const sat of ['Peri Nou', 'Jos', 'toate satele', 'POPESCU Ion', 'T7']) expect(areFormaIdentificator('sat', sat, { uat: u }), sat).toBe(false)
    // UAT fără sate declarate: orice sat nevid e refuzat (satul gol trece — TGZ nu are coloana „sat”)
    expect(areFormaIdentificator('sat', 'Peri', { uat: { sate_zi1: 'tarlalele 1–20' } })).toBe(false)
    expect(areFormaIdentificator('sat', '', { uat: {} })).toBe(true)
    expect(sateDeclarate(undefined).size).toBe(0)
  })
  it('MUTANT: validarea scoasă din genereazaAnuntAfisare → numele din „sat” AJUNGE în document (deci testul de blocare chiar păzește); cu validarea, aceleași parcele sunt refuzate', async () => {
    const mutatie = { fisier: 'docx.js', din: '  if (probleme.length) {\n', in: '  if (false) {\n' }
    const { mod: mutant, fisiere } = await incarcaDocx('lucru', mutatie)
    expect(fisiere).toContain('identificatoriPublici.js')
    const parcele = [parcela(1), parcela(2, { sat: 'POPESCU Ion' })]
    const r = await mutant.genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon() })
    expect((await docDin(r.blob)).xml).toContain('POPESCU Ion')   // mutantul publică numele
    const { mod: intact } = await incarcaDocx('lucru')
    const err = await intact.genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon() }).catch(e => e)
    expect(err.probleme).toEqual([{ id_parcela: 'T1-FIC-0002', camp: 'sat' }])
    // regula de formă e UNA (identificatoriPublici.js): generatorul anunțului n-are regex-uri proprii pe aceste câmpuri, UI-ul doar afișează lista
    const src = readFileSync('src/redari/docx.js', 'utf8')
    expect(src.match(/verificaIdentificatoriPublicati\(/g)).toHaveLength(1)   // un singur apel (importul e pe altă formă)
    const corpAnunt = src.slice(src.indexOf('export function randuriAnuntAfisare('), src.indexOf('export async function genereazaAnuntAfisare(') + 1)
      + src.slice(src.indexOf('export async function genereazaAnuntAfisare('))
    expect(corpAnunt).not.toMatch(/\/\^|new RegExp/)
    expect(readFileSync('src/redari/ui/UatEcran.jsx', 'utf8')).toContain('textProblemeIdentificatori(err.probleme)')
  })
})

describe('PARITATE cu origin/main (referință independentă): convocatorul și adresa UAT ies IDENTIC (câmpuri + hash DOCX)', () => {
  const PROIECTE = [PROIECT, { ...PROIECT, reprezentant_tgz_functie: '', contact_telefon: null, imputernicire_data: null }]
  const detinator = { id: 'd-fictiv', nume: 'DEȚINĂTOR FICTIV', calitate: 'proprietar' }
  const contactDetinator = { adresa_strada: 'Str. Fictivă 1', adresa_sat: 'Satul A', adresa_comuna: 'Comuna FICTIVĂ', adresa_judet: 'Județ FICTIV', cod_postal: '000000' }
  it.skipIf(!areOriginMain)('adresa UAT (Model 4): generatorul de pe origin/main și cel din ramură dau aceleași câmpuri și același DOCX pe 4 UAT-uri × 2 proiecte', async () => {
    const { mod: main, fisiere } = await incarcaDocx('origin/main')
    expect(fisiere).not.toContain('identificatoriPublici.js')   // chiar e versiunea veche (fără validarea nouă)
    const sablonAdresa = readFileSync('public/redari/sabloane/adresa_uat.docx')
    let cazuriRulate = 0
    for (const uat of cazuri) for (const pr of PROIECTE) {
      const arg = { proiect: pr, uat, parcele: [parcela(2), parcela(1)], nrDocument: 'AU-TEST', templateArrayBuffer: sablonAdresa, strict: false, dataDocument: '2026-11-18' }
      const [vechi, nou] = [await main.genereazaAdresaUat(arg), await genereazaAdresaUat(arg)]
      expect(nou.campuri).toEqual(vechi.campuri)
      expect(nou.hash).toBe(vechi.hash)
      expect(main.verificaDateAdresaUat({ proiect: pr, uat, nrDocument: 'AU-TEST' })).toEqual(verificaDateAdresaUat({ proiect: pr, uat, nrDocument: 'AU-TEST' }))
      cazuriRulate++
    }
    expect(cazuriRulate).toBe(8)
  })
  it.skipIf(!areOriginMain)('convocatorul (Model 1): aceleași câmpuri, același DOCX și aceleași lipsuri ca pe origin/main, pe 4 UAT-uri × 2 proiecte', async () => {
    const { mod: main } = await incarcaDocx('origin/main')
    const sablonConvocator = readFileSync('public/redari/sabloane/convocator.docx')
    const informare = { text: TEXT_INFORMARE_LOT1, publicata: true }
    let cazuriRulate = 0
    for (const uat of cazuri) for (const pr of PROIECTE) {
      const arg = { detinator, contactDetinator, parcela: parcela(1), uat, proiect: pr, nrDocument: 'C-TEST', token: 'tokenfictiv00000000000000000000', templateArrayBuffer: sablonConvocator, permiteIncomplet: true, informare, dataDocument: '2026-11-18' }
      const [vechi, nou] = [await main.genereazaConvocator(arg), await genereazaConvocator(arg)]
      expect(nou.campuri).toEqual(vechi.campuri)
      expect(nou.hash).toBe(vechi.hash)
      const argV = { nrDocument: 'C-TEST', token: 'tokenfictiv00000000000000000000', uat, proiect: pr, detinator, contactDetinator, informare }
      expect(main.verificaDateConvocator(argV)).toEqual(verificaDateConvocator(argV))
      cazuriRulate++
    }
    expect(cazuriRulate).toBe(8)
  })
})

describe('L19 — aceeași sursă a zilelor / programului / contractului / contactului ca la convocator și adresa UAT', () => {
  const CHEI_SESIUNI = ['zi1', 'program1', 'sate_zi1', 'zi2', 'program2', 'sate_zi2', 'zi3', 'program3', 'sate_zi3']
  const CHEI_CONTRACT = ['contract_nr', 'contract_data', 'proiect_denumire', 'imputernicire_nr', 'imputernicire_data']
  const CHEI_CONTACT = ['contact_nume', 'contact_telefon', 'contact_email']
  const alege = (o, chei) => Object.fromEntries(chei.map(k => [k, o[k]]))
  it('paritate pe același tabel de cazuri: anunț = adresa UAT = helper-ul comun (zile, program, sate, contract, împuternicire, contact)', async () => {
    const sablonAdresa = readFileSync('public/redari/sabloane/adresa_uat.docx')
    for (const uat of cazuri) {
      // satul gol: cazurile 2 și 3 nu declară ambele sate, iar forma identificatorilor se verifică și cu strict=false
      const anunt = await genereazaAnuntAfisare({ proiect: PROIECT, uat, parcele: [parcela(1, { sat: null })], templateArrayBuffer: sablon(), strict: false })
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
