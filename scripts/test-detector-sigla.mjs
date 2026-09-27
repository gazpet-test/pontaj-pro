// R3 — test detector siglă (3 PDF-uri sintetice generate cu jspdf; fără pdf-lib, fără AI, fără BD).
// Rulare: node scripts/test-detector-sigla.mjs
import { jsPDF } from 'jspdf'
import sharp from 'sharp'
import { analizeazaSemnale, randeazaVectorial } from '../api/_randare-pdf.js'
import { jpegDinPdf, decideRuta, esteCitibila, acoperireScanPdf, zoneTaiere } from '../api/plansa-felii.js'

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
// siglă EasySign „reală” sintetică: 900x450, fond alb + blocuri de text/logo (conținut simplu)
async function jpegSigla() {
  const w = 900, h = 450, px = Buffer.alloc(w * h * 3, 255)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3
    const logo = (x - 150) ** 2 + (y - 225) ** 2 < 90 ** 2 && (x - 150) ** 2 + (y - 225) ** 2 > 70 ** 2
    const text = x > 300 && x < 860 && ((y > 150 && y < 175) || (y > 215 && y < 240) || (y > 280 && y < 300)) && (x % 23) < 15
    if (logo) { px[i] = 20; px[i + 1] = 60; px[i + 2] = 160 } else if (text) px[i] = px[i + 1] = px[i + 2] = 30
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
}
// 472 (Vâlcelele PL4): plan topografic rar — străzi subțiri în benzi, mult alb; sondele 3x3 cădeau toate pe alb
async function pdfTopoRar() {
  const d = new jsPDF({ unit: 'pt', format: [1684, 2384] })
  const W = 1684, H = 2384
  for (const fx of [0.1, 0.38, 0.62, 0.9]) for (let k = 0; k < 6; k++) d.line(fx * W + k * 4, 40, fx * W + k * 4 + 20, H - 40)
  for (const fy of [0.1, 0.38, 0.62, 0.9]) for (let k = 0; k < 6; k++) d.line(40, fy * H + k * 4, W - 40, fy * H + k * 4 + 20)
  d.addImage(dataUrl(await jpegSigla()), 'JPEG', 1, H - 72, 141, 71)
  return cuByteRange(Buffer.from(d.output('arraybuffer')))
}
async function pdfSiglaEasySignReala() {     // A3 vectorial + sigla 900x450 cu textul de semnătură SUPRAPUS pe ea
  const d = new jsPDF({ unit: 'pt', format: 'a3', orientation: 'landscape' })
  for (let i = 0; i < 600; i++) d.line(40 + (i * 1.7) % 1000, 40 + (i * 13) % 700, 60 + (i * 7) % 1050, 60 + (i * 11) % 740)
  d.addImage(dataUrl(await jpegSigla()), 'JPEG', 1000, 740, 140, 70)
  d.setFontSize(7); d.text('Semnat digital EasySign', 1030, 780)
  return cuByteRange(Buffer.from(d.output('arraybuffer')))
}
async function pdfMicCartusExterior() {      // imagine mică legitimă (desen 800x600) + cartuș vectorial în afara ei, fără semnătură
  const d = new jsPDF({ unit: 'pt', format: 'a4' })
  d.addImage(dataUrl(await jpeg(800, 600, 3)), 'JPEG', 60, 80, 150, 112)
  d.rect(300, 650, 260, 150); for (let i = 0; i < 6; i++) d.line(300, 670 + i * 20, 560, 670 + i * 20)
  d.text('Plan situatie PL3 - Beneficiar', 310, 665)
  return Buffer.from(d.output('arraybuffer'))
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

// R4 pct. 1: scanare pe 60% din pagină + tabel vectorial în restul paginii (nicio semnătură)
async function pdfScan60Tabel() {
  const d = new jsPDF({ unit: 'pt', format: [1000, 700], orientation: 'landscape' })
  d.addImage(dataUrl(await jpeg(3000, 2520)), 'JPEG', 0, 0, 600, 700)   // 600x700 = 60% din pagină
  d.rect(630, 60, 340, 580); for (let i = 1; i < 20; i++) d.line(630, 60 + i * 29, 970, 60 + i * 29)
  d.line(760, 60, 760, 640); d.text('Tabel dimensionare', 640, 50)
  return Buffer.from(d.output('arraybuffer'))
}
// R4 pct. 1: scanare pe toată pagina, nimic altceva
async function pdfScanIntreg() {
  const d = new jsPDF({ unit: 'pt', format: [1000, 700], orientation: 'landscape' })
  d.addImage(dataUrl(await jpeg(3000, 2100)), 'JPEG', 0, 0, 1000, 700)
  return Buffer.from(d.output('arraybuffer'))
}
// 25.09.2026: scanare pe toată pagina + cote vectoriale desenate PESTE ea => randare completă, nu imaginea
async function pdfScanCuCote() {
  const d = new jsPDF({ unit: 'pt', format: [1000, 700], orientation: 'landscape' })
  d.addImage(dataUrl(await jpeg(3000, 2100)), 'JPEG', 0, 0, 1000, 700)
  for (let i = 0; i < 8; i++) { d.line(100 + i * 100, 200, 180 + i * 100, 200); d.text(`L=${12 + i}.50 m`, 110 + i * 100, 195) }
  d.text('Digitally signed by EasySign', 20, 690)
  return cuByteRange(Buffer.from(d.output('arraybuffer')))
}

async function ruleaza(nume, buf) {
  const imagini = jpegDinPdf(buf)
  const meta = imagini.length ? await sharp(imagini[0]).metadata() : null
  const a = await analizeazaSemnale(buf, meta ? { width: meta.width, height: meta.height } : null, imagini[0] || null)
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
    identificare: a.identificare, acoperire_pdf: a.acoperire_pdf, acoperire: ruta.randeaza ? null : acoperireScanPdf(a), declansator_randare: a.declansator_randare, ruta: ruta.motiv, randeaza: ruta.randeaza, sursa, sursa_sigla_dovedita: a.sursa_sigla_dovedita }
  console.log(JSON.stringify(r))
  return r
}
let ok = 0, tot = 0
const verifica = (cond, msg) => { tot++; if (cond) ok++; console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`) }
const r1 = await ruleaza('sigla_pe_vectorial', await pdfSiglaPeVectorial())
verifica(r1.sursa === 'randare_pagina', '1: siglă izolată => randare pagină completă')
verifica(r1.sursa_sigla_dovedita === false, '1: text de semnătură SUB imagine (nu pe ea) => NU dovedit (doar declanșator de randare)')
verifica(r1.declansator_randare === true, '1: imagine mică + conținut în afara bbox => declanșator de randare')
const r2 = await ruleaza('scan_mare_semnat', await pdfScanSemnat())
verifica(r2.sursa === 'imagine', '2: scanare mare semnată => rămâne imaginea')
verifica(r2.sursa_sigla_dovedita === false, '2: fără siglă')
const r3 = await ruleaza('desen_mic_legitim', await pdfDesenMic())
verifica(r3.sursa_sigla_dovedita === false, '3: imagine mică singurul conținut => NU siglă')
verifica(r3.sursa !== 'necitibil', '3: planșa rămâne citibilă (randare sau imagine)')
const r4 = await ruleaza('sigla_easysign_reala', await pdfSiglaEasySignReala())
verifica(r4.sursa_sigla_dovedita === true, '4: siglă EasySign 900x450 + text „Semnat digital EasySign” suprapus => dovedit (identificare pozitivă)')
verifica(r4.sursa === 'randare_pagina', '4: se randează pagina completă')
const r5 = await ruleaza('mic_cartus_exterior', await pdfMicCartusExterior())
verifica(r5.sursa_sigla_dovedita === false, '5: imagine mică + cartuș exterior fără text de semnătură => NU dovedit')
verifica(r5.randeaza === true, '5: ... doar randare (declanșator)')
const r6 = await ruleaza('scan_60_tabel_vectorial', await pdfScan60Tabel())
verifica(r6.sursa === 'imagine', '6: scanare 60% fără semnale de document => ruta rămâne imaginea (procentul doar pt rutare)')
verifica(r6.acoperire?.demonstrata === false, '6: scanare 60% + tabel vectorial în rest => acoperire NEdemonstrată (partial)')
verifica(r6.acoperire_pdf?.paths_in_afara > 0 && r6.acoperire_pdf?.text_in_afara > 0, '6: path-urile și textul tabelului detectate în afara bbox-ului scanării')
const r7 = await ruleaza('scan_pagina_intreaga', await pdfScanIntreg())
verifica(r7.sursa === 'imagine' && r7.acoperire?.demonstrata === true, '7: scanare pe toată pagina fără altceva => acoperire demonstrată')
verifica(r7.acoperire?.tip === 'imagine_pagina_intreaga', '7: acoperire_tip = imagine_pagina_intreaga')
verifica(r2.acoperire?.demonstrata === true, '2: scanare semnată pe toată pagina, textul semnăturii ÎN bbox => acoperire demonstrată')
const r8 = await ruleaza('scan_intreg_cu_cote_peste', await pdfScanCuCote())
verifica(r8.acoperire_pdf?.paths_peste > 0 && r8.acoperire_pdf?.text_peste > 0, '8: cotele (path + text) detectate PESTE scanare, în bbox')
verifica(r8.randeaza === true && r8.ruta === 'suprapunere vectorială peste imagine', '8: scan 100% + cote peste => ruta = randare completă')
verifica(r8.sursa === 'randare_pagina', '8: sursa = randarea paginii, nu imaginea')
verifica(r2.acoperire_pdf?.text_peste === 0, '2: textul de semnătură EasySign în bbox NU contează ca suprapunere')
const r9 = await ruleaza('topo_rar_472', await pdfTopoRar())
verifica(r9.sursa === 'randare_pagina', '9: plan topografic rar (472) => randarea paginii e citibilă, nu fallback pe siglă')
const alb = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer()
verifica((await esteCitibila(alb)).citibila === false, '9: pagină albă randată => necitibilă')
// 10 (runda 7): felii identice (ultima coloană / bandă fixată la margine, rest ≤ latura − pas) se taie și se plătesc O DATĂ
{
  const g = (W, H) => ({ latura: 1600, pas: 1408, coloane: Math.ceil(W / 1408), randuri: Math.ceil(H / 1408) })
  const a = zoneTaiere({ width: 7140, height: 1400 }, g(7140, 1400))
  verifica(a.zone.map((z) => z.zona).join(',') === '1_1,1_2,1_3,1_4,1_5', '10: W 7.140 (rest 100 px), o bandă: z1_6 = z1_5 (left 5.540) => 5 zone, nu 6')
  verifica(JSON.stringify(a.identice) === '[["1_6","1_5"]]', '10: zona sărită e trecută în `identice` ([sărită, păstrată])')
  const b = zoneTaiere({ width: 7340, height: 1400 }, g(7340, 1400))
  verifica(b.zone.length === 6 && !b.identice.length && b.zone[4].left === 5632 && b.zone[5].left === 5740, '10: W 7.340 (rest 300 px), o bandă: 6 zone distincte, coloana fixată la 5.740 (control)')
  const c = zoneTaiere({ width: 7140, height: 3000 }, g(7140, 3000))
  verifica(c.zone.length === 10 && c.identice.length === 8 && new Set(c.zone.map((z) => `${z.left}|${z.top}`)).size === 10, '10: W 7.140 × H 3.000: benzile 2 și 3 identice (top 1.400) + coloanele 5/6 => 10 zone unice, 8 sărite')
  const d = zoneTaiere({ width: 9362, height: 6623 }, g(9362, 6623))
  verifica(d.zone.length === 35 && !d.identice.length, '10: 470 (9.362 × 6.623): 35 zone, nimic sărit — geometria din BD neschimbată')
  // H între pas și latură (1.408 < H ≤ 1.600): banda 2 are top 0 = banda 1 => sărită (înainte: toată banda plătită de două ori)
  const e = zoneTaiere({ width: 4000, height: 1600 }, g(4000, 1600))
  verifica(e.zone.length === 3 && JSON.stringify(e.identice) === '[["2_1","1_1"],["2_2","1_2"],["2_3","1_3"]]', '10: H 1.600: banda 2 identică cu banda 1 => 3 zone, nu 6')
  const p = zoneTaiere({ width: 7140, height: 1400 }, g(7140, 1400), 'p2_')
  verifica(p.zone[0].zona === 'p2_1_1' && p.identice[0][0] === 'p2_1_6', '10: prefixul paginii se păstrează (dedup doar în aceeași sursă)')
}
console.log(`\n${ok}/${tot} verificări trecute`)
process.exit(ok === tot ? 0 : 1)
