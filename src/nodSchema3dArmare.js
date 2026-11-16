// ═══════════════════════════════════════════════════════════════════════════
// nodSchema3dArmare.js — betonul, armăturile și piesele înglobate din schema 3D (Izometrie, 16.11.2026)
// Extensie compatibilă înapoi a formatului „gazpet-nod-3d” versiunea 1 (modelele vechi se citesc și se desenează exact ca înainte):
//  - tipuri noi de element: `bara` (polilinie cu diametrul REAL, îndoiri la orice unghi, marcă), `beton` (cutie; treptele = mai
//    multe cutii), `bulon` și `placa` (piese înglobate, separate de armătură);
//  - blocul opțional `armare` pe grup: mărcile din extras (Ø, oțel, bucăți, lungime), starea listei, punctele de confirmat,
//    greutatea totală din extras (pentru rândul de control „desenat față de extras”).
// Aici: validarea strictă (nimic nu se completează în tăcere: lipsă / imposibil = eroare, elementul nu se afișează), traseul în ax
// cu îndoirile rotunjite, lungimea „ca în extras”, greutatea, legenda pe mărci. Fără React, fără Three.js: se testează în vitest.
// Nu importă din nodSchema3dLogica.js (acela importă de aici).
// ═══════════════════════════════════════════════════════════════════════════

export const TIPURI_ARMARE = ['bara', 'beton', 'bulon', 'placa']
export const STARI_LISTA = ['neconfirmata', 'confirmata']
export const DENSITATE_OTEL = 7850            // kg/m³
export const TOL_MM = 0.5                     // toleranța la „încape raza de îndoire pe segment” (coordonate rotunjite la 0,01 mm)
export const UNGHI_MAX = 179                  // grade: peste el bara s-ar întoarce pe ea însăși
export const PRAG_CONTROL_PROC = 2            // |greutate desenată / extras − 1| ≤ 2% = în regulă
const LIM = { dMin: 4, dMax: 60, r: 2000, puncte: 200, dim: 100000, buc: 100000, lungime: 50000, kgm: 50, marci: 100, deConfirmat: 20, text: 160, nota: 400, coord: 1e6 }
const RE_MARCA = /^[A-Za-z0-9][A-Za-z0-9.-]{0,11}$/
const CERT = ['desen', 'estimat']

const txt = v => (v == null ? '' : String(v).trim())
const estePunct = p => Array.isArray(p) && p.length === 3 && p.every(c => typeof c === 'number' && Number.isFinite(c) && Math.abs(c) <= LIM.coord)
const intre = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const pozitiv = (v, max) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max
/** Marca: text sau număr întreg (1 -> "1"); orice altceva = gol (eroare la validare). */
export const textMarca = v => (typeof v === 'number' && Number.isInteger(v) ? String(v) : typeof v === 'string' ? v.trim() : '')

// ── vectori mici (array-uri de 3) ──
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const plus = (a, b, k = 1) => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const lung = a => Math.hypot(a[0], a[1], a[2])
const unit = a => { const l = lung(a); return [a[0] / l, a[1] / l, a[2] / l] }
const limiteaza = x => Math.max(-1, Math.min(1, x))
/** Unghiul de îndoire (radiani) în vârful dintre segmentele u1 -> u2 (0 = drept înainte, π = întoarcere completă). */
const unghi = (u1, u2) => Math.acos(limiteaza(dot(u1, u2)))

/**
 * Verificarea traseului unei bare / unui bulon (puncte = vârfurile „ascuțite”, în axul barei; r = raza de îndoire în ax).
 * Respinge: sub 2 puncte, punct invalid, segment sub 1 mm, unghi peste UNGHI_MAX (bara se întoarce pe ea însăși), raza care nu
 * încape pe segment (îndoirile de la cele două capete ale segmentului îi cer mai mult decât lungimea lui). Întoarce motivul sau null.
 */
