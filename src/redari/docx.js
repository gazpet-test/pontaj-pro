// Redări teren — documente client-side (contract docs/redari/CONTRACT_SCHEMA.md §6 + §8, decizii 4A + 5A).
// - DOCX: șablonul se deschide cu jszip, placeholder-ele {{camp}} se înlocuiesc în word/document.xml + antete/subsoluri.
// - QR: generat local cu pachetul `qrcode` (toDataURL), inserat ca imagine inline în locul paragrafului {{qr}}.
// - hash sha256 (WebCrypto) pentru red_convocari.continut_hash; borderou Poștă CSV; upload în bucket-ul `redari`.
//
// LIMITELE înlocuirii în DOCX (documentate, verificate în docx.test.js):
// 1. Un placeholder rupt între mai multe <w:r>/<w:t> ale ACELUIAȘI paragraf se reunește: textul întreg al paragrafului,
//    cu toate câmpurile înlocuite, ajunge în primul <w:t>, restul <w:t> se golesc. Formatarea rămâne cea a PRIMULUI run
//    (bold/italic parțial în mijlocul paragrafului se pierde), iar <w:tab/>/<w:br/> dintre run-uri rămân pe loc, deci
//    ajung DUPĂ tot textul. Dacă fiecare placeholder stă într-un singur <w:t>, înlocuirea e locală și nimic nu se mută.
// 2. Un placeholder rupt între două paragrafe NU se înlocuiește (rămâne ca în șablon; cu `strict` ⇒ Error).
// 3. Se procesează doar paragrafele „frunză” (fără alt <w:p> înăuntru): într-o casetă text (textbox) se înlocuiesc
//    paragrafele din casetă, dar nu și run-urile paragrafului-gazdă din jurul casetei.
// 4. {{qr}} devine imagine DOAR dacă paragraful conține exclusiv {{qr}} (plus spații); altfel se înlocuiește cu șir gol.
// 5. Valorile sunt text simplu (escape XML); \n din valoare devine <w:br/> (rând nou în același paragraf).
// 6. Nu se ating w:instrText / câmpuri Word, comentarii, note de subsol.
// 7. `strict: true` → placeholder necunoscut (fără cheie în `campuri`) sau rămas în XML după completare ⇒ Error, nu
//    dispare tăcut. Fără `strict`, câmpul lipsă → șir gol (doar pentru previzualizare).
// 8. Determinism (hash): toate intrările scrise în zip primesc dată fixă și NU se creează intrări de director
//    (createFolders:false) — același șablon + aceleași câmpuri + același QR ⇒ același Blob ⇒ același hash, oricând.

import JSZip from 'jszip'
import QRCode from 'qrcode'
import { COL_UAT, termenAfisare, mesajTermenAfisare } from './setari.js'
import { ORIGINE_PUBLICA_REDARI } from './domeniuPublic.js'

// Denumirea Antreprenorului/liderului; se modifica in cod daca Asocierea este alta.
export const ANTREPRENOR = 'GAZPET INSTAL S.R.L.'
export const CHEI_CERERE_IMPUTERNICIRE = [
  'nr_document', 'data', 'beneficiar', 'reprezentant_tgz', 'contract_nr', 'contract_data',
  'proiect_denumire', 'antreprenor', 'uat_lista', 'contact_email', 'reprezentant_gazpet', 'functie',
]

export function verificaDateCerereImputernicire({ proiect = {}, uats = [] } = {}) {
  const lipsuri = []
  for (const [cheie, eticheta] of [
    ['beneficiar', 'beneficiarul'], ['reprezentant_tgz_nume', 'reprezentantul TGZ'],
    ['contract_nr', 'numarul contractului'], ['contract_data', 'data contractului'],
    ['denumire', 'denumirea proiectului'], ['reprezentant_gazpet_nume', 'reprezentantul Gazpet'],
    ['reprezentant_gazpet_functie', 'functia reprezentantului Gazpet'], ['contact_email', 'e-mailul de contact'],
  ]) if (!String(proiect?.[cheie] ?? '').trim()) lipsuri.push(`Lipseste ${eticheta}`)
  if (!uats?.length || uats.some(u => !u?.nume?.trim())) lipsuri.push('Este necesar cel putin un UAT, cu numele completat pentru fiecare UAT')
  return lipsuri
}

export async function genereazaCerereImputernicire({ proiect, uats, nrDocument, templateArrayBuffer,
  dataDocument = aziBucuresti(), antreprenor = ANTREPRENOR, strict = true }) {
  const lipsuri = verificaDateCerereImputernicire({ proiect, uats })
  if (lipsuri.length) throw new Error(lipsuri.join('; '))
  const t = v => String(v ?? '').trim()   // Gemini f3a r1 P3: spațiile de la capete nu intră în document
  const campuri = {
    nr_document: nrDocument?.trim() || '___', data: formatDataRo(dataDocument),
    beneficiar: t(proiect.beneficiar), reprezentant_tgz: t(proiect.reprezentant_tgz_nume),
    contract_nr: t(proiect.contract_nr), contract_data: formatDataRo(proiect.contract_data),
    proiect_denumire: t(proiect.denumire), antreprenor: t(antreprenor),
    uat_lista: uats.map(u => u.nume.trim()).sort((a, b) => a.localeCompare(b, 'ro')).join(', '),
    contact_email: t(proiect.contact_email), reprezentant_gazpet: t(proiect.reprezentant_gazpet_nume),
    functie: t(proiect.reprezentant_gazpet_functie),
  }
  const blob = await completeazaDocx(templateArrayBuffer, campuri, { strict })
  return { blob, hash: await hashBlob(blob), campuri }
}

export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const BUCKET_REDARI = 'redari'
const QR_CM = 3
const EMU_PER_CM = 360000
const DATA_FIXA_ZIP = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) // intrări în zip cu dată fixă → același conținut ⇒ același hash
const OPT_ZIP = { date: DATA_FIXA_ZIP, createFolders: false } // fără intrări de director (ar primi data curentă)

