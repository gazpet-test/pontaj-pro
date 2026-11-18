// Redări — MODELUL anunțului de afișare la primărie, pentru pachetul către Transgaz (anexă la planul procedurii de predare rev. 1):
// același generator ca în ERP (genereazaAnuntAfisare), pe date de MODEL (câmpuri „____”, exemple evidente, nimic real).
// Rulare: node scripts/redari_model_anunt_afisare.mjs <dosar_iesire> [--exemplu]
//   scrie <dosar>/13b_Model_Anunt_afisare_primarie_rev1.docx + .txt (textul, pentru verificare);
//   cu --exemplu scrie și Exemplu_TEST_anunt_afisare_150_parcele.docx (date sintetice, doar pentru verificarea paginării).
// Nu scrie în repo; dosarul de ieșire îl dă apelantul (ex. un folder din paw-data). Conversia în PDF se face în afara repo-ului.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { genereazaAnuntAfisare, CHEI_ANUNT_AFISARE } from '../src/redari/docx.js'

const RADACINA = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SABLON = resolve(RADACINA, 'public/redari/sabloane/anunt_afisare.docx')
const { readFileSync } = await import('node:fs')

const L = n => '_'.repeat(n)
// data de model: fără cifre, ca formatDataRo să o lase neschimbată (un șir cu „2026” în el ar fi citit de JS ca dată)
export const DATA_MODEL = '__.__.____'
// Datele de model: contractul și proiectul sunt cele din planul transmis Transgaz (publice în plan); restul = „____”
export const PROIECT_MODEL = {
  cod: 'LOT1-PRUNISOR-JUPA', denumire: 'Conductă de transport gaze naturale Prunișor–Orșova–Băile Herculane–Jupa, LOT 1',
  contract_nr: '30', contract_data: '2025-01-22', imputernicire_nr: L(5), imputernicire_data: DATA_MODEL,
  contact_nume: 'Ramona Brehui', contact_telefon: L(14), contact_email: 'redari@gazpet.ro',
  reprezentant_tgz_nume: L(23), reprezentant_tgz_functie: '', reprezentant_tgz_telefon: L(14),
  reprezentant_gazpet_nume: L(23), reprezentant_gazpet_functie: '', informare_publicata: true,
}
export const UAT_MODEL = {
  nume: L(16), judet: 'Mehedinți', uat3: 'MOD',
  sesiune_zi1: DATA_MODEL, program_zi1: '09:00 – 16:00', sate_zi1: L(20),
  sesiune_zi2: DATA_MODEL, program_zi2: '09:00 – 19:00 (program prelungit)', sate_zi2: L(20),
  sesiune_zi3: DATA_MODEL, program_zi3: '09:00 – 16:00', sate_zi3: L(20),
}
export const PARCELE_MODEL = Array.from({ length: 6 }, (_, i) => ({ id_parcela: `T0-MOD-${String(i + 1).padStart(4, '0')}`, sat: L(12), tarla: 'T___', nr_cadastral: L(8), poz_hg: L(5), tronson: '__', sters_la: null }))
// exemplu sintetic (DOAR pentru paginare): sate „Satul Exemplu A/B”, tarlale T1..T12, numere cadastrale fictive
export const parceleExemplu = n => Array.from({ length: n }, (_, i) => ({ id_parcela: `T0-EXE-${String(i + 1).padStart(4, '0')}`, sat: `Satul Exemplu ${'ABC'[i % 3]}`, tarla: `T${(i % 12) + 1}`, nr_cadastral: String(1000 + ((i * 37) % 500)), poz_hg: String(((i * 11) % 300) + 1), tronson: (i % 3) + 1, sters_la: null }))

const dez = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
/** Textul documentului generat: paragrafele, iar rândurile de tabel cu celulele unite prin „ | ”. */
export async function textDocx(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const xml = await zip.file('word/document.xml').async('string')
  const texte = []
  // corpul: pe rând, tabele (rânduri → celule) sau paragrafe de nivel înalt
  const corp = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)[1]
  const blocuri = corp.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g) || []
  const textP = p => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => dez(m[1])).join('') + (/<w:drawing>/.test(p) ? '[cod QR: pagina publică a informării]' : '')
  for (const b of blocuri) {
    if (b.startsWith('<w:tbl>')) {
      for (const tr of b.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) texte.push([...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(tc => textP(tc[0]).trim()).join(' | '))
      texte.push('')
    } else { const t = textP(b).trim(); if (t) texte.push(t) }
  }
  return texte.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`))) {
  const dosar = process.argv[2]
  if (!dosar || dosar.startsWith('--')) { console.error('Folosire: node scripts/redari_model_anunt_afisare.mjs <dosar_iesire> [--exemplu]'); process.exit(2) }
  mkdirSync(dosar, { recursive: true })
  const templateArrayBuffer = readFileSync(SABLON)
  const model = await genereazaAnuntAfisare({ proiect: PROIECT_MODEL, uat: UAT_MODEL, parcele: PARCELE_MODEL, templateArrayBuffer, dataDocument: DATA_MODEL })
  if (/\d\d\.\d\d\.20\d\d/.test([model.campuri.imputernicire_data, model.campuri.zi1, model.campuri.data].join())) throw new Error('model: o dată de model a fost citită ca dată reală')
  const baza = resolve(dosar, '13b_Model_Anunt_afisare_primarie_rev1')
  writeFileSync(`${baza}.docx`, Buffer.from(await model.blob.arrayBuffer()))
  writeFileSync(`${baza}.txt`, '﻿' + await textDocx(model.blob) + '\n', 'utf8')
  console.log(`${baza}.docx  sha256=${model.hash}  parcele=${model.randuri}  chei=${CHEI_ANUNT_AFISARE.length}`)
  if (process.argv.includes('--exemplu')) {
    const ex = await genereazaAnuntAfisare({ proiect: PROIECT_MODEL, uat: { ...UAT_MODEL, nume: 'Comuna Exemplu' }, parcele: parceleExemplu(150), templateArrayBuffer, dataDocument: '2026-11-18' })
    const cale = resolve(dosar, 'Exemplu_TEST_anunt_afisare_150_parcele.docx')
    writeFileSync(cale, Buffer.from(await ex.blob.arrayBuffer()))
    console.log(`${cale}  sha256=${ex.hash}  parcele=${ex.randuri}`)
  }
}
