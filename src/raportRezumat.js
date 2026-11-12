// ═══════════════════════════════════════════════════════════════════════════
// raportRezumat.js — rezumatul scurt al raportului zilnic de șantier (etapa 1, determinist, fără AI)
//
// rezumatRaport(intrare) scrie câteva rânduri pe înțelesul unui director: șantierul (+ proiectul, dacă nu e deja în nume), data,
// vremea, oameni, utilaje, poze, lucrările cu cantitățile EXACT ca în raport (unitatea de măsură inclusă), detaliile, subcontractorii,
// problemele, aprovizionarea, planul pentru mâine.
// Regulile: cantitățile se copiază din raport (nu se rotunjesc, nu se deduc, nu se adună; singura rotunjire = temperatura, la grad întreg);
// câmp lipsă = rândul / bucata lipsește (nu „0”, nu „necunoscut”); textele lungi se taie pe cuvinte, cu „…”.
// Textul e DETERMINIST: nicio „lustruire” cu AI în etapa 1 (proba cu un model local a inventat planul de mâine când rubrica era goală).
//
// Forma intrării = cea construită în BD de fn_raport_rezumat_intrare (migrarea 20261216a, blocul INTRARE) și de scriptul de
// probă scripts/raport_rezumat_proba.sql (același bloc, copiat identic):
//   { santier, proiect, data: 'AAAA-LL-ZZ', meteo: {temp, precip_mm, alerte[]}, personal: {sudori, …, total},
//     utilaje: [{nume, cod, stare, motiv}], linii: [{obiect_cod, obiect_nume, activitate, um, cantitate, bifa}],
//     distributie: {conducte, bransamente}, lucrari, subcontractori, probleme, masini, aprovizionare, plan_maine, poze: N }
// Textul salvat pe raport îl scrie SERVERUL (fn_raport_rezumat_text, aceeași regulă în SQL). Funcția de aici e oglinda lui
// (L19: dublare inevitabilă JS / SQL = test de paritate pe același tabel de cazuri, src/raportRezumat.cazuri.json).
//
// rezumatZi(rapoarte, data, opt) — rezumatul ZILEI pe toate șantierele (doar în aplicație, nu se salvează): vezi mai jos.
// ═══════════════════════════════════════════════════════════════════════════
import { paginareKeyset } from './hrDeciziiUtil.js'

export const LIMITE = {
  santier: 80, proiect: 60, detalii: 240, subcontractori: 200, probleme: 240, masini: 160, aprovizionare: 160, plan_maine: 200,
  motiv: 80, nefunctionale: 3,
}
// textul corectat de om: cel mult atâtea caractere (aceeași limită ca în BD; peste = refuz, nu tăiere)
export const MAX_EDITAT = 4000

const CATEGORII = [
  ['sudori', 'sudori'], ['lacatusi', 'lăcătuși'], ['operatori', 'operatori utilaje'], ['soferi', 'șoferi'],
  ['necalificati', 'necalificați'], ['tesa', 'TESA'], ['altii', 'alții'],
]

// caracterele de control (cod 1–31 și 127: tab, rând nou etc.) devin spațiu; construit din coduri, nu din secvențe de escape
const CONTROL = new RegExp('[' + String.fromCharCode(1) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']+', 'g')

// textul pe un singur rând: controalele -> spațiu, spațiile repetate -> unul, fără spații la capete (doar spațiul obișnuit)
export function curata(s) {
  if (typeof s !== 'string') return ''
  return s.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '')
}

// cel mult n caractere (puncte de cod, ca length() din PostgreSQL), tăiat la ultimul spațiu; un singur cuvânt mai lung = tăiat la n
export function trunchiaza(s, n) {
  const t = curata(s)
  const cp = Array.from(t)
  if (cp.length <= n) return t
  const cap = cp.slice(0, n + 1).join('')
  const i = cap.lastIndexOf(' ')
  return (i > 0 ? cap.slice(0, i) : cp.slice(0, n).join('')) + '…'
}

