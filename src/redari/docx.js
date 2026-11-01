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

export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const BUCKET_REDARI = 'redari'
const QR_CM = 3
const EMU_PER_CM = 360000
const DATA_FIXA_ZIP = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) // intrări în zip cu dată fixă → același conținut ⇒ același hash
const OPT_ZIP = { date: DATA_FIXA_ZIP, createFolders: false } // fără intrări de director (ar primi data curentă)

const RX_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g
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

/**
 * Completează un șablon DOCX: {{camp}} → campuri[camp], în document + antete + subsoluri.
 * @param {ArrayBuffer|Uint8Array|Blob} templateArrayBuffer
 * @param {Record<string, any>} campuri
 * @param {{ imagini?: { qr?: string }, strict?: boolean }} [optiuni]
 *   imagini.qr = dataURL PNG → înlocuiește paragraful {{qr}} cu imaginea (~3 cm);
 *   strict = true → Error dacă un placeholder nu are cheie în `campuri` sau rămâne necompletat în XML (altfel → șir gol).
 * @returns {Promise<Blob>} DOCX completat
 */
export async function completeazaDocx(templateArrayBuffer, campuri = {}, { imagini, strict = false } = {}) {
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
    const xml = await f.async('string')
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

/** Linkul public de răspuns (contract §8). */
export const linkRaspuns = (origin, token) => `${String(origin || '').replace(/\/+$/, '')}/redari/raspuns/${token}`

const plin = (v) => v !== null && v !== undefined && String(v).trim() !== ''

/** Eticheta în română a calității deținătorului (red_detinatori.calitate). `neidentificat` nu primește convocator. */
export const ETICHETA_CALITATE = { proprietar: 'proprietar', coproprietar: 'coproprietar', mostenitor: 'moștenitor', arendas: 'arendaș', utilizator: 'utilizator', neidentificat: 'neidentificat' }

/** O linie de adresă din red_detinatori_contact: strada, sat, comuna, județ, cod poștal — părțile nevide, cu virgulă. */
export const adresaDetinator = (c) => !c ? '' :
  [c.adresa_strada, c.adresa_sat, c.adresa_comuna, c.adresa_judet, c.cod_postal].map(v => plin(v) ? String(v).trim() : '').filter(Boolean).join(', ')

/** Textul GDPR din proiect cu marcajul `{uat}` / `[UAT]` înlocuit cu numele UAT-ului. */
export const textGdprPentruUat = (text, numeUat) => String(text ?? '').replace(/\{uat\}|\[UAT\]/gi, numeUat ?? '')

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

/** Cheile pe care le furnizează genereazaConvocator (cele 36 din convocator.docx, SABLOANE.md §2.1, + id_parcela pentru corelare). */
export const CHEI_CONVOCATOR = ['contract_nr', 'contract_data', 'proiect_denumire', 'imputernicire_nr', 'imputernicire_data', 'nr_document', 'data',
  'nume', 'calitate', 'adresa', 'uat', 'sat', 'tarla', 'nr_cadastral', 'poz_hg', 'suprafata', 'tronson', 'zi1', 'program1', 'sate_zi1',
  'zi2', 'program2', 'sate_zi2', 'zi3', 'program3', 'sate_zi3', 'link', 'qr', 'contact_telefon', 'contact_nume', 'contact_email', 'text_gdpr',
  'reprezentant_tgz', 'reprezentant_tgz_telefon', 'semnatar_gazpet', 'semnatar_tgz', 'id_parcela']

/**
 * Construiește câmpurile convocatorului real (SABLOANE.md §2.1, 36 placeholder-e), completează șablonul, calculează hash-ul.
 * `contact` = persoana de contact Gazpet { nume, telefon, email } (fallback: proiect.contact_*); `contactDetinator` = rândul
 * din red_detinatori_contact (adresa; fallback detinator.contact); `dataDocument` opțional (implicit azi).
 * Implicit STRICT: Error în română dacă lipsesc date obligatorii (verificaDateConvocator) sau dacă rămâne un placeholder
 * necompletat/necunoscut în șablon. `permiteIncomplet: true` DOAR pentru previzualizare (câmpurile lipsă → gol) — niciodată
 * pentru salvare.
 * @returns {Promise<{ blob: Blob, hash: string, link: string, campuri: Record<string,string>, lipsuri: string[] }>}
 */
export async function genereazaConvocator({ detinator, contactDetinator, contact, parcela, uat, proiect, nrDocument, token, origin, templateArrayBuffer, dataDocument, permiteIncomplet = false }) {
  if (!templateArrayBuffer) throw new Error('Lipsește șablonul convocatorului (templateArrayBuffer)')
  const lipsuri = verificaDateConvocator({ nrDocument, token, uat, contact, proiect, detinator, contactDetinator })
  if (lipsuri.length && !permiteIncomplet) throw new Error(`Convocatorul nu poate fi generat — lipsesc: ${lipsuri.join('; ')}`)
  if (!plin(token) && permiteIncomplet) throw new Error('Deținătorul nu are token de răspuns — nici previzualizarea nu are link/QR')
  const p = parcela || {}, u = uat || {}, pr = proiect || {}, c = contact || {}, d = detinator || {}
  const link = linkRaspuns(origin ?? (typeof window !== 'undefined' ? window.location.origin : ''), token)
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
    link,
    contact_nume: c.nume ?? pr.contact_nume ?? '',
    contact_telefon: c.telefon ?? pr.contact_telefon ?? '',
    contact_email: c.email ?? pr.contact_email ?? '',
    text_gdpr: textGdprPentruUat(pr.text_gdpr, u.nume),
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
 * până la o pagină incompletă — maximul e real și peste 1000 de obiecte); null dacă vreo pagină eșuează.
 * Fișierele orfane (încărcate, dar nelegate de rând) contează — așa nu mai bâjbâim versiune cu versiune.
 */
export async function versiuneMaximaInBucket(supabase, { proiectCod, uat3, idParcela, nrDocument }, { pagina = PAGINA_LISTARE_STORAGE } = {}) {
  const folder = `${segment(proiectCod, 'proiect_cod')}/${segment(uat3, 'uat3')}/${segment(idParcela, 'id_parcela')}`
  const nr = segment(nrDocument, 'nr_document')
  const rx = new RegExp(`^${nr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v(\\d+)\\.docx$`)
  try {
    let max = 0
    for (let p = 0; p < MAX_PAGINI_LISTARE; p++) {
      const { data, error } = await supabase.storage.from(BUCKET_REDARI).list(folder, { limit: pagina, offset: p * pagina })
      if (error || !Array.isArray(data)) return null
      for (const f of data) { const m = rx.exec(f?.name || ''); if (m) max = Math.max(max, parseInt(m[1], 10)) }
      if (data.length < pagina) return max // pagină incompletă = ultima
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
