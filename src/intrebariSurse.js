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
const VERDICT_CURATA = /^[\s#>*_`-]*(?:verdict\s*[:\-–—]?\s*)?[*_`]*\s*/i

/** Linia conține o afirmație normativă (act, articol, standard, cifră cu unitate) care cere sursă. */
export const eAfirmatieNormativa = linie => { const n = normalizeaza(linie); return REGULI_NORMATIVE.some(r => r.test(n)) }

/** ID-urile citate într-o linie, canonice (C1, W2). */
export function marcaje(linie) {
  const out = []
  for (const m of normalizeaza(linie).matchAll(/\[\s*([cw]\d{1,2}(?:\s*[,;]\s*[cw]\d{1,2})*)\s*\]/g)) {
    for (const x of m[1].split(/[,;]/)) out.push(x.trim().toUpperCase())
  }
  return out
}

/** Prima linie nevidă, dacă e un verdict (Da / Nu / Depinde de X). Altfel null. */
export function verdict(text) {
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!linie.trim()) continue
    const curat = linie.replace(VERDICT_CURATA, '').trim().replace(/^[*_`]+|[*_`]+$/g, '').trim()
    const n = normalizeaza(curat)
    if (n.startsWith('nu am gasit')) return null
    if (/^(?:da|nu)\b/.test(n) || /^depinde de\s+\S/.test(n)) return curat
    return null
  }
  return null
}

/** { verdict, fara_sursa: [linii], citate: [id], necunoscute: [id] } — ca analizeaza() din cercetare.py. */
export function analizeaza(text, idsValide) {
  const valide = new Set((idsValide || []).map(i => String(i).toUpperCase()))
  const fara = [], citate = new Set(), necunoscute = new Set()
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!linie.trim()) continue
    const ids = marcaje(linie)
    const ok = ids.filter(i => valide.has(i))
    ok.forEach(i => citate.add(i)); ids.filter(i => !valide.has(i)).forEach(i => necunoscute.add(i))
    if (eAfirmatieNormativa(linie) && !ok.length && !normalizeaza(linie).includes(FARA_SURSA)) fara.push(linie.trim())
  }
  return { verdict: verdict(text), fara_sursa: fara, citate: [...citate].sort(), necunoscute: [...necunoscute].sort() }
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
  if (!v) return { verdict: null, rest: String(md ?? '') }
  const linii = String(md ?? '').replace(/\r/g, '').split('\n')
  const i = linii.findIndex(l => l.trim())
  return { verdict: v, rest: linii.slice(i + 1).join('\n').trim() }
}
