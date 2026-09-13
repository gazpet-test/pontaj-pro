// ════════════════════════════════════════════════════════════════
// OfertareExport.js — propunerea tehnică iese ca DOCX, plus borderoul pieselor îndosariate.
//
// DE CE DOCX ȘI NU PDF:
// 1. Tiparul de PDF al casei e html2canvas → jsPDF, adică documentul devine o IMAGINE. Merge
//    pentru o declarație de o pagină; pe Secțiunea A de la Contești (586 pagini) taie cuvinte
//    la mijloc, rupe rândurile arbitrar și dă un fișier de sute de MB. Singurul exemplu
//    multi-pagină din repo (rapoarteExport.js) feliază un canvas lung — acelasi lucru.
// 2. Autoritățile cer editabil: la Contești graficul s-a depus și PDF și Excel, iar la
//    clarificări s-a cerut MS Project într-o zi.
// 3. Word face singur cuprinsul, numerotarea paginilor și antetul — exact ce cere opisul
//    („fiecare capitol având cuprins", coloana „Nr. pag.").
// 4. `docx` e DEJA în package.json (9.7.1), nefolosit de nimeni. Nu e librărie nouă.
//
// CE NU FACE: nu asamblează anexele scanate și nu completează coloana „Nr. pag." cu numere
// reale. Paginile reale se știu abia după asamblare (doc.getPageCount()), iar asamblarea de
// PDF-uri se face SERVER-SIDE — pdf-lib e interzis în frontend (Rollup rezolvă dynamic imports
// la build și cade pe Vercel; vezi HR.jsx). Deci coloana rămâne de completat la îndosariere,
// și scrie asta în document, nu o inventează.
// ════════════════════════════════════════════════════════════════
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType,
  Table, TableRow, TableCell, TableOfContents, WidthType,
} from 'docx'

const FONT = 'Times New Roman'   // documentele oficiale ale casei sunt Times (vezi DeclaratieTehnicaSection)

const txt = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size ?? 24, bold: o.bold, italics: o.italics, color: o.color })
const p = (text, o = {}) => new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 120 }, heading: o.heading, children: [txt(text, o)] })
const celula = (text, o = {}) => new TableCell({
  width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
  children: [new Paragraph({ alignment: o.align, children: [txt(text, { bold: o.bold, size: 22 })] })],
})

// Eticheta reală din opis („Cap. I", „Anexa 7"), nu `nr` — `nr` e doar ordinea, iar „Cap. I" se
// repetă între secțiuni.
export const etichetaCapitol = c => String(c.eticheta || `${c.nr}.`).trim()
const titluCapitol = c => `${etichetaCapitol(c)} ${c.titlu}`.trim()

// Textul unui capitol, paragraf cu paragraf. Rândurile goale devin spațiu, nu paragrafe goale
// care s-ar aduna în pagini albe.
const paragrafeText = continut =>
  String(continut || '').split('\n').map(r => r.trim()).filter(Boolean).map(r => p(r, { align: AlignmentType.JUSTIFIED }))

/**
 * Propunerea tehnică: pagină de titlu, cuprins automat (Word îl populează la F9 / la deschidere),
 * apoi capitolele, fiecare pe pagină nouă, grupate pe secțiuni.
 */
