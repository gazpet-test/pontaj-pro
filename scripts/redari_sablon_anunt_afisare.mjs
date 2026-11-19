// Redări — șablonul „Anunț de afișare la primărie” (convocarea pe UAT; planul procedurii de predare rev. 1, pct. 4.3 + cap. 8),
// construit DOAR din textul docs/redari/TEXT_ANUNT_AFISARE.md (marcajele de formatare sunt descrise acolo).
// Rulare: node scripts/redari_sablon_anunt_afisare.mjs            (scrie public/redari/sabloane/anunt_afisare.docx)
//         node scripts/redari_sablon_anunt_afisare.mjs --verifica (doar compară octet cu octet; iese cu 1 dacă diferă)
// Reguli: fiecare placeholder stă întreg într-un singur <w:t> (docx.js înlocuiește local); tabelele au antetul repetat pe fiecare
// pagină (<w:tblHeader/>) și rânduri care nu se rup (<w:cantSplit/>); rândul cu {{rand.*}} e repetat de repetaRand pentru fiecare
// parcelă; antetul oficial Gazpet (imagine) e în header-ul primei pagini (redari_antet.mjs). Ieșirea e deterministă (dată fixă în zip).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { adaugaAntet } from './redari_antet.mjs'

export const SURSA = new URL('../docs/redari/TEXT_ANUNT_AFISARE.md', import.meta.url)
const DESTINATIE = new URL('../public/redari/sabloane/anunt_afisare.docx', import.meta.url)
// A4 portret; marginile convocatorului (1,27 cm sus / jos, 1,5 cm stânga / dreapta)
export const PAGINA = { w: 11906, h: 16838, sus: 720, jos: 720, stanga: 850, dreapta: 850 }
export const LATIME_UTILA = PAGINA.w - PAGINA.stanga - PAGINA.dreapta
// mărimi în jumătăți de punct: corp 11 pt, titlu 20 pt, subtitlu 13 pt, subcapitol 11,5 pt, mic 10 pt, mărunt 9 pt, celule 10 pt
export const MARIMI = { corp: 22, titlu: 40, subtitlu: 26, subcapitol: 23, mic: 20, marunt: 18, celula: 20 }
const DATA_FIXA = new Date('2026-01-01T00:00:00Z')

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
function asigura(cond, mesaj) { if (!cond) throw new Error(`anunt_afisare: ${mesaj}`) }

/**
 * Citește textul-sursă → blocuri: { tip: 'p', text, flags: Set } | { tip: 'tabel', latimi: [%], faraBorduri, randuri: [[celule]] } | { tip: 'qr' }.
 * Întoarce și lista ordonată a placeholder-elor din corp și numărul declarat la final („Placeholder-e (N): …”).
 */
