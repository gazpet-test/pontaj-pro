// Harta AI — logica pură a desenatorului (06.11.2026, cerere Răzvan). Fără React, fără Supabase, fără date.
// Datele (noduri, legături, fluxuri, grupuri) NU stau în repo: repo-ul e public, iar harta descrie infrastructura internă.
// Formatul e descris în docs/HARTA_AI.md; exemplul generic e în scripts/harta_ai/exemplu.json.

export const NOD_L = 176
export const NOD_H = 50
const PAS_Y = 64
const ANTET_GRUP = 44

export const TIPURI_NOD = {
  om: ['👤', 'Om'],
  poarta: ['✋', 'Poartă umană'],
  sesiune: ['💬', 'Sesiune Claude'],
  agent: ['🤖', 'Agent AI'],
  rutina: ['🔁', 'Rutină cloud'],
  sarcina: ['⏰', 'Sarcină programată'],
  cron: ['⏱️', 'pg_cron'],
  edge: ['⚡', 'Funcție edge'],
  api: ['🔌', 'Endpoint Vercel'],
  worker: ['⚙️', 'Worker'],
  model: ['🧠', 'Model local'],
  coada: ['📥', 'Coadă'],
  tabel: ['🗄️', 'Tabel / BD'],
  stocare: ['📁', 'Stocare fișiere'],
  script: ['📜', 'Script'],
  extern: ['🌐', 'Serviciu extern'],
  cheie: ['🔑', 'Cheie / cont plătit'],
  ecran: ['🖥️', 'Ecran ERP'],
}

export const STARI_NOD = {
  activ: ['Activ', '#38765A'],
  oprit: ['Oprit', '#617282'],
  viitor: ['Plănuit', '#24778B'],
  neverificat: ['Neverificat', '#946B20'],
  eroare: ['Eroare la ultima rulare', '#B74D55'],
}

export const TIPURI_LEGATURA = {
  date: ['Date / fișiere', '#617282'],
  comanda: ['Comandă / pornire', '#24778B'],
  bani: ['Apel plătit', '#946B20'],
  poarta: ['Trece prin „da”', '#B74D55'],
  cod: ['Cod / PR / verdict', '#6B4FA0'],
}

const lista = v => (Array.isArray(v) ? v : [])

// Cheia unei legături: id-ul explicit sau de>la#index (index = poziția în listă, ca două legături între aceleași noduri să nu se confunde).
export function cheieLegatura(l, i) {
  return l?.id ? String(l.id) : `${l?.de}>${l?.la}#${i}`
}

// --- Detectorul de secrete și date personale ---------------------------------------------------------------
// Harta trebuie să conțină DOAR numele secretelor. Orice șir care arată a valoare de secret oprește generarea.
const TIPARE_SECRET = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'cheie privată'],
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'cheie API (sk-…)'],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/, 'cheie Anthropic'],
  [/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'token GitHub'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'token Slack'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'cheie AWS'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'cheie Google'],
  [/\b[0-9a-f]{40,}\b/i, 'șir hex lung (hash sau secret)'],
  // „parola=valoare”; un NUME de secret (MAJUSCULE_CU_LINIUȚĂ) după egal e permis.
  [/\b(?:[Pp]arola|PAROLA|[Pp]assword|PASSWORD|[Pp]asswd|[Pp]wd)\s*[:=]\s*(?![A-Z0-9_]+(?![^\s,;.)]))[^\s,;)]{6,}/, 'atribuire de parolă'],
  // Un șir de 32+ litere și cifre amestecate (mici, mari, cifre) fără separatori = token aleator. ID-urile de sesiune (24) trec.
  [/(?<![A-Za-z0-9])(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{32,}(?![A-Za-z0-9])/, 'șir aleator lung (posibil secret)'],
]
const TIPAR_TELEFON = /(?<![\d.])(?:\+?40[\s.-]?|0)7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/
const TIPAR_CNP = /(?<!\d)[1-8]\d{12}(?!\d)/
const TIPAR_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export function cautaSecret(text) {
  const s = typeof text === 'string' ? text : ''
  for (const [re, motiv] of TIPARE_SECRET) if (re.test(s)) return motiv
  if (TIPAR_TELEFON.test(s)) return 'număr de telefon'
  if (TIPAR_CNP.test(s)) return 'posibil CNP'
  return null
}