export function construiestePropunere({ licitatie, capitole, firma = 'GAZPET INSTAL S.R.L.' }) {
  const copii = [
    p(firma, { bold: true, align: AlignmentType.CENTER, size: 28 }),
    p('PROPUNERE TEHNICĂ', { bold: true, align: AlignmentType.CENTER, size: 36, after: 240 }),
    p(licitatie?.obiect || '', { align: AlignmentType.CENTER, italics: true, after: 120 }),
    p(licitatie?.nr_anunt ? `Anunț de participare ${licitatie.nr_anunt}` : '', { align: AlignmentType.CENTER, after: 480 }),
    new Paragraph({ children: [new PageBreak()] }),
    p('CUPRINS', { bold: true, heading: HeadingLevel.HEADING_1, after: 240 }),
    new TableOfContents('Cuprins', { hyperlink: true, headingStyleRange: '1-2' }),
    new Paragraph({ children: [new PageBreak()] }),
  ]

  let sectiuneAnterioara = null
  capitole.forEach((c, i) => {
    if (i > 0) copii.push(new Paragraph({ children: [new PageBreak()] }))
    const sect = String(c.sectiune || '').trim()
    if (sect && sect !== sectiuneAnterioara) {
      copii.push(p(sect.toUpperCase(), { bold: true, heading: HeadingLevel.HEADING_1, align: AlignmentType.CENTER, after: 240 }))
      sectiuneAnterioara = sect
    }
    copii.push(p(titluCapitol(c), { bold: true, heading: HeadingLevel.HEADING_2, after: 200 }))
    const corp = paragrafeText(c.continut)
    if (corp.length) copii.push(...corp)
    else copii.push(p(
      c.fisier_path
        ? `[capitolul se depune ca fișier separat: ${c.fisier_path}]`
        : '[CAPITOL NECOMPLETAT — nu depune documentul în starea asta]',
      { italics: true, color: 'C00000' }))
  })

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{ children: copii }],
  })
}

/**
 * Borderoul pieselor îndosariate — titlul folosit de ei pe toate familiile de licitații.
 * Trei coloane: Nr. crt. | Denumire document | Nr. pag., ca în opisurile reale depuse.
 */
export function construiesteBorderou({ licitatie, capitole, firma = 'GAZPET INSTAL S.R.L.' }) {
  const randuri = [new TableRow({ children: [
    celula('Nr. crt.', { bold: true, width: 10, align: AlignmentType.CENTER }),
    celula('Denumire document', { bold: true, width: 75 }),
    celula('Nr. pag.', { bold: true, width: 15, align: AlignmentType.CENTER }),
  ] })]
  let sectiuneAnterioara = null
  let n = 0
  for (const c of capitole) {
    const sect = String(c.sectiune || '').trim()
    if (sect && sect !== sectiuneAnterioara) {
      randuri.push(new TableRow({ children: [celula(''), celula(sect.toUpperCase(), { bold: true }), celula('')] }))
      sectiuneAnterioara = sect
    }
    n++
    randuri.push(new TableRow({ children: [
      celula(String(n), { align: AlignmentType.CENTER }),
      celula(titluCapitol(c)),
      celula('', { align: AlignmentType.CENTER }),   // se completează la îndosariere — vezi antetul fișierului
    ] }))
  }

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{ children: [
      p(firma, { bold: true, align: AlignmentType.CENTER, size: 26 }),
      p('BORDEROUL PIESELOR ÎNDOSARIATE', { bold: true, align: AlignmentType.CENTER, size: 30, after: 120 }),
      p('Propunere tehnică', { align: AlignmentType.CENTER, italics: true, after: 120 }),
      p(licitatie?.obiect || '', { align: AlignmentType.CENTER, after: 240 }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: randuri }),
      p('', { after: 240 }),
      p('Coloana „Nr. pag." se completează la îndosariere: numerele reale se știu abia după ce se asamblează fizic anexele.',
        { italics: true, size: 20 }),
      p('', { after: 360 }),
      p('Administrator,', { align: AlignmentType.RIGHT }),
    ] }],
  })
}

// Numele fișierului: fără diacritice și fără caractere care sparg Windows Explorer.
export const numeFisier = (prefix, licitatie) => {
  const baza = String(licitatie?.nr_anunt || licitatie?.obiect || 'licitatie')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, 60)
  return `${prefix}_${baza}.docx`
}

/** Blob-ul DOCX, pentru hash + upload (manifest). Aceiași bytes ca la descărcare. */
export const blobDocx = doc => Packer.toBlob(doc)

export async function descarcaDocx(doc, nume) {
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nume
  document.body.appendChild(a); a.click(); a.remove()
  // Revocarea imediată rupe descărcarea în unele browsere; se lasă o tură de event loop.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