export function verificaTraseu(puncte, r) {
  if (!Array.isArray(puncte) || puncte.length < 2) return 'traseul are nevoie de cel puțin 2 puncte'
  if (puncte.length > LIM.puncte) return `traseul are peste ${LIM.puncte} de puncte`
  for (let i = 0; i < puncte.length; i++) if (!estePunct(puncte[i])) return `punctul ${i + 1} al traseului lipsește sau e invalid`
  const seg = [], dir = []
  for (let i = 1; i < puncte.length; i++) {
    const v = sub(puncte[i], puncte[i - 1]), l = lung(v)
    if (l < 1) return `segmentul ${i} (punctele ${i}–${i + 1}) are sub 1 mm`
    seg.push(l); dir.push(unit(v))
  }
  const t = [0]                                    // cât „mănâncă” îndoirea din fiecare segment alăturat vârfului
  for (let i = 1; i < puncte.length - 1; i++) {
    const th = unghi(dir[i - 1], dir[i])
    const grade = (th * 180) / Math.PI
    if (grade > UNGHI_MAX) return `unghi imposibil la punctul ${i + 1}: bara se întoarce pe ea însăși (${Math.round(grade)}°)`
    t.push(r * Math.tan(th / 2))
  }
  t.push(0)
  for (let i = 0; i < seg.length; i++) {
    if (t[i] + t[i + 1] > seg[i] + TOL_MM) {
      return `raza de îndoire (${r} mm) nu încape pe segmentul ${i + 1}: îndoirile cer ${Math.round(t[i] + t[i + 1])} mm, segmentul are ${Math.round(seg[i])} mm`
    }
  }
  return null
}

/** Validarea unui element de tip nou. `marci` = Map marca -> marca validă din blocul `armare` al grupului. Motivul sau null. */
export function validElementArmare(e, tip, marci) {
  if (e.cert != null && !CERT.includes(e.cert)) return 'certitudine invalidă'
  if (e.et != null && txt(e.et).length > LIM.text) return 'eticheta e prea lungă'
  if (tip === 'bara' || tip === 'bulon') {
    if (tip === 'bara') {
      const m = textMarca(e.marca)
      if (!m) return 'marca lipsește'
      if (!RE_MARCA.test(m)) return `marca „${m.slice(0, 12)}” e invalidă`
      if (!marci.has(m)) return `marca „${m}” nu e în lista mărcilor grupului (blocul „armare”)`
      if (e.d == null) return 'diametrul barei lipsește'
      if (!intre(e.d, LIM.dMin, LIM.dMax)) return `diametru invalid (între ${LIM.dMin} și ${LIM.dMax} mm)`
      if (e.d !== marci.get(m).d) return `diametrul (Ø${e.d}) nu e al mărcii ${m} (Ø${marci.get(m).d})`
    } else {
      if (e.d == null) return 'diametrul bulonului lipsește'
      if (!intre(e.d, LIM.dMin, LIM.dMax)) return `diametru invalid (între ${LIM.dMin} și ${LIM.dMax} mm)`
    }
    if (e.r == null) return 'raza de îndoire lipsește (0 = colț fără rază)'
    if (!intre(e.r, 0, LIM.r)) return `raza de îndoire invalidă (între 0 și ${LIM.r} mm)`
    return verificaTraseu(e.puncte, e.r)
  }
  if (tip === 'beton') {
    if (!estePunct(e.min) || !estePunct(e.max)) return 'colțurile „min” / „max” lipsesc sau sunt invalide'
    for (let i = 0; i < 3; i++) {
      const l = e.max[i] - e.min[i]
      if (!(l >= 1)) return `cutia de beton e goală sau întoarsă pe axa ${'xyz'[i]} (max − min = ${Math.round(l)} mm)`
      if (l > LIM.dim) return `cutia de beton depășește ${LIM.dim / 1000} m pe axa ${'xyz'[i]}`
    }
    return null
  }
  if (tip === 'placa') {
    if (!estePunct(e.centru)) return 'centrul plăcii lipsește sau e invalid'
    for (const k of ['lx', 'ly', 'grosime']) if (!pozitiv(e[k], LIM.dim)) return `„${k}” lipsește sau e invalid (mm, peste 0)`
    if (e.gol != null && !(pozitiv(e.gol, LIM.dim) && e.gol < Math.min(e.lx, e.ly))) return 'golul plăcii e invalid (diametru peste 0, mai mic decât latura)'
    return null
  }
  return `tip necunoscut „${tip}”`
}

