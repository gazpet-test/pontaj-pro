// ════════════════════════════════════════════════════════════════
// ctcUtil.js — logică PURĂ pentru modulul CTC (fără React/Supabase), ca să se poată testa.
// Clonarea pozițiilor din template, paginarea borderoului, numele fișierelor din ZIP,
// numărul de pagini dintr-un PDF (euristică).
// ════════════════════════════════════════════════════════════════

export const STATUSE_DOC = ['lipsa', 'incarcat', 'verificat', 'na']
export const STATUSE_CARTE = [
  ['in_lucru', 'În lucru'],
  ['completa', 'Completă'],
  ['predata', 'Predată'],
]
export const MAX_BYTES = 50 * 1024 * 1024   // = limita bucketului ctc-documente

// Probele de presiune se repetă pe PROBĂ, nu pe tronson. Schema are o singură listă (ctc_carti.tronsoane),
// așa că probele se disting prin prefix. Cele două categorii de mai jos sunt cele „de probă".
export const PREFIX_PROBA = 'Probă · '
export const CATEGORII_PROBA = ['Faze determinante', 'Probe presiune']
export const PRESETURI_TRONSON = ['FOD', 'Mal drept', 'Mal stâng', 'Conductă Dn400', 'Conductă Dn500']
export const PRESETURI_PROBA = ['rezistență intermediară (înainte de tragere)', 'rezistență întreg fir', 'etanșeitate']

export const esteProba = (tronson) => typeof tronson === 'string' && tronson.startsWith(PREFIX_PROBA)
export const numeProba = (eticheta) => PREFIX_PROBA + String(eticheta || '').trim()
export const etichetaTronson = (tronson) => (esteProba(tronson) ? tronson.slice(PREFIX_PROBA.length) : tronson)

// Fără diacritice / caractere nepermise în nume de fișier și în path de storage.
export function slugFisier(text, max = 60) {
  const s = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (s || 'fisier').slice(0, max)
}

// Nume pentru ZIP: 001_Denumire.pdf (nr. = poziția din borderou)
export function numeInZip(nr, denumire, tronson) {
  const prefix = String(nr).padStart(3, '0')
  const t = tronson ? '_' + slugFisier(etichetaTronson(tronson), 25) : ''
  return `${prefix}${t}_${slugFisier(denumire, 70)}.pdf`
}

// Ordinea de afișare: pozițiile generale după ordinea din template; cele repetabile sunt grupate PE
// TRONSON în cadrul secțiunii lor (C = 600-799 execuție, D = 800+ probe), ca în cărțile reale.
export function calculeazaOrdine(pozitie, idxUnitate) {
  const o = Number(pozitie.ordine) || 0
  if (!pozitie.repetabil) return o * 1000
  const banda = o >= 800 ? 800 : 600
  return banda * 1000 + (idxUnitate || 0) * 1000 + (o - banda)
}

// Clonează pozițiile template-ului într-o carte. Generale: o dată. Repetabile: pe fiecare tronson
// (categorii „normale") sau pe fiecare probă (categorii de probă). Fără unități → o singură dată, tronson=null.
export function clonarePozitii(pozitiiTemplate, tronsoane, carteId) {
  const lista = Array.isArray(tronsoane) ? tronsoane : []
  const tr = lista.filter(t => !esteProba(t))
  const pr = lista.filter(esteProba)
  const out = []
  const sorted = [...pozitiiTemplate].sort((a, b) => a.ordine - b.ordine || a.id - b.id)
  for (const p of sorted) {
    const baza = {
      carte_id: carteId, template_pozitie_id: p.id, categorie: p.categorie,
      denumire_document: p.denumire_document, obligatoriu: !!p.obligatoriu, status: 'lipsa',
    }
    if (!p.repetabil) { out.push({ ...baza, tronson: null, ordine: calculeazaOrdine(p, 0) }); continue }
    const unitati = CATEGORII_PROBA.includes(p.categorie) ? pr : tr
    if (!unitati.length) { out.push({ ...baza, tronson: null, ordine: calculeazaOrdine(p, 0) }); continue }
    unitati.forEach((u, i) => out.push({ ...baza, tronson: u, ordine: calculeazaOrdine(p, i) }))
  }
  return out
}

// Poziții de adăugat când se adaugă ULTERIOR o unitate (tronson/probă) unei cărți existente.
export function pozitiiPentruUnitate(pozitiiTemplate, unitate, idxUnitate, carteId) {
  const proba = esteProba(unitate)
  return clonarePozitii(
    pozitiiTemplate.filter(p => p.repetabil && CATEGORII_PROBA.includes(p.categorie) === proba),
    [unitate], carteId,
  ).map(r => ({ ...r, tronson: unitate, ordine: r.ordine + (idxUnitate || 0) * 1000 }))
}

