// ═══════════════════════════════════════════════════════════════════════════
// nodSchema3dLogica.js — logica pură a schemei 3D (probă) a unui nod de cuplare (Execuție)
// Decizia lui Răzvan, 10.11.2026: varianta A — schema 3D generată din izometrii, în browser (Three.js încărcat doar la cerere).
// Modelul vine din bucket-ul noduri-scheme (<proiect>/<nod>/model_3d.json, urcat de chat, lângă vederi.json); aici: validarea lui,
// legarea sudurilor din executie_noduri_suduri de pozițiile din model (după cod), culorile pe DN și pe stare.
// Fără React, fără Three.js, fără Supabase: totul se testează în vitest.
// ═══════════════════════════════════════════════════════════════════════════

import { STARI, CULORI, culoareStare, esteStare, RE_COD } from './nodCuplareLogica.js'

export const FORMAT = 'gazpet-nod-3d'
export const VERSIUNE = 1
export const TIPURI = ['teava', 'cot', 'teu', 'reductie', 'flansa', 'robinet', 'stut', 'rezervor', 'eticheta']
export const CERTITUDINI = ['desen', 'estimat']
const LIM = { grupuri: 20, elemente: 5000, suduri: 2000, faraPozitie: 2000, text: 160, note: 20, coord: 1e6 }
const RE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const RE_PREFIX = /^[A-Z]{1,6}$/

const txt = v => (v == null ? '' : String(v).trim())
const esteDn = v => Number.isInteger(v) && v >= 6 && v <= 2000
/** Punct 3D valid: exact 3 numere finite, în ±1 km. */
export const estePunct = p => Array.isArray(p) && p.length === 3 && p.every(c => typeof c === 'number' && Number.isFinite(c) && Math.abs(c) <= LIM.coord)

// Ce câmpuri de geometrie cere fiecare tip (a, b = capete; c = colțul cotului; r = capătul ramificației teului; p = locul etichetei)
const PUNCTE = {
  teava: ['a', 'b'], cot: ['a', 'c', 'b'], teu: ['a', 'b', 'r'], reductie: ['a', 'b'], flansa: ['a', 'b'], robinet: ['a', 'b'],
  stut: ['a', 'b'], rezervor: ['a', 'b'], eticheta: ['p'],
}

/**
 * Validarea modelului (JSON-ul din bucket). Nimic nu dispare tacit (L12): un element / o sudură invalidă apare în `erori` și nu
 * se afișează; restul modelului rămâne. Probleme de structură (format, versiune, nicio grupă) = model respins (grupuri goale).
 * Cod de sudură duplicat (în același grup sau în altul) = eroare pe a doua apariție.
 */
export function parseModel3d(json) {
  const erori = []
  const respins = m => ({ grupuri: [], note: [], titlu: '', erori: [m] })
  if (!json || typeof json !== 'object' || Array.isArray(json)) return respins('Modelul 3D nu e un obiect JSON')
  if (json.format !== FORMAT) return respins(`Modelul 3D are alt format („${txt(json.format).slice(0, 40)}”)`)
  if (json.versiune !== VERSIUNE) return respins(`Versiunea modelului 3D (${txt(json.versiune).slice(0, 10)}) nu e cunoscută`)
  if (json.unitate !== 'mm') return respins('Modelul 3D trebuie să fie în milimetri')
  if (!Array.isArray(json.grupuri) || !json.grupuri.length) return respins('Modelul 3D nu are niciun grup')
  if (json.grupuri.length > LIM.grupuri) return respins(`Modelul 3D are peste ${LIM.grupuri} grupuri`)
  const coduri = new Set(), iduri = new Set(), grupuri = []
  json.grupuri.forEach((g, gi) => {
    const id = txt(g?.id)
    const eticG = `Grupul ${gi + 1} (${id || '?'})`
    if (!RE_ID.test(id) || iduri.has(id)) { erori.push(`${eticG}: id invalid sau duplicat`); return }
    const el = Array.isArray(g.elemente) ? g.elemente : null, su = Array.isArray(g.suduri) ? g.suduri : null
    if (!el || !su) { erori.push(`${eticG}: lipsesc elementele sau sudurile`); return }
    if (el.length > LIM.elemente || su.length > LIM.suduri) { erori.push(`${eticG}: prea multe elemente / suduri`); return }
    const prefixe = Array.isArray(g.prefixe) ? g.prefixe.map(txt) : []
    if (!prefixe.length || !prefixe.every(p => RE_PREFIX.test(p))) { erori.push(`${eticG}: prefixele codurilor lipsesc sau sunt invalide`); return }
    const teren = g.teren_z == null ? null : g.teren_z
    if (teren != null && !(typeof teren === 'number' && Number.isFinite(teren) && Math.abs(teren) <= LIM.coord)) { erori.push(`${eticG}: teren_z invalid`); return }
    iduri.add(id)
    const elemente = []
    el.forEach((e, i) => {
      const pb = validElement(e)
      if (pb) { erori.push(`${eticG}, elementul ${i + 1} (${txt(e?.tip) || '?'}): ${pb}`); return }
      elemente.push(curataElement(e))
    })
    const suduri = []
    su.forEach((s, i) => {
      const cod = txt(s?.cod).toUpperCase()
      const pb = []
      if (!RE_COD.test(cod)) pb.push('cod invalid')
      else if (coduri.has(cod)) pb.push('cod duplicat')
      else if (!prefixe.includes(cod.split('-')[0])) pb.push('codul nu e în prefixele grupului')
      if (!estePunct(s?.p)) pb.push('poziție invalidă')
      if (!CERTITUDINI.includes(s?.cert)) pb.push('certitudine invalidă')
      if (pb.length) { erori.push(`${eticG}, sudura ${i + 1} (${cod || '?'}): ${pb.join(', ')}`); return }
      coduri.add(cod)
      suduri.push({ cod, p: s.p.slice(), cert: s.cert })
    })
    const faraPozitie = []
    ;(Array.isArray(g.fara_pozitie) ? g.fara_pozitie : []).slice(0, LIM.faraPozitie).forEach((f, i) => {
      const cod = txt(f?.cod).toUpperCase()
      if (!RE_COD.test(cod) || coduri.has(cod)) { erori.push(`${eticG}, fără poziție ${i + 1} (${cod || '?'}): cod invalid sau deja cu poziție`); return }
      coduri.add(cod)
      faraPozitie.push({ cod, motiv: txt(f?.motiv).slice(0, LIM.text) })
    })
    grupuri.push({ id, titlu: txt(g.titlu).slice(0, LIM.text) || id, prefixe, terenZ: teren, elemente, suduri, faraPozitie })
  })
  const note = (Array.isArray(json.note) ? json.note : []).slice(0, LIM.note).map(n => txt(n).slice(0, 400)).filter(Boolean)
  return { grupuri, note, titlu: txt(json.titlu).slice(0, LIM.text), erori }
}