/** Elementul curățat (forma internă). Betonul și placa primesc centru + rotZ, ca amplasarea grupului să le poată roti. */
export function curataElementArmare(e, tip) {
  const o = { tip, cert: e.cert === 'estimat' ? 'estimat' : 'desen' }
  if (txt(e.et)) o.et = txt(e.et)
  if (tip === 'bara' || tip === 'bulon') {
    if (tip === 'bara') o.marca = textMarca(e.marca)
    o.d = e.d; o.r = e.r
    o.puncte = e.puncte.map(p => p.slice())
  } else if (tip === 'beton') {
    o.centru = [0, 1, 2].map(i => (e.min[i] + e.max[i]) / 2)
    o.dim = [0, 1, 2].map(i => e.max[i] - e.min[i])
    o.rotZ = 0
  } else if (tip === 'placa') {
    o.centru = e.centru.slice(); o.lx = e.lx; o.ly = e.ly; o.grosime = e.grosime; o.gol = e.gol == null ? null : e.gol
    o.rotZ = 0
  }
  return o
}

// ── blocul `armare` al grupului ──
const CHEI_ARMARE = ['stare_lista', 'de_confirmat', 'marci', 'extras_kg', 'extras_sursa']
const CHEI_MARCA = ['marca', 'd', 'otel', 'buc', 'lungime_mm', 'kg_m', 'forma']

/**
 * Validarea blocului `armare`. Lipsă / null = fără armare (fără eroare). Structură greșită = armare null + eroare (barele grupului
 * ies apoi ca „marcă necunoscută”, deci vizibile ca erori). O marcă invalidă = eroare pe ea, restul rămân. Textele prea lungi se
 * raportează (nu se taie în tăcere). Întoarce { armare, erori }.
 */