// Parcurge toate șirurile din obiect, cu calea lor (ex. noduri[3].fisa.cont).
function parcurgeSiruri(v, cale, fn) {
  if (typeof v === 'string') { fn(v, cale); return }
  if (Array.isArray(v)) { v.forEach((x, i) => parcurgeSiruri(x, `${cale}[${i}]`, fn)); return }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) parcurgeSiruri(x, cale ? `${cale}.${k}` : k, fn)
}

// --- Validarea întregului fișier ------------------------------------------------------------------------------
// erori = harta nu se desenează / nu se generează; avertismente = se desenează, dar se vede bannerul.
export function valideazaHarta(date) {
  const erori = []
  const avertismente = []
  if (!date || typeof date !== 'object' || Array.isArray(date)) return { erori: ['fișierul nu e un obiect JSON'], avertismente }
  const grupuri = lista(date.grupuri)
  const noduri = lista(date.noduri)
  const legaturi = lista(date.legaturi)
  const fluxuri = lista(date.fluxuri)
  if (!noduri.length) erori.push('lipsesc nodurile (noduri: [])')

  const idGrup = new Set()
  grupuri.forEach((g, i) => {
    if (!g?.id) erori.push(`grupuri[${i}] fără id`)
    else if (idGrup.has(g.id)) erori.push(`grup duplicat: ${g.id}`)
    else idGrup.add(g.id)
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(g?.[k])) erori.push(`grupul ${g?.id || i}: ${k} lipsește sau nu e număr`)
  })
  const idNod = new Set()
  noduri.forEach((n, i) => {
    if (!n?.id) { erori.push(`noduri[${i}] fără id`); return }
    if (idNod.has(n.id)) erori.push(`nod duplicat: ${n.id}`)
    idNod.add(n.id)
    if (!n.nume) erori.push(`nodul ${n.id} fără nume`)
    if (n.grup && !idGrup.has(n.grup)) erori.push(`nodul ${n.id}: grup inexistent ${n.grup}`)
    if (!n.grup && !(Number.isFinite(n.x) && Number.isFinite(n.y))) erori.push(`nodul ${n.id}: fără grup și fără x/y`)
    if (n.tip && !TIPURI_NOD[n.tip]) avertismente.push(`nodul ${n.id}: tip necunoscut „${n.tip}” (se desenează ca nod simplu)`)
    if (n.stare && !STARI_NOD[n.stare]) avertismente.push(`nodul ${n.id}: stare necunoscută „${n.stare}”`)
  })
  const idLeg = new Set()
  const perechi = new Set()
  legaturi.forEach((l, i) => {
    const k = cheieLegatura(l, i)
    if (idLeg.has(k)) erori.push(`legătură duplicată: ${k}`)
    idLeg.add(k)
    if (!idNod.has(l?.de)) erori.push(`legaturi[${i}]: nod sursă inexistent ${l?.de}`)
    if (!idNod.has(l?.la)) erori.push(`legaturi[${i}]: nod destinație inexistent ${l?.la}`)
    if (l?.de === l?.la) erori.push(`legaturi[${i}]: buclă pe același nod ${l?.de}`)
    if (!l?.ce) avertismente.push(`legaturi[${i}] ${l?.de} → ${l?.la}: lipsește „ce” (ce trece pe săgeată)`)
    if (l?.tip && !TIPURI_LEGATURA[l.tip]) avertismente.push(`legaturi[${i}]: tip necunoscut „${l.tip}”`)
    perechi.add(`${l?.de}>${l?.la}`)
    if (l?.dublu) perechi.add(`${l?.la}>${l?.de}`)
  })
  const idFlux = new Set()
  fluxuri.forEach((f, i) => {
    if (!f?.id) erori.push(`fluxuri[${i}] fără id`)
    else if (idFlux.has(f.id)) erori.push(`flux duplicat: ${f.id}`)
    else idFlux.add(f.id)
    const drum = lista(f?.drum)
    if (drum.length < 2) erori.push(`fluxul ${f?.id || i}: drumul are mai puțin de 2 noduri`)
    drum.forEach(n => { if (!idNod.has(n)) erori.push(`fluxul ${f?.id || i}: nod inexistent ${n}`) })
    for (let j = 1; j < drum.length; j++) {
      if (!perechi.has(`${drum[j - 1]}>${drum[j]}`)) erori.push(`fluxul ${f?.id || i}: lipsește legătura ${drum[j - 1]} → ${drum[j]}`)
    }
    lista(f?.ramuri).forEach(([a, b]) => { if (!perechi.has(`${a}>${b}`)) erori.push(`fluxul ${f?.id || i}: lipsește legătura de ramură ${a} → ${b}`) })
  })

  const emailuriPermise = new Set(lista(date.meta?.emailuri_permise).map(e => String(e).toLowerCase()))
  parcurgeSiruri(date, '', (s, cale) => {
    const motiv = cautaSecret(s)
    if (motiv) erori.push(`${cale}: arată a ${motiv} — în hartă intră doar NUMELE secretelor`)
    for (const m of s.match(TIPAR_EMAIL) || []) {
      if (!emailuriPermise.has(m.toLowerCase())) avertismente.push(`${cale}: adresă de mail ${m} (adaug-o în meta.emailuri_permise dacă e o adresă de rol)`)
    }
  })
  return { erori, avertismente }
}

