// ❓ Întreabă echipa — răspuns DIN SURSE (06.11.2026, cerere Silviu + Răzvan; migrarea 20261131e).
// Aceleași reguli ca worker/intrebari-tehnice/cercetare.py (validarea are cazurile comune în worker/intrebari-tehnice/teste_validare.json,
// rulate și de vitest, și de unittest; runda 4: tokenii numerici, tipul regulii și propozițiile în teste_normative.json). Testat în
// intrebariSurse.test.js.

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

// ─── runda 4 (review r3 P1 + P2): tipul regulii, propoziții, cifre cu semn și unitate — = cercetare.py (paritate pe teste_normative.json)
// Formele NEGATE întâi, mascate, apoi cele pozitive („nu se admite” = interdicție, „nu este obligatoriu” = fără obligație).
const NEGATIE = '\\bnu\\s+(?:(?:se|este|e|sunt|va|vor|fi|fie|poate|pot|mai|le|li|ii|il|o|a|au|are|fost|in|mod)\\s+){0,3}'
const POLARITATI = [
  ['fara_obligatie', NEGATIE + '(?:obliga\\w*|necesar\\w*|impun\\w*|impus\\w*)'],
  ['interdictie', NEGATIE + '(?:admi[st]\\w*|permi[st]\\w*|trebui\\w*|voie\\b)'],
  ['permisiune', NEGATIE + 'interzi\\w*'],
  ['interdictie', '\\binterzi\\w*'],
  ['obligatie', '\\b(?:obliga\\w*|trebui\\w*|necesar\\w*|impun\\w*|impus\\w*)'],
  ['permisiune', '\\b(?:admi[st]\\w*|permi[st]\\w*)|\\b(?:are|au|e|este)\\s+voie\\b'],
  ['conditie', '\\b(?:numai|doar)\\s+(?:daca|dupa|cu|in\\s+cazul)\\b|\\bcu\\s+conditia\\b|\\bcu\\s+exceptia\\b|\\bexceptand\\b'],
  ['minim', '\\bcel\\s+putin\\b|\\bnu\\s+mai\\s+putin\\s+de\\b|\\bminim\\w*'],
  ['maxim', '\\bcel\\s+mult\\b|\\bnu\\s+mai\\s+mult\\s+de\\b|\\bmaxim\\w*'],
].map(([k, p]) => [k, new RegExp(p, 'g')])
// „se poate” / „nu se poate” doar pe linii cu marcaj și în surse (extins)
const POLARITATI_POATE = [
  ['interdictie', NEGATIE + 'po(?:ate|t)\\b'],
  ['permisiune', '\\bse\\s+po(?:ate|t)\\b'],
].map(([k, p]) => [k, new RegExp(p, 'g')])
const LIMITA_EXPLICITA = /\bcel\s+(?:putin|mult)\b|\bnu\s+mai\s+(?:putin|mult)\s+de\b/
const NEGATIE_SIMPLA = /\b(?:nu|nici|niciun\w*|nicio|niciodata)\b/
const VERDICT_INCEPUT = new RegExp('^\\s*(?:da|nu)\\b\\s*[,.:;!' + String.fromCharCode(0x2014, 0x2013) + '-]+')
const OPUSE = { obligatie: 'fara_obligatie', fara_obligatie: 'obligatie', interdictie: 'permisiune', permisiune: 'interdictie' }
const NU_SE_PIERD = ['interdictie', 'fara_obligatie', 'conditie']
const LIMITE = ['minim', 'maxim']
const GRAD = String.fromCharCode(0xb0), CUB = String.fromCharCode(0xb3), PATRAT = String.fromCharCode(0xb2)
const UM = 'grade\\s+celsius|metri\\s+patrati|metri\\s+cubi|centimetri|centimetru|kilometri|kilometru|milimetri|milimetru|kilograme'
  + '|kilogram|saptamani|saptamana|procente|procent|minute|grade|metri|metru|mbari|mbar|zile|euro|luni|luna|bari|bar|kpa|mpa'
  + `|ore|ora|ani|min|lei|eur|${GRAD}\\s*c|mm|cm|km|kg|mc|mp|m3|m2|m${CUB}|m${PATRAT}|zi|an|m|h|${GRAD}|%`