export function citesteArmare(a) {
  const erori = []
  if (a == null) return { armare: null, erori }
  const nu = m => ({ armare: null, erori: [`armarea grupului: ${m}; barele grupului nu se afișează`] })
  if (typeof a !== 'object' || Array.isArray(a)) return nu('nu e un obiect')
  const necunoscute = Object.keys(a).filter(k => !CHEI_ARMARE.includes(k))
  if (necunoscute.length) return nu(`câmpuri necunoscute (${necunoscute.join(', ').slice(0, 60)})`)
  if (!STARI_LISTA.includes(a.stare_lista)) return nu('„stare_lista” trebuie să fie „neconfirmata” sau „confirmata”')
  if (!Array.isArray(a.marci) || !a.marci.length) return nu('lista mărcilor lipsește sau e goală')
  if (a.marci.length > LIM.marci) return nu(`are peste ${LIM.marci} de mărci`)
  if (a.extras_kg != null && !pozitiv(a.extras_kg, 1e7)) return nu('„extras_kg” trebuie să fie un număr peste 0')
  if (a.de_confirmat != null && !Array.isArray(a.de_confirmat)) return nu('„de_confirmat” trebuie să fie o listă de texte')
  const marci = [], vazute = new Set()
  a.marci.forEach((m, i) => {
    const et = `armarea grupului, marca ${i + 1} (${textMarca(m?.marca).slice(0, 12) || '?'})`
    if (!m || typeof m !== 'object' || Array.isArray(m)) { erori.push(`${et}: nu e un obiect`); return }
    const nec = Object.keys(m).filter(k => !CHEI_MARCA.includes(k))
    const id = textMarca(m.marca)
    const pb = nec.length ? `câmpuri necunoscute (${nec.join(', ').slice(0, 60)})`
      : !id ? 'marca lipsește'
      : !RE_MARCA.test(id) ? 'marca e invalidă (litere, cifre, punct sau minus; cel mult 12)'
      : vazute.has(id) ? 'marcă duplicată'
      : m.d == null ? 'diametrul lipsește'
      : !intre(m.d, LIM.dMin, LIM.dMax) ? `diametru invalid (între ${LIM.dMin} și ${LIM.dMax} mm)`
      : !txt(m.otel) || txt(m.otel).length > 20 ? 'oțelul lipsește sau e prea lung'
      : !(Number.isInteger(m.buc) && m.buc >= 1 && m.buc <= LIM.buc) ? 'numărul de bucăți lipsește sau nu e un întreg peste 0'
      : !pozitiv(m.lungime_mm, LIM.lungime) ? 'lungimea (lungime_mm) lipsește sau e invalidă'
      : m.kg_m != null && !pozitiv(m.kg_m, LIM.kgm) ? '„kg_m” e invalid'
      : m.forma != null && txt(m.forma).length > LIM.text ? 'forma e prea lungă'
      : null
    if (pb) { erori.push(`${et}: ${pb}; marca nu se afișează`); return }
    vazute.add(id)
    marci.push({ marca: id, d: m.d, otel: txt(m.otel), buc: m.buc, lungimeMm: m.lungime_mm, kgM: m.kg_m == null ? null : m.kg_m, forma: txt(m.forma) })
  })
  const dc = a.de_confirmat || []
  if (dc.length > LIM.deConfirmat) erori.push(`armarea grupului: „de_confirmat” are ${dc.length} puncte; peste ${LIM.deConfirmat} nu se afișează`)
  const deConfirmat = []
  dc.slice(0, LIM.deConfirmat).forEach((x, i) => {
    const t = txt(x)
    if (!t) { erori.push(`armarea grupului: punctul de confirmat ${i + 1} e gol`); return }
    if (t.length > LIM.nota) erori.push(`armarea grupului: punctul de confirmat ${i + 1} are peste ${LIM.nota} caractere (tăiat)`)
    deConfirmat.push(t.slice(0, LIM.nota))
  })
  const sursa = txt(a.extras_sursa)
  if (sursa.length > LIM.text) erori.push(`armarea grupului: sursa extrasului are peste ${LIM.text} caractere (tăiată)`)
  return {
    armare: { stareLista: a.stare_lista, deConfirmat, marci, extrasKg: a.extras_kg == null ? null : a.extras_kg, extrasSursa: sursa.slice(0, LIM.text) },
    erori,
  }
}

// ── geometrie ──
function cosSin(grade) {
  const n = ((grade % 360) + 360) % 360
  const exact = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[n]
  if (exact) return exact
  const t = (n * Math.PI) / 180
  return [Math.cos(t), Math.sin(t)]
}
/** Colțurile unei cutii (centru, dimensiuni pe x / y, z de la z0 la z1), rotite cu rotZ în jurul centrului. */
function colturi(c, lx, ly, z0, z1, rotZ) {
  const [co, si] = cosSin(rotZ), out = []
  for (const z of [z0, z1]) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = (sx * lx) / 2, y = (sy * ly) / 2
    out.push([c[0] + x * co - y * si, c[1] + x * si + y * co, z])
  }
  return out
}
/** Punctele care descriu un element nou (pentru cutia grupului, încadrare și limita de ±1 km după amplasare). */
export function puncteArmare(e) {
  if (e.tip === 'bara' || e.tip === 'bulon') return e.puncte
  if (e.tip === 'beton') return colturi(e.centru, e.dim[0], e.dim[1], e.centru[2] - e.dim[2] / 2, e.centru[2] + e.dim[2] / 2, e.rotZ)
  if (e.tip === 'placa') return colturi(e.centru, e.lx, e.ly, e.centru[2], e.centru[2] + e.grosime, e.rotZ)
  return []
}
/** Elementul mutat în sistemul comun: T = transformarea punctelor, rotZ = rotirea amplasării (grade). */
export function transformaArmare(e, T, rotZ) {
  if (e.tip === 'bara' || e.tip === 'bulon') return { ...e, puncte: e.puncte.map(T) }
  return { ...e, centru: T(e.centru), rotZ: e.rotZ + rotZ }
}

