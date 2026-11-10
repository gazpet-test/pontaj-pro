// ═══════════════════════════════════════════════════════════════════════════
// nodSchema3dLogica.js — logica pură a schemei 3D (probă) a unui nod de cuplare (Execuție)
// Decizia lui Răzvan, 10.11.2026: varianta A — schema 3D generată din izometrii, în browser (Three.js încărcat doar la cerere).
// Modelul vine din bucket-ul noduri-scheme (<proiect>/<nod>/model_3d.json, urcat de chat, lângă vederi.json); aici: validarea lui,
// legarea sudurilor din executie_noduri_suduri de pozițiile din model (după cod), culorile pe DN și pe stare.
// Varianta B (10.11.2026): grupurile pot avea `amplasare` (opțională) și apare vederea „Toată instalația” (instalatia()).
// Fără React, fără Three.js, fără Supabase: totul se testează în vitest.
// ═══════════════════════════════════════════════════════════════════════════

import { STARI, CULORI, culoareStare, esteStare, RE_COD } from './nodCuplareLogica.js'

export const FORMAT = 'gazpet-nod-3d'
export const VERSIUNE = 1
export const TIPURI = ['teava', 'cot', 'teu', 'reductie', 'flansa', 'robinet', 'stut', 'rezervor', 'eticheta']
export const CERTITUDINI = ['desen', 'estimat']
const LIM = { grupuri: 20, elemente: 5000, suduri: 2000, faraPozitie: 2000, text: 160, note: 20, nota: 400, coord: 1e6 }
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
    const fp = Array.isArray(g.fara_pozitie) ? g.fara_pozitie : []
    if (fp.length > LIM.faraPozitie) erori.push(`${eticG}: „fără poziție” are ${fp.length} intrări; peste ${LIM.faraPozitie} nu se citesc`)
    fp.slice(0, LIM.faraPozitie).forEach((f, i) => {
      const cod = txt(f?.cod).toUpperCase()
      const pb = !RE_COD.test(cod) ? 'cod invalid' : coduri.has(cod) ? 'cod deja folosit (cu poziție sau „fără poziție”)'
        : !prefixe.includes(cod.split('-')[0]) ? 'codul nu e în prefixele grupului' : null
      if (pb) { erori.push(`${eticG}, fără poziție ${i + 1} (${cod || '?'}): ${pb}`); return }
      coduri.add(cod)
      const motiv = txt(f?.motiv)
      if (motiv.length > LIM.text) erori.push(`${eticG}, fără poziție ${i + 1} (${cod}): motivul are peste ${LIM.text} caractere (tăiat)`)
      faraPozitie.push({ cod, motiv: motiv.slice(0, LIM.text) })
    })
    const titlu = txt(g.titlu)
    if (titlu.length > LIM.text) erori.push(`${eticG}: titlul are peste ${LIM.text} caractere (tăiat)`)
    const grup = { id, titlu: titlu.slice(0, LIM.text) || id, prefixe, terenZ: teren, amplasare: null, elemente, suduri, faraPozitie }
    // amplasarea în sistemul comun al nodului (opțională): invalidă = eroare vizibilă, grupul rămâne doar în vederea lui (L12)
    const am = citesteAmplasare(g.amplasare)
    const pbAm = am.eroare || (am.amplasare && !punctePastrate(grup, am.amplasare) ? 'amplasarea scoate grupul în afara ±1 km' : null)
    if (pbAm) erori.push(`${eticG}: ${pbAm}; grupul nu apare în „Toată instalația”, doar în vederea lui`)
    else grup.amplasare = am.amplasare
    grupuri.push(grup)
  })
  const note = Array.isArray(json.note) ? json.note : []
  if (note.length > LIM.note) erori.push(`Modelul are ${note.length} note; peste ${LIM.note} nu se afișează`)
  const noteCitite = note.slice(0, LIM.note).map(txt)
  noteCitite.forEach((n, i) => { if (n.length > LIM.nota) erori.push(`Nota ${i + 1} are peste ${LIM.nota} caractere (tăiată)`) })
  const titlu = txt(json.titlu)
  if (titlu.length > LIM.text) erori.push(`Titlul modelului are peste ${LIM.text} caractere (tăiat)`)
  return { grupuri, note: noteCitite.map(n => n.slice(0, LIM.nota)).filter(Boolean), titlu: titlu.slice(0, LIM.text), erori }
}