// --- Poziții ---------------------------------------------------------------------------------------------------
// Nodurile cu x/y explicite stau unde scrie. Restul se așază în grila grupului, în ordinea din fișier.
export function pozitiiNoduri(date) {
  const poz = {}
  const grupuri = Object.fromEntries(lista(date?.grupuri).map(g => [g.id, g]))
  const contor = {}
  for (const n of lista(date?.noduri)) {
    if (!n?.id) continue
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) { poz[n.id] = { x: n.x, y: n.y, w: NOD_L, h: NOD_H }; continue }
    const g = grupuri[n.grup]
    if (!g) continue
    const col = Math.max(1, Math.floor(g.coloane || (g.w - 24) / (NOD_L + 16)))
    const i = contor[g.id] = (contor[g.id] ?? -1) + 1
    const latCel = (g.w - 24) / col
    const x = g.x + 12 + (i % col) * latCel + (latCel - NOD_L) / 2
    const y = g.y + ANTET_GRUP + Math.floor(i / col) * PAS_Y
    poz[n.id] = { x, y, w: NOD_L, h: NOD_H }
  }
  return poz
}

export function limiteHarta(date, poz = pozitiiNoduri(date)) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const ia = (x, y, w, h) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h) }
  lista(date?.grupuri).forEach(g => ia(g.x, g.y, g.w, g.h))
  Object.values(poz).forEach(p => ia(p.x, p.y, p.w, p.h))
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1000, h: 600 }
  return { x: x0 - 30, y: y0 - 30, w: x1 - x0 + 60, h: y1 - y0 + 60 }
}

