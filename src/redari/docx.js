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
// 2. Un placeholder rupt între două paragrafe NU se înlocuiește (rămâne ca în șablon).
// 3. Se procesează doar paragrafele „frunză” (fără alt <w:p> înăuntru): într-o casetă text (textbox) se înlocuiesc
//    paragrafele din casetă, dar nu și run-urile paragrafului-gazdă din jurul casetei.
// 4. {{qr}} devine imagine DOAR dacă paragraful conține exclusiv {{qr}} (plus spații); altfel se înlocuiește cu șir gol.
// 5. Valorile sunt text simplu (escape XML); \n din valoare devine <w:br/> (rând nou în același paragraf).
// 6. Nu se ating w:instrText / câmpuri Word, comentarii, note de subsol.

import JSZip from 'jszip'
import QRCode from 'qrcode'

export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const BUCKET_REDARI = 'redari'
const QR_CM = 3
const EMU_PER_CM = 360000
const DATA_FIXA_ZIP = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) // intrări noi în zip cu dată fixă → același conținut ⇒ același hash

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

const inlocuiesteText = (text, campuri) =>
  text.replace(RX_PLACEHOLDER, (_, nume) => {
    const v = campuri[nume]
    return v === null || v === undefined ? '' : String(v)
  })

// Înlocuirea într-un paragraf: întâi local (placeholder întreg într-un singur <w:t>), apoi, dacă a rămas ceva rupt
// între run-uri, consolidare în primul <w:t>.
const completeazaParagraf = (pXml, campuri) => {
  if (!/\{\{/.test(pXml) && !/\{\{/.test(textParagraf(pXml))) return pXml
  let out = pXml.replace(RX_WT, (m, inner) => {
    if (inner === undefined || !RX_PLACEHOLDER.test(inner)) { RX_PLACEHOLDER.lastIndex = 0; return m }
    RX_PLACEHOLDER.lastIndex = 0
    const nou = unescapeXml(inner).replace(RX_PLACEHOLDER, (_, nume) => {
      const v = campuri[nume]
      return v === null || v === undefined ? '' : String(v)
    })
    return `<w:t xml:space="preserve">${valoareInWt(nou)}</w:t>`
  })
  const textRamas = textParagraf(out)
  if (!RX_PLACEHOLDER.test(textRamas)) { RX_PLACEHOLDER.lastIndex = 0; return out }
  RX_PLACEHOLDER.lastIndex = 0
  // placeholder rupt între run-uri: tot textul în primul <w:t>, restul golite (limita 1 din antet)
  const textNou = inlocuiesteText(textRamas, campuri)
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
  zip.file(relsPath, rels, { date: f ? f.date : DATA_FIXA_ZIP })
  return rId
}

const asiguraContentTypePng = async (zip) => {
  const f = zip.file('[Content_Types].xml')
  if (!f) throw new Error('Șablonul DOCX nu are [Content_Types].xml')
  const ct = await f.async('string')
  if (/Extension="png"/i.test(ct)) return
  zip.file('[Content_Types].xml', ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>'), { date: f.date })
}

const dataUrlBase64 = (dataUrl) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''))
  if (!m) throw new Error('imagini.qr trebuie să fie un dataURL PNG (data:image/png;base64,...)')
  return m[1].replace(/\s+/g, '')
}

/**
 * Completează un șablon DOCX: {{camp}} → campuri[camp] (șir gol dacă lipsește), în document + antete + subsoluri.
 * @param {ArrayBuffer|Uint8Array|Blob} templateArrayBuffer
 * @param {Record<string, any>} campuri
 * @param {{ imagini?: { qr?: string } }} [optiuni] imagini.qr = dataURL PNG → înlocuiește paragraful {{qr}} cu imaginea (~3 cm)
 * @returns {Promise<Blob>} DOCX completat
 */
export async function completeazaDocx(templateArrayBuffer, campuri = {}, { imagini } = {}) {
  const sursa = templateArrayBuffer instanceof Blob ? await templateArrayBuffer.arrayBuffer() : templateArrayBuffer
  const zip = await JSZip.loadAsync(sursa)
  if (!zip.file('word/document.xml')) throw new Error('Fișierul nu este un DOCX valid (lipsește word/document.xml)')
  const parti = Object.keys(zip.files).filter(p => p === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(p)).sort()
  const qrDataUrl = imagini?.qr
  let qrAdaugat = false
  let docPrId = 9000

  for (const partPath of parti) {
    const f = zip.file(partPath)
    const xml = await f.async('string')
    if (!xml.includes('{{')) continue
    let rId = null
    if (qrDataUrl && /\{\{\s*qr\s*\}\}/.test(textParagrafeConcatenate(xml))) {
      if (!qrAdaugat) {
        zip.file('word/media/qr.png', dataUrlBase64(qrDataUrl), { base64: true, date: DATA_FIXA_ZIP })
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
      return completeazaParagraf(pXml, campuri)
    })
    zip.file(partPath, nou, { date: f.date })
  }
  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new Blob([u8], { type: MIME_DOCX })
}

const textParagrafeConcatenate = (xml) => {
  let t = ''
  for (const m of xml.matchAll(RX_PARAGRAF)) t += textParagraf(m[0]) + '\n'
  return t
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

const celulaCsv = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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

/**
 * Construiește câmpurile din contract §8, completează șablonul, calculează hash-ul.
 * `contact` = { nume, telefon, email } (fallback: proiect.contact_*); `dataDocument` opțional (implicit azi).
 * @returns {Promise<{ blob: Blob, hash: string, link: string, campuri: Record<string,string> }>}
 */
export async function genereazaConvocator({ detinator, contact, parcela, uat, proiect, nrDocument, token, origin, templateArrayBuffer, dataDocument }) {
  if (!templateArrayBuffer) throw new Error('Lipsește șablonul convocatorului (templateArrayBuffer)')
  if (!token) throw new Error('Deținătorul nu are token de răspuns')
  if (!nrDocument) throw new Error('Lipsește numărul documentului (nr_document)')
  const p = parcela || {}, u = uat || {}, pr = proiect || {}, c = contact || {}
  const link = linkRaspuns(origin ?? (typeof window !== 'undefined' ? window.location.origin : ''), token)
  const reprezentant = [pr.reprezentant_tgz_nume, pr.reprezentant_tgz_functie].filter(Boolean).join(', ')
  const campuri = {
    nume: detinator?.nume ?? '',
    id_parcela: p.id_parcela ?? '',
    uat: u.nume ?? '',
    sat: p.sat ?? '',
    tarla: p.tarla ?? '',
    nr_cadastral: p.nr_cadastral ?? '',
    suprafata: formatNumarRo(p.suprafata_temporara_mp),
    zi1: formatDataRo(u.sesiune_zi1), program1: u.program_zi1 ?? '',
    zi2: formatDataRo(u.sesiune_zi2), program2: u.program_zi2 ?? '',
    zi3: formatDataRo(u.sesiune_zi3), program3: u.program_zi3 ?? '',
    link,
    nr_document: nrDocument,
    data: formatDataRo(dataDocument || new Date()),
    contact_nume: c.nume ?? pr.contact_nume ?? '',
    contact_telefon: c.telefon ?? pr.contact_telefon ?? '',
    contact_email: c.email ?? pr.contact_email ?? '',
    reprezentant_tgz: reprezentant,
    text_gdpr: pr.text_gdpr ?? '',
  }
  const qr = await genereazaQr(link)
  const blob = await completeazaDocx(templateArrayBuffer, campuri, { imagini: { qr } })
  const hash = await hashBlob(blob)
  return { blob, hash, link, campuri }
}

const RX_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const segment = (v, nume) => {
  const s = String(v ?? '').trim()
  if (!RX_SEGMENT.test(s) || s.includes('..')) throw new Error(`Valoare invalidă pentru calea din storage (${nume}): „${s}”`)
  return s
}

/** Calea în bucket (contract §6): {proiect_cod}/{uat3}/{id_parcela}/{nr_document}.docx */
export const caleConvocator = ({ proiectCod, uat3, idParcela, nrDocument }) =>
  `${segment(proiectCod, 'proiect_cod')}/${segment(uat3, 'uat3')}/${segment(idParcela, 'id_parcela')}/${segment(nrDocument, 'nr_document')}.docx`

/**
 * Upload în bucket-ul `redari` (upsert false) + rând în red_convocari.
 * @returns {Promise<{ path: string, convocareId: string }>}
 */
export async function salveazaConvocator(supabase, { blob, hash, proiectCod, uat3, idParcela, nrDocument, detinatorId, canal = 'posta' }) {
  if (!supabase) throw new Error('Lipsește clientul Supabase')
  if (!blob) throw new Error('Lipsește fișierul convocatorului')
  if (!detinatorId) throw new Error('Lipsește deținătorul (detinator_id)')
  const path = caleConvocator({ proiectCod, uat3, idParcela, nrDocument })
  const { error: eUp } = await supabase.storage.from(BUCKET_REDARI).upload(path, blob, { contentType: MIME_DOCX, upsert: false })
  if (eUp) throw new Error(`Încărcarea convocatorului în storage a eșuat (${path}): ${eUp.message || eUp}`)
  const { data, error: eIns } = await supabase.from('red_convocari')
    .insert({ detinator_id: detinatorId, canal, nr_document: nrDocument, continut_hash: hash, fisier_convocator_path: path })
    .select('id').single()
  if (eIns) throw new Error(`Fișierul a fost încărcat la ${path}, dar înregistrarea convocării în red_convocari a eșuat: ${eIns.message || eIns}`)
  if (!data?.id) throw new Error('Înregistrarea convocării nu a întors un id')
  return { path, convocareId: data.id }
}
