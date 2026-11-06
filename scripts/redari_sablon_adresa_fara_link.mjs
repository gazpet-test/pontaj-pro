// Transformare unică D1: păstrează toate intrările și tot XML-ul în afara textului eliminat.
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'

const cale = new URL('../public/redari/sabloane/adresa_uat.docx', import.meta.url)
const zip = await JSZip.loadAsync(readFileSync(cale), { createFolders: false })
const xml = await zip.file('word/document.xml').async('string')
const tinta = ' sau online la {{link_afisare}}'
if (xml.split(tinta).length !== 2) throw new Error('Necesită exact o apariție a textului original; transformarea nu se aplică de două ori')
zip.file('word/document.xml', xml.replace(tinta, ''), { date: new Date('2026-01-01T00:00:00Z'), createFolders: false })
writeFileSync(cale, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log('adresa_uat.docx: link_afisare eliminat; restul XML-ului păstrat')