function validElement(e) {
  if (!e || typeof e !== 'object') return 'nu e un obiect'
  const tip = txt(e.tip)
  if (!TIPURI.includes(tip)) return `tip necunoscut „${tip.slice(0, 20)}”`
  for (const k of PUNCTE[tip]) if (!estePunct(e[k])) return `punctul „${k}” lipsește sau e invalid`
  if (tip === 'eticheta') return txt(e.text) && txt(e.text).length <= LIM.text ? null : 'text lipsă sau prea lung'
  if (tip === 'rezervor') return Number.isFinite(e.d) && e.d > 0 && e.d <= 20000 ? null : 'diametru invalid'
  if (!esteDn(e.dn)) return 'DN invalid'
  if (tip === 'reductie' && e.dn2 == null) return 'reducția nu are DN2'
  if (e.dn2 != null && !esteDn(e.dn2)) return 'DN2 invalid'
  if ((tip === 'teava' || tip === 'stut' || tip === 'flansa' || tip === 'robinet' || tip === 'reductie') && lungime(e.a, e.b) < 1) return 'lungime zero'
  if (e.cert != null && !CERTITUDINI.includes(e.cert)) return 'certitudine invalidă'
  if (e.et != null && txt(e.et).length > LIM.text) return 'eticheta e prea lungă'
  return null
}
function curataElement(e) {
  const tip = txt(e.tip)                // același tip normalizat ca la validare
  const o = { tip, cert: e.cert === 'estimat' ? 'estimat' : 'desen' }
  for (const k of PUNCTE[tip]) o[k] = e[k].slice()
  if (e.dn != null) o.dn = e.dn
  if (e.dn2 != null) o.dn2 = e.dn2
  if (e.d != null) o.d = e.d
  if (txt(e.et)) o.et = txt(e.et)
  if (tip === 'eticheta') o.text = txt(e.text)
  return o
}
export const lungime = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

// ── amplasarea grupurilor în sistemul comun al nodului (varianta B, 10.11.2026) ──
// `amplasare: { origine: [x, y, z], rot_z: grade }` pe grup = unde ajunge originea grupului în sistemul comun și rotirea lui în
// jurul axei z (sens trigonometric). Câmp opțional: modelele fără el se comportă exact ca înainte (versiune: 1 rămâne).
const CHEI_AMPLASARE = ['origine', 'rot_z']

/** Validarea strictă a amplasării. Lipsă / null = fără amplasare (fără eroare). Întoarce { amplasare: { origine, rotZ } | null, eroare }. */
export function citesteAmplasare(a) {
  const nu = eroare => ({ amplasare: null, eroare })
  if (a == null) return nu(null)
  if (typeof a !== 'object' || Array.isArray(a)) return nu('amplasarea nu e un obiect')
  const necunoscute = Object.keys(a).filter(k => !CHEI_AMPLASARE.includes(k))
  if (necunoscute.length) return nu(`amplasarea are câmpuri necunoscute (${necunoscute.join(', ').slice(0, 60)})`)
  if (!estePunct(a.origine)) return nu('originea amplasării lipsește sau e invalidă (3 numere, în ±1 km)')
  if (!(typeof a.rot_z === 'number' && Number.isFinite(a.rot_z) && Math.abs(a.rot_z) <= 360)) return nu('rot_z lipsește sau nu e un număr între -360 și 360')
  return { amplasare: { origine: a.origine.slice(), rotZ: a.rot_z }, eroare: null }
}

/** cos / sin pentru rotirea în grade; multiplii de 90° sunt exacți (fără 6e-17 care ar decala sudurile „în același loc”). */
function cosSin(grade) {
  const n = ((grade % 360) + 360) % 360
  const exact = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[n]
  if (exact) return exact
  const t = (n * Math.PI) / 180
  return [Math.cos(t), Math.sin(t)]
}

/** Punctul din sistemul grupului -> sistemul comun: întâi rotirea în jurul lui z (în originea grupului), apoi translația. */
export function transformaPunct(p, amplasare) {
  if (!amplasare) return p.slice()
  const [c, s] = cosSin(amplasare.rotZ), o = amplasare.origine
  return [p[0] * c - p[1] * s + o[0], p[0] * s + p[1] * c + o[1], p[2] + o[2]]
}

/** Toate punctele grupului rămân, după amplasare, în limitele modelului (±1 km)? */
function punctePastrate(grup, amplasare) {
  for (const e of grup.elemente) for (const k of PUNCTE[e.tip]) if (!estePunct(transformaPunct(e[k], amplasare))) return false
  for (const s of grup.suduri) if (!estePunct(transformaPunct(s.p, amplasare))) return false
  return true
}

/** Grupul cu toate punctele (piese și suduri) mutate în sistemul comun. Grupul fără amplasare iese neschimbat (copie). */
export function aplicaAmplasare(grup) {
  const T = p => transformaPunct(p, grup.amplasare)
  const elemente = grup.elemente.map(e => {
    const o = { ...e }
    for (const k of PUNCTE[e.tip]) o[k] = T(e[k])
    return o
  })
  return { ...grup, elemente, suduri: grup.suduri.map(s => ({ ...s, p: T(s.p) })) }
}

