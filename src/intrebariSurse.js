// ❓ Întreabă echipa — răspuns DIN SURSE (06.11.2026, cerere Silviu + Răzvan; migrarea 20261131e).
// Aceleași reguli ca worker/intrebari-tehnice/cercetare.py (validarea are cazurile comune în worker/intrebari-tehnice/teste_validare.json,
// rulate și de vitest, și de unittest). Testat în intrebariSurse.test.js.

// Lista fixă de domenii oficiale pentru căutarea web — identică în cercetare.py și în edge-ul intrebari-tehnice-worker (test „domenii identice”),
// toate din lista aprobată în CLAUDE.md pct. 11 (runda 3: iscir.ro a ieșit — nu e în lista aprobată).
export const DOMENII_OFICIALE = [
  'legislatie.just.ro', 'monitoruloficial.ro', 'anre.ro', 'isc.gov.ro', 'igsu.ro',
  'transgaz.ro', 'anap.gov.ro', 'e-licitatie.ro', 'eur-lex.europa.eu', 'magazin.asro.ro',
]
// Cuvintele de legătură (= STOP din cercetare.py) și cuvintele generice (= GENERICE) — testul de paritate le compară cu Python.
export const STOP = new Set(`si sau de la in pe cu din pentru care este sunt ca ce un o unei unui al ai ale a se nu da mai sa fi fost are au prin catre
dupa fara intre sub peste cum cand daca acest aceasta aceste acestui acesta cel cea cei cele lui lor ei el ea noi voi poate trebuie avem
am ne va vor iar deci doar tot toate fie unde cine cat cate the of and or for to is are be pe`.split(/\s+/))
export const GENERICE = new Set(`verdict depinde este sunt fie face fac facut facute aplica aplic aplicat aplicabil aplicabila cere cerut ceruta
cer exista poate pot alt alta alte altul altei acel acea aceea astfel privind referitor caz cazul orice toti fiecare art articol
articolul articolului alin alineat alineatul pct punct punctul lit litera anexa sursa sursei sursele`.split(/\s+/))
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
// obligații / prescripții fără cifre (runda 2, P1-b; runda 3: + admis/admite/permis/permite) — aceeași listă ca REGULA_OBLIGATIE din cercetare.py
const OBLIGATIE = 'obliga\\w*|trebuie|interzi\\w*|impun\\w*|impus\\w*|prevede\\w*|prevad\\w*|prevazut\\w*|conform|potrivit|temeiul|necesar\\w*|admi[st]\\w*|permi[st]\\w*'
const REGULA_OBLIGATIE = new RegExp(`\\b(?:${OBLIGATIE})\\b`)
const CUVANT_OBLIGATIE = new RegExp(`^(?:${OBLIGATIE})$`)
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

/** Termenii-cheie ai unei afirmații (= termeni_cheie din cercetare.py): rădăcini de 6 litere, fără STOP / GENERICE / obligații. */
export function termeniCheie(linie) {
  const n = normalizeaza(linie).replace(PREFIX_LINIE, '').replace(MARCAJ, ' ')
  const out = []
  for (const w of n.match(/[a-z]+/g) || []) {
    if (w.length < 3 || STOP.has(w) || GENERICE.has(w) || CUVANT_OBLIGATIE.test(w)) continue
    if (!out.includes(w.slice(0, 6))) out.push(w.slice(0, 6))
  }
  return out
}

/** [potriviți, total] — câți termeni-cheie ai liniei apar în sursele citate (= suport_lexical din cercetare.py). */
function suportLexical(linie, ids, harta) {
  const k = termeniCheie(linie)
  const cuvinte = new Set((normalizeaza(ids.map(i => harta.get(i)).join('\n')).match(/[a-z]+/g) || []).filter(w => w.length >= 3))
  const radacini = new Set([...cuvinte].map(w => w.slice(0, 6)))
  const pot = k.filter(x => radacini.has(x) || (x.length < 6 && [...cuvinte].some(w => w.startsWith(x)))).length
  return [pot, k.length]
}