function validElement(e) {
  if (!e || typeof e !== 'object') return 'nu e un obiect'
  const tip = txt(e.tip)
  if (!TIPURI.includes(tip)) return `tip necunoscut „${tip.slice(0, 20)}”`
  for (const k of PUNCTE[tip]) if (!estePunct(e[k])) return `punctul „${k}” lipsește sau e invalid`
  if (tip === 'eticheta') return txt(e.text) && txt(e.text).length <= LIM.text ? null : 'text lipsă sau prea lung'
  if (tip === 'rezervor') return Number.isFinite(e.d) && e.d > 0 && e.d <= 20000 ? null : 'diametru invalid'
  if (!esteDn(e.dn)) return 'DN invalid'
  if (e.dn2 != null && !esteDn(e.dn2)) return 'DN2 invalid'
  if ((tip === 'teava' || tip === 'stut' || tip === 'flansa' || tip === 'robinet' || tip === 'reductie') && lungime(e.a, e.b) < 1) return 'lungime zero'
  if (e.cert != null && !CERTITUDINI.includes(e.cert)) return 'certitudine invalidă'
  if (e.et != null && txt(e.et).length > LIM.text) return 'eticheta e prea lungă'
  return null
}
function curataElement(e) {
  const o = { tip: e.tip, cert: e.cert === 'estimat' ? 'estimat' : 'desen' }
  for (const k of PUNCTE[e.tip]) o[k] = e[k].slice()
  if (e.dn != null) o.dn = e.dn
  if (e.dn2 != null) o.dn2 = e.dn2
  if (e.d != null) o.d = e.d
  if (txt(e.et)) o.et = txt(e.et)
  if (e.tip === 'eticheta') o.text = txt(e.text)
  return o
}
export const lungime = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

// ── sudurile din BD pe pozițiile din model ──
const CHEIE_MM = 1   // sudurile la sub 1 mm una de alta = același punct (o singură sferă, cu lista lor)

/**
 * Leagă sudurile (rânduri din executie_noduri_suduri, deja filtrate) de pozițiile grupului, după cod.
 *  - grupuri: [{ cheie, p, cert, puncte: [{ sudura, certitudine }] }] — aceeași formă ca grupurile de pe vederile 2D (ListaGrup);
 *  - faraLoc: sudurile din domeniul grupului (prefixele lui) fără poziție în model (din fara_pozitie sau lipsă cu totul);
 *  - inModelFaraLista: codurile din model care nu sunt în listă (raportate, nu ascunse; ex. sudură anulată filtrată sau cod greșit).
 * `toate` = toate sudurile nodului (nefiltrate), ca un cod filtrat să nu apară ca „lipsă din listă”.
 */