export const ID_INSTALATIE = '_instalatie'      // nu poate fi id de grup (RE_ID cere literă / cifră la început)

/**
 * Vederea „Toată instalația”: toate grupurile cu amplasare validă, mutate în sistemul comun, cu terenul comun la z = 0.
 * Există doar dacă cel puțin DOUĂ grupuri sunt amplasate (altfel null). Are aceeași formă ca un grup (prefixe, elemente, suduri =
 * reuniunea), ca maparea și scena să meargă la fel, plus `parti` (grupurile, pentru ascundere / „du-mă la”) și `neamplasate`.
 */
export function instalatia(model) {
  const toate = model?.grupuri || []
  const amplasate = toate.filter(g => g.amplasare)
  if (amplasate.length < 2) return null
  const parti = amplasate.map(aplicaAmplasare)
  return {
    id: ID_INSTALATIE, titlu: 'Toată instalația', terenZ: 0, amplasare: null,
    prefixe: [...new Set(parti.flatMap(p => p.prefixe))],
    elemente: parti.flatMap(p => p.elemente),
    suduri: parti.flatMap(p => p.suduri),
    faraPozitie: parti.flatMap(p => p.faraPozitie),
    parti: parti.map(p => ({ id: p.id, titlu: p.titlu, prefixe: p.prefixe, elemente: p.elemente, suduri: p.suduri })),
    neamplasate: toate.filter(g => !g.amplasare).map(g => ({ id: g.id, titlu: g.titlu })),
  }
}

// ── sudurile din BD pe pozițiile din model ──
export const PRAG_MM = 1   // două suduri la cel mult 1 mm una de alta = același loc (o singură sferă, cu lista lor)

/**
 * Locurile sudurilor din model (TOATE, nefiltrate): două suduri la ≤ PRAG_MM (distanța reală 3D, nu rotunjire) sunt în același loc,
 * iar legătura e tranzitivă (lanț de vecini). Cheia locului = cel mai mic cod din el, poziția = a primei suduri din model:
 * nu depind de filtre sau de ordinea din listă. Întoarce Map cod -> { cheie, p }.
 * Vecinii se caută pe o grilă (doar celulele alăturate), nu fiecare cu fiecare: în vederea comună sunt sudurile tuturor
 * grupurilor. Rădăcina unui loc rămâne cel mai mic indice (unirea leagă mereu indicele mare de cel mic).
 * Paritate EXACTĂ cu varianta fiecare-cu-fiecare (review r1): aceeași comparație (`aproape`, cu Math.hypot și rotunjirile lui),
 * iar latura celulei e 2 × PRAG_MM, nu PRAG_MM. Cu latura PRAG_MM, [0.9999999999999999, 0, 0] și [2, 0, 0] (hypot rotunjit = 1)
 * cădeau în celulele 0 și 2, deci nu se mai comparau. Orice pereche cu hypot ≤ PRAG_MM are diferența REALĂ pe fiecare axă cu mult
 * sub 2 × PRAG_MM (eroarea scăderii la ±2 km e ~1e-10 mm), deci celulele ei diferă cu cel mult 1 pe fiecare axă (v / 2 e exact).
 */
const LATURA_GRILA = 2 * PRAG_MM
const aproape = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= PRAG_MM
export function punctePeCod(suduri) {
  const l = suduri || [], par = l.map((_, i) => i)
  const rad = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i] } return i }
  const grila = new Map()
  l.forEach((s, j) => {
    const c = s.p.map(v => Math.floor(v / LATURA_GRILA))
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const i of grila.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) || []) {
        if (aproape(l[i].p, s.p)) { const x = rad(i), y = rad(j); if (x !== y) par[Math.max(x, y)] = Math.min(x, y) }
      }
    }
    const k = c.join(',')
    if (!grila.has(k)) grila.set(k, [])
    grila.get(k).push(j)
  })
  const loc = new Map()
  l.forEach((s, i) => {
    const r = rad(i)
    if (!loc.has(r)) loc.set(r, { cheie: null, p: l[r].p, coduri: [] })
    loc.get(r).coduri.push(s.cod)
  })
  for (const v of loc.values()) v.cheie = `3d:${[...v.coduri].sort()[0]}`
  const pe = new Map()
  l.forEach((s, i) => { const v = loc.get(rad(i)); pe.set(s.cod, { cheie: v.cheie, p: v.p }) })
  return pe
}