/** [problemă, temei] — aceleași reguli ca evalueaza_linie din cercetare.py (vezi docstring-ul de acolo). */
function evalueazaLinie(linie, harta) {
  if (!linie.trim() || eDeclaratieLipsa(linie)) return [null, false]
  const normativ = eAfirmatieNormativa(linie)
  const ok = marcaje(linie).filter(i => harta.has(i))
  if (!ok.length) return [normativ ? 'fara_marcaj' : null, false]
  const a = ancore(linie)
  if (a.length && !a.every(x => ok.some(i => ancoraIn(x, harta.get(i))))) return ['neconfirmat', false]
  const [pot, tot] = suportLexical(linie, ok, harta)
  if (tot) {
    const prag = normativ ? Math.floor(tot / 2) + 1 : Math.floor((tot + 1) / 2)
    if (pot < prag) return ['nesustinut', false]
    return [null, pot * 2 > tot || a.length > 0]
  }
  if (!a.length && REGULA_OBLIGATIE.test(normalizeaza(linie))) return ['nesustinut', false]
  return [null, a.length > 0]
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

/** { verdict, fara_sursa, neconfirmate, nesustinute, citate, necunoscute, temei } — ca analizeaza() din cercetare.py; `surse` = obiecte sau ID-uri. */
export function analizeaza(text, surse) {
  const harta = hartaSurse(surse)
  const fara = [], neconf = [], nesust = [], citate = new Set(), necunoscute = new Set()
  let temei = false
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!linie.trim()) continue
    for (const i of marcaje(linie)) (harta.has(i) ? citate : necunoscute).add(i)
    const [p, t] = evalueazaLinie(linie, harta)
    temei = temei || t
    if (p) fara.push(linie.trim())
    if (p === 'neconfirmat') neconf.push(linie.trim())
    if (p === 'nesustinut') nesust.push(linie.trim())
  }
  return { verdict: verdict(text), fara_sursa: fara, neconfirmate: neconf, nesustinute: nesust, citate: [...citate].sort(),
    necunoscute: [...necunoscute].sort(), temei }
}

export const INCERT = 'Incert — de verificat'
export const INCERT_FARA_TEMEI = `${INCERT}: nu am găsit o sursă care să susțină verdictul propus.`
const NOTE = {
  fara_marcaj: '> ⚠️ Afirmație scoasă: nu avea sursă găsită în cercetare.',
  neconfirmat: '> ⚠️ Afirmație scoasă: cifrele sau articolul ei nu apar în sursa citată.',
  nesustinut: '> ⚠️ Afirmație scoasă: sursa citată nu conține termenii ei (vorbește despre altceva).',
}
const MARCAJ_ORICE = /\[\s*([CcWw]\d{1,2}(?:\s*[,;]\s*[CcWw]\d{1,2})*)\s*\]/g

/** [text, scoase] — ca curata_raspuns() din cercetare.py (paritate pe teste_validare.json). */
export function curataRaspuns(text, surse) {
  const harta = hartaSurse(surse)
  const faraNecunoscute = linie => linie.replace(MARCAJ_ORICE, (_, g) => {
    const p = g.split(/[,;]/).map(y => y.trim().toUpperCase()).filter(x => harta.has(x))
    return p.length ? `[${p.join(', ')}]` : ''
  })
  const out = []
  let scoase = 0, temei = false
  for (const brut of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const linie = faraNecunoscute(brut)
    const [p, t] = evalueazaLinie(linie, harta)
    if (p) { scoase++; out.push(NOTE[p]) } else { out.push(linie); temei = temei || t }
  }
  let rez = out.join('\n').trim()
  const v = verdict(rez)
  if (!v) rez = `${INCERT}: din sursele găsite nu rezultă un verdict sigur.\n\n` + rez
  else if (!normalizeaza(v).startsWith('incert') && !temei) {
    const linii = rez.split('\n')
    linii[linii.findIndex(l => l.trim())] = INCERT_FARA_TEMEI
    rez = linii.join('\n')
  }
  return [rez, scoase]
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