export function mapeazaSuduri3d(grup, filtrate, toate = filtrate) {
  if (!grup) return { grupuri: [], faraLoc: [], inModelFaraLista: [] }
  const peCod = new Map((filtrate || []).map(s => [String(s.cod || '').toUpperCase(), s]))
  const existente = new Set((toate || []).map(s => String(s.cod || '').toUpperCase()))
  const m = new Map(), puse = new Set(), inModelFaraLista = []
  for (const sm of grup.suduri) {
    if (!existente.has(sm.cod)) { inModelFaraLista.push(sm.cod); continue }
    const s = peCod.get(sm.cod)
    if (!s) continue                                     // există, dar e scoasă de filtre
    const k = sm.p.map(c => Math.round(c / CHEIE_MM)).join('|')
    if (!m.has(k)) m.set(k, { cheie: `3d:${k}`, p: sm.p, cert: sm.cert, puncte: [] })
    const g = m.get(k)
    if (sm.cert === 'estimat') g.cert = 'estimat'
    g.puncte.push({ sudura: s, certitudine: sm.cert })
    puse.add(sm.cod)
  }
  const faraLoc = (filtrate || []).filter(s => {
    const cod = String(s.cod || '').toUpperCase()
    return grup.prefixe.includes(cod.split('-')[0]) && !puse.has(cod)
  })
  return { grupuri: [...m.values()], faraLoc, inModelFaraLista }
}

/** Culoarea sferei unui punct: o singură stare = culoarea ei; mai multe = starea cea mai puțin avansată (ordinea STARI). */
export function culoarePunct3d(grup) {
  const st = new Set(grup.puncte.map(p => p.sudura.stare))
  if (st.size === 1) return culoareStare([...st][0])
  if ([...st].some(s => !esteStare(s))) return culoareStare(null)
  return CULORI[STARI.find(s => st.has(s))]
}

// ── culorile țevilor pe DN: tonuri stinse, diferite de culorile stărilor (sferele trebuie să iasă în evidență) ──
export const CULORI_DN = {
  25: '#B07AA1', 50: '#C9ADA7', 80: '#7A9E7E', 100: '#D08C60', 150: '#4E6E95', 200: '#B5838D', 250: '#2A9D8F', 300: '#9C6644',
  400: '#6D597A', 500: '#8D99AE', 600: '#A68A64',
}
export const CULOARE_DN_ALTA = '#5E548E'
export const culoareDn = dn => CULORI_DN[dn] || CULOARE_DN_ALTA
/** DN-urile din grup (pentru legendă), descrescător. */
export const dnuriGrup = grup => [...new Set((grup?.elemente || []).map(e => e.dn).filter(Number.isInteger))].sort((a, b) => b - a)

/** Diametrul exterior (mm) după DN, pentru grosimea țevilor din schemă. DN necunoscut = aproximat cu DN-ul. */
const OD = { 15: 21.3, 20: 26.7, 25: 33.4, 32: 42.2, 40: 48.3, 50: 60.3, 65: 73, 80: 88.9, 100: 114.3, 125: 141.3, 150: 168.3, 200: 219.1, 250: 273, 300: 323.9, 350: 355.6, 400: 406.4, 450: 457, 500: 508, 600: 610, 700: 711 }
export const diametruExterior = dn => OD[dn] || dn

/** Raza sferei unei suduri (mm): vizibilă și pe țevi mici, dar nu cât să acopere vecinii. */
export const razaSfera = dn => Math.max(diametruExterior(dn || 50) * 0.5 * 1.45, 55)

/** Cutia care cuprinde elementele și sudurile grupului: { min, max, centru, marime }; null dacă grupul e gol. */
export function cutieGrup(grup) {
  const pts = []
  for (const e of grup?.elemente || []) for (const k of ['a', 'b', 'c', 'r', 'p']) if (e[k]) pts.push(e[k])
  for (const s of grup?.suduri || []) pts.push(s.p)
  if (!pts.length) return null
  const min = [0, 1, 2].map(i => Math.min(...pts.map(p => p[i]))), max = [0, 1, 2].map(i => Math.max(...pts.map(p => p[i])))
  return { min, max, centru: [0, 1, 2].map(i => (min[i] + max[i]) / 2), marime: Math.max(...[0, 1, 2].map(i => max[i] - min[i])) }
}

/** Planul modelului (x est-ish, y, z în sus) -> sistemul Three.js (y în sus), în metri. */
export const spreScena = p => [p[0] / 1000, p[2] / 1000, -p[1] / 1000]

/** „Lipsa” unui fișier din bucket (nu există încă model pentru nod) — singura eroare care ascunde butonul fără mesaj. */
export function esteObiectLipsa(err) {
  if (!err) return false
  if (err.status === 404 || String(err.statusCode) === '404') return true
  return /^(object )?not found$/i.test(txt(err.message))
}

/**
 * Atingere vs. rotire pe ecranul 3D: e „atingere” doar dacă degetul / cursorul s-a mișcat puțin și a stat puțin
 * (altfel a fost rotire / zoom și nu deschidem nicio fișă).
 */
export const esteAtingere = (jos, sus, { px = 8, ms = 600 } = {}) =>
  !!jos && !!sus && Math.hypot(sus.x - jos.x, sus.y - jos.y) <= px && sus.t - jos.t <= ms