/**
 * Traseul în ax al unei bare: vârfurile „ascuțite”, cu fiecare îndoire înlocuită de un arc de rază r (pași de cel mult 15°).
 * r = 0 sau segmente coliniare = vârful rămâne. Puncte consecutive la sub 0,01 mm se unesc.
 */
export function traseuBara(P, r) {
  const out = [P[0].slice()]
  for (let i = 1; i < P.length - 1; i++) {
    const u1 = unit(sub(P[i], P[i - 1])), u2 = unit(sub(P[i + 1], P[i]))
    const th = unghi(u1, u2)
    if (th < 1e-3 || !(r > 0)) { out.push(P[i].slice()); continue }
    const t = r * Math.tan(th / 2), T1 = plus(P[i], u1, -t)
    const n = unit(plus(u2, u1, -dot(u1, u2)))        // în planul îndoirii, perpendicular pe u1, spre u2
    const C = plus(T1, n, r)                          // centrul arcului
    const N = Math.max(3, Math.round(th / (Math.PI / 12)))
    for (let k = 0; k <= N; k++) {
      const f = (th * k) / N
      out.push(plus(plus(C, n, -r * Math.cos(f)), u1, r * Math.sin(f)))
    }
  }
  out.push(P[P.length - 1].slice())
  return out.filter((p, i) => i === 0 || lung(sub(p, out[i - 1])) > 0.01)
}
export const lungimeTraseu = pts => pts.reduce((s, p, i) => (i ? s + lung(sub(p, pts[i - 1])) : 0), 0)

/**
 * Lungimea unei bare „ca în extras”: suma laturilor măsurate pe exterior = fiecare segment în ax + d/2 la fiecare capăt care e
 * îndoit (vârf interior cu unghi). Capetele libere nu primesc nimic. Convenția planșelor de armare (laturile cotate pe exterior).
 */
export function lungimeExtras(P, d) {
  let s = 0
  const indoit = i => i > 0 && i < P.length - 1 && unghi(unit(sub(P[i], P[i - 1])), unit(sub(P[i + 1], P[i]))) >= 1e-3
  for (let i = 1; i < P.length; i++) s += lung(sub(P[i], P[i - 1])) + (indoit(i - 1) ? d / 2 : 0) + (indoit(i) ? d / 2 : 0)
  return s
}
/** Greutatea (kg) a unei bare de lungime L (mm) și diametru d (mm), la densitatea oțelului. */
export const masaBara = (L, d) => (L * Math.PI * d * d * DENSITATE_OTEL) / 4 / 1e9

// ── culori: pe marcă (după ordinea din extras) sau pe diametru; tonuri diferite de culorile stărilor sudurilor ──
export const CULORI_MARCA = ['#2F6FD0', '#E07B1A', '#1F9D55', '#C2185B', '#7B61FF', '#00838F', '#B8860B', '#6D4C41', '#5C6BC0', '#9E9D24']
export const culoareMarca = i => CULORI_MARCA[((i % CULORI_MARCA.length) + CULORI_MARCA.length) % CULORI_MARCA.length]
export const CULORI_DIAMETRU = {
  6: '#8D6E63', 8: '#2A9D8F', 10: '#3F51B5', 12: '#F4A261', 14: '#B23A48', 16: '#6A4C93', 18: '#1982C4', 20: '#8AC926',
  22: '#FF595E', 25: '#FFCA3A', 28: '#4D908E', 32: '#C9184A', 36: '#577590', 40: '#F3722C',
}
export const CULOARE_DIAMETRU_ALTA = '#9E9E9E'
export const culoareDiametru = d => CULORI_DIAMETRU[d] || CULOARE_DIAMETRU_ALTA