// Punctul de pe marginea dreptunghiului a spre centrul lui b (săgeata pornește și se oprește la margine, nu în centru).
export function punctMargine(a, b) {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2
  const dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = dx ? (a.w / 2) / Math.abs(dx) : Infinity
  const sy = dy ? (a.h / 2) / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

// Drumul SVG al unei legături: curbă ușoară; „decalaj” desparte legăturile din sens opus între aceleași noduri.
export function drumLegatura(pa, pb, decalaj = 0) {
  const a = punctMargine(pa, pb)
  const b = punctMargine(pb, pa)
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const curb = Math.min(60, len * 0.12) + decalaj
  const cx = mx - (dy / len) * curb, cy = my + (dx / len) * curb
  return { d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`, eticheta: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 } }
}

// --- Fluxuri, vecini, filtre ------------------------------------------------------------------------------------
// Pașii unui flux: pentru fiecare pereche consecutivă din drum, legătura care o leagă (prima găsită, în sensul drumului).
export function pasiFlux(date, idFlux) {
  const f = lista(date?.fluxuri).find(x => x.id === idFlux)
  if (!f) return null
  const legaturi = lista(date?.legaturi)
  const gaseste = (a, b) => {
    const i = legaturi.findIndex(l => (l.de === a && l.la === b) || (l.dublu && l.de === b && l.la === a))
    return i < 0 ? null : { cheie: cheieLegatura(legaturi[i], i), legatura: legaturi[i] }
  }
  const drum = lista(f.drum)
  const pasi = []
  for (let j = 1; j < drum.length; j++) pasi.push({ de: drum[j - 1], la: drum[j], ...(gaseste(drum[j - 1], drum[j]) || { cheie: null, legatura: null }) })
  const ramuri = lista(f.ramuri).map(([a, b]) => ({ de: a, la: b, ...(gaseste(a, b) || { cheie: null, legatura: null }) }))
  const noduri = new Set([...drum, ...ramuri.flatMap(r => [r.de, r.la])])
  const chei = new Set([...pasi, ...ramuri].map(p => p.cheie).filter(Boolean))
  const ordine = {}
  drum.forEach((n, i) => { if (!(n in ordine)) ordine[n] = i + 1 })
  return { flux: f, pasi, ramuri, noduri, chei, ordine }
}

// „alt” = celălalt capăt al legăturii, văzut din nodul cerut (la legăturile „dublu” poate fi oricare dintre de / la).
export function veciniNod(date, id) {
  const intrari = [], iesiri = []
  lista(date?.legaturi).forEach((l, i) => {
    const cheie = cheieLegatura(l, i)
    const alt = l.de === id ? l.la : l.de
    if (l.la === id || (l.dublu && l.de === id)) intrari.push({ cheie, legatura: l, alt })
    if (l.de === id || (l.dublu && l.la === id)) iesiri.push({ cheie, legatura: l, alt })
  })
  return { intrari, iesiri }
}

const norm = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Căutare fără diacritice în nume, subtitlu și fișă (ce_e, cont, secrete). Gol = nimic.
export function cautaNoduri(date, text) {
  const q = norm(text).trim()
  if (!q) return []
  return lista(date?.noduri).filter(n => {
    const f = n.fisa || {}
    return [n.id, n.nume, n.sub, f.ce_e, f.cont, f.cand, ...lista(f.secrete)].some(v => norm(v).includes(q))
  }).map(n => n.id)
}

// Nodurile vizibile: fără cele din grupurile ascunse. Legăturile vizibile: ambele capete vizibile.
export function vizibile(date, grupuriAscunse = new Set()) {
  const noduri = lista(date?.noduri).filter(n => !grupuriAscunse.has(n.grup))
  const ids = new Set(noduri.map(n => n.id))
  const legaturi = lista(date?.legaturi).map((l, i) => ({ l, i, cheie: cheieLegatura(l, i) })).filter(x => ids.has(x.l.de) && ids.has(x.l.la))
  return { noduri, ids, legaturi }
}

// Câmpurile fișei, în ordinea afișării (a–e din CLAUDE.md pct. 7, plus contextul nodului).
export const CAMPURI_FISA = [
  ['ce_e', 'Ce e'],
  ['unde', 'Unde rulează'],
  ['cont', 'Cont / cheie (doar nume)'],
  ['cand', 'Când rulează'],
  ['a_extern', '(a) Conținut extern citit'],
  ['b_scrie', '(b) Ce scrie / face'],
  ['c_identitate', '(c) Cu ce identitate rulează'],
  ['d_cine_porneste', '(d) Cine îl poate porni'],
  ['e_confirmare', '(e) Ce cere confirmare umană'],
]
