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

// Runda 6 (verdict r5, L24): exportul primește de la ecran `eValabil` (contextul în care s-a cerut PDF-ul e încă cel curent) și un `semnal`
// (AbortSignal, anulat de ecran la schimbarea raportului / proiectului / la ieșire). Se verifică după FIECARE await (URL-uri semnate, fiecare
// poză, fiecare captură) și imediat înainte de pdf.save(): context schimbat = buclele se opresc, nimic descărcat, rezultat { anulat: true }.
class ExportAnulat extends Error { constructor() { super('Exportul PDF a fost oprit: ecranul s-a schimbat.'); this.anulat = true } }
const verificator = (eValabil, semnal) => () => { if (semnal?.aborted || !eValabil()) throw new ExportAnulat() }

async function fetchAsDataURL(url, semnal) {
  const r = await fetch(url, semnal ? { signal: semnal } : undefined)
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const b = await r.blob()
  return await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsDataURL(b) })
}

/** pozele cu imaginea ca data URL; o poză necitită rămâne în listă fără imagine (apare cu mențiunea în anexă) și e numărată.
 *  `viu` (opțional) aruncă ExportAnulat când contextul s-a schimbat: verificat după fiecare citire, oprește bucla (nu e numărat ca „necitită”) */
export async function pozeCuImagini(client, poze, { viu = () => {}, semnal = null } = {}) {
  const lista = poze || []
  if (!lista.length) return { poze: [], necitite: 0 }
  viu()
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(lista.map(p => p.cale), 600)
  viu()
  const url = new Map((error ? [] : data || []).map(x => [x.path, x.signedUrl]))
  let necitite = 0
  const rez = []
  for (const p of lista) {
    let dataUrl = null
    try { if (url.get(p.cale)) dataUrl = await fetchAsDataURL(url.get(p.cale), semnal) } catch { dataUrl = null }
    viu()                                      // întâi contextul: o citire întreruptă de anulare NU devine „poză necitită”
    if (!dataUrl) necitite++
    rez.push({ ...p, dataUrl })
  }
  return { poze: rez, necitite }
}

async function capteaza(html, viu) {
  viu()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0'
  host.innerHTML = html
  document.body.appendChild(host)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    viu()
    const c = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fff', useCORS: false })
    viu()
    return c
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

/** generează și descarcă PDF-ul; întoarce { necitite, pagini }, sau { anulat: true } (fără descărcare) dacă contextul s-a schimbat între timp.
 *  eValabil: () => boolean, cerut de ecran (contextul capturat la apăsare); semnal: AbortSignal opțional (oprește și citirile pozelor în zbor) */
export async function exportRaportUscarePDF({ client, uscare, poze, cuCoordonate = false, eValabil = () => true, semnal = null }) {
  const viu = verificator(eValabil, semnal)
  try {
    return await genereaza({ client, uscare, poze, cuCoordonate, viu, semnal })
  } catch (e) {
    if (e instanceof ExportAnulat) return { anulat: true, necitite: 0, pagini: 0 }
    // o eroare apărută DUPĂ schimbarea contextului (ex. citire întreruptă de semnal) nu mai e a ecranului curent
    if (semnal?.aborted || !eValabil()) return { anulat: true, necitite: 0, pagini: 0 }
    throw e
  }
}

async function genereaza({ client, uscare, poze, cuCoordonate, viu, semnal }) {
  const { poze: cuImagini, necitite } = await pozeCuImagini(client, poze, { viu, semnal })
  viu()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  pdf.setProperties({ title: 'Raport - operațiune de uscare a conductei', creator: uscare.constructor || 'Constructor', author: uscare.constructor || '' })
  const canvase = []
  for (const html of htmlRaportBlocuri(uscare, { cuCoordonate })) canvase.push(await capteaza(html, viu))
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
    const c = await capteaza(pagina, viu)
    let w = LATIME_MM, h = (c.height * w) / c.width
    if (h > INALTIME_MM) { w = w * INALTIME_MM / h; h = INALTIME_MM }   // pagina anexei are 2 poze cu înălțime limitată: încape
    pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', (210 - w) / 2, SUS_MM, w, h)
  }
  viu()                                        // imediat înainte de descărcare: raportul cerut e încă cel de pe ecran
  pdf.save(numeFisierRaport(uscare))
  return { necitite, pagini: pdf.getNumberOfPages() }
}
