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
import {
  areFormaIdentificator, canonizeazaIdentificator, canonizeazaParcelePublicate, sateDeclarate, verificaIdentificatoriPublicati, textProblemeIdentificatori,
  MESAJ_IDENTIFICATORI_REFUZATI, MESAJ_SAT_NEDECLARAT, RE_NECOMPLETAT, LUNGIME_MAX_IDENTIFICATOR, MAX_CIFRE_SUBCAMP, MOTIV, ETICHETA_MOTIV,
} from './identificatoriPublici.js'
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
    // rândurile au exact coloanele din lista albă, cu valorile canonice (șiruri), nu obiectele parcelelor
    const { randuri: rand, probleme } = randuriAnuntAfisare(parcele, UAT)
    expect(probleme).toEqual([])
    expect(rand).toHaveLength(9)
    for (const x of rand) {
      expect(Object.keys(x).sort()).toEqual(['nr', ...CAMPURI_PARCELA_ANUNT].sort())
      for (const k of CAMPURI_PARCELA_ANUNT) expect(typeof x[k], k).toBe('string')
    }
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
    expect(randuriAnuntAfisare([parcela(1, { tarla: 'T10' }), parcela(2, { tarla: 'T2' })], UAT).randuri.map(x => x.tarla)).toEqual(['T2', 'T10'])
    // ordinea pe forma publicată a TGZ-ului compus („31#” rămâne „31#”): 9 < 31 < 123, nu alfabetic
    expect(randuriAnuntAfisare([parcela(1, { tarla: '123#' }), parcela(2, { tarla: '9#' }), parcela(3, { tarla: '31#' })], UAT).randuri.map(x => x.tarla)).toEqual(['9#', '31#', '123#'])
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
    expect(refuz.probleme).toEqual([1, 2, 3].map(i => ({ id_parcela: `T0-EXE-000${i}`, camp: 'sat', motiv: MOTIV.SAT_NEDECLARAT })))
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
async function incarcaDocx(ref, mutatii = []) {
  const lista = Array.isArray(mutatii) ? mutatii : (mutatii ? [mutatii] : [])
  const dir = mkdtempSync(join(TMP, 'anunt_docx_')); foldere.push(dir)
  const surse = new Map(); const coada = ['docx.js']
  while (coada.length) {
    const n = coada.shift(); if (surse.has(n)) continue
    let t = sursaModul(n, ref)
    for (const mutatie of lista.filter(x => x.fisier === n)) {
      if (t.split(mutatie.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${n}: ${mutatie.din}`)
      t = t.replace(mutatie.din, mutatie.in)
    }
    surse.set(n, t)
    for (const m of t.matchAll(RX_IMPORT_LOCAL)) coada.push(m[1])
  }
  for (const [n, t] of surse) writeFileSync(join(dir, n), t)
  const v = `?v=${Date.now()}${Math.random()}`
  const mod = await import(pathToFileURL(join(dir, 'docx.js')).href + v)
  // același modul de validare pe care îl folosește generatorul încărcat (aceeași cheie de import, deci aceeași instanță)
  const idp = surse.has('identificatoriPublici.js') ? await import(pathToFileURL(join(dir, 'identificatoriPublici.js')).href) : null
  return { mod, idp, fisiere: [...surse.keys()] }
}
const areOriginMain = (() => { try { execFileSync('git', ['rev-parse', '--verify', 'origin/main^{commit}'], { stdio: ['ignore', 'pipe', 'ignore'] }); return true } catch { return false } })()

describe('identificatorii publicați (review #1137 P1): forma fiecărui câmp, o singură definiție, refuz cu lista parcelelor', () => {
  // valori contaminate (fictive), câte una pe câmp: nume în sat, adresă în tarla, CNP în nr_cadastral, cotă în poz_hg, telefon în tronson
  const CONTAMINATE = { sat: 'POPESCU Ion', tarla: 'Str. Fictivă nr. 7', nr_cadastral: '1800101000000', poz_hg: '1/2', tronson: '0711 111 111' }
  const genereaza = (parcele, extra = {}) => genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon(), ...extra })
  // motivul așteptat pe fiecare contaminare: numele nu e sat declarat, adresa n-are forma, CNP-ul are 13 cifre, cota e „a/b” cu a ≤ b, telefonul are 10 cifre
  const MOTIVE = { sat: MOTIV.SAT_NEDECLARAT, tarla: MOTIV.FORMA, nr_cadastral: MOTIV.TELEFON_CNP, poz_hg: MOTIV.COTA, tronson: MOTIV.TELEFON_CNP }
  it('un nume în sat / o adresă în tarla / un CNP în nr_cadastral / o cotă în poz_hg / un telefon în tronson → generarea e BLOCATĂ (și cu strict=false), cu lista exactă (id_parcela + câmp + motiv) și FĂRĂ valoarea în mesaj', async () => {
    for (const [camp, valoare] of Object.entries(CONTAMINATE)) {
      for (const strict of [true, false]) {
        const err = await genereaza([parcela(1), parcela(2, { [camp]: valoare })], { strict }).catch(e => e)
        expect(err, `${camp} strict=${strict}`).toBeInstanceOf(Error)
        expect(err.probleme).toEqual([{ id_parcela: 'T1-FIC-0002', camp, motiv: MOTIVE[camp] }])
        expect(err.message).toContain(MESAJ_IDENTIFICATORI_REFUZATI)
        expect(err.message).toContain('T1-FIC-0002')
        expect(err.message).not.toContain(valoare)
        expect(JSON.stringify(err.probleme)).not.toContain(valoare)
      }
    }
    // toate cinci pe parcele diferite + o parcelă bună → lista are exact cele cinci, în ordinea parcelelor, apoi a coloanelor; motivul apare ca etichetă, nu valoarea
    const parcele = [parcela(1), ...Object.entries(CONTAMINATE).map(([camp, valoare], i) => parcela(i + 2, { [camp]: valoare })), parcela(9, { sat: 'POPESCU Ion', tronson: '0711 111 111' })]
    const err = await genereaza(parcele).catch(e => e)
    expect(err.probleme).toEqual([...Object.keys(CONTAMINATE).map((camp, i) => ({ id_parcela: `T1-FIC-000${i + 2}`, camp, motiv: MOTIVE[camp] })), { id_parcela: 'T1-FIC-0009', camp: 'sat', motiv: MOTIV.SAT_NEDECLARAT }, { id_parcela: 'T1-FIC-0009', camp: 'tronson', motiv: MOTIV.TELEFON_CNP }])
    const CIFRE = ETICHETA_MOTIV[MOTIV.TELEFON_CNP], COTA = ETICHETA_MOTIV[MOTIV.COTA]
    expect(textProblemeIdentificatori(err.probleme)).toBe(`sat: T1-FIC-0002, T1-FIC-0009; tarla: T1-FIC-0003; nr. cadastral / parcelă: T1-FIC-0004 (${CIFRE}); poz. HG: T1-FIC-0005 (${COTA}); tronson: T1-FIC-0006 (${CIFRE}), T1-FIC-0009 (${CIFRE}); (${MESAJ_SAT_NEDECLARAT})`)
    for (const valoare of Object.values(CONTAMINATE)) expect(textProblemeIdentificatori(err.probleme)).not.toContain(valoare)
    // a doua barieră, independentă de poarta din generator: dintr-o listă cu refuzuri nu se construiește NICIUN rând
    expect(randuriAnuntAfisare(parcele, UAT).randuri).toEqual([])
    expect(canonizeazaParcelePublicate(parcele, CAMPURI_PARCELA_ANUNT, UAT).randuri).toEqual([])
    // o parcelă ȘTEARSĂ cu valori contaminate nu intră în listă (nu se publică oricum)
    expect((await genereaza([parcela(1), parcela(2, { ...CONTAMINATE, sters_la: '2026-11-01T00:00:00Z' })])).randuri).toBe(1)
  })
  it('tabelul din verdictul r2 (27f5567c): „1/2” în tarla și în nr. cadastral, „0711/111/111” și „180010/100000/0” în nr. cadastral, „1/2” în poz. HG → refuzate cu motivul lor; „12//3” nu mai trece normalizat ca „12/3”', () => {
    const VERDICT_R2 = [
      ['tarla', '1/2', MOTIV.COTA], ['nr_cadastral', '1/2', MOTIV.COTA], ['nr_cadastral', '0711/111/111', MOTIV.TELEFON_CNP],
      ['nr_cadastral', '180010/100000/0', MOTIV.TELEFON_CNP], ['poz_hg', '1/2', MOTIV.COTA], ['tarla', '12//3', MOTIV.FORMA],
    ]
    for (const [camp, v, motiv] of VERDICT_R2) expect(canonizeazaIdentificator(camp, v, { uat: UAT }), `${camp}=${v}`).toEqual({ ok: false, motiv })
    // „12/3” (a > b) e o subdiviziune legitimă și se publică exact așa; „12//3” e refuzată, nu reparată
    expect(canonizeazaIdentificator('tarla', '12/3')).toEqual({ ok: true, valoare: '12/3' })
  })
  it('se publică EXACT șirul validat: doar majuscule / spații simple („cf  1010” → „CF 1010”, „hg  9” → „HG 9”), TGZ-ul compus rămâne cu „#” („50029#30#”), satul cu ortografia DECLARATĂ („GARNITA” → „Gârnița”); subcâmpurile NU se lipesc cu „ / ” („1#2#” nu devine „1 / 2”)', async () => {
    const uat = { ...UAT, sate_zi1: 'Gârnița, tarlalele 1–5' }
    const parcele = [parcela(1, { sat: 'GARNITA', tarla: '31#', nr_cadastral: '50029#30#', poz_hg: '117', tronson: '3' }), parcela(2, { sat: 'satul b', tarla: 't 12', nr_cadastral: 'cf  1010', poz_hg: 'hg  9', tronson: 2 }),
      parcela(3, { sat: 'Satul B', tarla: 'T20', nr_cadastral: '1#2#', poz_hg: '5', tronson: 1 })]
    const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat, parcele, templateArrayBuffer: sablon() })
    const { xml } = await docDin(r.blob)
    const lista = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0]).at(-1)
    const randuri = [...lista.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => textWt(m[0]))
    expect(randuri.slice(1)).toEqual([['1', 'Gârnița', '31#', '50029#30#', '117', '3'], ['2', 'Satul B', 'T 12', 'CF 1010', 'HG 9', '2'], ['3', 'Satul B', 'T20', '1#2#', '5', '1']])
    for (const brut of ['GARNITA', 'satul b', 'cf  1010', 'hg  9', '1 / 2', '50029 / 30']) expect(lista, brut).not.toContain(brut)
    // fiecare celulă publicată = EXACT valoarea întoarsă de validare pentru acel câmp (o singură reprezentare)
    const { randuri: rand } = randuriAnuntAfisare(parcele, uat)
    for (const x of rand) {
      // id-ul parcelei nu e în rândul publicat: sursa se regăsește după poz. HG (unică în acest fixture)
      const sursa = parcele.find(q => canonizeazaIdentificator('poz_hg', q.poz_hg).valoare === x.poz_hg)
      for (const k of CAMPURI_PARCELA_ANUNT) expect(x[k], k).toBe(canonizeazaIdentificator(k, sursa[k], { uat }).valoare)
    }
  })
  // ── TABELUL FORMELOR (forma → acceptat cu forma publicată / refuzat cu motivul). Formele „reale” vin din fixture-urile importurilor
  // (TGZ: „T1#”, „123##”, „#123#”, „##UA 62A”, „52#”, „#44#”, „50029#30#”, „##”; Anexa 7: „T12”, „CF100”), din cadastru.js / SABLOANE.md
  // și din CONTRACT_SCHEMA §7; câteva tipare TGZ suplimentare („12IV#”, „#12'(34/5)#”) vin din notele rundei 3 (neverificate pe BD);
  // restul sunt contaminări sintetice. Forma publicată = șirul validat (majuscule, spații simple), cu „#” cu tot; „##” → nimic.
  const ok = valoare => ({ ok: true, valoare }); const nu = motiv => ({ ok: false, motiv })
  const TABEL = [
    // tarla: TGZ compus „<tarla>#<nr. topo>” sau simplu; publicat exact cum a fost validat
    ['tarla', '31#', ok('31#'), 'forma TGZ: tarla + topo gol'], ['tarla', '123#', ok('123#'), 'TGZ'], ['tarla', '9#', ok('9#'), 'TGZ'],
    ['tarla', '123/4#', ok('123/4#'), 'TGZ: subdiviziune, a > b'], ['tarla', '12IV#', ok('12IV#'), 'TGZ: sufix roman'], ['tarla', 'T1#', ok('T1#'), 'fixture TGZ'],
    ['tarla', 'T12', ok('T12'), 'Anexa 7'], ['tarla', 'T 12', ok('T 12'), 'prefix cu spațiu'], ['tarla', 'T.12', ok('T.12'), 'prefix cu punct'], ['tarla', 'Tarla 1', ok('TARLA 1'), 'prefix „Tarla”, majuscule canonice'],
    ['tarla', '12', ok('12'), 'număr simplu'], ['tarla', 'T12/1', ok('T12/1'), 'prefix + subdiviziune (a > b)'], ['tarla', 'T1/2', ok('T1/2'), 'prefixul „T” exclude cota'], ['tarla', '12A', ok('12A'), 'sufix literă'],
    ['tarla', '12/3', ok('12/3'), 'a > b: subdiviziune'], ['tarla', '#', ok(''), 'TGZ gol: nu publică nimic'], ['tarla', '-', ok('-'), 'marcaj „fără valoare”'], ['tarla', ' t12 ', ok('T12'), 'spații / minuscule → canonic'],
    ['tarla', '1/2', nu(MOTIV.COTA), 'a ≤ b: cotă (verdict r2)'], ['tarla', '12/15', nu(MOTIV.COTA), 'a ≤ b: ambiguu → refuz, nu ghicit'], ['tarla', '1/1', nu(MOTIV.COTA), 'cotă întreagă'],
    ['tarla', '12//3', nu(MOTIV.FORMA), 'separator dublu: refuzat, nu normalizat (verdict r2)'], ['tarla', 'T13-2', nu(MOTIV.FORMA), '„-” nu e separator real (doar „/”)'],
    ['tarla', 'Str. Fictivă nr. 7', nu(MOTIV.FORMA), 'adresă'], ['tarla', 'Ion', nu(MOTIV.FORMA), 'cuvânt de 3 litere'], ['tarla', 'POPESCU', nu(MOTIV.FORMA), 'nume'], ['tarla', '12 A B', nu(MOTIV.FORMA), 'două sufixe'],
    ['tarla', '1234567', nu(MOTIV.FORMA), 'peste 6 cifre pentru tarla'], ['tarla', '0711 111 111', nu(MOTIV.TELEFON_CNP), 'telefon'], ['tarla', '1800101000000', nu(MOTIV.TELEFON_CNP), 'CNP'],
    // nr. cadastral / parcelă: TGZ compus „<nr. cadastral>#<parcelă / topo>#<rest>” sau simplu; publicat exact cum a fost validat
    ['nr_cadastral', '#44#', ok('#44#'), 'TGZ: parcelă'], ['nr_cadastral', '#1234#', ok('#1234#'), 'TGZ'], ['nr_cadastral', '50029##', ok('50029##'), 'TGZ: nr. cadastral'], ['nr_cadastral', '50029#30#', ok('50029#30#'), 'TGZ: cadastral + parcelă'],
    ['nr_cadastral', '50029#1234#', ok('50029#1234#'), 'TGZ: 9 cifre în total, dar în subcâmpuri diferite și fără prefix de telefon — nedeosebibil de un telefon fără 0 (raport)'], ['nr_cadastral', '#12/3#', ok('#12/3#'), 'TGZ: parcelă cu subdiviziune, a > b'],
    ['nr_cadastral', "#12'#", ok("#12'#"), 'TGZ: număr cu prim'], ['nr_cadastral', "#12'(34/5)#", ok("#12'(34/5)#"), 'TGZ: prim + numerotarea veche în paranteze'], ['nr_cadastral', '#123(456)#', ok('#123(456)#'), 'TGZ: paranteze'],
    ['nr_cadastral', '#7A#', ok('#7A#'), 'TGZ: sufix literă'], ['nr_cadastral', '#3/A#', ok('#3/A#'), 'TGZ: parte literă după „/”'], ['nr_cadastral', '##UA 62A', ok('##UA 62A'), 'fixture TGZ: unitate amenajistică (pădure)'],
    ['nr_cadastral', '##', ok(''), 'TGZ gol: nu publică nimic'], ['nr_cadastral', ' # # ', ok(''), 'TGZ gol cu spații'], ['nr_cadastral', '# 44 #', ok('#44#'), 'spațiile din jurul „#” → canonic'],['nr_cadastral', '123##', ok('123##'), 'fixture TGZ'], ['nr_cadastral', '#123#', ok('#123#'), 'fixture TGZ'], ['nr_cadastral', 'CF 1001', ok('CF 1001'), 'Anexa 7 / fixture'],
    ['nr_cadastral', '1#2#', ok('1#2#'), 'cadastral 1 + parcelă 2: publicat cu „#”, NU „1 / 2” (forma unei cote)'],
    ['nr_cadastral', 'cf  1010', ok('CF 1010'), 'minuscule, spațiu dublu → canonic'], ['nr_cadastral', 'CF100', ok('CF100'), 'Anexa 7'], ['nr_cadastral', '123/4', ok('123/4'), 'subdiviziune'], ['nr_cadastral', '1234/2/1', ok('1234/2/1'), 'topo pe 3 niveluri'],
    ['nr_cadastral', 'DE', ok('DE'), 'cod de 1–2 litere (drum de exploatare)'], ['nr_cadastral', '12 BIS', ok('12 BIS'), 'sufix BIS'], ['nr_cadastral', '', ok(''), 'gol'],
    ['nr_cadastral', '1/2', nu(MOTIV.COTA), 'cotă (verdict r2)'], ['nr_cadastral', '#1/2#', nu(MOTIV.COTA), 'cotă în subcâmpul TGZ'], ['nr_cadastral', '#3/3#', nu(MOTIV.COTA), 'a = b'], ['nr_cadastral', "#12'(1/2)#", nu(MOTIV.COTA), 'cotă în paranteze'],
    ['nr_cadastral', '0711/111/111', nu(MOTIV.TELEFON_CNP), 'telefon pe segmente (verdict r2)'], ['nr_cadastral', '180010/100000/0', nu(MOTIV.TELEFON_CNP), '13 cifre pe segmente (verdict r2)'],
    ['nr_cadastral', '1800101000000', nu(MOTIV.TELEFON_CNP), 'CNP'], ['nr_cadastral', '0711#111111#', nu(MOTIV.TELEFON_CNP), 'telefon lipit din subcâmpuri'], ['nr_cadastral', '180010#100000#0', nu(MOTIV.TELEFON_CNP), 'CNP lipit din subcâmpuri'],
    ['nr_cadastral', '711111111', nu(MOTIV.TELEFON_CNP), '9 cifre'], ['nr_cadastral', 'Ion', nu(MOTIV.FORMA), 'prenume'], ['nr_cadastral', 'DEX', nu(MOTIV.FORMA), '3 litere'], ['nr_cadastral', 'ANNA', nu(MOTIV.FORMA), '4 litere'],
    ['nr_cadastral', '50029#Ion#', nu(MOTIV.FORMA), 'cuvânt într-un subcâmp'], ['nr_cadastral', 'CF 1001 2', nu(MOTIV.FORMA), 'două numere'], ['nr_cadastral', '1234567', nu(MOTIV.FORMA), '7 cifre într-un număr'],
    ['nr_cadastral', '12 ION', nu(MOTIV.FORMA), 'cuvânt după număr'], ['nr_cadastral', 'POPESCU ION', nu(MOTIV.FORMA), 'nume'], ['nr_cadastral', '?', nu(MOTIV.FORMA), 'marcaj necunoscut'],
    // poz. HG: număr simplu (real: 1–4 cifre), opțional „HG ” și sufix; fără „/” și „#”
    ['poz_hg', '1234', ok('1234'), 'forma reală'], ['poz_hg', '117', ok('117'), ''], ['poz_hg', '1', ok('1'), ''], ['poz_hg', '12A', ok('12A'), 'sufix'], ['poz_hg', '12 A', ok('12 A'), ''], ['poz_hg', '12 BIS', ok('12 BIS'), ''],
    ['poz_hg', 'HG 1', ok('HG 1'), 'fixture'], ['poz_hg', 'hg  9', ok('HG 9'), 'canonic'],
    ['poz_hg', '1/2', nu(MOTIV.COTA), 'cotă (verdict r2)'], ['poz_hg', '12/1', nu(MOTIV.FORMA), 'fără „/” la poz. HG'], ['poz_hg', '12#', nu(MOTIV.FORMA), 'fără „#”'], ['poz_hg', '50%', nu(MOTIV.FORMA), 'procent'],
    ['poz_hg', '123456', nu(MOTIV.FORMA), 'peste 5 cifre'], ['poz_hg', 'HG', nu(MOTIV.FORMA), 'fără cifră'], ['poz_hg', 'POPESCU', nu(MOTIV.FORMA), 'nume'], ['poz_hg', '0711 111 111', nu(MOTIV.TELEFON_CNP), 'telefon'],
    // tronson: exact regula importului (1..11)
    ['tronson', 1, ok('1'), ''], ['tronson', 11, ok('11'), ''], ['tronson', '3', ok('3'), 'text → canonic'], ['tronson', null, ok(''), 'neatribuit'], ['tronson', '__', ok('__'), 'marcajul modelului'],
    ['tronson', 0, nu(MOTIV.FORMA), ''], ['tronson', 12, nu(MOTIV.FORMA), ''], ['tronson', '3x', nu(MOTIV.FORMA), ''], ['tronson', 2.5, nu(MOTIV.FORMA), ''], ['tronson', true, nu(MOTIV.FORMA), ''], ['tronson', 'unu', nu(MOTIV.FORMA), ''],
    ['tronson', '0711 111 111', nu(MOTIV.TELEFON_CNP), 'telefon'],
    // sat: doar satele declarate la sesiuni (UAT: „Satul A”, „Satul B”), publicat cu ortografia declarată
    ['sat', 'Satul A', ok('Satul A'), 'declarat'], ['sat', 'satul b', ok('Satul B'), 'ortografia declarată'], ['sat', ' SATUL A ', ok('Satul A'), ''], ['sat', 'A', nu(MOTIV.FORMA), 'prea scurt'],
    ['sat', 'POPESCU Ion', nu(MOTIV.SAT_NEDECLARAT), 'nume cu forma unui sat, nedeclarat'], ['sat', 'POPESCU Ion (fictiv)', nu(MOTIV.FORMA), 'paranteze'], ['sat', 'Satul C', nu(MOTIV.SAT_NEDECLARAT), 'nedeclarat'],
    ['sat', 'Satul A 2', nu(MOTIV.FORMA), 'cifre'], ['sat', 'restul', nu(MOTIV.SAT_NEDECLARAT), 'indicație de program'], ['sat', 'tarlalele 1–5', nu(MOTIV.FORMA), 'indicație de program'], ['sat', '', ok(''), 'gol (TGZ n-are coloana sat)'],
  ]
  it('tabelul formelor (forma → acceptat cu forma canonică / refuzat cu motivul), pe fiecare câmp: formele reale TGZ / Anexa 7 trec, cotele („a/b” cu a ≤ b), telefoanele / CNP-urile (9+ cifre, lipite sau nu), cuvintele și „12//3” sunt refuzate', () => {
    for (const [camp, v, asteptat, de_ce] of TABEL) {
      expect(canonizeazaIdentificator(camp, v, { uat: UAT }), `${camp}=${JSON.stringify(v)} (${de_ce})`).toEqual(asteptat)
      expect(areFormaIdentificator(camp, v, { uat: UAT })).toBe(asteptat.ok)
    }
    // tabelul acoperă fiecare câmp cu acceptări și refuzuri și fiecare motiv de refuz (în afară de „camp”, testat separat)
    for (const camp of CAMPURI_PARCELA_ANUNT) {
      expect(TABEL.some(r => r[0] === camp && r[2].ok), camp).toBe(true)
      expect(TABEL.some(r => r[0] === camp && !r[2].ok), camp).toBe(true)
    }
    for (const motiv of [MOTIV.FORMA, MOTIV.COTA, MOTIV.TELEFON_CNP, MOTIV.SAT_NEDECLARAT]) expect(TABEL.some(r => r[2].motiv === motiv), motiv).toBe(true)
    // tronsonul = exact regula importului (tronsonOptional), nu una nouă (L19)
    for (const v of [0, 12, '0', '12', '3x', 2.5, true, '0711 111 111']) { expect(tronsonOptional(v)).toBeNull(); expect(areFormaIdentificator('tronson', v)).toBe(false) }
    for (const v of [1, 11, '3']) expect(canonizeazaIdentificator('tronson', v).valoare).toBe(String(tronsonOptional(v)))
  })
  it('documentul se generează cu formele reale și le publică exact cum au fost validate (TGZ compus cu „#”, „##” = celulă goală)', async () => {
    const r = await genereaza([parcela(1, { sat: 'Satul B', tarla: 'T 12', nr_cadastral: '50029#30#', poz_hg: '117', tronson: 11 }), parcela(2, { sat: null, tarla: '12A', nr_cadastral: '##', poz_hg: 'HG 1', tronson: null })])
    const lista = [...(await docDin(r.blob)).xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0]).at(-1)
    const randuri = [...lista.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => textWt(m[0]))
    expect(randuri.slice(1)).toEqual([['1', '', '12A', '', 'HG 1', ''], ['2', 'Satul B', 'T 12', '50029#30#', '117', '11']])
    expect(lista).not.toContain('##')
  })
  it('refuzuri independente de câmp: orice valoare peste 40 de caractere, obiect / tablou / funcție, câmp necunoscut; nul = nimic publicat; lista problemelor poartă id-ul parcelei („?” dacă lipsește) și motivul', () => {
    for (const camp of CAMPURI_PARCELA_ANUNT) {
      expect(canonizeazaIdentificator(camp, '1'.repeat(LUNGIME_MAX_IDENTIFICATOR + 1), { uat: UAT })).toEqual(nu(MOTIV.LUNGIME))
      // 9 cifre: telefon / CNP la câmpurile numerice; la sat, orice cifră e deja în afara formei
      expect(canonizeazaIdentificator(camp, '1'.repeat(MAX_CIFRE_SUBCAMP + 1), { uat: UAT })).toEqual(nu(camp === 'sat' ? MOTIV.FORMA : MOTIV.TELEFON_CNP))
      for (const v of [{ x: 1 }, ['1'], () => 1]) expect(canonizeazaIdentificator(camp, v, { uat: UAT })).toEqual(nu(MOTIV.FORMA))
      for (const v of [null, undefined]) expect(canonizeazaIdentificator(camp, v, { uat: UAT })).toEqual(ok(''))
    }
    expect(canonizeazaIdentificator('nume', 'T12')).toEqual(nu(MOTIV.CAMP))   // câmp necunoscut = nu se publică
    expect(areFormaIdentificator('nume', 'T12')).toBe(false)
    expect(verificaIdentificatoriPublicati([{ id_parcela: 'X-1', sat: 'POPESCU Ion' }, null, { sat: 'Y' }], ['sat'], UAT)).toEqual([{ id_parcela: 'X-1', camp: 'sat', motiv: MOTIV.SAT_NEDECLARAT }, { id_parcela: '?', camp: 'sat', motiv: MOTIV.FORMA }])
    expect(textProblemeIdentificatori([{ id_parcela: 'X-1', camp: 'tarla', motiv: MOTIV.LUNGIME }])).toBe(`tarla: X-1 (${ETICHETA_MOTIV[MOTIV.LUNGIME]})`)
    // rândurile canonice: doar coloanele cerute + id-ul; valorile originale nu apar
    const { probleme, randuri } = canonizeazaParcelePublicate([{ id_parcela: 'X-2', tarla: '31#', nr_cadastral: 'cf  1', sat: 'satul a', poz_hg: 7, tronson: '2' }], CAMPURI_PARCELA_ANUNT, UAT)
    expect(probleme).toEqual([])
    expect(randuri).toEqual([{ id_parcela: 'X-2', sat: 'Satul A', tarla: '31#', nr_cadastral: 'CF 1', poz_hg: '7', tronson: '2' }])
  })
  it('satul: doar unul dintre satele DECLARATE la „Sate / tarlale ziua 1–3” (fără diacritice / majuscule, cu sau fără „Satul”); indicațiile de program („tarlalele 1–5”, „restul”, parantezele) nu devin sate', () => {
    expect([...sateDeclarate(UAT)]).toEqual([['SATUL A', 'Satul A'], ['SATUL B', 'Satul B']])   // „tarlalele 1–5” și „restul” nu sunt sate; „A” singur e prea scurt
    const u = { sate_zi1: 'sat Peri (tarlalele 1–5); Husnicioara și Gârnița', sate_zi2: 'Marga – T7-T9, Dumbrava de Jos', sate_zi3: 'toate satele' }
    expect([...sateDeclarate(u).keys()].sort()).toEqual(['DUMBRAVA DE JOS', 'GARNITA', 'HUSNICIOARA', 'MARGA', 'PERI', 'SAT PERI'])
    // forma publicată = ortografia declarată (cu diacritice, fără prefixul „sat”)
    expect(['PERI', 'SAT PERI', 'GARNITA'].map(k => sateDeclarate(u).get(k))).toEqual(['Peri', 'sat Peri', 'Gârnița'])
    expect(canonizeazaIdentificator('sat', 'Satul Peri', { uat: u })).toEqual(ok('Peri'))
    for (const sat of ['Peri', 'PERI', 'Gârnița', 'Garnita', 'sat Peri', 'Satul Peri', 'Dumbrava de Jos', 'Marga']) expect(areFormaIdentificator('sat', sat, { uat: u }), sat).toBe(true)
    for (const sat of ['Peri Nou', 'Jos', 'toate satele', 'POPESCU Ion', 'T7']) expect(areFormaIdentificator('sat', sat, { uat: u }), sat).toBe(false)
    // UAT fără sate declarate: orice sat nevid e refuzat (satul gol trece — TGZ nu are coloana „sat”)
    expect(areFormaIdentificator('sat', 'Peri', { uat: { sate_zi1: 'tarlalele 1–20' } })).toBe(false)
    expect(areFormaIdentificator('sat', '', { uat: {} })).toBe(true)
    expect(sateDeclarate(undefined).size).toBe(0)
  })
  // ── Mutanți (sursa din arborele de lucru, o regulă scoasă pe rând): fiecare trebuie să schimbe EXACT rândurile tabelului care depind de
  // regula lui (deci tabelul chiar o păzește), iar pe document mutantul publică valoarea pe care intactul o refuză.
  const M = {
    poarta: { fisier: 'docx.js', din: '  if (probleme.length) {\n', in: '  if (false) {\n' },
    bariera: { fisier: 'identificatoriPublici.js', din: 'return { probleme, randuri: probleme.length ? [] : randuri }', in: 'return { probleme, randuri }' },
    original: { fisier: 'identificatoriPublici.js', din: '      if (r.ok) rand[camp] = r.valoare\n', in: "      if (r.ok) rand[camp] = p[camp] ?? ''\n" },
    cota: { fisier: 'identificatoriPublici.js', din: '    if (pareCota(s)) return MOTIV.COTA\n', in: '' },
    telefonLipit: { fisier: 'identificatoriPublici.js', din: '  if (RE_TELEFON_SAU_CNP.test(toateCifrele)) return MOTIV.TELEFON_CNP\n', in: '' },
    cifreSubcamp: { fisier: 'identificatoriPublici.js', din: '    if (c.length > MAX_CIFRE_SUBCAMP) return MOTIV.TELEFON_CNP\n', in: '' },
  }
  const cheie = r => `${r[0]}=${JSON.stringify(r[1])}`
  const diferenteTabel = idp => TABEL.filter(r => JSON.stringify(idp.canonizeazaIdentificator(r[0], r[1], { uat: UAT })) !== JSON.stringify(r[2])).map(cheie)
  const xmlLista = async blob => [...(await docDin(blob)).xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0]).at(-1)
  it('MUTANT cotă / telefon lipit / cifre pe subcâmp: fiecare regulă scoasă schimbă EXACT rândurile ei din tabelul formelor, iar documentul mutant publică „1/2” și „0711#111111#”', async () => {
    const { idp: intact } = await incarcaDocx('lucru')
    expect(diferenteTabel(intact)).toEqual([])
    // cota: toate rândurile cu motivul „cotă” (și doar ele) se schimbă
    const { mod: mCota, idp: iCota } = await incarcaDocx('lucru', M.cota)
    expect(diferenteTabel(iCota)).toEqual(TABEL.filter(r => r[2].motiv === MOTIV.COTA).map(cheie))
    const rc = await mCota.genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: [parcela(1), parcela(2, { tarla: '1/2', nr_cadastral: '#1/2#' })], templateArrayBuffer: sablon() })
    expect(await xmlLista(rc.blob)).toContain('>1/2<')
    // telefonul / CNP-ul lipit din subcâmpuri: exact cele două rânduri „lipite”
    const { mod: mTel, idp: iTel } = await incarcaDocx('lucru', M.telefonLipit)
    expect(diferenteTabel(iTel)).toEqual(['nr_cadastral="0711#111111#"', 'nr_cadastral="180010#100000#0"'])
    const rt = await mTel.genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: [parcela(1), parcela(2, { nr_cadastral: '0711#111111#' })], templateArrayBuffer: sablon() })
    expect(await xmlLista(rt.blob)).toContain('0711#111111#')
    // plafonul de cifre pe subcâmp: valorile rămân refuzate de plafonul câmpului, dar cu motivul „forma” — lista de corectat pierde explicația
    const { idp: iCif } = await incarcaDocx('lucru', M.cifreSubcamp)
    const telefonPeSubcamp = TABEL.filter(r => r[2].motiv === MOTIV.TELEFON_CNP && r[0] !== 'tronson' && !['0711#111111#', '180010#100000#0'].includes(r[1]))
    expect(diferenteTabel(iCif)).toEqual(telefonPeSubcamp.map(cheie))
    for (const r of telefonPeSubcamp) expect(iCif.canonizeazaIdentificator(r[0], r[1], { uat: UAT })).toEqual(nu(MOTIV.FORMA))
    // intactul refuză aceleași parcele
    for (const parcele of [[parcela(1), parcela(2, { tarla: '1/2' })], [parcela(1), parcela(2, { nr_cadastral: '0711#111111#' })]]) {
      const err = await genereaza(parcele).catch(e => e)
      expect(err.probleme).toHaveLength(1)
    }
  })
  it('MUTANT „originalul în loc de forma validată”: mutantul publică „cf  1010” / „satul b” ca în BD, intactul publică „CF 1010” / „Satul B”', async () => {
    const parcele = [parcela(1, { sat: 'satul b', nr_cadastral: 'cf  1010', tarla: 't 12' })]
    const { mod: mOrig } = await incarcaDocx('lucru', M.original)
    const lm = await xmlLista((await mOrig.genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon() })).blob)
    expect(textWt(lm)).toEqual(expect.arrayContaining(['satul b', 'cf  1010', 't 12']))
    const li = await xmlLista((await genereaza(parcele)).blob)
    expect(textWt(li)).toEqual(expect.arrayContaining(['Satul B', 'CF 1010', 'T 12']))
    for (const brut of ['satul b', 'cf  1010', 't 12']) expect(textWt(li)).not.toContain(brut)
  })
  it('MUTANT cele trei bariere (poarta din generator, „niciun rând dintr-o listă cu refuzuri”, rândul conține doar forme validate): oricare singură oprește publicarea numelui; scoase TOATE, numele din „sat” ajunge în document', async () => {
    const parcele = [parcela(1), parcela(2, { sat: 'POPESCU Ion' })]
    const gen = (mod, strict = true) => mod.genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, templateArrayBuffer: sablon(), strict }).catch(e => e)
    // a treia mutație: în rând intră valoarea din BD pentru ORICE câmp (și cele refuzate); „else”-ul original rămâne pe lista problemelor
    const { mod: toate, fisiere } = await incarcaDocx('lucru', [M.poarta, M.bariera, { ...M.original, in: "      if (r.ok) rand[camp] = p[camp] ?? ''; else rand[camp] = p[camp] ?? ''\n      if (r.ok) ;\n" }])
    expect(fisiere).toContain('identificatoriPublici.js')
    expect((await docDin((await gen(toate)).blob)).xml).toContain('POPESCU Ion')   // mutantul publică numele
    // poarta + bariera scoase, rândul tot canonic: parcela iese cu celula „sat” GOALĂ (golire tacită — de aceea poarta refuză, L18), fără nume
    const { mod: doua } = await incarcaDocx('lucru', [M.poarta, M.bariera])
    const r2 = await gen(doua)
    expect((await docDin(r2.blob)).xml).not.toContain('POPESCU')
    const randuri2 = [...(await xmlLista(r2.blob)).matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(m => textWt(m[0]))
    expect(randuri2.slice(1)).toEqual([['1', 'Satul A', 'T2', '101', '1', '2'], ['2', '', 'T3', '102', '2', '3']])
    // doar poarta scoasă: nu se construiește niciun rând (strict → „fără parcele”; previzualizare → tabel gol), numele nu apare
    const { mod: faraPoarta } = await incarcaDocx('lucru', M.poarta)
    expect(await gen(faraPoarta)).toBeInstanceOf(Error)
    const prev = await gen(faraPoarta, false)
    expect((await docDin(prev.blob)).xml).not.toContain('POPESCU')
    expect(prev.randuri).toBe(0)
    // doar bariera scoasă: poarta refuză, cu lista
    const { mod: faraBariera } = await incarcaDocx('lucru', M.bariera)
    expect((await gen(faraBariera)).probleme).toEqual([{ id_parcela: 'T1-FIC-0002', camp: 'sat', motiv: MOTIV.SAT_NEDECLARAT }])
    const { mod: intact } = await incarcaDocx('lucru')
    expect((await gen(intact)).probleme).toEqual([{ id_parcela: 'T1-FIC-0002', camp: 'sat', motiv: MOTIV.SAT_NEDECLARAT }])
    expect((await gen(intact, false)).probleme).toEqual([{ id_parcela: 'T1-FIC-0002', camp: 'sat', motiv: MOTIV.SAT_NEDECLARAT }])
    // regula de formă e UNA (identificatoriPublici.js): generatorul anunțului n-are regex-uri proprii pe aceste câmpuri, UI-ul doar afișează lista
    const src = readFileSync('src/redari/docx.js', 'utf8')
    expect(src.match(/canonizeazaParcelePublicate\(/g)).toHaveLength(1)   // un singur apel, în randuriAnuntAfisare
    expect(src).not.toMatch(/verificaIdentificatoriPublicati\(/)
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