const UNITATI = {
  'grade celsius': `${GRAD}c`, 'metri patrati': 'mp', 'metri cubi': 'mc', centimetri: 'cm', centimetru: 'cm', kilometri: 'km',
  kilometru: 'km', milimetri: 'mm', milimetru: 'mm', kilograme: 'kg', kilogram: 'kg', saptamani: 'saptamani',
  saptamana: 'saptamani', procente: '%', procent: '%', minute: 'minute', grade: 'grade', metri: 'm', metru: 'm',
  mbari: 'mbar', mbar: 'mbar', zile: 'zile', euro: 'euro', luni: 'luni', luna: 'luni', bari: 'bar', bar: 'bar',
  kpa: 'kpa', mpa: 'mpa', ore: 'ore', ora: 'ore', ani: 'ani', min: 'minute', lei: 'lei', eur: 'euro',
  [`${GRAD}c`]: `${GRAD}c`, [`${GRAD} c`]: `${GRAD}c`, mm: 'mm', cm: 'cm', km: 'km', kg: 'kg', mc: 'mc', mp: 'mp', m3: 'mc', m2: 'mp',
  [`m${CUB}`]: 'mc', [`m${PATRAT}`]: 'mp', zi: 'zile', an: 'ani', m: 'm', h: 'ore', [GRAD]: 'grade', '%': '%',
}
const MINUS = String.fromCharCode(0x2212), LINIUTA = String.fromCharCode(0x2013), PLUSMINUS = String.fromCharCode(0xb1)
const NUMERIC = new RegExp(`(?:(?<![0-9a-z])([-+${MINUS}${LINIUTA}${PLUSMINUS}]))?(?<![0-9])([0-9]+(?:[.,][0-9]+)?)(?:\\s*(?:de\\s+)?(${UM})(?![a-z0-9]))?`, 'g')
const SEMNE = { '-': '-', [MINUS]: '-', [LINIUTA]: '-', '+': '', [PLUSMINUS]: PLUSMINUS }
const ABREVIERI = new Set('art alin pct lit nr ord hg oug cap sect par fig pag ex cca min max str ed vol pt np sr en iso stas tab pl'.split(' '))
const SEPARATOR = /[.!?;\n]/g
const CONTRAST_PROP = /\b(?:dar|insa|iar|totusi|desi|in\s+schimb|pe\s+cand)\b/

/** [tipuri de regulă (Set), textul rămas după mascare] — `n` deja normalizat (= _polaritati din cercetare.py). */
function polaritatiSiRest(n, extins = false) {
  const clase = new Set()
  for (const [k, r] of extins ? [...POLARITATI, ...POLARITATI_POATE] : POLARITATI) {
    r.lastIndex = 0
    if (r.test(n)) { clase.add(k); r.lastIndex = 0; n = n.replace(r, ' ') }
    r.lastIndex = 0
  }
  return [clase, n]
}
/** Tipurile de regulă, sortate (paritate cu sorted(polaritati(...)) în teste). */
export const polaritati = (n, extins = false) => [...polaritatiSiRest(n, extins)[0]].sort()

/** Cifrele unui text normalizat, ca tokeni compleți: „−5 bar” → „-5 bar”, „30 de zile” → „30 zile”, „art. 12” → „12”. */
export function tokeniNumerici(n) {
  const out = []
  for (const m of n.matchAll(NUMERIC)) {
    const um = UNITATI[(m[3] || '').split(/\s+/).filter(Boolean).join(' ')] || ''
    out.push((SEMNE[m[1] || ''] ?? '') + m[2].replace(',', '.') + (um ? ' ' + um : ''))
  }
  return out
}
const corpAfirmatie = linie => normalizeaza(linie).replace(PREFIX_LINIE, '').replace(MARCAJ, ' ')