const RX_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g
// paragraf „frunză”: nu conține alt <w:p ...> înăuntru (casetele text se tratează prin paragrafele lor interioare)
const RX_PARAGRAF = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
// <w:t ...>text</w:t> sau <w:t/>; nu prinde <w:tab/>, <w:tc>, <w:tbl>, <w:tr> (după „<w:t” urmează spațiu, „>” sau „/>”)
const RX_WT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g

export const escapeXml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const unescapeXml = (s) => String(s ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&')

// valoare → conținut de <w:t>: escape + \n → rând nou în același run
const valoareInWt = (v) => escapeXml(v).split('\n').join('</w:t><w:br/><w:t xml:space="preserve">')

const textParagraf = (pXml) => {
  let t = ''
  for (const m of pXml.matchAll(RX_WT)) t += unescapeXml(m[1] ?? '')
  return t
}

const areText = (s) => { const r = RX_PLACEHOLDER.test(s); RX_PLACEHOLDER.lastIndex = 0; return r }

// înlocuitor cu evidența numelor necunoscute (fără cheie în campuri)
const inlocuitor = (campuri, necunoscute) => (_, nume) => {
  if (!Object.prototype.hasOwnProperty.call(campuri, nume)) necunoscute.add(nume)
  const v = campuri[nume]
  return v === null || v === undefined ? '' : String(v)
}

// Înlocuirea într-un paragraf: întâi local (placeholder întreg într-un singur <w:t>), apoi, dacă a rămas ceva rupt
// între run-uri, consolidare în primul <w:t>.
const completeazaParagraf = (pXml, campuri, necunoscute) => {
  if (!pXml.includes('{{')) return pXml
  const inl = inlocuitor(campuri, necunoscute)
  let out = pXml.replace(RX_WT, (m, inner) => {
    if (inner === undefined || !areText(inner)) return m
    return `<w:t xml:space="preserve">${valoareInWt(unescapeXml(inner).replace(RX_PLACEHOLDER, inl))}</w:t>`
  })
  const textRamas = textParagraf(out)
  if (!areText(textRamas)) return out
  // placeholder rupt între run-uri: tot textul în primul <w:t>, restul golite (limita 1 din antet)
  const textNou = textRamas.replace(RX_PLACEHOLDER, inl)
  let primul = true
  out = out.replace(RX_WT, () => {
    if (primul) { primul = false; return `<w:t xml:space="preserve">${valoareInWt(textNou)}</w:t>` }
    return '<w:t/>'
  })
  return out
}

const xmlDrawingQr = (rId, docPrId) => {
  const emu = QR_CM * EMU_PER_CM
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${emu}" cy="${emu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="QR raspuns ${docPrId}" descr="Cod QR cu linkul de raspuns"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="qr.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

// adaugă relația de imagine în partea dată (word/document.xml → word/_rels/document.xml.rels); întoarce rId-ul
const adaugaRelatieImagine = async (zip, partPath, target) => {
  const relsPath = partPath.replace(/^word\//, 'word/_rels/') + '.rels'
  const f = zip.file(relsPath)
  let rels = f ? await f.async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  let max = 0
  for (const m of rels.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, parseInt(m[1], 10))
  const rId = `rId${max + 1}`
  rels = rels.replace('</Relationships>',
    `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`)
  zip.file(relsPath, rels, OPT_ZIP)
  return rId
}

const asiguraContentTypePng = async (zip) => {
  const f = zip.file('[Content_Types].xml')
  if (!f) throw new Error('Șablonul DOCX nu are [Content_Types].xml')
  const ct = await f.async('string')
  if (/Extension="png"/i.test(ct)) return
  zip.file('[Content_Types].xml', ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>'), OPT_ZIP)
}

const dataUrlBase64 = (dataUrl) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''))
  if (!m) throw new Error('imagini.qr trebuie să fie un dataURL PNG (data:image/png;base64,...)')
  return m[1].replace(/\s+/g, '')
}

const textParagrafeConcatenate = (xml) => {
  let t = ''
  for (const m of xml.matchAll(RX_PARAGRAF)) t += textParagraf(m[0]) + '\n'
  return t
}

/** Repetă numai rândul cu rand.*, păstrând celelalte celule și placeholder-ele simple. */
export function repetaRand(xml, randuri) {
  if (!Array.isArray(randuri)) throw new Error('Lista de parcele trebuie să fie un tablou')
  // Copilot f2b r1 P3: regex-ul de rând nu poate izola un <w:tr> care conține alt <w:tr>; cu tabele imbricate și rand.* refuzăm explicit
  if (/\{\{\s*rand\./.test(xml)) {
    let adancime = 0
    for (const t of xml.match(/<\/?w:tbl[\s>]/g) || []) {
      adancime += t.startsWith('</') ? -1 : 1
      if (adancime > 1) throw new Error('Șablonul are tabele imbricate; rândul-șablon {{rand.*}} nu e suportat în această structură')
    }
  }
  return xml.replace(/<w:tr(?:\s[^>]*)?>(?:(?!<w:tr[\s>])[\s\S])*?<\/w:tr>/g, rand => {
    if (!/\{\{\s*rand\./.test(textParagrafeConcatenate(rand))) return rand
    if (!randuri.length) return '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="6"/></w:tcPr><w:p><w:r><w:t>(nicio parcela importata)</w:t></w:r></w:p></w:tc></w:tr>'
    return randuri.map(valori => {
      const chei = Object.fromEntries(Object.entries(valori).map(([k, v]) => [`rand.${k}`, v]))
      // Cele simple sunt păstrate literal pentru pasul următor; cheile de rând necunoscute rămân pentru strict.
      for (const m of textParagrafeConcatenate(rand).matchAll(RX_PLACEHOLDER)) {
        if (!(m[1] in chei)) chei[m[1]] = `{{${m[1]}}}`
      }
      return rand.replace(RX_PARAGRAF, p => completeazaParagraf(p, chei, new Set()))
    }).join('')
  })
}

/**
 * Completează un șablon DOCX: {{camp}} → campuri[camp], în document + antete + subsoluri.
 * @param {ArrayBuffer|Uint8Array|Blob} templateArrayBuffer
 * @param {Record<string, any>} campuri
 * @param {{ imagini?: { qr?: string }, strict?: boolean }} [optiuni]
 *   imagini.qr = dataURL PNG → înlocuiește paragraful {{qr}} cu imaginea (~3 cm);
 *   strict = true → Error dacă un placeholder nu are cheie în `campuri` sau rămâne necompletat în XML (altfel → șir gol).
 * @returns {Promise<Blob>} DOCX completat
 */
export async function completeazaDocx(templateArrayBuffer, campuri = {}, { imagini, randuri, strict = false } = {}) {
  const sursa = templateArrayBuffer instanceof Blob ? await templateArrayBuffer.arrayBuffer() : templateArrayBuffer
  const zip = await JSZip.loadAsync(sursa, { createFolders: false })
  if (!zip.file('word/document.xml')) throw new Error('Fișierul nu este un DOCX valid (lipsește word/document.xml)')
  const parti = Object.keys(zip.files).filter(p => p === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(p)).sort()
  const qrDataUrl = imagini?.qr
  const campuriEf = qrDataUrl && !Object.prototype.hasOwnProperty.call(campuri, 'qr') ? { ...campuri, qr: '' } : campuri
  const necunoscute = new Set()
  const ramase = new Set()
  let qrAdaugat = false
  let docPrId = 9000

  for (const partPath of parti) {
    const f = zip.file(partPath)
    const original = await f.async('string')
    const xml = randuri?.rand ? repetaRand(original, randuri.rand) : original
    if (!xml.includes('{{')) continue
    let rId = null
    if (qrDataUrl && /\{\{\s*qr\s*\}\}/.test(textParagrafeConcatenate(xml))) {
      if (!qrAdaugat) {
        zip.file('word/media/qr.png', dataUrlBase64(qrDataUrl), { ...OPT_ZIP, base64: true })
        await asiguraContentTypePng(zip)
        qrAdaugat = true
      }
      rId = await adaugaRelatieImagine(zip, partPath, 'media/qr.png')
    }
    const nou = xml.replace(RX_PARAGRAF, (pXml) => {
      if (rId && /^\s*\{\{\s*qr\s*\}\}\s*$/.test(textParagraf(pXml))) {
        const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(pXml)?.[0] || ''
        const deschidere = /^<w:p(?:\s[^>]*)?>/.exec(pXml)[0]
        docPrId += 1
        return `${deschidere}${pPr}${xmlDrawingQr(rId, docPrId)}</w:p>`
      }
      return completeazaParagraf(pXml, campuriEf, necunoscute)
    })
    for (const m of textParagrafeConcatenate(nou).matchAll(RX_PLACEHOLDER)) ramase.add(m[1])
    zip.file(partPath, nou, OPT_ZIP)
  }
  if (strict && (necunoscute.size || ramase.size)) {
    const parti2 = []
    if (necunoscute.size) parti2.push(`câmpuri fără valoare în șablon: ${[...necunoscute].map(n => `{{${n}}}`).join(', ')}`)
    if (ramase.size) parti2.push(`placeholder-e rămase necompletate (rupte între paragrafe?): ${[...ramase].map(n => `{{${n}}}`).join(', ')}`)
    throw new Error(`Șablonul nu a putut fi completat integral — ${parti2.join('; ')}`)
  }
  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new Blob([u8], { type: MIME_DOCX })
}

/** QR PNG ca dataURL (margin 1, 300 px). */
export const genereazaQr = (text) => QRCode.toDataURL(String(text), { margin: 1, width: 300, errorCorrectionLevel: 'M' })

/** sha256 hex al conținutului unui Blob (WebCrypto). */
export async function hashBlob(blob) {
  const buf = await blob.arrayBuffer()
  const dig = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(dig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const COLOANE_BORDEROU = ['nr_document', 'nume', 'adresa', 'cod_postal', 'localitate', 'judet', 'id_parcela']

// Anti „formula injection” la deschiderea CSV-ului în Excel/LibreOffice: o valoare care începe (după spații / caractere de
// control) cu = + - @ TAB sau CR primește prefix apostrof și intră în ghilimele. Telefoanele cu + și numerele negative
// sunt afectate intenționat (apostroful se vede ca text în Excel, nu se evaluează).
const RX_FORMULA = /^[\s\u0000-\u001f\u007f]*[=+\-@\t\r]/
export const celulaCsv = (v) => {
  let s = v === null || v === undefined ? '' : String(v)
  const formula = RX_FORMULA.test(s)
  if (formula) s = "'" + s
  return formula || /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Borderou Poștă: CSV UTF-8 cu BOM, separator `;`, antet fix (contract §8). */
export function borderouCsv(randuri = []) {
  const linii = [COLOANE_BORDEROU.join(';')]
  for (const r of randuri) linii.push(COLOANE_BORDEROU.map(c => celulaCsv(r?.[c])).join(';'))
  return new Blob(['﻿' + linii.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
}

/** Descarcă un Blob în browser. */
export function descarcaBlob(blob, numeFisier) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) throw new Error('descarcaBlob funcționează doar în browser')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = numeFisier || 'document'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 'AAAA-LL-ZZ' / Date → 'ZZ.LL.AAAA' (fără decalaj de fus orar pentru șirurile de tip date). */
export function formatDataRo(d) {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d))
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return String(d)
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`
}

export const formatNumarRo = (n) => {
  if (n === null || n === undefined || n === '') return ''
  const x = Number(n)
  return isNaN(x) ? String(n) : new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(x)
}

// Doar pentru teste: aceeași formă a linkului pe altă origine. Codul de producție folosește linkRaspuns.
export const linkRaspunsCu = (origin, token) => `${String(origin ?? '').replace(/\/+$/, '')}/redari/raspuns/${token}`
/** Linkul public de răspuns (contract §8), mereu pe redari.gazpet.ro. */
export const linkRaspuns = (token) => linkRaspunsCu(ORIGINE_PUBLICA_REDARI, token)

const plin = (v) => v !== null && v !== undefined && String(v).trim() !== ''

/** Eticheta în română a calității deținătorului (red_detinatori.calitate). `neidentificat` nu primește convocator. */
export const ETICHETA_CALITATE = { proprietar: 'proprietar', coproprietar: 'coproprietar', mostenitor: 'moștenitor', arendas: 'arendaș', utilizator: 'utilizator', neidentificat: 'neidentificat' }

/** O linie de adresă din red_detinatori_contact: strada, sat, comuna, județ, cod poștal — părțile nevide, cu virgulă. */
export const adresaDetinator = (c) => !c ? '' :
  [c.adresa_strada, c.adresa_sat, c.adresa_comuna, c.adresa_judet, c.cod_postal].map(v => plin(v) ? String(v).trim() : '').filter(Boolean).join(', ')

/** Textul GDPR din proiect cu marcajul `{uat}` / `[UAT]` înlocuit cu numele UAT-ului. */
export const textGdprPentruUat = (text, numeUat, linkInformare) => {
  const baza = String(text ?? '').replace(/\{uat\}|\[UAT\]/gi, () => numeUat ?? '')
  // Fără link configurat, propoziția juridică se omite. Restul textului rămâne intact.
  if (linkInformare === undefined) return baza
  // Gemini f2b r1 P2: dacă propoziția există deja în text (cu [link] sau cu un URL), se înlocuiește PE LOC, oriunde ar fi;
  // se adaugă la final doar când lipsește; fără link se scoate (și spațiul dublu rămas).
  // [link] sau un URL (fără punctul final, care rămâne al frazei — Copilot f2b r2 P3-02); grupul 1 = punctul, păstrat la înlocuire
  const RX_INFO = /Informarea completă:[ \t]*(?:\[[^\]]*\]|https?:\/\/\S+?)([.])?(?=[ \t\n]|$)/gi
  if (!linkInformare) return baza.replace(RX_INFO, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim()
  const exista = new RegExp(RX_INFO.source, 'i').test(baza)
  return exista ? baza.replace(RX_INFO, (m, punct) => `Informarea completă: ${linkInformare}${punct || ''}`) : `${baza}\nInformarea completă: ${linkInformare}`
}

const contactDet = (detinator, contactDetinator) => contactDetinator ?? detinator?.contact ?? detinator?.red_detinatori_contact ?? null

/**
 * Lipsurile care blochează generarea unui convocator de trimis (nu de previzualizat). Întoarce lista mesajelor (goală = OK).
 * `contactDetinator` = rândul din red_detinatori_contact (PII; doar admin/editor îl pot citi).
 */
export function verificaDateConvocator({ nrDocument, token, uat, contact, proiect, detinator, contactDetinator }) {
  const u = uat || {}, pr = proiect || {}, c = contact || {}
  const lipsuri = []
  if (!plin(nrDocument)) lipsuri.push('numărul documentului (nr_document)')
  if (!plin(token)) lipsuri.push('tokenul de răspuns al deținătorului')
  if (!plin(pr.contract_nr) || !plin(pr.contract_data)) lipsuri.push('numărul și data contractului (proiect.contract_nr + contract_data)')
  if (!plin(pr.imputernicire_nr) || !plin(pr.imputernicire_data)) lipsuri.push('numărul și data împuternicirii Transgaz (proiect.imputernicire_nr + imputernicire_data) — fără împuternicire nu se trimite')
  if (!detinator) lipsuri.push('deținătorul')
  else {
    if (!plin(detinator.nume)) lipsuri.push('numele deținătorului')
    if (detinator.calitate === 'neidentificat') lipsuri.push('deținător neidentificat — nu primește convocator (parcela merge pe afișare la Primărie)')
    else if (!ETICHETA_CALITATE[detinator.calitate]) lipsuri.push(`calitatea deținătorului („${detinator.calitate ?? ''}” necunoscută)`)
    const cd = contactDet(detinator, contactDetinator)
    if (!cd || cd.adresa_cunoscuta === false || !adresaDetinator(cd)) lipsuri.push('deținător fără adresă — convocare prin afișare')
  }
  const ziCuProgram = [1, 2, 3].some(i => plin(u[`sesiune_zi${i}`]) && plin(u[`program_zi${i}`]))
  if (!ziCuProgram) lipsuri.push('cel puțin o zi de sesiune cu program pe UAT (sesiune_zi1..3 + program_zi1..3)')
  if (!(plin(c.nume ?? pr.contact_nume) || plin(c.telefon ?? pr.contact_telefon) || plin(c.email ?? pr.contact_email))) lipsuri.push('persoana de contact (nume, telefon sau e-mail)')
  if (!plin(pr.text_gdpr)) lipsuri.push('textul de informare GDPR (proiect.text_gdpr)')
  if (!plin(pr.reprezentant_tgz_nume)) lipsuri.push('reprezentantul Transgaz (proiect.reprezentant_tgz_nume)')
  return lipsuri
}

/** Cheile pe care le furnizează genereazaConvocator (cele 35 din convocator.docx, SABLOANE.md §2.1, + id_parcela pentru corelare).
 * Fără `link` (decizia 03.11 seara): pe hârtie e doar QR-ul; linkul se întoarce separat, în rezultat. */
export const CHEI_CONVOCATOR = ['contract_nr', 'contract_data', 'proiect_denumire', 'imputernicire_nr', 'imputernicire_data', 'nr_document', 'data',
  'nume', 'calitate', 'adresa', 'uat', 'sat', 'tarla', 'nr_cadastral', 'poz_hg', 'suprafata', 'tronson', 'zi1', 'program1', 'sate_zi1',
  'zi2', 'program2', 'sate_zi2', 'zi3', 'program3', 'sate_zi3', 'qr', 'contact_telefon', 'contact_nume', 'contact_email', 'text_gdpr',
  'reprezentant_tgz', 'reprezentant_tgz_telefon', 'semnatar_gazpet', 'semnatar_tgz', 'id_parcela']

/**
 * Construiește câmpurile convocatorului real (SABLOANE.md §2.1, 35 placeholder-e), completează șablonul, calculează hash-ul.
 * Linkul de răspuns intră doar în QR și în rezultat (`link`), nu și în document (convocatorul pleacă prin poștă, doar cu QR).
 * `contact` = persoana de contact Gazpet { nume, telefon, email } (fallback: proiect.contact_*); `contactDetinator` = rândul
 * din red_detinatori_contact (adresa; fallback detinator.contact); `dataDocument` opțional (implicit azi).
 * Implicit STRICT: Error în română dacă lipsesc date obligatorii (verificaDateConvocator) sau dacă rămâne un placeholder
 * necompletat/necunoscut în șablon. `permiteIncomplet: true` DOAR pentru previzualizare (câmpurile lipsă → gol) — niciodată
 * pentru salvare.
 * @returns {Promise<{ blob: Blob, hash: string, link: string, campuri: Record<string,string>, lipsuri: string[] }>}
 */
export async function genereazaConvocator({ detinator, contactDetinator, contact, parcela, uat, proiect, nrDocument, token, templateArrayBuffer, dataDocument, permiteIncomplet = false }) {
  if (!templateArrayBuffer) throw new Error('Lipsește șablonul convocatorului (templateArrayBuffer)')
  const lipsuri = verificaDateConvocator({ nrDocument, token, uat, contact, proiect, detinator, contactDetinator })
  if (lipsuri.length && !permiteIncomplet) throw new Error(`Convocatorul nu poate fi generat — lipsesc: ${lipsuri.join('; ')}`)
  if (!plin(token) && permiteIncomplet) throw new Error('Deținătorul nu are token de răspuns — nici previzualizarea nu are link/QR')
  const p = parcela || {}, u = uat || {}, pr = proiect || {}, c = contact || {}, d = detinator || {}
  // Linkul și QR-ul merg mereu pe domeniul public; un `origin` trimis de apelant se ignoră (nu mai e parametru)
  // linkul nu se tipărește (03.11 seara): îl folosesc doar QR-ul și rezultatul întors
  const link = linkRaspuns(token)
  const semnatarTgz = [pr.reprezentant_tgz_nume, pr.reprezentant_tgz_functie].filter(plin).join(', ')
  const semnatarGazpet = [pr.reprezentant_gazpet_nume, pr.reprezentant_gazpet_functie].filter(plin).join(', ')
  const campuri = {
    contract_nr: pr.contract_nr ?? '',
    contract_data: formatDataRo(pr.contract_data),
    proiect_denumire: pr.denumire ?? '',
    imputernicire_nr: pr.imputernicire_nr ?? '',
    imputernicire_data: formatDataRo(pr.imputernicire_data),
    nr_document: nrDocument ?? '',
    data: formatDataRo(dataDocument || new Date()),
    nume: d.nume ?? '',
    calitate: ETICHETA_CALITATE[d.calitate] ?? (d.calitate ?? ''),
    adresa: adresaDetinator(contactDet(detinator, contactDetinator)),
    id_parcela: p.id_parcela ?? '',
    uat: u.nume ?? '',
    sat: p.sat ?? '',
    tarla: p.tarla ?? '',
    nr_cadastral: p.nr_cadastral ?? '',
    poz_hg: p.poz_hg ?? '',
    suprafata: formatNumarRo(p.suprafata_temporara_mp),
    tronson: p.tronson ?? '',
    zi1: formatDataRo(u.sesiune_zi1), program1: u.program_zi1 ?? '', sate_zi1: u.sate_zi1 ?? '',
    zi2: formatDataRo(u.sesiune_zi2), program2: u.program_zi2 ?? '', sate_zi2: u.sate_zi2 ?? '',
    zi3: formatDataRo(u.sesiune_zi3), program3: u.program_zi3 ?? '', sate_zi3: u.sate_zi3 ?? '',
    contact_nume: c.nume ?? pr.contact_nume ?? '',
    contact_telefon: c.telefon ?? pr.contact_telefon ?? '',
    contact_email: c.email ?? pr.contact_email ?? '',
    text_gdpr: textGdprPentruUat(pr.text_gdpr, u.nume, pr.link_informare_gdpr ?? null),
    reprezentant_tgz: semnatarTgz,
    reprezentant_tgz_telefon: pr.reprezentant_tgz_telefon ?? '',
    semnatar_gazpet: semnatarGazpet,
    semnatar_tgz: semnatarTgz,
  }
  const qr = await genereazaQr(link)
  const blob = await completeazaDocx(templateArrayBuffer, campuri, { imagini: { qr }, strict: !permiteIncomplet })
  const hash = await hashBlob(blob)
  return { blob, hash, link, campuri, lipsuri }
}

const RX_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const segment = (v, nume) => {
  const s = String(v ?? '').trim()
  if (!RX_SEGMENT.test(s) || s.includes('..')) throw new Error(`Valoare invalidă pentru calea din storage (${nume}): „${s}”`)
  return s
}

/**
 * Calea în bucket (contract §6, versionată — fișierele din `redari` sunt IMUTABILE, bucket-ul nu are politică de UPDATE):
 * {proiect_cod}/{uat3}/{id_parcela}/{nr_document}-v{n}.docx. Orice reîncărcare merge pe o versiune NOUĂ; fișierele vechi rămân.
 */
export const caleConvocator = ({ proiectCod, uat3, idParcela, nrDocument, versiune = 1 }) => {
  const n = Number(versiune)
  if (!Number.isInteger(n) || n < 1) throw new Error(`Versiune invalidă pentru calea din storage: „${versiune}”`)
  return `${segment(proiectCod, 'proiect_cod')}/${segment(uat3, 'uat3')}/${segment(idParcela, 'id_parcela')}/${segment(nrDocument, 'nr_document')}-v${n}.docx`
}

/** Versiunea din calea curentă (`…-v7.docx` → 7); NULL / cale fără sufix → 0. */
export const versiuneDinCale = (path) => {
  const m = /-v(\d+)\.[A-Za-z0-9]+$/.exec(String(path || ''))
  return m ? parseInt(m[1], 10) : 0
}

const eroareCu = (mesaj, extra) => Object.assign(new Error(mesaj), extra)
// Supabase Storage la upload pe o cheie existentă (upsert false): 409 / „The resource already exists” / error „Duplicate”
const eExistaDeja = (e) => !!e && (String(e.statusCode ?? e.status ?? '') === '409' || /already exists|duplicate/i.test(`${e.message || ''} ${e.error || ''}`))

// upload fără suprascriere — NICIODATĂ upsert:true (bucket-ul nu are politică de UPDATE, fișierele sunt imutabile)
const incarca = (supabase, path, blob) => supabase.storage.from(BUCKET_REDARI).upload(path, blob, { contentType: MIME_DOCX, upsert: false })

// pasul 3: UPDATE rândul cu path + hash; eșecul lasă rândul pe calea veche (fișierul nou rămâne în bucket, reluabil)
const leagaDeRand = async (supabase, { convocareId, path, hash }) => {
  const { data, error: eUpd } = await supabase.from('red_convocari')
    .update({ fisier_convocator_path: path, continut_hash: hash }).eq('id', convocareId).select('id').single()
  if (eUpd || !data?.id) throw eroareCu(`Fișierul e în storage (${path}), dar legarea de convocarea ${convocareId} a eșuat: ${eUpd?.message || eUpd || 'niciun rând actualizat'}. Reluați încărcarea din Registru.`, { convocareId, path, pas: 'update' })
  return { path, convocareId }
}

/**
 * Salvare în 3 pași, ca numărul de document să nu se piardă și să nu rămână fișiere orfane:
 * (1) INSERT red_convocari {detinator_id, canal, nr_document} (path/hash NULL) → id; (2) upload la `…-v1.docx` (upsert false,
 * fără suprascriere); (3) UPDATE rândul cu fisier_convocator_path + continut_hash. Dacă (2) sau (3) eșuează, rândul rămâne
 * fără path („neîncărcat” în UI) și se reia cu reincarcaConvocator; eroarea poartă `convocareId`, `path`, `pas`.
 * @returns {Promise<{ path: string, convocareId: string }>}
 */
export async function salveazaConvocator(supabase, { blob, hash, proiectCod, uat3, idParcela, nrDocument, detinatorId, canal = 'posta' }) {
  if (!supabase) throw new Error('Lipsește clientul Supabase')
  if (!blob) throw new Error('Lipsește fișierul convocatorului')
  if (!plin(hash)) throw new Error('Lipsește hash-ul conținutului')
  if (!detinatorId) throw new Error('Lipsește deținătorul (detinator_id)')
  const path = caleConvocator({ proiectCod, uat3, idParcela, nrDocument, versiune: 1 })
  const { data, error: eIns } = await supabase.from('red_convocari')
    .insert({ detinator_id: detinatorId, canal, nr_document: nrDocument })
    .select('id').single()
  if (eIns) throw new Error(`Înregistrarea convocării ${nrDocument} în red_convocari a eșuat: ${eIns.message || eIns}`)
  if (!data?.id) throw new Error('Înregistrarea convocării nu a întors un id')
  const convocareId = data.id
  const { error: eUp } = await incarca(supabase, path, blob)
  if (eUp) throw eroareCu(`Convocarea ${convocareId} e înregistrată, dar fișierul nu a putut fi încărcat în storage (${path}): ${eUp.message || eUp}. Reluați încărcarea din Registru.`, { convocareId, path, pas: 'upload' })
  return leagaDeRand(supabase, { convocareId, path, hash })
}

export const MAX_INCERCARI_VERSIUNE = 20

export const PAGINA_LISTARE_STORAGE = 1000
const MAX_PAGINI_LISTARE = 100 // plafon de siguranță: 100.000 de obiecte într-un folder de parcelă nu există în practică

/**
 * Cea mai mare versiune `{nrDocument}-v{n}.docx` existentă în folderul parcelei (listare storage PAGINATĂ, limit + offset,
 * până la pagina goală — maximul e real și peste 1000 de obiecte); null dacă vreo pagină eșuează.
 * Fișierele orfane (încărcate, dar nelegate de rând) contează — așa nu mai bâjbâim versiune cu versiune.
 */
export async function versiuneMaximaInBucket(supabase, { proiectCod, uat3, idParcela, nrDocument, adresa = false }, { pagina = PAGINA_LISTARE_STORAGE, esteCurent = () => true } = {}) {
  const folder = `${segment(proiectCod, 'proiect_cod')}/${segment(uat3, 'uat3')}/${segment(idParcela, 'id_parcela')}`
  const nr = segment(nrDocument, 'nr_document')
  const rx = new RegExp(`^${nr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${adresa ? '_' : '-'}v(\\d+)\\.docx$`)
  try {
    let max = 0
    let offset = 0
    for (let p = 0; p < MAX_PAGINI_LISTARE; p++) {
      if (!esteCurent()) return null
      const { data, error } = await supabase.storage.from(BUCKET_REDARI).list(folder, { limit: pagina, offset, sortBy: { column: 'name', order: 'asc' } })
      if (!esteCurent()) return null
      if (error || !Array.isArray(data)) return null
      for (const f of data) { const m = rx.exec(f?.name || ''); if (m) max = Math.max(max, parseInt(m[1], 10)) }
      if (data.length === 0) return max // continuăm și când serverul plafonează pagina sub limita cerută
      offset += data.length
    }
    return null // prea multe pagini: nu ne bazăm pe un maxim parțial → cad pe încercări succesive
  } catch { return null }
}

/**
 * Reîncărcarea unei convocări (rămasă fără fișier sau regenerată): citește calea curentă din rând, determină versiunea LIBERĂ
 * (max dintre versiunea din rând și cea mai mare `-v{n}` din folderul parcelei, +1), încarcă cu upsert false și face UPDATE
 * pe rând cu noua cale + hash. Dacă listarea folderului eșuează sau apare totuși „already exists”, încearcă versiunile
 * următoare, succesiv, până la MAX_INCERCARI_VERSIUNE încărcări; peste → eroare clară. Fișierele vechi rămân în bucket
 * (imutabile); schimbarea coloanei e jurnalizată de trigger.
 * @returns {Promise<{ path: string, convocareId: string, versiune: number }>}
 */
export async function reincarcaConvocator(supabase, { convocareId, blob, hash, proiectCod, uat3, idParcela, nrDocument }) {
  if (!supabase) throw new Error('Lipsește clientul Supabase')
  if (!convocareId) throw new Error('Lipsește id-ul convocării de reîncărcat')
  if (!blob) throw new Error('Lipsește fișierul convocatorului')
  if (!plin(hash)) throw new Error('Lipsește hash-ul conținutului')
  caleConvocator({ proiectCod, uat3, idParcela, nrDocument }) // validează segmentele înainte de orice apel
  const { data: rand, error: eSel } = await supabase.from('red_convocari').select('id, fisier_convocator_path').eq('id', convocareId).single()
  if (eSel || !rand) throw new Error(`Convocarea ${convocareId} nu a putut fi citită: ${eSel?.message || eSel || 'rând inexistent'}`)
  const dinBucket = await versiuneMaximaInBucket(supabase, { proiectCod, uat3, idParcela, nrDocument })
  let versiune = Math.max(versiuneDinCale(rand.fisier_convocator_path), dinBucket ?? 0) + 1
  let path, eUp
  for (let incercare = 1; ; incercare++) {
    path = caleConvocator({ proiectCod, uat3, idParcela, nrDocument, versiune })
    ;({ error: eUp } = await incarca(supabase, path, blob))
    if (!eUp) break
    if (!eExistaDeja(eUp)) throw eroareCu(`Fișierul convocării ${convocareId} nu a putut fi încărcat în storage (${path}): ${eUp.message || eUp}. Reluați încărcarea din Registru.`, { convocareId, path, pas: 'upload' })
    if (incercare >= MAX_INCERCARI_VERSIUNE) throw eroareCu(`Fișierul convocării ${convocareId} nu a putut fi încărcat: ${MAX_INCERCARI_VERSIUNE} versiuni consecutive (până la ${path}) există deja în storage. Verificați folderul parcelei în bucket-ul redari.`, { convocareId, path, pas: 'upload' })
    versiune += 1 // coliziune (fișier orfan): următoarea versiune, tot cu upsert false
  }
  const r = await leagaDeRand(supabase, { convocareId, path, hash })
  return { ...r, versiune }
}

// Adresa UAT (Model 4): lista este comparată cu șablonul real în docx.test.js.
// Final_v2 (03.11.2026): modelul nu mai are antetul firmei, deci nici contract_nr / contract_data / proiect_denumire (40 de chei);
// genereazaAdresaUat le calculează în continuare, iar verificaDateAdresaUat le cere (contractul rămâne obligatoriu pe proiect).
export const CHEI_ADRESA_UAT = [
  'uat', 'judet', 'nr_document', 'data',
  'imputernicire_nr', 'imputernicire_data', 'zi1', 'zi2', 'zi3', 'program1', 'program2', 'program3',
  'sate_zi1', 'sate_zi2', 'sate_zi3', 'afisare_data_start', 'afisare_data_end', 'afisare_pv_nr',
  'termen_confirmare', 'contact_nume', 'contact_telefon', 'contact_email', 'reprezentant_tgz',
  'reprezentant_tgz_telefon', 'reprezentant_gazpet', 'zile_sesiune_text', 'program_text',
  'rand.nr', 'rand.sat', 'rand.tarla', 'rand.nr_cadastral', 'rand.poz_hg', 'rand.tronson',
  'reprezentant_uat_nume', 'reprezentant_uat_functie', 'reprezentant_gazpet_nume', 'afisare_ora',
  'numar_parcele', 'semnatar_uat', 'semnatar_gazpet',
]

export function verificaDateAdresaUat({ proiect = {}, uat = {}, nrDocument } = {}) {
  const lipsuri = []
  const cere = (v, mesaj) => { if (!plin(v)) lipsuri.push(mesaj) }
  cere(nrDocument, 'Lipsește nr. documentului')
  cere(proiect.contract_nr, 'Lipsește nr. contractului')
  cere(proiect.contract_data, 'Lipsește data contractului')
  cere(proiect.imputernicire_nr, 'Lipsește nr. împuternicirii Transgaz')
  cere(proiect.imputernicire_data, 'Lipsește data împuternicirii Transgaz')
  if (![1, 2, 3].some(i => plin(uat[`sesiune_zi${i}`]) && plin(uat[`program_zi${i}`]))) lipsuri.push('Lipsește o zi de sesiune cu program')
  cere(uat.afisare_data_start, 'Lipsește data începerii afișării')
  cere(uat.afisare_data_end, 'Lipsește data încheierii afișării')
  cere(uat.termen_confirmare, 'Lipsește termenul de confirmare')
  cere(proiect.reprezentant_gazpet_nume, 'Lipsește reprezentantul Gazpet')
  if (!['contact_nume', 'contact_telefon', 'contact_email'].some(k => plin(proiect[k]))) lipsuri.push('Lipsește contactul Gazpet (nume, telefon sau e-mail)')
  cere(uat.nume, 'Lipsește numele UAT-ului')
  cere(uat.judet, 'Lipsește județul UAT-ului')
  // adresa cere afișarea „începând cu data de X (cu cel puțin 10 zile înainte de prima sesiune)”: cu X prea târziu nu se generează
  const termen = termenAfisare(uat)
  if (termen.depasit) lipsuri.push(mesajTermenAfisare(termen))
  return lipsuri
}

/** Data civilă a documentului în România, inclusiv la miezul nopții UTC. */
export function aziBucuresti() {
  const parti = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const p = Object.fromEntries(parti.map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export function zileSesiuneText(uat) {
  const zile = [1, 2, 3].map(i => uat[`sesiune_zi${i}`]).filter(Boolean)
  if (!zile.length) return ''
  const luni = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
  const aceeasiLuna = zile.every(z => z.slice(0, 7) === zile[0].slice(0, 7))
  const texte = zile.map(z => `${Number(z.slice(8, 10))}${aceeasiLuna ? '' : ` ${luni[Number(z.slice(5, 7)) - 1]} ${z.slice(0, 4)}`}`)
  const lista = texte.length > 1 ? `${texte.slice(0, -1).join(', ')} și ${texte.at(-1)}` : texte[0]
  return aceeasiLuna ? `${lista} ${luni[Number(zile[0].slice(5, 7)) - 1]} ${zile[0].slice(0, 4)}` : lista
}

export async function genereazaAdresaUat({ proiect = {}, uat = {}, parcele = [], nrDocument, templateArrayBuffer, strict = true, dataDocument = aziBucuresti() }) {
  const lipsuri = verificaDateAdresaUat({ proiect, uat, nrDocument })
  if (strict && lipsuri.length) throw new Error(lipsuri.join('; '))
  const active = parcele.filter(p => p.sters_la == null).slice().sort((a, b) => a.id_parcela.localeCompare(b.id_parcela))
  const campuri = Object.fromEntries(CHEI_ADRESA_UAT.filter(k => !k.startsWith('rand.')).map(k => [k, '']))
  Object.assign(campuri, {
    contract_nr: proiect.contract_nr ?? '', contract_data: formatDataRo(proiect.contract_data), proiect_denumire: proiect.denumire ?? '',
    uat: uat.nume ?? '', judet: uat.judet ?? '', nr_document: nrDocument ?? '', data: formatDataRo(dataDocument),
    imputernicire_nr: proiect.imputernicire_nr ?? '', imputernicire_data: formatDataRo(proiect.imputernicire_data),
    afisare_data_start: formatDataRo(uat.afisare_data_start), afisare_data_end: formatDataRo(uat.afisare_data_end), afisare_pv_nr: uat.afisare_pv_nr ?? '',
    termen_confirmare: formatDataRo(uat.termen_confirmare), afisare_ora: uat.afisare_ora ?? '',
    reprezentant_gazpet: [proiect.reprezentant_gazpet_nume, proiect.reprezentant_gazpet_functie].filter(Boolean).join(', '),
    reprezentant_gazpet_nume: proiect.reprezentant_gazpet_nume ?? '', reprezentant_tgz: proiect.reprezentant_tgz_nume ?? '',
    reprezentant_tgz_telefon: proiect.reprezentant_tgz_telefon ?? '', reprezentant_uat_nume: uat.reprezentant_uat_nume ?? '',
    reprezentant_uat_functie: uat.reprezentant_uat_functie ?? '', semnatar_uat: uat.reprezentant_uat_nume ?? '', semnatar_gazpet: proiect.reprezentant_gazpet_nume ?? '',
    contact_nume: proiect.contact_nume ?? '', contact_telefon: proiect.contact_telefon ?? '', contact_email: proiect.contact_email ?? '',
    numar_parcele: active.length, zile_sesiune_text: zileSesiuneText(uat),
  })
  const sesiuni = [1, 2, 3].filter(i => uat[`sesiune_zi${i}`])
  const prima = sesiuni[0]
  campuri.program_text = prima ? uat[`program_zi${prima}`] ?? '' : ''
  for (const i of [1, 2, 3]) {
    campuri[`zi${i}`] = formatDataRo(uat[`sesiune_zi${i}`])
    campuri[`program${i}`] = uat[`program_zi${i}`] ?? ''
    campuri[`sate_zi${i}`] = uat[`sate_zi${i}`] ?? ''
    if (i !== prima && sesiuni.includes(i) && uat[`program_zi${i}`] && uat[`program_zi${i}`] !== uat[`program_zi${prima}`]) {
      // Programul poate avea o descriere liberă; nu inventăm o oră dacă nu este un interval.
      const final = /^[ \t]*\d{2}:\d{2}[ \t]*(?:–|—|-)[ \t]*(\d{2}:\d{2})[ \t]*$/.exec(uat[`program_zi${i}`])?.[1]   // Gemini f2b r1 P3: doar un interval simplu
      campuri.program_text += final ? `, ziua ${i} până la ${final}` : `, ziua ${i}: ${uat[`program_zi${i}`]}`
    }
  }
  const rand = active.map((p, index) => ({ nr: index + 1, sat: p.sat ?? '', tarla: p.tarla ?? '', nr_cadastral: p.nr_cadastral ?? '', poz_hg: p.poz_hg ?? '', tronson: p.tronson ?? '' }))
  const blob = await completeazaDocx(templateArrayBuffer, campuri, { randuri: { rand }, strict })
  return { blob, hash: await hashBlob(blob), campuri }
}

export const caleAdresaUat = ({ proiectCod, uat3, nrDocument, versiune = 1 }) => {
  if (!Number.isInteger(versiune) || versiune < 1) throw new Error('Versiune invalidă pentru adresă')
  return `${segment(proiectCod, 'proiect_cod')}/${segment(uat3, 'uat3')}/adresa/${segment(nrDocument, 'nr_document')}_v${versiune}.docx`
}

/**
 * Upload imutabil al adresei (versiunea următoare liberă). Numărul și data sunt DEJA pe red_uat (fn_red_adresa_uat_rezerva, Copilot f2b r1 P2-1):
 * aici nu se mai scrie în BD, deci un eșec de upload lasă UAT-ul cu numărul rezervat și fără fișier — reluarea e „Regenerează” pe același număr.
 */
export async function salveazaAdresaUat(supabase, { blob, proiectCod, uat, nrDocument, esteCurent = () => true }) {
  const cheie = { proiectCod, uat3: uat.uat3, nrDocument, idParcela: 'adresa', adresa: true }
  caleAdresaUat(cheie)
  const max = await versiuneMaximaInBucket(supabase, cheie, { esteCurent })
  if (!esteCurent()) throw new Error('Operație abandonată: UAT-ul s-a schimbat')
  if (max === null) throw new Error('Nu pot lista versiunile adresei; reîncarcă și verifică starea înainte de reluare')
  let versiune = max + 1
  let path
  for (let i = 0; i < MAX_INCERCARI_VERSIUNE; i++, versiune++) {
    if (!esteCurent()) throw new Error('Operație abandonată: UAT-ul s-a schimbat')
    path = caleAdresaUat({ ...cheie, versiune })
    const { error } = await incarca(supabase, path, blob)
    if (!error) break
    if (!eExistaDeja(error) || i === MAX_INCERCARI_VERSIUNE - 1) throw new Error('Încărcarea adresei a eșuat; numărul rămâne pe UAT, reia cu „Regenerează”. ' + (error.message || 'Storage indisponibil'))
  }
  return { path, versiune }
}