/**
 * Legenda și controlul armăturii unui grup cu bloc `armare` (null fără el). Pe fiecare marcă: bucățile desenate față de extras,
 * lungimea desenată (min / max, ca în extras) față de extras, greutatea desenată (lungime × densitate × secțiune); totalul și,
 * dacă modelul are greutatea din extras, diferența procentuală. Barele unei mărci care NU e în listă nu există (validarea le respinge).
 */
export function controlArmare(grup) {
  const ar = grup?.armare
  if (!ar) return null
  const bare = (grup.elemente || []).filter(e => e.tip === 'bara')
  const marci = ar.marci.map((m, i) => {
    const l = bare.filter(b => b.marca === m.marca)
    const lungimi = l.map(b => lungimeExtras(b.puncte, b.d))
    const kgDesen = lungimi.reduce((s, x) => s + masaBara(x, m.d), 0)
    const lungimeMin = lungimi.length ? Math.min(...lungimi) : null
    const lungimeMax = lungimi.length ? Math.max(...lungimi) : null
    return {
      marca: m.marca, d: m.d, otel: m.otel, forma: m.forma,
      bucExtras: m.buc, bucDesen: l.length, bucOk: l.length === m.buc,
      lungimeExtras: m.lungimeMm, lungimeMin, lungimeMax,
      lungimeOk: lungimi.length > 0 && Math.abs(lungimeMin - m.lungimeMm) <= 1 && Math.abs(lungimeMax - m.lungimeMm) <= 1,
      kgDesen, kgExtras: m.kgM == null ? null : (m.buc * m.lungimeMm * m.kgM) / 1000,
      estimate: l.filter(b => b.cert === 'estimat').length,
      culoare: culoareMarca(i), culoareD: culoareDiametru(m.d),
    }
  })
  const kgDesen = marci.reduce((s, m) => s + m.kgDesen, 0)
  const diferentaProc = ar.extrasKg ? (kgDesen / ar.extrasKg - 1) * 100 : null
  return {
    stareLista: ar.stareLista, deConfirmat: ar.deConfirmat, extrasSursa: ar.extrasSursa,
    marci, kgDesen, extrasKg: ar.extrasKg, diferentaProc,
    controlOk: diferentaProc == null ? null : Math.abs(diferentaProc) <= PRAG_CONTROL_PROC,
    bucDesen: marci.reduce((s, m) => s + m.bucDesen, 0), bucExtras: marci.reduce((s, m) => s + m.bucExtras, 0),
  }
}

/** Ce are grupul în afară de țevi (pentru butoanele și legenda din ecran): beton, piese înglobate, bare. */
export function continutArmare(grup) {
  const el = grup?.elemente || []
  const n = t => el.filter(e => e.tip === t).length
  const beton = el.filter(e => e.tip === 'beton')
  return {
    bare: n('bara'), beton: beton.length, buloane: n('bulon'), placi: n('placa'),
    numeBeton: [...new Set(beton.map(e => e.et).filter(Boolean))],
    betonEstimat: beton.some(e => e.cert === 'estimat'),
    inglobateEstimate: el.filter(e => (e.tip === 'bulon' || e.tip === 'placa') && e.cert === 'estimat').length,
    diametreBuloane: [...new Set(el.filter(e => e.tip === 'bulon').map(e => e.d))].sort((a, b) => a - b),
  }
}