/**
 * Leagă sudurile (rânduri din executie_noduri_suduri, deja filtrate) de pozițiile grupului, după cod.
 *  - grupuri: [{ cheie, p, cert, puncte: [{ sudura, certitudine }] }] — aceeași formă ca grupurile de pe vederile 2D (ListaGrup);
 *  - faraLoc: sudurile din domeniul grupului (prefixele lui) fără poziție în model (din fara_pozitie sau lipsă cu totul);
 *  - inModelFaraLista: codurile din model care nu sunt în listă (raportate, nu ascunse; ex. sudură anulată filtrată sau cod greșit).
 * `toate` = toate sudurile nodului (nefiltrate), ca un cod filtrat să nu apară ca „lipsă din listă”.
 * În vederea comună (`grup.parti`, din instalatia()) aceeași mapare rulează pe reuniune: un cod apare o singură dată (codurile sunt
 * unice în tot modelul), iar fiecare loc primește `parti` = grupurile din care vin sudurile lui (pentru ascunderea pe grup).
 */
export function mapeazaSuduri3d(grup, filtrate, toate = filtrate) {
  if (!grup) return { grupuri: [], faraLoc: [], inModelFaraLista: [] }
  const peCod = new Map((filtrate || []).map(s => [String(s.cod || '').toUpperCase(), s]))
  const existente = new Set((toate || []).map(s => String(s.cod || '').toUpperCase()))
  const parteDe = grup.parti ? new Map(grup.parti.flatMap(p => p.suduri.map(s => [s.cod, p.id]))) : null
  const m = new Map(), puse = new Set(), inModelFaraLista = []
  const ancore = punctePeCod(grup.suduri)
  for (const sm of grup.suduri) {
    if (!existente.has(sm.cod)) { inModelFaraLista.push(sm.cod); continue }
    const s = peCod.get(sm.cod)
    if (!s) continue                                     // există, dar e scoasă de filtre
    const a = ancore.get(sm.cod)
    if (!m.has(a.cheie)) m.set(a.cheie, { cheie: a.cheie, p: a.p, cert: sm.cert, puncte: [], ...(parteDe ? { parti: [] } : {}) })
    const g = m.get(a.cheie)
    if (sm.cert === 'estimat') g.cert = 'estimat'
    g.puncte.push({ sudura: s, certitudine: sm.cert })
    if (parteDe && !g.parti.includes(parteDe.get(sm.cod))) g.parti.push(parteDe.get(sm.cod))
    puse.add(sm.cod)
  }
  const faraLoc = (filtrate || []).filter(s => {
    const cod = String(s.cod || '').toUpperCase()
    return grup.prefixe.includes(cod.split('-')[0]) && !puse.has(cod)
  })
  return { grupuri: [...m.values()], faraLoc, inModelFaraLista }
}

/** Locurile care se văd când unele grupuri sunt ascunse (vederea comună): un loc se vede dacă vine din cel puțin un grup vizibil. */
export function puncteVizibile(locuri, ascunse) {
  if (!ascunse || !ascunse.size) return locuri || []
  return (locuri || []).filter(l => !l.parti || l.parti.some(id => !ascunse.has(id)))
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
  // buclă, nu Math.min(...pts): în vederea comună pot fi zeci de mii de puncte (spread-ul mare dă RangeError)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i] }
  return { min, max, centru: [0, 1, 2].map(i => (min[i] + max[i]) / 2), marime: Math.max(...[0, 1, 2].map(i => max[i] - min[i])) }
}

/**
 * Planul îndepărtat al camerei (m), din distanța camerei la centrul scenei și raza sferei care cuprinde scena: tot ce e în scenă
 * rămâne înaintea lui, oricât de depărtate sunt grupurile și oricât s-a dat zoom înapoi (review r1: la ±900 m dispăreau piesele).
 * Cel puțin 1000 m = proiecția de dinainte, neschimbată pentru nodurile obișnuite. Intrări nefinite = tot 1000 (nu NaN în cameră).
 */
export const DEPARTARE_MIN = 1000
export function departareCamera(dist, raza) {
  const d = (dist + raza) * 1.05
  return Number.isFinite(d) && d > DEPARTARE_MIN ? d : DEPARTARE_MIN
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
  !!jos && !!sus && Math.max(jos.max || 0, Math.hypot(sus.x - jos.x, sus.y - jos.y)) <= px && sus.t - jos.t <= ms
/** Începutul unui gest (un deget / cursorul apăsat). `max` = cea mai mare depărtare de punctul de start pe parcurs. */
export const gestNou = (x, y, t) => ({ x, y, t, max: 0 })
/** Mișcarea din timpul gestului: o rotire care se întoarce lângă start NU mai e atingere (depărtarea maximă rămâne). */
export const gestMisca = (g, x, y) => (g ? { ...g, max: Math.max(g.max || 0, Math.hypot(x - g.x, y - g.y)) } : g)