// numele fără diacritice / majuscule, pentru comparație: DOAR literele românești + A–Z (aceeași hartă ca translate() din SQL,
// ca rezultatul să nu depindă de colația bazei)
const HARTA_DIN = 'ĂÂÎȘŞȚŢăâîșşțţABCDEFGHIJKLMNOPQRSTUVWXYZ'
const HARTA_IN = 'aaissttaaissttabcdefghijklmnopqrstuvwxyz'
export function normNume(s) {
  let o = ''
  for (const ch of curata(s)) { const i = HARTA_DIN.indexOf(ch); o += i >= 0 ? HARTA_IN[i] : ch }
  return o
}

const esteNr = (v) => typeof v === 'number' && Number.isFinite(v)
const esteObiect = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
// numărul exact cum vine din raport, cu virgulă zecimală (12.5 -> „12,5”); nenumăr = null (bucata lipsește)
export function fmtNr(v) {
  return esteNr(v) ? String(v).replace('.', ',') : null
}
// temperatura la grad întreg, jumătatea departe de zero (8,5 -> 9; -2,5 -> -3), ca round(numeric) din PostgreSQL; fără „-0”
export function fmtGrad(v) {
  if (!esteNr(v)) return null
  const r = Math.sign(v) * Math.round(Math.abs(v))
  return String(r === 0 ? 0 : r)
}
const fmtData = (d) => (typeof d === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d)) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : ''

function textMeteo(m) {
  if (!esteObiect(m)) return ''
  const p = []
  if (esteNr(m.temp)) p.push(`${fmtGrad(m.temp)} °C`)
  if (esteNr(m.precip_mm) && m.precip_mm > 0) p.push(`precipitații ${fmtNr(m.precip_mm)} mm`)
  const al = Array.isArray(m.alerte) ? m.alerte.map(curata).filter(Boolean) : []
  if (al.length) p.push(`alerte: ${al.join(', ')}`)
  return p.join(', ')
}

function textOameni(ps) {
  if (!esteObiect(ps)) return ''
  const cat = CATEGORII.filter(([k]) => esteNr(ps[k]) && ps[k] > 0).map(([k, l]) => `${l} ${fmtNr(ps[k])}`)
  if (esteNr(ps.total)) return `Oameni: ${fmtNr(ps.total)}${cat.length ? ` (${cat.join(', ')})` : ''}`
  return cat.length ? `Oameni: ${cat.join(', ')}` : ''
}

const denUtilaj = (e) => curata(e.nume) || curata(e.cod) || 'fără denumire'
const nefunctionale = (u) => (Array.isArray(u) ? u.filter(e => esteObiect(e) && e.stare === 'nefunctional') : [])
// numărul lor + cel mult primele LIMITE.nefunctionale (în ordinea din raport), apoi „+N”
function listaScurta(elemente) {
  const n = elemente.length, k = LIMITE.nefunctionale
  return `${elemente.slice(0, k).join('; ')}${n > k ? `; +${n - k}` : ''}`
}

function textUtilaje(u) {
  if (!Array.isArray(u) || u.length === 0) return ''
  const nef = nefunctionale(u).map(e => {
    const den = denUtilaj(e)
    const m = trunchiaza(e.motiv, LIMITE.motiv)
    return m ? `${den} – ${m}` : den
  })
  return `Utilaje: ${u.length}${nef.length ? ` (nefuncționale ${nef.length}: ${listaScurta(nef)})` : ''}`
}

// lucrările pe obiecte, în ordinea din raport (prima apariție a obiectului): [{ cod, et, bucati[] }]
function grupeLucrari(linii) {
  if (!Array.isArray(linii)) return []
  const grupe = new Map()
  for (const l of linii) {
    if (!esteObiect(l)) continue
    const cod = curata(l.obiect_cod), nume = curata(l.obiect_nume)
    const et = cod && nume ? `${cod} · ${nume}` : (cod || nume)
    const act = curata(l.activitate) || 'activitate'
    let buc
    if (l.bifa === true) buc = `${act} (efectuat)`
    else {
      const c = fmtNr(l.cantitate), um = curata(l.um)
      buc = c == null ? `${act} (fără cantitate)` : `${act} ${c}${um ? ' ' + um : ''}`
    }
    if (!grupe.has(et)) grupe.set(et, { scurt: cod || nume, bucati: [] })
    grupe.get(et).bucati.push(buc)
  }
  return [...grupe].map(([et, g]) => ({ et, scurt: g.scurt, bucati: g.bucati }))
}
// fără obiect = „Lucrări:”
const randuriLucrari = (linii) => grupeLucrari(linii).map(g => `${g.et ? `Lucrări ${g.et}` : 'Lucrări'}: ${g.bucati.join('; ')}`)