/** Propozițiile unui text, normalizate (= propozitii din cercetare.py). */
export function propozitii(text) {
  const n = normalizeaza(text)
  const bucati = []
  let start = 0
  for (const m of n.matchAll(SEPARATOR)) {
    const k = m.index
    if ('.!?'.includes(n[k])) {
      if (k + 1 < n.length && !/\s/.test(n[k + 1])) continue
      if (n[k] === '.') {
        const cuv = n.slice(start, k).match(/[a-z]+$/)
        if (cuv && ABREVIERI.has(cuv[0])) continue
      }
      const urm = n.slice(k + 1).match(/^\s*(\S)/)
      if (urm && /[0-9(]/.test(urm[1])) continue
    }
    bucati.push(n.slice(start, k))
    start = k + 1
  }
  bucati.push(n.slice(start))
  return bucati.flatMap(b => b.split(CONTRAST_PROP)).map(p => p.trim()).filter(Boolean)
}

/** Linia conține o afirmație normativă (act, articol, standard, cifră cu unitate, obligație / interdicție / permisiune / condiție / limită). */
export const eAfirmatieNormativa = linie => {
  const n = normalizeaza(linie)
  return REGULI_NORMATIVE.some(r => r.test(n)) || REGULA_OBLIGATIE.test(n) || LIMITA_EXPLICITA.test(n)
    || polaritati(n).some(k => !LIMITE.includes(k)) || ancore(linie).some(t => t.includes(' '))
}

/** Linia e EXCLUSIV declarația „Nu am găsit sursa oficială pentru …” (fără altă propoziție, cifre, articole sau reguli). */
export function eDeclaratieLipsa(linie) {
  const n = normalizeaza(linie).replace(PREFIX_LINIE, '').trim()
  if (!n.startsWith(FARA_SURSA)) return false
  const rest = n.slice(FARA_SURSA.length).trim().replace(/[.!*_` ]+$/, '')
  if (rest.includes(';') || /[.!?]\s+\S/.test(rest) || CONTRAST.test(rest)) return false
  if (REGULI_NORMATIVE.some(r => r.test(rest)) || tokeniNumerici(rest).some(t => t.includes(' '))) return false
  const r = rest.replace(CERERE_DOCUMENT, ' ')
  return !REGULA_OBLIGATIE.test(r) && !LIMITA_EXPLICITA.test(r) && !polaritati(r).some(k => !LIMITE.includes(k))
}

/** ID-urile citate într-o linie, canonice (C1, W2). */
export function marcaje(linie) {
  const out = []
  for (const m of normalizeaza(linie).matchAll(MARCAJ)) {
    for (const x of m[1].split(/[,;]/)) out.push(x.trim().toUpperCase())
  }
  return out
}

/** Cifrele afirmate într-o linie (fără marcaje și numerotare), ca tokeni compleți, sortați (= ancore din cercetare.py). */
export function ancore(linie) {
  return [...new Set(tokeniNumerici(corpAfirmatie(linie)))].sort()
}

/** {ID: titlu + rând nou + extras}; acceptă și o listă de ID-uri simple (fără extrase: nimic nu se poate confirma din ele). */
function hartaSurse(surse) {
  const h = new Map()
  for (const s of surse || []) {
    if (s && typeof s === 'object') { const i = String(s.id ?? '').trim().toUpperCase(); if (i) h.set(i, `${s.titlu ?? ''}\n${s.extras ?? ''}`) }
    else if (String(s ?? '').trim()) h.set(String(s).trim().toUpperCase(), '')
  }
  return h
}

/** Termenii de conținut (= termeni_cheie din cercetare.py): rădăcini de 6 litere, fără STOP / GENERICE / obligații / marcatori / cifre. */
export function termeniCheie(linie) {
  const n = polaritatiSiRest(corpAfirmatie(linie), true)[1].replace(NUMERIC, ' ')
  const out = []
  for (const w of n.match(/[a-z]+/g) || []) {
    if (w.length < 3 || STOP.has(w) || GENERICE.has(w) || CUVANT_OBLIGATIE.test(w)) continue
    if (!out.includes(w.slice(0, 6))) out.push(w.slice(0, 6))
  }
  return out
}
const cuvinte = text => new Set((text.match(/[a-z]+/g) || []).filter(w => w.length >= 3))
function potriviti(termeni, cuv) {
  const radacini = new Set([...cuv].map(w => w.slice(0, 6)))
  return termeni.filter(x => radacini.has(x) || (x.length < 6 && [...cuv].some(w => w.startsWith(x)))).length
}

function descrieAfirmatia(linie) {
  const n = corpAfirmatie(linie)
  const [clase, rest] = polaritatiSiRest(n, true)
  return { clase, neg: NEGATIE_SIMPLA.test(rest.replace(VERDICT_INCEPUT, ' ')), termeni: termeniCheie(linie), tok: tokeniNumerici(n) }
}
function propozitiiSurse(ids, harta) {
  const out = []
  for (const i of ids) {
    const t = harta.get(i), k = t.indexOf('\n')
    const titlu = k < 0 ? t : t.slice(0, k), extras = k < 0 ? '' : t.slice(k + 1)
    const nt = normalizeaza(titlu)
    for (const p of propozitii(extras)) {
      const [clase, rest] = polaritatiSiRest(p, true)
      const ctx = nt + '\n' + p
      out.push({ clase, neg: NEGATIE_SIMPLA.test(rest), cuvinte: cuvinte(ctx), tok: new Set(tokeniNumerici(ctx)) })
    }
  }
  return out
}
function potrivirePropozitie(af, prop) {
  for (const k of af.clase) if (!prop.clase.has(k) || prop.clase.has(OPUSE[k])) return false
  const pierdute = [...prop.clase].filter(k => !af.clase.has(k))
  if (pierdute.some(k => NU_SE_PIERD.includes(k))) return false
  if (af.tok.length && pierdute.some(k => LIMITE.includes(k))) return false
  return af.neg === prop.neg
}
/** [susținută, potriviți, total] — = sustinere din cercetare.py. */
function sustinere(linie, ids, harta, normativ) {
  const af = descrieAfirmatia(linie)
  const tot = af.termeni.length, cuUm = af.tok.filter(t => t.includes(' '))
  let celMaiBun = -1
  for (const p of propozitiiSurse(ids, harta)) {
    if (!potrivirePropozitie(af, p)) continue
    if (normativ && !cuUm.every(t => p.tok.has(t))) continue
    celMaiBun = Math.max(celMaiBun, potriviti(af.termeni, p.cuvinte))
  }
  if (celMaiBun < 0) return [false, 0, tot]
  return [celMaiBun >= (normativ ? tot : Math.floor((tot + 1) / 2)), celMaiBun, tot]
}

/** [problemă, temei, normativă] — aceleași reguli ca _evalueaza din cercetare.py (vezi docstring-ul evalueaza_linie de acolo). */
function evalueazaLinie(linie, harta) {
  if (!linie.trim() || eDeclaratieLipsa(linie)) return [null, false, false]
  let normativ = eAfirmatieNormativa(linie)
  const ok = marcaje(linie).filter(i => harta.has(i))
  if (!ok.length) return [normativ ? 'fara_marcaj' : null, false, normativ]
  normativ = normativ || polaritati(corpAfirmatie(linie), true).length > 0
  const a = ancore(linie)
  const dinSurse = new Set(ok.flatMap(i => tokeniNumerici(normalizeaza(harta.get(i)))))
  let lipsa
  if (normativ) lipsa = a.filter(x => !dinSurse.has(x))
  else { const valori = new Set([...dinSurse].map(x => x.split(' ')[0])); lipsa = a.filter(x => !valori.has(x.split(' ')[0])) }
  if (lipsa.length) return ['neconfirmat', false, normativ]
  const k = termeniCheie(linie)
  if (!k.length && !a.length) return normativ ? ['nesustinut', false, true] : [null, false, false]
  if (!k.length && !normativ) return [null, true, false]
  const [sust, pot, tot] = sustinere(linie, ok, harta, normativ)
  if (!sust) return ['nesustinut', false, normativ]
  return [null, normativ || pot * 2 > tot || a.length > 0, normativ]
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
  nesustinut: '> ⚠️ Afirmație scoasă: sursa citată nu spune exact asta (alți termeni, alt tip de regulă sau altă valoare).',
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
  let scoase = 0, temei = false, normativScos = false
  for (const brut of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const linie = faraNecunoscute(brut)
    const [p, t, normativ] = evalueazaLinie(linie, harta)
    if (p) { scoase++; normativScos = normativScos || normativ; out.push(NOTE[p]) } else { out.push(linie); temei = temei || t }
  }
  let rez = out.join('\n').trim()
  const v = verdict(rez)
  if (!v) rez = `${INCERT}: din sursele găsite nu rezultă un verdict sigur.\n\n` + rez
  // runda 4: o afirmație normativă scoasă = verdictul se putea sprijini pe ea → Incert (ca în cercetare.py)
  else if (!normalizeaza(v).startsWith('incert') && (normativScos || !temei)) {
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

/** Eroarea unei citiri care cere coloanele migrării 20261131e (`surse` / `interogari_web`) pe o bază fără ea. */
export const lipsesteMigrarea = e => !!e && /surse|interogari_web/.test(String(e.message || ''))

/** Acțiunile arătate pe o întrebare (runda 4, review r3 P2 — condiția de merge): butoanele care cheamă fn_intrebari_de_verificat /
 *  fn_intrebari_reia apar DOAR cu migrarea 20261131e detectată (`v2 === true`: coloanele ei s-au citit fără eroare — migrarea le
 *  adaugă în aceeași tranzacție cu funcțiile). Necunoscut (încă se încarcă) sau lipsă → nimic de apăsat; `nota` = unde ar fi apărut
 *  un buton, ca ecranul să spună „disponibil după actualizarea bazei de date”. */
export function actiuniIntrebare({ v2, stare, eAutor, eOwner }) {
  const verificare = stare === 'raspuns' && !!(eAutor || eOwner)
  const reia = !!eOwner && ['raspuns', 'de_verificat', 'eroare'].includes(stare)
  return v2 === true ? { verificare, reia, nota: false } : { verificare: false, reia: false, nota: verificare || reia }
}

/** Interogările web trimise (audit, doar ownerul le vede): listă de șiruri, max 20 × 200 de caractere. */
export function interogariAfisabile(x) {
  return Array.isArray(x) ? x.filter(q => typeof q === 'string' && q.trim()).slice(0, 20).map(q => q.slice(0, 200)) : []
}