const areFisier = (d) => (d.status === 'incarcat' || d.status === 'verificat') && !!d.fisier_path

// Borderou: doar pozițiile cu fișier, în ordinea din carte, numerotate 1..n, cu pagini cumulate.
// paginiBorderou = câte pagini ocupă borderoul însuși (primele din PDF-ul final).
// Pozițiile cu fișier dar fără nr_pagini apar cu pagini = null și sunt numărate în `fara_pagini`.
export function calculeazaBorderou(documente, paginiBorderou = 1) {
  const incluse = documente.filter(areFisier)
    .sort((a, b) => (a.ordine - b.ordine) || (a.id - b.id))
  let cursor = paginiBorderou + 1
  let faraPagini = 0
  const randuri = incluse.map((d, i) => {
    const n = Number(d.nr_pagini) > 0 ? Number(d.nr_pagini) : null
    let start = null, end = null
    if (n) { start = cursor; end = cursor + n - 1; cursor = end + 1 } else faraPagini++
    return { nr: i + 1, doc: d, pagini: n, start, end }
  })
  return { randuri, faraPagini, totalPagini: cursor - 1 }
}

export const RANDURI_PE_PAGINA_BORDEROU = 30   // rândurile au înălțime fixă (2 linii) ca să încapă exact pe A4
export const paginiBorderou = (nrRanduri) => Math.max(1, Math.ceil(nrRanduri / RANDURI_PE_PAGINA_BORDEROU))

// Borderoul final al unei cărți: întâi numărăm pozițiile cu fișier ca să știm câte pagini ocupă borderoul însuși.
export function borderouCarte(documente) {
  const n = calculeazaBorderou(documente, 1).randuri.length
  return calculeazaBorderou(documente, paginiBorderou(n))
}

// Progres pentru o listă de documente (aceeași logică ca v_ctc_carti_progres, pentru ecranul de detaliu).
export function progres(documente) {
  const aplicabile = documente.filter(d => d.status !== 'na')
  return {
    total: documente.length,
    aplicabile: aplicabile.length,
    incarcate: documente.filter(d => d.status === 'incarcat' || d.status === 'verificat').length,
    verificate: documente.filter(d => d.status === 'verificat').length,
    obligatoriiLipsa: documente.filter(d => d.status === 'lipsa' && d.obligatoriu).length,
    pagini: documente.filter(areFisier).reduce((s, d) => s + (Number(d.nr_pagini) || 0), 0),
  }
}

// Grupare pentru checklist: generale, apoi fiecare tronson, apoi fiecare probă — în ordinea din carte.
export function grupeazaDocumente(documente) {
  const sorted = [...documente].sort((a, b) => (a.ordine - b.ordine) || (a.id - b.id))
  const chei = []
  const map = new Map()
  for (const d of sorted) {
    const k = d.tronson || ''
    if (!map.has(k)) { map.set(k, []); chei.push(k) }
    map.get(k).push(d)
  }
  // generale primele; apoi tronsoanele; apoi probele (ordinea relativă păstrată)
  const rang = (k) => (k === '' ? 0 : esteProba(k) ? 2 : 1)
  chei.sort((a, b) => rang(a) - rang(b))
  return chei.map(k => ({ cheie: k, eticheta: k === '' ? 'Documentație generală' : (esteProba(k) ? '🧪 Probă: ' : '🔧 Tronson: ') + etichetaTronson(k), docs: map.get(k) }))
}

// Număr de pagini dintr-un PDF, fără librărie (pdf-lib nu trece de build-ul Vercel):
// numără obiectele /Type /Page; dacă lipsesc (PDF cu object streams) → null și se introduce manual.
export function paginiDinBytes(bytes) {
  let s = ''
  const CH = 1 << 20
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  const pagini = (s.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length
  if (pagini > 0) return pagini
  const counts = [...s.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)]
    .map(m => Number(m[1] || m[2])).filter(Boolean)
  return counts.length ? Math.max(...counts) : null
}

// Mutare ↑/↓ în cadrul unui grup (aceeași listă sortată ca pe ecran). Întoarce cele 2 actualizări de `ordine`
// de făcut, sau [] dacă nu se poate muta. Dacă cele două poziții au aceeași `ordine` (departajate doar de id),
// o depărtăm cu 1 ca mutarea să aibă efect.
export function calculeazaMutare(grup, id, dir) {
  const i = grup.findIndex(d => d.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= grup.length) return []
  const d = grup[i], n = grup[j]
  if (d.ordine !== n.ordine) return [{ id: d.id, ordine: n.ordine }, { id: n.id, ordine: d.ordine }]
  return [{ id: d.id, ordine: dir < 0 ? n.ordine - 1 : n.ordine + 1 }]
}
