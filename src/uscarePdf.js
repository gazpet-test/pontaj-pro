// PDF-ul raportului de uscare: blocurile HTML (uscareRaport.js) → html2canvas → jsPDF, A4 portret. Blocurile se așază pe pagini (aseazaBlocuri):
// ce nu mai încape trece pe pagina următoare, un bloc mai înalt decât o pagină se taie în felii — nimic nu se micșorează pe o singură pagină.
// Regulile din CLAUDE.md: pozele private vin prin signed URL și se aduc ca data URL (CORS); 2× requestAnimationFrame înainte de captură.
// Fără metadate despre aplicație în fișier (doar titlul raportului). Coordonatele exacte doar cu opțiunea explicită `cuCoordonate`.
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { htmlRaportBlocuri, htmlAnexa, aseazaBlocuri } from './uscareRaport.js'
import { numeFisierRaport } from './uscareLogica.js'

const BUCKET = 'executie-uscare'
const LATIME_MM = 194, INALTIME_MM = 281, SUS_MM = 8

async function fetchAsDataURL(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const b = await r.blob()
  return await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsDataURL(b) })
}

/** pozele cu imaginea ca data URL; o poză necitită rămâne în listă fără imagine (apare cu mențiunea în anexă) și e numărată */
export async function pozeCuImagini(client, poze) {
  const lista = poze || []
  if (!lista.length) return { poze: [], necitite: 0 }
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(lista.map(p => p.cale), 600)
  const url = new Map((error ? [] : data || []).map(x => [x.path, x.signedUrl]))
  let necitite = 0
  const rez = []
  for (const p of lista) {
    let dataUrl = null
    try { if (url.get(p.cale)) dataUrl = await fetchAsDataURL(url.get(p.cale)) } catch { dataUrl = null }
    if (!dataUrl) necitite++
    rez.push({ ...p, dataUrl })
  }
  return { poze: rez, necitite }
}

async function capteaza(html) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0'
  host.innerHTML = html
  document.body.appendChild(host)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    return await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fff', useCORS: false })
  } finally { document.body.removeChild(host) }
}
/** felia [de_la, de_la + inaltime] (mm) dintr-un canvas cu înălțimea totală `total` mm */
function felie(canvas, { de_la, inaltime, total }) {
  const px = canvas.height / total
  const c = document.createElement('canvas')
  c.width = canvas.width; c.height = Math.max(1, Math.round(inaltime * px))
  c.getContext('2d').drawImage(canvas, 0, Math.round(de_la * px), canvas.width, c.height, 0, 0, canvas.width, c.height)
  return c
}

/** generează și descarcă PDF-ul; întoarce { necitite, pagini } */
export async function exportRaportUscarePDF({ client, uscare, poze, cuCoordonate = false }) {
  const { poze: cuImagini, necitite } = await pozeCuImagini(client, poze)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  pdf.setProperties({ title: 'Raport - operațiune de uscare a conductei', creator: uscare.constructor || 'Constructor', author: uscare.constructor || '' })
  const canvase = []
  for (const html of htmlRaportBlocuri(uscare, { cuCoordonate })) canvase.push(await capteaza(html))
  const inaltimi = canvase.map(c => (c.height * LATIME_MM) / c.width)
  const pagini = aseazaBlocuri(inaltimi, { inaltimePagina: INALTIME_MM, sus: SUS_MM })
  pagini.forEach((pg, i) => {
    if (i > 0) pdf.addPage()
    for (const b of pg) {
      const c = b.felie ? felie(canvase[b.bloc], b.felie) : canvase[b.bloc]
      pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', (210 - LATIME_MM) / 2, b.y, LATIME_MM, b.h)
    }
  })
  for (const pagina of htmlAnexa(uscare, cuImagini)) {
    pdf.addPage()
    const c = await capteaza(pagina)
    let w = LATIME_MM, h = (c.height * w) / c.width
    if (h > INALTIME_MM) { w = w * INALTIME_MM / h; h = INALTIME_MM }   // pagina anexei are 2 poze cu înălțime limitată: încape
    pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', (210 - w) / 2, SUS_MM, w, h)
  }
  pdf.save(numeFisierRaport(uscare))
  return { necitite, pagini: pdf.getNumberOfPages() }
}
