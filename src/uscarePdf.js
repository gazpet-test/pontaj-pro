// PDF-ul raportului de uscare: HTML (uscareRaport.js) → html2canvas → jsPDF, A4 portret, o pagină pentru tabel + paginile anexei foto.
// Regulile din CLAUDE.md: pozele private vin prin signed URL și se aduc ca data URL (CORS); 2× requestAnimationFrame înainte de captură.
// Fără metadate despre aplicație în fișier (doar titlul raportului).
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { htmlRaport, htmlAnexa } from './uscareRaport.js'
import { numeFisierRaport } from './uscareLogica.js'

const BUCKET = 'executie-uscare'

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
function adaugaPagina(pdf, canvas, prima) {
  if (!prima) pdf.addPage()
  // A4 210×297 mm, margini 8 mm; conținutul mai înalt decât pagina se micșorează proporțional
  let w = 194, h = (canvas.height * w) / canvas.width
  if (h > 281) { w = w * 281 / h; h = 281 }
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', (210 - w) / 2, 8, w, h)
}

/** generează și descarcă PDF-ul; întoarce { necitite } (pozele care n-au putut fi puse în anexă) */
export async function exportRaportUscarePDF({ client, uscare, poze }) {
  const { poze: cuImagini, necitite } = await pozeCuImagini(client, poze)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  pdf.setProperties({ title: 'Raport - operatiune de uscare a conductei', creator: uscare.constructor || 'Constructor', author: uscare.constructor || '' })
  adaugaPagina(pdf, await capteaza(htmlRaport(uscare)), true)
  for (const pagina of htmlAnexa(uscare, cuImagini)) adaugaPagina(pdf, await capteaza(pagina), false)
  pdf.save(numeFisierRaport(uscare))
  return { necitite }
}
