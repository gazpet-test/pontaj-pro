// Genereaza exclusiv din textul Juridic; datele proiectului se completeaza ulterior in ERP.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { adaugaAntet } from './redari_antet.mjs'

const sursa = new URL('../docs/redari/TEXT_CERERE_IMPUTERNICIRE.md', import.meta.url)
const destinatie = new URL('../public/redari/sabloane/cerere_imputernicire.docx', import.meta.url)
const text = readFileSync(sursa, 'utf8')
const sectiuni = text.split(/^---[ \t]*\r?$/m)
if (sectiuni.length !== 3 || !/^\s*Placeholder-e \(12\):/u.test(sectiuni[2])) {
  throw new Error('Structura textului Juridic nu este recunoscuta')
}
const paragrafe = sectiuni[1].split(/\r?\n/).map(l => l.trim()).filter(Boolean)
const chei = new Set([...sectiuni[1].matchAll(/\{\{([a-z_]+)\}\}/g)].map(m => m[1]))
if (chei.size !== 12 || !paragrafe[0]?.startsWith('Nr. ')) throw new Error('Text incomplet: se asteapta 12 chei si antetul Nr.')
const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const rel = 'http://schemas.openxmlformats.org/package/2006/relationships'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const declaratie = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const zip = new JSZip()
const pune = (cale, continut) => zip.file(cale, declaratie + continut, { date: new Date('2026-01-01T00:00:00Z'), createFolders: false })
pune('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
pune('_rels/.rels', `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`)
pune('word/_rels/document.xml.rels', `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/styles" Target="styles.xml"/></Relationships>`)
pune('word/styles.xml', `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="ro-RO"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`)
const corp = paragrafe.map(p => `<w:p><w:pPr>${/^[a-d]\)/.test(p) ? '<w:ind w:left="720"/>' : ''}<w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">${xml(p)}</w:t></w:r></w:p>`).join('')
pune('word/document.xml', `<w:document xmlns:w="${w}"><w:body>${corp}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`)
// antetul oficial Gazpet în header-ul primei pagini (decizia Răzvan 05.11.2026, ca la celelalte șabloane Redări)
await adaugaAntet(zip, { date: new Date('2026-01-01T00:00:00Z') })
writeFileSync(destinatie, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`${fileURLToPath(destinatie)}: ${chei.size} placeholder-e distincte; ${paragrafe.length} paragrafe`)