function textDistributie(d) {
  if (!esteObiect(d)) return ''
  const p = []
  if (esteNr(d.conducte) && d.conducte > 0) p.push(`conducte ${fmtNr(d.conducte)}`)
  if (esteNr(d.bransamente) && d.bransamente > 0) p.push(`branșamente ${fmtNr(d.bransamente)}`)
  return p.length ? `Distribuție gaze (rânduri): ${p.join(', ')}` : ''
}

export function rezumatRaport(r) {
  const x = esteObiect(r) ? r : {}
  const out = []
  // 1. un singur nume: șantierul (sites.name, scurtat); proiectul doar dacă numele lui NU e deja în numele șantierului
  //    (fără diacritice / majuscule), scurtat; data; vremea
  const sTot = curata(x.santier), prTot = curata(x.proiect)
  const pr = prTot === '' || normNume(sTot).includes(normNume(prTot)) ? '' : trunchiaza(prTot, LIMITE.proiect)
  const s = trunchiaza(sTot, LIMITE.santier), d = fmtData(x.data), m = textMeteo(x.meteo)
  out.push(`${s || 'Raport zilnic'}${pr ? ` (proiect ${pr})` : ''}${d ? ` · ${d}` : ''}${m ? ` · ${m}` : ''}`)
  // 2. oameni · utilaje · poze
  const echipa = [textOameni(x.personal), textUtilaje(x.utilaje), esteNr(x.poze) && x.poze > 0 ? `Poze: ${fmtNr(x.poze)}` : ''].filter(Boolean)
  if (echipa.length) out.push(echipa.join(' · '))
  // 3. lucrările cu cantități, pe obiecte; distribuția
  const luc = randuriLucrari(x.linii)
  out.push(...luc)
  const dist = textDistributie(x.distributie)
  if (dist) out.push(dist)
  // 4. textul liber al lucrărilor (detalii, dacă există și cantități)
  const t = trunchiaza(x.lucrari, LIMITE.detalii)
  if (t) out.push(`${luc.length ? 'Detalii' : 'Lucrări'}: ${t}`)
  // 4b. subcontractorii (ce au lucrat azi), dacă rubrica e completată
  const sc = trunchiaza(x.subcontractori, LIMITE.subcontractori)
  if (sc) out.push(`Subcontractori: ${sc}`)
  // 5. probleme · mașini
  const pb = [trunchiaza(x.probleme, LIMITE.probleme), trunchiaza(x.masini, LIMITE.masini)]
  const pbt = [pb[0] ? `Probleme: ${pb[0]}` : '', pb[1] ? `Mașini: ${pb[1]}` : ''].filter(Boolean)
  if (pbt.length) out.push(pbt.join(' · '))
  // 6. aprovizionarea cerută și planul pentru mâine, fiecare doar dacă e completat (textul omului, nimic dedus)
  const ap = trunchiaza(x.aprovizionare, LIMITE.aprovizionare)
  if (ap) out.push(`Aprovizionare: ${ap}`)
  const pm = trunchiaza(x.plan_maine, LIMITE.plan_maine)
  if (pm) out.push(`Plan pentru mâine: ${pm}`)
  return out.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// REZUMATUL ZILEI, pe toate șantierele (r2) — un singur text pe zi, pentru directorul de execuție / WhatsApp.
// Doar în aplicație (Rapoarte Șantier, birou), doar citire, nu se salvează. Cine îl cere vede doar rapoartele pe care le vede
// deja (RLS-ul de azi + șantierele lui din ecran); funcția de aici e pură și nu citește nimic.
//   rapoarte: intrările rapoartelor din ziua aceea, forma lui rezumatRaport + site_id
//             (santier, personal, utilaje, linii, lucrari, subcontractori, probleme; restul câmpurilor nu intră în rezumatul zilei)
//   data:     'AAAA-LL-ZZ'
//   opt.santiereActive: [{ id, nume }] = șantierele care trebuiau să raporteze (lipsă / nu e listă = partea „fără raport” NU apare)
// Antetul ADUNĂ oamenii (personal.total) și utilajele (numărul din listă) — cerința zilei; un raport fără număr nu devine 0:
// se spune câte rapoarte n-au avut numărul. Cantitățile nu se adună (fiecare șantier cu ale lui, exact ca în raport).
// Șantierele: în ordinea numărului de oameni (descrescător; fără număr la final), apoi după nume.
// ═══════════════════════════════════════════════════════════════════════════
export const LIMITE_ZI = { santier: 60, lucrari: 200, subcontractori: 120, probleme: 160 }

// „1 șantier”, „5 șantiere”, „20 de șantiere”, „101 șantiere” (regula lui „de”: ultimele două cifre 00 sau 20–99)
export function cuNumar(n, unu, multe) {
  if (n === 1) return `1 ${unu}`
  const r = Math.abs(n) % 100
  return `${n} ${(r === 0 && n !== 0) || r >= 20 ? 'de ' : ''}${multe}`
}
const faraNumar = (k) => (k ? ` (${k === 1 ? 'un raport' : cuNumar(k, 'raport', 'rapoarte')} fără număr)` : '')

// rândurile unui șantier: 1) nume: oameni · utilaje (nefuncționale), 2) lucrări, 3) subcontractori, 4) probleme
function randuriSantier(x) {
  const out = []
  const nume = trunchiaza(x.santier, LIMITE_ZI.santier) || (x.site_id != null ? `Șantier #${x.site_id}` : 'Șantier fără nume')
  const p = esteObiect(x.personal) && esteNr(x.personal.total) ? cuNumar(x.personal.total, 'om', 'oameni') : ''
  let ut = ''
  if (Array.isArray(x.utilaje)) {
    const nef = nefunctionale(x.utilaje).map(denUtilaj)
    ut = `${cuNumar(x.utilaje.length, 'utilaj', 'utilaje')}${nef.length ? ` (nefuncționale ${nef.length}: ${listaScurta(nef)})` : ''}`
  }
  const ech = [p, ut].filter(Boolean).join(' · ')
  out.push(`• ${nume}${ech ? `: ${ech}` : ''}`)
  // lucrările: cantitățile exacte pe obiecte (netăiate: o cifră nu se taie), apoi textul liber scurtat
  const gr = grupeLucrari(x.linii).map(g => `${g.scurt ? `${g.scurt} – ` : ''}${g.bucati.join(', ')}`).join('; ')
  const t = trunchiaza(x.lucrari, LIMITE_ZI.lucrari)
  out.push(`  Lucrări: ${gr && t ? `${gr} — ${t}` : (gr || t || 'nimic trecut în raport')}`)
  const sc = trunchiaza(x.subcontractori, LIMITE_ZI.subcontractori)
  if (sc) out.push(`  Subcontractori: ${sc}`)
  const pb = trunchiaza(x.probleme, LIMITE_ZI.probleme)
  if (pb) out.push(`  Probleme: ${pb}`)
  return out
}

export function rezumatZi(rapoarte, data, opt = {}) {
  const lista = (Array.isArray(rapoarte) ? rapoarte : []).filter(esteObiect)
  const d = fmtData(data)
  const titlu = `Rapoarte șantiere${d ? ` — ${d}` : ''}`
  const out = []
  if (lista.length === 0) out.push(`${titlu}: niciun raport`)
  else {
    let oameni = 0, faraOameni = 0, utilaje = 0, faraUtilaje = 0
    for (const x of lista) {
      if (esteObiect(x.personal) && esteNr(x.personal.total)) oameni += x.personal.total; else faraOameni++
      if (Array.isArray(x.utilaje)) utilaje += x.utilaje.length; else faraUtilaje++
    }
    out.push(`${titlu}: ${cuNumar(lista.length, 'șantier', 'șantiere')}, ${cuNumar(oameni, 'om', 'oameni')}${faraNumar(faraOameni)}, `
      + `${cuNumar(utilaje, 'utilaj', 'utilaje')}${faraNumar(faraUtilaje)}`)
    const tot = (x) => (esteObiect(x.personal) && esteNr(x.personal.total) ? x.personal.total : -Infinity)
    const dupaOameni = (a, b) => (tot(a) === tot(b) ? 0 : tot(b) > tot(a) ? 1 : -1)
    const ordonate = [...lista].sort((a, b) => dupaOameni(a, b)
      || curata(a.santier).localeCompare(curata(b.santier), 'ro') || (Number(a.site_id) || 0) - (Number(b.site_id) || 0))
    out.push('')
    for (const x of ordonate) out.push(...randuriSantier(x))
  }
  // șantierele active fără raport în ziua aceea (doar dacă lista lor e cunoscută)
  if (Array.isArray(opt.santiereActive)) {
    const auRaport = new Set(lista.map(x => String(x.site_id)))
    const lipsa = opt.santiereActive.filter(s => esteObiect(s) && !auRaport.has(String(s.id)))
      .map(s => trunchiaza(s.nume, LIMITE_ZI.santier) || `Șantier #${s.id}`)
      .sort((a, b) => a.localeCompare(b, 'ro'))
    out.push('')
    out.push(lipsa.length ? `Fără raport (${lipsa.length}): ${lipsa.join(', ')}` : 'Toate șantierele active au trimis raport.')
  }
  return out.join('\n')
}

// liniile din raport_lucrari (select cu proiect_activitati / proiect_unitati) -> forma „linii” a intrării, în ordinea din
// fn_raport_rezumat_intrare: întâi cele fără obiect, apoi pe obiect (ordine, id), activitate (ordine, id), id
export function liniiDinRaportLucrari(randuri) {
  const nr = (v) => (v == null ? Infinity : Number(v))   // NULL la final, ca ORDER BY ... ASC din PostgreSQL
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return (Array.isArray(randuri) ? randuri : []).filter(esteObiect).slice().sort((a, b) =>
    cmp(a.unitate_id != null ? 1 : 0, b.unitate_id != null ? 1 : 0)
    || cmp(nr(a.proiect_unitati?.ordine), nr(b.proiect_unitati?.ordine)) || cmp(nr(a.unitate_id), nr(b.unitate_id))
    || cmp(nr(a.proiect_activitati?.ordine), nr(b.proiect_activitati?.ordine)) || cmp(nr(a.activitate_id), nr(b.activitate_id))
    || cmp(nr(a.id), nr(b.id))
  ).map(r => ({
    obiect_cod: r.proiect_unitati?.cod ?? null, obiect_nume: r.proiect_unitati?.nume ?? null,
    activitate: r.proiect_activitati?.nume ?? null, um: r.proiect_activitati?.um ?? null,
    cantitate: r.cantitate == null ? null : Number(r.cantitate),
    bifa: (r.proiect_activitati?.tip_raportare ?? 'cantitate') === 'bifa',
  }))
}

// ── rezumatul zilei în aplicație: citirea (doar SELECT, cu drepturile de azi ale celui care cere) și forma intrării ──
// Coloanele citite = DOAR ce intră în rezumatul zilei (fără autor / șef de șantier / poze).
export const COLOANE_ZI = 'id, site_id, data, personal_snapshot, utilaje_snapshot, lucrari_efectuate, subcontractori, probleme'
export const COLOANE_LINII_ZI = 'id, raport_id, unitate_id, activitate_id, cantitate, '
  + 'proiect_activitati(nume, um, tip_raportare, ordine), proiect_unitati(cod, nume, ordine)'
const ZI_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
// Rapoartele unei zile pe șantierele date + liniile lor (raport_lucrari). Citiri pe chei (L23), id-urile pe bucăți în .in();
// o eroare se aruncă (L18: eroare ≠ zi fără rapoarte). Lista de șantiere goală = nu vede nimic (nicio cerere).
// RLS-ul de azi decide ce rânduri vin (un cont restrâns pe proiect primește doar rapoartele lui): aici nu se ocolește nimic.
export async function citesteRapoarteZi(client, siteIds, zi, { paginare, bucata = 100 } = {}) {
  const ids = [...new Set((Array.isArray(siteIds) ? siteIds : []).filter(v => v != null))]
  if (!ids.length || typeof zi !== 'string' || !ZI_RE.test(zi)) return []
  const pagini = paginare || paginareKeyset
  const rapoarte = []
  for (let i = 0; i < ids.length; i += bucata) {
    const b = ids.slice(i, i + bucata)
    const r = await pagini((ultim, pas) => {
      const q = client.from('rapoarte_zilnice').select(COLOANE_ZI).in('site_id', b).eq('data', zi).order('id').limit(pas)
      return ultim == null ? q : q.gt('id', ultim)
    })
    for (const x of r) rapoarte.push(x)
  }
  const linii = []
  const rid = rapoarte.map(r => r.id)
  for (let i = 0; i < rid.length; i += bucata) {
    const b = rid.slice(i, i + bucata)
    const r = await pagini((ultim, pas) => {
      const q = client.from('raport_lucrari').select(COLOANE_LINII_ZI).in('raport_id', b).order('id').limit(pas)
      return ultim == null ? q : q.gt('id', ultim)
    })
    for (const x of r) linii.push(x)
  }
  return rapoarte.map(r => ({ ...r, linii_raport: linii.filter(l => l.raport_id === r.id) }))
}
// rândul citit -> intrarea lui rezumatZi; numele șantierului = sites.name (numeSantier(id); lipsă = „Șantier #id” în text)
export function intrareZi(r, numeSantier) {
  const x = esteObiect(r) ? r : {}
  return {
    site_id: x.site_id ?? null,
    santier: (typeof numeSantier === 'function' ? numeSantier(x.site_id) : null) || null,
    personal: x.personal_snapshot ?? null,
    utilaje: x.utilaje_snapshot ?? null,
    linii: liniiDinRaportLucrari(x.linii_raport),
    lucrari: x.lucrari_efectuate ?? null,
    subcontractori: x.subcontractori ?? null,
    probleme: x.probleme ?? null,
  }
}
// șantierele care trebuiau să raporteze: aceeași regulă ca „Lipsă azi” din Rapoarte Șantier (raport_zilnic_necesar) + active
export function santiereDeRaportat(sites) {
  return (Array.isArray(sites) ? sites : []).filter(s => esteObiect(s) && s.id != null && s.raport_zilnic_necesar !== false && s.active !== false)
    .map(s => ({ id: s.id, nume: s.name }))
}

// ── pentru rubrica din aplicație ──
// eticheta: „generat automat” / „editat de <nume>”; rezumatul lipsă (raport salvat înainte de migrare) = null
export function etichetaRezumat(raport, numeAutor) {
  if (!raport || raport.rezumat_sursa == null) return null
  if (raport.rezumat_sursa === 'automat') return 'generat automat'
  if (raport.rezumat_sursa === 'editat') return `editat de ${numeAutor || 'un utilizator'}`
  return null
}
// textul corectat de om, validat ca în BD: nevid (nu doar spații), cel mult MAX_EDITAT caractere (fără tăiere)
export function valideazaEditat(t) {
  if (typeof t !== 'string' || !/[^\s]/.test(t)) return 'Rezumatul nu poate fi gol. Pentru textul automat folosește „Revino la automat”.'
  if (Array.from(t).length > MAX_EDITAT) return `Rezumatul are ${Array.from(t).length} caractere; maximum ${MAX_EDITAT}.`
  return null
}
