// ❓ Întreabă echipa — răspuns DIN SURSE (06.11.2026, cerere Silviu + Răzvan; migrarea 20261131e).
// Aceleași reguli ca worker/intrebari-tehnice/cercetare.py (validarea are cazurile comune în worker/intrebari-tehnice/teste_validare.json,
// rulate și de vitest, și de unittest). Testat în intrebariSurse.test.js.

// Lista fixă de domenii oficiale pentru căutarea web — identică în cercetare.py și în edge-ul intrebari-tehnice-worker (test „domenii identice”).
export const DOMENII_OFICIALE = [
  'legislatie.just.ro', 'monitoruloficial.ro', 'iscir.ro', 'anre.ro', 'isc.gov.ro', 'igsu.ro',
  'transgaz.ro', 'anap.gov.ro', 'e-licitatie.ro', 'eur-lex.europa.eu', 'magazin.asro.ro',
]
const FARA_SURSA = 'nu am gasit sursa oficiala'

export const normalizeaza = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const REGULI_NORMATIVE = [
  /\bart(?:\.|icol(?:ul|ului|ele|elor)?)?\s*\d/,
  /\balin(?:\.|eat(?:ul)?)?\s*\(?\d/,
  /\b(?:pct|punct(?:ul|ele)?)\.?\s*\d/,
  /\b(?:legea|legii|hg|h\.g\.|oug|o\.u\.g\.|ordinul|ordin|ord\.|decizia|normativul)\s*(?:nr\.?\s*)?\d/,
  /\b(?:sr\s+)?en\s*(?:iso\s*)?\d{3,}/,
  /\biso\s*\d{3,}/,
  /\bstas\s*\d/,
  /\bntpee\b/,
  /\bpt\s*c\s*\d/,
  /\bnp\s*-?\s*\d{2,}/,
  /\d(?:[.,]\d+)?\s*(?:(?:mm|cm|m|km|bar|mbar|kpa|mpa|zile|ore|luni|ani|lei|euro|kg|grade)\b|%)/,
]
// obligații / prescripții fără cifre (runda 2, P1-b) — aceeași listă ca REGULA_OBLIGATIE din cercetare.py
const REGULA_OBLIGATIE = /\b(?:obliga\w*|trebuie|interzi\w*|impun\w*|impus\w*|prevede\w*|prevad\w*|prevazut\w*|conform|potrivit|temeiul|necesar\w*)\b/
const MARCAJ = /\[\s*([cw]\d{1,2}(?:\s*[,;]\s*[cw]\d{1,2})*)\s*\]/g
const VERDICT_CURATA = /^[\s#>*_`-]*(?:verdict\s*[:\-–—]?\s*)?[*_`]*\s*/i
const PREFIX_LINIE = /^[\s>*_`#•·\-–—]*(?:\d{1,2}[.)]\s+)?[*_`\s]*/
const CERERE_DOCUMENT = /\btrebuie\s+(?:cerut|consultat|solicitat|verificat)\w*/g
const CONTRAST = /\b(?:dar|insa|iar|totusi|desi|but)\b/

/** Linia conține o afirmație normativă (act, articol, standard, cifră cu unitate, obligație) care cere sursă. */
export const eAfirmatieNormativa = linie => { const n = normalizeaza(linie); return REGULI_NORMATIVE.some(r => r.test(n)) || REGULA_OBLIGATIE.test(n) }

/** Linia e EXCLUSIV declarația „Nu am găsit sursa oficială pentru …” (fără altă propoziție, cifre, articole sau obligații). */
export function eDeclaratieLipsa(linie) {
  const n = normalizeaza(linie).replace(PREFIX_LINIE, '').trim()
  if (!n.startsWith(FARA_SURSA)) return false
  const rest = n.slice(FARA_SURSA.length).trim().replace(/[.!*_` ]+$/, '')
  if (rest.includes(';') || /[.!?]\s+\S/.test(rest) || CONTRAST.test(rest)) return false
  if (REGULI_NORMATIVE.some(r => r.test(rest))) return false
  return !REGULA_OBLIGATIE.test(rest.replace(CERERE_DOCUMENT, ' '))
}

/** ID-urile citate într-o linie, canonice (C1, W2). */
export function marcaje(linie) {
  const out = []
  for (const m of normalizeaza(linie).matchAll(MARCAJ)) {
    for (const x of m[1].split(/[,;]/)) out.push(x.trim().toUpperCase())
  }
  return out
}

/** Numerele afirmate într-o linie (fără marcaje și numerotare), canonice: „0,5” → „0.5”. */
export function ancore(linie) {
  const n = normalizeaza(linie).replace(PREFIX_LINIE, '').replace(MARCAJ, ' ')
  return [...new Set((n.match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(',', '.')))].sort()
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ancoraIn = (a, text) => new RegExp('(?<!\\d)(?<!\\d\\.)' + escRe(a) + '(?!\\d|\\.\\d)').test(normalizeaza(text).replace(/,/g, '.'))

/** {ID: titlu + extras}; acceptă și o listă de ID-uri simple (fără extrase: cifrele lor nu se pot confirma). */
function hartaSurse(surse) {
  const h = new Map()
  for (const s of surse || []) {
    if (s && typeof s === 'object') { const i = String(s.id ?? '').trim().toUpperCase(); if (i) h.set(i, `${s.titlu ?? ''}\n${s.extras ?? ''}`) }
    else if (String(s ?? '').trim()) h.set(String(s).trim().toUpperCase(), '')
  }
  return h
}

/** null = linia e în regulă; 'fara_marcaj' / 'neconfirmat' (marcaj valid, dar niciuna dintre cifrele ei nu e în sursa citată). */
function problemaLinie(linie, harta) {
  if (!linie.trim() || !eAfirmatieNormativa(linie) || eDeclaratieLipsa(linie)) return null
  const ok = marcaje(linie).filter(i => harta.has(i))
  if (!ok.length) return 'fara_marcaj'
  const a = ancore(linie)
  if (a.length && !a.some(x => ok.some(i => ancoraIn(x, harta.get(i))))) return 'neconfirmat'
  return null
}

/** Prima linie nevidă, dacă e un verdict (Da / Nu / Depinde de X / Incert). Altfel null. */
export function verdict(text) {
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!linie.trim()) continue
    const curat = linie.replace(VERDICT_CURATA, '').trim().replace(/^[*_`]+|[*_`]+$/g, '').trim()
    const n = normalizeaza(curat)
    if (n.startsWith('nu am gasit')) return null
    if (/^(?:da|nu|incert)\b/.test(n) || /^depinde de\s+\S/.test(n)) return curat
    return null
  }
  return null
}

/** { verdict, fara_sursa, neconfirmate, citate, necunoscute } — ca analizeaza() din cercetare.py; `surse` = obiecte sau ID-uri. */
export function analizeaza(text, surse) {
  const harta = hartaSurse(surse)
  const fara = [], neconf = [], citate = new Set(), necunoscute = new Set()
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!linie.trim()) continue
    for (const i of marcaje(linie)) (harta.has(i) ? citate : necunoscute).add(i)
    const p = problemaLinie(linie, harta)
    if (p) fara.push(linie.trim())
    if (p === 'neconfirmat') neconf.push(linie.trim())
  }
  return { verdict: verdict(text), fara_sursa: fara, neconfirmate: neconf, citate: [...citate].sort(), necunoscute: [...necunoscute].sort() }
}

/** http(s) pe un domeniu oficial (sau subdomeniu), fără user:parolă. */
export function urlOficial(url) {
  let u
  try { u = new URL(String(url ?? '').trim()) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  return DOMENII_OFICIALE.some(d => host === d || host.endsWith('.' + d))
}

/** Sursele salvate, curățate pentru afișare: web doar pe domenii oficiale, corpus doar căi docs/… */
export function surseAfisabile(surse) {
  if (!Array.isArray(surse)) return []
  return surse.filter(s => s && typeof s === 'object' && /^[CW]\d{1,2}$/.test(String(s.id || ''))).flatMap(s => {
    if (s.tip === 'web' && urlOficial(s.url)) return [{ id: s.id, tip: 'web', url: String(s.url), titlu: String(s.titlu || s.url), extras: String(s.extras || '') }]
    if (s.tip === 'corpus' && typeof s.cale === 'string' && /^docs\//.test(s.cale) && !s.cale.includes('..'))
      return [{ id: s.id, tip: 'corpus', cale: s.cale, titlu: String(s.titlu || s.cale), extras: String(s.extras || '') }]
    return []
  })
}

/** Răspunsul împărțit pentru ecran: verdictul (prima linie, dacă e verdict) separat de restul textului. */
export function imparteRaspuns(md) {
  const v = verdict(md)
  if (!v) return { verdict: null, rest: String(md ?? ''), incert: false }
  const linii = String(md ?? '').replace(/\r/g, '').split('\n')
  const i = linii.findIndex(l => l.trim())
  return { verdict: v, rest: linii.slice(i + 1).join('\n').trim(), incert: normalizeaza(v).startsWith('incert') }
}

/** Interogările web trimise (audit, doar ownerul le vede): listă de șiruri, max 20 × 200 de caractere. */
export function interogariAfisabile(x) {
  return Array.isArray(x) ? x.filter(q => typeof q === 'string' && q.trim()).slice(0, 20).map(q => q.slice(0, 200)) : []
}
