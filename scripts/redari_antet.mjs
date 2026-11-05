// Redări — antetul oficial Gazpet (imagine) în header-ul primei pagini al unui șablon DOCX (decizia Răzvan 05.11.2026:
// doar prima pagină, rândul scris cu datele firmei se scoate din corp). Folosit de redari_sabloane_din_modele.mjs și de
// redari_sablon_cerere_imputernicire.mjs. Imaginea: docs/redari/referinta/antet_gazpet.jpg (decupată la 300 dpi din
// „Adresa Europan.pdf”, nr. 1008/03.11.2026: datele firmei, foto conductă, siglele AQ Cert ISO 9001 / 14001).
import { readFileSync } from 'node:fs'

export const ANTET_IMAGINE = new URL('../docs/redari/referinta/antet_gazpet.jpg', import.meta.url)
export const ANTET_PX = { w: 2342, h: 337 }
// distanța header-ului de la marginea de sus (twips): 0,5 cm — antetul ocupă ~2,6 cm, corpul începe sub el
export const ANTET_DISTANTA = 284
const R_HEADER = 'rIdAntetGazpet'
const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
}
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function asigura(cond, mesaj) { if (!cond) throw new Error(`antet: ${mesaj}`) }

const headerXml = (cx, cy) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<w:hdr xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}">` +
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
  `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  '<wp:docPr id="1" name="Antet Gazpet" descr="Antet GAZPET INSTAL S.R.L."/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  '<pic:nvPicPr><pic:cNvPr id="1" name="antet_gazpet.jpg"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>'

/**
 * Adaugă antetul în zip (șablon DOCX cu o singură secțiune). Lățimea = lățimea utilă a paginii (pgSz − margini), înălțimea
 * proporțională; header de tip „first” + <w:titlePg/> → doar pe prima pagină (versoul / paginile 2+ fără antet).
 * Refuză un șablon care are deja header-e sau mai multe secțiuni (nu ghicește).
 */
export async function adaugaAntet(zip, { date, imagine = readFileSync(ANTET_IMAGINE) } = {}) {
  const opt = { date, createFolders: false }
  asigura(!Object.keys(zip.files).some(p => /^word\/header\d*\.xml$/.test(p)), 'șablonul are deja header')
  let doc = await zip.file('word/document.xml').async('string')
  const sect = doc.match(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/g) ?? []
  asigura(sect.length === 1, `aștept o singură secțiune, am ${sect.length}`)
  const s = sect[0]
  asigura(!/<w:headerReference|<w:titlePg/.test(s), 'secțiunea are deja headerReference / titlePg')
  const pg = s.match(/<w:pgSz w:w="(\d+)"/)
  const mar = s.match(/<w:pgMar [^>]*w:right="(\d+)"[^>]*w:left="(\d+)"/)
  asigura(pg && mar, 'pgSz / pgMar în altă formă decât cea știută')
  const latimeTwips = Number(pg[1]) - Number(mar[1]) - Number(mar[2])
  const cx = latimeTwips * 635
  const cy = Math.round(cx * ANTET_PX.h / ANTET_PX.w)
  let s2 = s.replace(/^(<w:sectPr(?:\s[^>]*)?>)/, `$1<w:headerReference w:type="first" r:id="${R_HEADER}"/>`)
    .replace(/(<w:pgMar [^>]*w:header=")\d+(")/, `$1${ANTET_DISTANTA}$2`)
  // ordinea din schemă: … cols, formProt, vAlign, noEndnote, titlePg, textDirection, bidi, rtlGutter, docGrid
  s2 = /<w:(textDirection|bidi|rtlGutter|docGrid)[\s/>]/.test(s2) ? s2.replace(/<w:(textDirection|bidi|rtlGutter|docGrid)[\s/>]/, m => `<w:titlePg/>${m}`) : s2.replace('</w:sectPr>', '<w:titlePg/></w:sectPr>')
  asigura(s2.includes(`w:header="${ANTET_DISTANTA}"`), 'pgMar fără atributul w:header')
  doc = doc.replace(s, () => s2)
  // prefixul r: trebuie declarat pe rădăcină (șablonul cererii nu îl are)
  if (!/<w:document[^>]*\sxmlns:r=/.test(doc)) doc = doc.replace(/<w:document(\s|>)/, `<w:document xmlns:r="${NS.r}"$1`)
  zip.file('word/document.xml', doc, opt)

  const relsCale = 'word/_rels/document.xml.rels'
  const rels = await zip.file(relsCale).async('string')
  asigura(!rels.includes(`Id="${R_HEADER}"`), 'relația antetului există deja')
  zip.file(relsCale, rels.replace('</Relationships>', `<Relationship Id="${R_HEADER}" Type="${REL}/header" Target="header1.xml"/></Relationships>`), opt)
  zip.file('word/header1.xml', headerXml(cx, cy), opt)
  zip.file('word/_rels/header1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="media/antet_gazpet.jpg"/></Relationships>`, opt)
  zip.file('word/media/antet_gazpet.jpg', imagine, { ...opt, binary: true })

  let ct = await zip.file('[Content_Types].xml').async('string')
  if (!/<Default Extension="jpg"/i.test(ct)) ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="jpg" ContentType="image/jpeg"/>')
  ct = ct.replace('</Types>', '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>')
  zip.file('[Content_Types].xml', ct, opt)
  return { cx, cy, latimeTwips }
}

// rândul scris cu datele firmei (primul run al antetului din Model_1, urmat de <w:br/> și „Lider al Asocierii …”) se scoate:
// datele firmei sunt acum în imagine. Rămâne „Lider al Asocierii … Contract …”. Exact o apariție, altfel eroare.
export function faraDateFirma(xml, textFirmaEscapat) {
  const t = textFirmaEscapat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rx = new RegExp(`<w:r(?:\\s[^>]*)?>(<w:rPr>(?:(?!</w:rPr>)[\\s\\S])*</w:rPr>)<w:t>${t}</w:t></w:r>(<w:r(?:\\s[^>]*)?>)\\1<w:br/>`, 'g')
  const n = (xml.match(rx) ?? []).length
  asigura(n === 1, `rândul cu datele firmei: aștept 1 apariție (run + <w:br/>), am ${n}`)
  return xml.replace(rx, '$2$1')
}
