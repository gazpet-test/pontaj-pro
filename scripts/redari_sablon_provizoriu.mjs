// Redări teren — generează ȘABLONUL PROVIZORIU al convocatorului (contract docs/redari/CONTRACT_SCHEMA.md §8).
// Ieșire: public/redari/sabloane/convocator_provizoriu.docx (binar mic, comis în repo).
// Rulare: node scripts/redari_sablon_provizoriu.mjs
//
// PROVIZORIU: Model_1 (convocatorul real din pachetul Lot1 al lui Răzvan) îl va ÎNLOCUI — se schimbă doar fișierul .docx,
// cu aceleași placeholder-e {{camp}}; codul din src/redari/docx.js nu se atinge. Fiecare placeholder stă într-un singur
// TextRun ca să rămână într-un singur <w:t> (înlocuire locală, fără consolidare de run-uri). Fără date reale de persoane.
//
// Placeholder-e (toate cele din contract §8): {{nume}} {{id_parcela}} {{uat}} {{sat}} {{tarla}} {{nr_cadastral}} {{suprafata}}
// {{zi1}} {{program1}} {{zi2}} {{program2}} {{zi3}} {{program3}} {{link}} {{qr}} {{nr_document}} {{data}}
// {{contact_nume}} {{contact_telefon}} {{contact_email}} {{reprezentant_tgz}} {{text_gdpr}}

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AlignmentType, BorderStyle, Document, Footer, Header, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'

const RADACINA = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IESIRE = resolve(RADACINA, 'public/redari/sabloane/convocator_provizoriu.docx')

const FONT = 'Arial'
const run = (text, opt = {}) => new TextRun({ text, font: FONT, size: 22, ...opt })
const p = (children, opt = {}) => new Paragraph({ spacing: { after: 120 }, ...opt, children: Array.isArray(children) ? children : [run(children)] })
const gol = () => new Paragraph({ children: [] })
const celula = (text, opt = {}) => new TableCell({
  width: { size: 33, type: WidthType.PERCENTAGE },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [p([run(text, opt)], { spacing: { after: 0 } })],
})
const bordura = { style: BorderStyle.SINGLE, size: 4, color: '000000' }

const doc = new Document({
  creator: 'Gazpet ERP — Redări teren',
  title: 'Convocare la constatarea readucerii terenului la starea inițială (șablon provizoriu)',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1418, right: 1134 } } },
    headers: {
      default: new Header({
        children: [
          p([run('GAZPET INSTAL SRL', { bold: true, size: 24 })], { alignment: AlignmentType.LEFT, spacing: { after: 0 } }),
          p([run('Executant lucrări — Lot 1 Transgaz · Nr. înregistrare: '), run('{{nr_document}}', { bold: true }), run(' din '), run('{{data}}')],
            { spacing: { after: 0 } }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [p([run('Contact: '), run('{{contact_nume}}'), run(' · tel. '), run('{{contact_telefon}}'), run(' · '), run('{{contact_email}}')],
          { alignment: AlignmentType.CENTER, spacing: { after: 0 } })],
      }),
    },
    children: [
      gol(),
      p([run('CONVOCARE', { bold: true, size: 30 })], { alignment: AlignmentType.CENTER, spacing: { after: 60 } }),
      p([run('la constatarea readucerii terenului la starea inițială', { bold: true, size: 24 })], { alignment: AlignmentType.CENTER, spacing: { after: 240 } }),

      p([run('Către: '), run('{{nume}}', { bold: true })]),
      p([run('Referitor la parcela '), run('{{id_parcela}}', { bold: true }), run(', UAT '), run('{{uat}}'), run(', sat '), run('{{sat}}'),
        run(', tarla '), run('{{tarla}}'), run(', nr. cadastral '), run('{{nr_cadastral}}'), run(', suprafață afectată temporar '),
        run('{{suprafata}}'), run(' mp.')]),

      p('Stimată doamnă / Stimate domn,'),
      p('Vă aducem la cunoștință că lucrările de execuție a conductei de transport gaze naturale pe terenul dumneavoastră, ' +
        'afectat temporar, au fost finalizate, iar terenul a fost readus la starea inițială. Vă invităm să participați la ' +
        'constatarea readucerii terenului la starea inițială, în cadrul sesiunii organizate la sediul primăriei UAT, în oricare dintre zilele:'),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: bordura, bottom: bordura, left: bordura, right: bordura, insideHorizontal: bordura, insideVertical: bordura },
        rows: [
          new TableRow({ tableHeader: true, children: [celula('Ziua', { bold: true }), celula('Data', { bold: true }), celula('Program / sate', { bold: true })] }),
          new TableRow({ children: [celula('Ziua 1'), celula('{{zi1}}'), celula('{{program1}}')] }),
          new TableRow({ children: [celula('Ziua 2'), celula('{{zi2}}'), celula('{{program2}}')] }),
          new TableRow({ children: [celula('Ziua 3'), celula('{{zi3}}'), celula('{{program3}}')] }),
        ],
      }),
      gol(),

      p([run('Dacă nu puteți participa, vă rugăm să ne transmiteți opțiunea dumneavoastră (particip / nu particip, fără obiecții / ' +
        'nu particip, cu obiecții / solicit constatare pe teren) prin formularul online de la adresa:')]),
      p([run('{{link}}', { underline: {}, color: '1F4E79' })], { alignment: AlignmentType.CENTER }),
      p('sau scanând codul QR de mai jos:', { alignment: AlignmentType.CENTER }),
      p([run('{{qr}}')], { alignment: AlignmentType.CENTER }),
      p([run('Răspunsul se poate transmite și telefonic sau prin e-mail la datele de contact de mai jos, menționând numărul '),
        run('{{nr_document}}'), run(' și parcela '), run('{{id_parcela}}'), run('.')]),
      p([run('Persoană de contact: '), run('{{contact_nume}}', { bold: true }), run(', telefon '), run('{{contact_telefon}}'),
        run(', e-mail '), run('{{contact_email}}'), run('.')]),

      p([run('Informare privind prelucrarea datelor cu caracter personal', { bold: true, size: 20 })], { spacing: { before: 240, after: 60 } }),
      p([run('{{text_gdpr}}', { size: 18 })]),

      gol(),
      p([run('Reprezentant Transgaz: '), run('{{reprezentant_tgz}}')], { spacing: { before: 240 } }),
      p([run('Pentru GAZPET INSTAL SRL,')], { spacing: { before: 240 } }),
      p('Semnătura și ștampila: ______________________'),
      p([run('Data: '), run('{{data}}')]),
      gol(),
      p([run('Șablon provizoriu — va fi înlocuit cu Model_1 din pachetul Lot 1.', { italics: true, size: 16, color: '808080' })]),
    ],
  }],
})

const buf = await Packer.toBuffer(doc)
mkdirSync(dirname(IESIRE), { recursive: true })
writeFileSync(IESIRE, buf)
console.log(`Scris ${IESIRE} (${buf.length} octeți)`)
