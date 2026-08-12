#!/usr/bin/env node
// ============================================================================
// gen_docx.mjs — Import Documente, etapa 7: intermediar.md → .docx
// Spec §8 (gotchas docx-js, toate respectate aici):
//   - columnWidths pe tabel SI width per celula, ambele DXA, suma = latimea
//     (PERCENTAGE se strica in Google Docs)
//   - ShadingType.CLEAR, nu SOLID
//   - fara \n in text — un Paragraph per paragraf
//   - buline prin numbering + LevelFormat.BULLET
//   - ImageRun cere type:'png'
//   - TOC doar cu HeadingLevel built-in; hyperlink:true; updateFields la open
// Trasabilitate (criteriul §12.9): bookmark invizibil `pag_sursa_N` la
// inceputul continutului fiecarei pagini sursa (Word: Insert → Bookmark).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType, Bookmark, Document, HeadingLevel, ImageRun, LevelFormat,
  Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableOfContents,
  TableRow, TextRun, WidthType,
} from 'docx';

const OUT = process.argv[2] || 'test-fixtures/import-documente/out';
const DOCX_NAME = process.argv[3] || 'Caiet_de_sarcini.docx';
const LATIME_DXA = 9026;          // A4 utila la margini 2.5cm
const IMG_MAX_PX = 580;

const md = fs.readFileSync(path.join(OUT, 'intermediar.md'), 'utf-8');
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'extract_meta.json'), 'utf-8'));

function pngSize(buf) {
  // IHDR: latime @16, inaltime @20 (big-endian)
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2,
                  3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };

// ---- parcurgere markdown → children docx -----------------------------------
const children = [];
const stats = { paragrafe: 0, titluri: 0, tabele: 0, buline: 0, imagini: 0, bookmarkuri: 0 };
const lines = md.split('\n');
let i = 0;
let tocInserat = false;
let primaPaginaVazuta = false;

function celule(row) {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
    .split(' | ').map(c => c.trim().replace(/\\\|/g, '|'));
}

while (i < lines.length) {
  const ln = lines[i];

  // marker de pagina sursa → bookmark invizibil (trasabilitate §12.9)
  const mPag = ln.match(/^<!-- pagina (\d+) -->$/);
  if (mPag) {
    const nr = Number(mPag[1]);
    if (primaPaginaVazuta && nr > 1 && !tocInserat) {
      // dupa continutul primei pagini (coperta): CUPRINSUL generat
      children.push(
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 240 },
          children: [new TextRun({ text: 'CUPRINS', bold: true, size: 28 })],
        }),
        new TableOfContents('Cuprins', { hyperlink: true, headingStyleRange: '1-3' }),
      );
      tocInserat = true;
    }
    primaPaginaVazuta = true;
    children.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new Bookmark({ id: `pag_sursa_${nr}`, children: [new TextRun('')] })],
    }));
    stats.bookmarkuri += 1;
    i += 1;
    continue;
  }

  if (!ln.trim()) { i += 1; continue; }

  // titluri #..####
  const mH = ln.match(/^(#{1,4}) (.*)$/);
  if (mH) {
    const lvl = mH[1].length;
    children.push(new Paragraph({
      heading: HEADING[lvl],
      pageBreakBefore: lvl === 1,        // capitolele incep pe pagina noua
      children: [new TextRun({ text: mH[2] })],
    }));
    stats.titluri += 1;
    i += 1;
    continue;
  }

  // imagine
  const mImg = ln.match(/^!\[\]\((media\/[^)]+)\)$/);
  if (mImg) {
    const buf = fs.readFileSync(path.join(OUT, mImg[1]));
    const { w, h } = pngSize(buf);
    const sw = Math.min(w, IMG_MAX_PX);
    const sh = Math.max(1, Math.round(h * sw / w));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ type: 'png', data: buf,
                                transformation: { width: sw, height: sh } })],
    }));
    stats.imagini += 1;
    i += 1;
    continue;
  }

  // tabel markdown
  if (ln.startsWith('|') && i + 1 < lines.length && /^\|(\s*-{3,}\s*\|)+\s*$/.test(lines[i + 1])) {
    const randuri = [celule(ln)];
    let j = i + 2;
    while (j < lines.length && lines[j].startsWith('|')) {
      randuri.push(celule(lines[j]));
      j += 1;
    }
    const ncol = Math.max(...randuri.map(r => r.length));
    const colw = Math.floor(LATIME_DXA / ncol);
    const widths = Array(ncol).fill(colw);
    widths[ncol - 1] = LATIME_DXA - colw * (ncol - 1);   // suma exact = latimea
    children.push(new Table({
      width: { size: LATIME_DXA, type: WidthType.DXA },
      columnWidths: widths,
      rows: randuri.map((r, ri) => new TableRow({
        children: widths.map((wdx, ci) => new TableCell({
          width: { size: wdx, type: WidthType.DXA },
          shading: ri === 0
            ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EDEDED' }
            : undefined,
          children: [new Paragraph({
            children: [new TextRun({ text: r[ci] ?? '', bold: ri === 0 })],
          })],
        })),
      })),
    }));
    children.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }));
    stats.tabele += 1;
    i = j;
    continue;
  }

  // bulina
  if (ln.startsWith('• ') || ln.startsWith('- ')) {
    children.push(new Paragraph({
      numbering: { reference: 'buline', level: 0 },
      children: [new TextRun({ text: ln.replace(/^(• |- )/, '') })],
    }));
    stats.buline += 1;
    i += 1;
    continue;
  }

  // paragraf simplu (un rand = un bloc; fara \n in interior)
  children.push(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    children: [new TextRun({ text: ln })],
  }));
  stats.paragrafe += 1;
  i += 1;
}

// ---- document ---------------------------------------------------------------
const doc = new Document({
  creator: 'PontajPRO — Import Documente',
  title: meta.fisier.replace(/\.pdf$/i, ''),
  description: `Generat automat din ${meta.fisier} (${meta.pagini_pdf} pagini sursa)`,
  features: { updateFields: true },       // Word actualizeaza TOC la deschidere
  numbering: {
    config: [{
      reference: 'buline',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: 'Trebuchet MS', size: 22 } },   // 11pt, fontul sursei
      heading1: { run: { font: 'Trebuchet MS', size: 28, bold: true, color: '000000' },
                  paragraph: { spacing: { before: 240, after: 120 } } },
      heading2: { run: { font: 'Trebuchet MS', size: 24, bold: true, color: '000000' },
                  paragraph: { spacing: { before: 200, after: 100 } } },
      heading3: { run: { font: 'Trebuchet MS', size: 22, bold: true, color: '000000' },
                  paragraph: { spacing: { before: 160, after: 80 } } },
      heading4: { run: { font: 'Trebuchet MS', size: 22, bold: true, italics: true,
                         color: '000000' },
                  paragraph: { spacing: { before: 120, after: 60 } } },
    },
  },
  sections: [{
    properties: {
      page: { margin: { top: 1417, bottom: 1417, left: 1417, right: 1417 } }, // 2.5cm
    },
    children,
  }],
});

const buf = await Packer.toBuffer(doc);
const cale = path.join(OUT, DOCX_NAME);
fs.writeFileSync(cale, buf);
console.log(JSON.stringify({ fisier: cale, octeti: buf.length, ...stats }, null, 1));
