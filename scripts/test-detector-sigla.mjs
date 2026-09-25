// R3 — test detector siglă (3 PDF-uri sintetice generate cu jspdf; fără pdf-lib, fără AI, fără BD).
// Rulare: node scripts/test-detector-sigla.mjs
import { jsPDF } from 'jspdf'
import sharp from 'sharp'
import { analizeazaSemnale, randeazaVectorial } from '../api/_randare-pdf.js'
import { jpegDinPdf, decideRuta, esteCitibila } from '../api/plansa-felii.js'

// JPEG cu zgomot + linii (peste 10 KB, ca să-l vadă jpegDinPdf)
async function jpeg(w, h, dens = 1) {
  const px = Buffer.alloc(w * h * 3, 255)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3
    if ((x % Math.max(8, Math.round(40 / dens)) < 2) || (y % 37 < 2) || Math.random() < 0.08) px[i] = px[i + 1] = px[i + 2] = Math.floor(Math.random() * 120)
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer()
}
const dataUrl = (b) => 'data:image/jpeg;base64,' + b.toString('base64')
const cuByteRange = (buf) => Buffer.concat([buf.subarray(0, 9), Buffer.from('%/ByteRange [0 100 200 300]\n', 'latin1'), buf.subarray(9)])

async function pdfSiglaPeVectorial() {       // A3 landscape, 600 linii vectoriale + sigla 900x450 în colț
  const d = new jsPDF({ unit: 'pt', format: 'a3', orientation: 'landscape' })
  for (let i = 0; i < 600; i++) d.line(40 + (i * 1.7) % 1000, 40 + (i * 13) % 700, 60 + (i * 7) % 1050, 60 + (i * 11) % 740)
  d.addImage(dataUrl(await jpeg(900, 450)), 'JPEG', 1000, 740, 140, 70)
  d.text('Semnat digital EasySign', 1000, 830)
  return cuByteRange(Buffer.from(d.output('arraybuffer')))
}
async function pdfScanSemnat() {             // scanare 3000x2100 pe toată pagina, semnată
  const d = new jsPDF({ unit: 'pt', format: [1000, 700], orientation: 'landscape' })
  d.addImage(dataUrl(await jpeg(3000, 2100)), 'JPEG', 0, 0, 1000, 700)
  d.text('Digitally signed by EasySign', 20, 690)
  return cuByteRange(Buffer.from(d.output('arraybuffer')))
}
async function pdfDesenMic() {               // A4, singurul conținut = o imagine mică (800x600) mică pe pagină
  const d = new jsPDF({ unit: 'pt', format: 'a4' })
  d.addImage(dataUrl(await jpeg(800, 600, 3)), 'JPEG', 200, 300, 150, 112)
  return Buffer.from(d.output('arraybuffer'))
}

async function ruleaza(nume, buf) {
  const imagini = jpegDinPdf(buf)
  const meta = imagini.length ? await sharp(imagini[0]).metadata() : null
  const a = await analizeazaSemnale(buf, meta ? { width: meta.width, height: meta.height } : null)
  const ruta = decideRuta(meta, a)
  let sursa = 'imagine'
  if (ruta.randeaza) {
    const pagini = await randeazaVectorial(buf, 100)
    const cit = []
    for (const p of pagini) if ((await esteCitibila(p.img)).citibila) cit.push(p)
    sursa = cit.length ? 'randare_pagina' : (!a.sursa_sigla_dovedita && meta && (await esteCitibila(imagini[0])).citibila ? 'imagine (fallback)' : 'necitibil')
  }
  const r = { nume, img: meta && `${meta.width}x${meta.height}`, semnale: a.semnale, paths: a.paths,
    fractie: a.imagine_selectata?.fractie_pagina, bbox_pdf: a.imagine_selectata?.bbox_pdf, dovada: a.dovada,
    ruta: ruta.motiv, sursa, sursa_sigla_dovedita: a.sursa_sigla_dovedita }
  console.log(JSON.stringify(r))
  return r
}
let ok = 0, tot = 0
const verifica = (cond, msg) => { tot++; if (cond) ok++; console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`) }
const r1 = await ruleaza('sigla_pe_vectorial', await pdfSiglaPeVectorial())
verifica(r1.sursa === 'randare_pagina', '1: siglă izolată => randare pagină completă')
verifica(r1.sursa_sigla_dovedita === true, '1: dovadă siglă (imagine <10% + conținut în afara bbox)')
const r2 = await ruleaza('scan_mare_semnat', await pdfScanSemnat())
verifica(r2.sursa === 'imagine', '2: scanare mare semnată => rămâne imaginea')
verifica(r2.sursa_sigla_dovedita === false, '2: fără siglă')
const r3 = await ruleaza('desen_mic_legitim', await pdfDesenMic())
verifica(r3.sursa_sigla_dovedita === false, '3: imagine mică singurul conținut => NU siglă')
verifica(r3.sursa !== 'necitibil', '3: planșa rămâne citibilă (randare sau imagine)')
console.log(`\n${ok}/${tot} verificări trecute`)
process.exit(ok === tot ? 0 : 1)