export function parseazaText(md) {
  const sectiuni = md.split(/^---[ \t]*\r?$/m)
  asigura(sectiuni.length === 3, `aștept 3 secțiuni despărțite de „---”, am ${sectiuni.length}`)
  const declaratie = /^\s*Placeholder-e \((\d+)\):\s*([^\n]*)/.exec(sectiuni[2])
  asigura(declaratie, 'lipsește rândul „Placeholder-e (N): …” din secțiunea a treia')
  const declarate = declaratie[2].replace(/\.\s*$/, '').split(',').map(s => s.trim()).filter(Boolean)
  asigura(declarate.length === Number(declaratie[1]), `declarate ${declarate.length} placeholder-e, anunțate ${declaratie[1]}`)
  const blocuri = []
  let latimi = null, faraBorduri = false, tabel = null
  const inchideTabel = () => { if (tabel) { blocuri.push(tabel); tabel = null } }
  for (const brut of sectiuni[1].split(/\r?\n/)) {
    const linie = brut.trim()
    if (!linie) { inchideTabel(); continue }
    if (linie.startsWith('|')) {
      asigura(linie.endsWith('|'), `rând de tabel neînchis: ${linie.slice(0, 40)}`)
      const celule = linie.slice(1, -1).split('|').map(c => c.trim())
      if (!tabel) {
        asigura(latimi, `tabelul „${celule[0]}” nu are „!latimi” înainte`)
        asigura(latimi.length === celule.length, `tabelul „${celule[0]}”: ${celule.length} coloane, ${latimi.length} lățimi`)
        tabel = { tip: 'tabel', latimi, faraBorduri, randuri: [] }
        latimi = null; faraBorduri = false
      }
      asigura(celule.length === tabel.latimi.length, `rând cu ${celule.length} celule într-un tabel cu ${tabel.latimi.length} coloane`)
      tabel.randuri.push(celule)
      continue
    }
    inchideTabel()
    const m = /^!(\w+)(?:\s+(.*))?$/.exec(linie)
    if (m && m[1] === 'latimi') {
      latimi = m[2].split(',').map(Number)
      asigura(latimi.every(x => Number.isFinite(x) && x > 0) && Math.abs(latimi.reduce((a, b) => a + b, 0) - 100) < 0.01, `„!latimi ${m[2]}”: procente pozitive cu suma 100`)
      continue
    }
    if (m && m[1] === 'faraborduri') { faraBorduri = true; continue }
    if (m && m[1] === 'qr') { blocuri.push({ tip: 'qr' }); continue }
    const titlu = /^(#{1,3}) (.+)$/.exec(linie)
    if (titlu) { blocuri.push({ tip: 'p', text: titlu[2], flags: new Set([['titlu', 'subtitlu', 'subcapitol'][titlu[1].length - 1]]) }); continue }
    if (m) {
      asigura(/^[ibmsc]+$/.test(m[1]) && m[2], `marcaj necunoscut: ${linie.slice(0, 30)}`)
      blocuri.push({ tip: 'p', text: m[2].trim(), flags: new Set(m[1].split('')) })
      continue
    }
    blocuri.push({ tip: 'p', text: linie, flags: new Set() })
  }
  inchideTabel()
  asigura(!latimi && !faraBorduri, 'marcaj „!latimi” / „!faraborduri” fără tabel după el')
  const texte = blocuri.flatMap(b => (b.tip === 'p' ? [b.text] : b.tip === 'qr' ? ['{{qr}}'] : b.randuri.flat()))
  const gasite = [...new Set(texte.join('\n').match(/\{\{[A-Za-z0-9_.]+\}\}/g).map(p => p.slice(2, -2)))]
  asigura(gasite.length === declarate.length && gasite.every(p => declarate.includes(p)), `placeholder-ele din corp (${gasite.join(', ')}) nu coincid cu cele declarate`)
  return { blocuri, texte, chei: declarate }
}

// ─── WordprocessingML ───
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const run = (text, { b = false, i = false, sz = MARIMI.corp } = {}) =>
  `<w:r><w:rPr>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`
const paragraf = (continut, { jc = null, inainte = 0, dupa = 100, keepNext = false, extra = '' } = {}) =>
  `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}${extra}<w:spacing w:before="${inainte}" w:after="${dupa}" w:line="252" w:lineRule="auto"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${continut}</w:p>`

function paragrafDin(bloc) {
  const f = bloc.flags
  if (f.has('titlu')) return paragraf(run(bloc.text, { b: true, sz: MARIMI.titlu }), { jc: 'center', inainte: 120, dupa: 40, keepNext: true })
  if (f.has('subtitlu')) return paragraf(run(bloc.text, { b: true, sz: MARIMI.subtitlu }), { jc: 'center', dupa: 40, keepNext: true })
  if (f.has('subcapitol')) return paragraf(run(bloc.text, { b: true, sz: MARIMI.subcapitol }), { inainte: 160, dupa: 60, keepNext: true })
  const sz = f.has('m') ? MARIMI.marunt : f.has('s') ? MARIMI.mic : MARIMI.corp
  return paragraf(run(bloc.text, { b: f.has('b'), i: f.has('i'), sz }), { jc: f.has('c') ? 'center' : null, dupa: f.has('s') ? 40 : 100 })
}

// cadrul QR-ului: 3,2 cm, aliniat la dreapta, textul următor curge în jurul lui (ca la convocator); docx.js păstrează pPr-ul
// (inclusiv framePr) când pune imaginea în locul paragrafului {{qr}}
const CADRU_QR = '<w:framePr w:w="1814" w:hSpace="142" w:vSpace="57" w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/>'
const paragrafQr = () => paragraf(run('{{qr}}', { sz: MARIMI.marunt }), { dupa: 0, extra: CADRU_QR })

const BORDURA = 'w:val="single" w:sz="4" w:space="0" w:color="808080"'
function tabelDin(bloc) {
  const latimi = bloc.latimi.map(p => Math.round(LATIME_UTILA * p / 100))
  latimi[latimi.length - 1] += LATIME_UTILA - latimi.reduce((a, b) => a + b, 0)   // suma exactă = lățimea utilă
  const borduri = bloc.faraBorduri ? '' : `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(l => `<w:${l} ${BORDURA}/>`).join('')}</w:tblBorders>`
  const celula = (text, i, antet) => `<w:tc><w:tcPr><w:tcW w:w="${latimi[i]}" w:type="dxa"/>${antet ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>` +
    paragraf(run(text, { b: antet, sz: MARIMI.celula }), { dupa: 0 }) + '</w:tc>'
  const rand = (celule, antet) => `<w:tr><w:trPr><w:cantSplit/>${antet ? '<w:tblHeader/>' : ''}</w:trPr>${celule.map((c, i) => celula(c, i, antet)).join('')}</w:tr>`
  const randuri = bloc.randuri.map((celule, k) => rand(celule, k === 0 && !bloc.faraBorduri))
  return `<w:tbl><w:tblPr><w:tblW w:w="${LATIME_UTILA}" w:type="dxa"/>${borduri}<w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${latimi.map(l => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>${randuri.join('')}</w:tbl>` +
    // Word cere un paragraf după tabel; spațiul de după ține loc de rând gol
    paragraf('', { dupa: 60 })
}

export async function construiesteSablon(md = readFileSync(SURSA, 'utf8')) {
  const { blocuri, chei } = parseazaText(md)
  const corp = blocuri.map(b => (b.tip === 'p' ? paragrafDin(b) : b.tip === 'qr' ? paragrafQr() : tabelDin(b))).join('')
  const zip = new JSZip()
  const pune = (cale, continut) => zip.file(cale, DECL + continut, { date: DATA_FIXA, createFolders: false })
  pune('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
  pune('_rels/.rels', `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`)
  pune('word/_rels/document.xml.rels', `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/styles" Target="styles.xml"/></Relationships>`)
  pune('word/styles.xml', `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="${MARIMI.corp}"/><w:szCs w:val="${MARIMI.corp}"/><w:lang w:val="ro-RO"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="${MARIMI.corp}"/><w:szCs w:val="${MARIMI.corp}"/></w:rPr></w:style></w:styles>`)
  pune('word/document.xml', `<w:document xmlns:w="${W}"><w:body>${corp}<w:sectPr><w:pgSz w:w="${PAGINA.w}" w:h="${PAGINA.h}"/><w:pgMar w:top="${PAGINA.sus}" w:right="${PAGINA.dreapta}" w:bottom="${PAGINA.jos}" w:left="${PAGINA.stanga}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`)
  await adaugaAntet(zip, { date: DATA_FIXA })
  return { buf: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), chei, blocuri }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`))) {
  const { buf, chei, blocuri } = await construiesteSablon()
  if (process.argv.includes('--verifica')) {
    let acum = null
    try { acum = readFileSync(DESTINATIE) } catch (e) { if (e.code !== 'ENOENT') throw e }
    const egal = acum !== null && Buffer.compare(acum, buf) === 0
    console.log(`${egal ? 'identic' : 'DIFERĂ'}  anunt_afisare.docx`)
    if (!egal) process.exitCode = 1
  } else {
    writeFileSync(DESTINATIE, buf)
    console.log(`${fileURLToPath(DESTINATIE)}: ${chei.length} placeholder-e distincte; ${blocuri.length} blocuri`)
  }
}
