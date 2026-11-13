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
articolul articolului alin alineat alineatul pct punct punctul lit litera anexa sursa sursei sursele citat citatul citate`.split(/\s+/))
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
// „se poate” / „nu se poate” doar pe linii cu marcaj și în surse (extins); runda 5 (review r4 P1): tot aici condițiile simple
// („dacă”, „numai” / „doar”, „în cazul în care”, „în afară de”) — = POLARITATI_POATE din cercetare.py
const POLARITATI_POATE = [
  ['interdictie', NEGATIE + 'po(?:ate|t)\\b'],
  ['permisiune', '\\bse\\s+po(?:ate|t)\\b'],
  ['conditie', '\\b(?:daca|numai|doar|in\\s+cazul\\s+in\\s+care|in\\s+afara\\s+(?:de|cazului))\\b'],
].map(([k, p]) => [k, new RegExp(p, 'g')])
// Runda 5 (review r4 P1): restricțiile unei propoziții din sursă (grupe: conditie / exceptie / limita / contrast) — = RESTRICTIE
// din cercetare.py. Clauza = textul de după marcator, până la următorul marcator sau la sfârșitul propoziției.
const RESTRICTIE_SURSA = '\\b(?:(?<conditie>doar\\s+daca|numai\\s+daca|in\\s+cazul\\s+in\\s+care|cu\\s+conditia(?:\\s+ca)?|numai|doar|daca)'
  + '|(?<exceptie>cu\\s+exceptia|exceptand|in\\s+afara\\s+(?:de|cazului))|(?<limita>pana\\s+la)|(?<contrast>dar|insa|totusi|desi))\\b'
const RESTRICTIE = new RegExp(RESTRICTIE_SURSA, 'g')
const ALTERNATIVA = /\b(?:sau|ori)\b/
const LIMITA_EXPLICITA = /\bcel\s+(?:putin|mult)\b|\bnu\s+mai\s+(?:putin|mult)\s+de\b/
const NEGATIE_SIMPLA = /\b(?:nu|nici|niciun\w*|nicio|niciodata)\b/
const VERDICT_INCEPUT = new RegExp('^\\s*(?:da|nu)\\b\\s*[,.:;!' + String.fromCharCode(0x2014, 0x2013) + '-]+')
const OPUSE = { obligatie: 'fara_obligatie', fara_obligatie: 'obligatie', interdictie: 'permisiune', permisiune: 'interdictie' }
const NU_SE_PIERD = ['interdictie', 'fara_obligatie', 'conditie']
const LIMITE = ['minim', 'maxim']
const GRAD = String.fromCharCode(0xb0), CUB = String.fromCharCode(0xb3), PATRAT = String.fromCharCode(0xb2)
const UM = 'grade\\s+celsius|metri\\s+patrati|metri\\s+cubi|centimetri|centimetru|kilometri|kilometru|milimetri|milimetru|kilograme'
  + '|kilogram|saptamani|saptamana|procente|procent|secunde|secunda|minute|grade|metri|metru|litri|litru|mbari|mbar|zile|euro'
  + `|luni|luna|bari|bar|kpa|mpa|ore|ora|ani|min|lei|eur|${GRAD}\\s*c|mm|cm|km|kg|mc|mp|m3|m2|m${CUB}|m${PATRAT}|zi|an|m|h|l|s|${GRAD}|%`
const UNITATI = {
  'grade celsius': `${GRAD}c`, 'metri patrati': 'mp', 'metri cubi': 'mc', centimetri: 'cm', centimetru: 'cm', kilometri: 'km',
  kilometru: 'km', milimetri: 'mm', milimetru: 'mm', kilograme: 'kg', kilogram: 'kg', saptamani: 'saptamani',
  saptamana: 'saptamani', procente: '%', procent: '%', secunde: 's', secunda: 's', minute: 'minute',
  grade: 'grade', metri: 'm', metru: 'm', litri: 'l', litru: 'l',
  mbari: 'mbar', mbar: 'mbar', zile: 'zile', euro: 'euro', luni: 'luni', luna: 'luni', bari: 'bar', bar: 'bar',
  kpa: 'kpa', mpa: 'mpa', ore: 'ore', ora: 'ore', ani: 'ani', min: 'minute', lei: 'lei', eur: 'euro',
  [`${GRAD}c`]: `${GRAD}c`, [`${GRAD} c`]: `${GRAD}c`, mm: 'mm', cm: 'cm', km: 'km', kg: 'kg', mc: 'mc', mp: 'mp', m3: 'mc', m2: 'mp',
  [`m${CUB}`]: 'mc', [`m${PATRAT}`]: 'mp', zi: 'zile', an: 'ani', m: 'm', h: 'ore', l: 'l', s: 's', [GRAD]: 'grade', '%': '%',
}
const MINUS = String.fromCharCode(0x2212), LINIUTA = String.fromCharCode(0x2013), PLUSMINUS = String.fromCharCode(0xb1)
const LINIE_LUNGA = String.fromCharCode(0x2014), PUNCTE = String.fromCharCode(0x2026)
// runda 5 (review r4 P2): unitatea întreagă — exponent și numitori (= NUMERIC / NUMITOR din cercetare.py)
const EXPONENT = `(?:\\^?[23](?![0-9])|[${PATRAT}${CUB}])`
const NUMERIC_SURSA = `(?<![0-9])([0-9]+(?:[.,][0-9]+)?)(?:\\s*(?:de\\s+)?(${UM})(${EXPONENT})?((?:\\s*/\\s*[a-z${GRAD}]+${EXPONENT}?)*)(?![a-z0-9]))?`
const NUMERIC = new RegExp(NUMERIC_SURSA, 'g')
const NUMITOR = new RegExp(`/\\s*([a-z${GRAD}]+)(${EXPONENT})?`, 'g')
const SEMNE = { '-': '-', [MINUS]: '-', [LINIUTA]: '-', '+': '', [PLUSMINUS]: PLUSMINUS }
// semnul lipit / despărțit prin spațiu (= SEMN_LIPIT / SEMN_DESPARTIT); intervalele (= INTERVAL_* din cercetare.py)
const SEMN_CLASA = `[-+${MINUS}${LINIUTA}${PLUSMINUS}]`
const SEMN_LIPIT = new RegExp(`(?:^|(?<=[^0-9a-z]))(${SEMN_CLASA})$`)
const SEMN_DESPARTIT = new RegExp(`(${SEMN_CLASA})[ \\t]+$`)
const SEMN_CAPAT2 = `[-+${MINUS}${PLUSMINUS}]`
const INTERVAL_LINIE = new RegExp(`^[ \\t]*(?:[-${MINUS}${LINIUTA}${LINIE_LUNGA}]|\\.{2,3}|${PUNCTE})[ \\t]*(?:(?<=[ \\t])(${SEMN_CAPAT2}))?$`)
const INTERVAL_SI = new RegExp(`^\\s+si\\s+(?:(${SEMN_CAPAT2})[ \\t]*)?$`)
const INTERVAL_LA = new RegExp(`^\\s+(?:pana\\s+)?la\\s+(?:(${SEMN_CAPAT2})[ \\t]*)?$`)
const INAINTE_INTRE = /\bintre\s+$/
const INAINTE_DE_LA = /\bde\s+la\s+$/
const ABREVIERI = new Set('art alin pct lit nr ord hg oug cap sect par fig pag ex cca min max str ed vol pt np sr en iso stas tab pl'.split(' '))
const SEPARATOR = /[.!?;\n]/g
// runda 5: propoziția întreagă; o bucată care începe cu un marcator de restricție se lipește de cea dinainte (= INCEPE_CU_RESTRICTIE)
const INCEPE_CU_RESTRICTIE = new RegExp(`^\\s*[,:${LINIE_LUNGA}${LINIUTA}-]?\\s*` + RESTRICTIE_SURSA)

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

const exp = e => (e || '').replace('^', '').replace(PATRAT, '2').replace(CUB, '3')
const areCheie = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
/** O parte de unitate, canonică (= _parte_unitate din cercetare.py): „m” + „2” → „mp”, „s” + „2” → „s2”; necunoscută → cum e. */
function parteUnitate(baza, e) {
  const x = exp(e)
  if (x && areCheie(UNITATI, baza + x)) return UNITATI[baza + x]
  return (areCheie(UNITATI, baza) ? UNITATI[baza] : baza) + x
}
function unitate(m) {
  if (!m[2]) return ''
  let um = parteUnitate(m[2].split(/\s+/).filter(Boolean).join(' '), m[3])
  for (const d of (m[4] || '').matchAll(NUMITOR)) um += '/' + parteUnitate(d[1], d[2])
  return um
}
/** [semnul, poziția de unde începe] pentru numărul de la `start` (= _semn din cercetare.py). */
function semn(n, start) {
  const pre = n.slice(0, start)
  let m = pre.match(SEMN_LIPIT)
  if (m) return [SEMNE[m[1]], m.index + m[0].length - m[1].length]
  m = pre.match(SEMN_DESPARTIT)
  if (m) {
    const inainte = pre.slice(0, m.index)
    const ultim = inainte.replace(/[ \t]+$/, '').slice(-1)
    if (/[0-9]/.test(ultim)) return ['', start]
    if (!inainte.split('\n').pop().trim()) return ['?', m.index]
    return [SEMNE[m[1]], m.index]
  }
  return ['', start]
}
/** Cifrele unui text normalizat, ca tokeni compleți (= tokeni_numerici din cercetare.py): „−5 bar” / „- 5 bar” → „-5 bar”,
 *  „30 de zile” → „30 zile”, „5 m/s²” → „5 m/s2”, „între 2 și 6 bar” / „2–6 bar” → „2..6 bar”, „art. 12” → „12”. */
export function tokeniNumerici(n) {
  const bucati = []
  for (const m of n.matchAll(NUMERIC)) {
    const [s, poz] = semn(n, m.index)
    bucati.push({ poz, start: m.index, end: m.index + m[0].length, semn: s, val: m[1].replace(',', '.'), um: unitate(m) })
  }
  const out = []
  for (let i = 0; i < bucati.length; i++) {
    const a = bucati[i], b = bucati[i + 1]
    if (b) {
      const intre = n.slice(a.end, b.start)
      const um = a.um && b.um && a.um !== b.um ? null : (b.um || a.um)
      let m = intre.match(INTERVAL_LINIE)
      if (!(m && (a.um || b.um))) {
        const pre = n.slice(0, a.poz)
        m = (INAINTE_INTRE.test(pre) ? intre.match(INTERVAL_SI) : null) || (INAINTE_DE_LA.test(pre) ? intre.match(INTERVAL_LA) : null)
      }
      if (m && um !== null) {
        out.push(`${a.semn}${a.val}..${SEMNE[m[1] || ''] ?? ''}${b.val}` + (um ? ' ' + um : ''))
        i++
        continue
      }
    }
    out.push(a.semn + a.val + (a.um ? ' ' + a.um : ''))
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
    if (INCEPE_CU_RESTRICTIE.test(n.slice(k + 1))) continue
    bucati.push(n.slice(start, k))
    start = k + 1
  }
  bucati.push(n.slice(start))
  return bucati.map(p => p.trim()).filter(Boolean)
}

/** [[grupa, clauza]] — restricțiile unei propoziții normalizate (= restrictii din cercetare.py). */
export function restrictii(p) {
  const ms = [...p.matchAll(RESTRICTIE)]
  return ms.map((m, j) => [Object.keys(m.groups).find(g => m.groups[g] !== undefined),
    p.slice(m.index + m[0].length, j + 1 < ms.length ? ms[j + 1].index : p.length)])
}
/** Restricțiile propoziției din sursă se regăsesc în afirmație (= restrictii_acoperite din cercetare.py). */
function restrictiiAcoperite(afText, propText) {
  const grupe = new Set(restrictii(afText).map(([g]) => g))
  const cuv = cuvinte(afText), tok = new Set(tokeniNumerici(afText))
  for (const [g, clauza] of restrictii(propText)) {
    if (!grupe.has(g)) return false
    const ok = clauza.split(ALTERNATIVA).some(v => {
      const t = termeni(v)
      return potriviti(t, cuv) === t.length && tokeniNumerici(v).every(x => tok.has(x))
    })
    if (!ok) return false
  }
  return true
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
export const termeniCheie = linie => termeni(corpAfirmatie(linie))
/** termeniCheie pe un text deja normalizat, fără marcaje (= _termeni din cercetare.py). */
function termeni(text) {
  const n = polaritatiSiRest(text, true)[1].replace(NUMERIC, ' ')
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

/** O propoziție a afirmației (normalizată, fără marcaje) — = descrie_afirmatia din cercetare.py. */
function descrieAfirmatia(n) {
  const [clase, rest] = polaritatiSiRest(n, true)
  return { text: n, clase, neg: NEGATIE_SIMPLA.test(rest.replace(VERDICT_INCEPUT, ' ')), termeni: termeni(n), tok: tokeniNumerici(n) }
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
      out.push({ text: p, clase, neg: NEGATIE_SIMPLA.test(rest), cuvinte: cuvinte(ctx), tok: new Set(tokeniNumerici(ctx)) })
    }
  }
  return out
}
function potrivirePropozitie(af, prop) {
  // opusul din propoziție contează doar dacă afirmația nu-l spune și ea (runda 5: citarea întreagă „permisă, dar se interzice …”)
  for (const k of af.clase) if (!prop.clase.has(k) || (prop.clase.has(OPUSE[k]) && !af.clase.has(OPUSE[k]))) return false
  const pierdute = [...prop.clase].filter(k => !af.clase.has(k))
  if (pierdute.some(k => NU_SE_PIERD.includes(k))) return false
  if (af.tok.length && pierdute.some(k => LIMITE.includes(k))) return false
  return af.neg === prop.neg
}
/** [susținută, potriviți, total] — = sustinere din cercetare.py (runda 5: fiecare propoziție a rândului separat + restricțiile
 *  propoziției din sursă regăsite în afirmația normativă). */
function sustinere(linie, ids, harta, normativ) {
  const surse = propozitiiSurse(ids, harta)
  let totalPot = 0, totalTot = 0
  for (const fraza of propozitii(corpAfirmatie(linie))) {
    const af = descrieAfirmatia(fraza)
    if (!af.termeni.length && !af.tok.length && !af.clase.size) continue
    const tot = af.termeni.length, cuUm = af.tok.filter(t => t.includes(' '))
    let celMaiBun = -1
    for (const p of surse) {
      if (!potrivirePropozitie(af, p)) continue
      if (normativ && !cuUm.every(t => p.tok.has(t))) continue
      if (normativ && !restrictiiAcoperite(fraza, p.text)) continue
      celMaiBun = Math.max(celMaiBun, potriviti(af.termeni, p.cuvinte))
    }
    if (celMaiBun < (normativ ? tot : Math.floor((tot + 1) / 2))) return [false, Math.max(celMaiBun, 0), tot]
    totalPot += celMaiBun
    totalTot += tot
  }
  return [true, totalPot, totalTot]
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

/** Runda 5 (review r4 P2): prezentarea unui răspuns. Fără migrarea 20261131e detectată (`v2 !== true`, același semnal ca la
 *  butoane) ecranul arată EXACT ca înainte: eticheta veche, textul în Markdown, fără verdict evidențiat și fără blocul de surse.
 *  Cu migrarea: componenta nouă (verdict + surse), iar eticheta „din cercetare” DOAR pe răspunsurile fluxului nou — cele cu surse
 *  sau interogări web salvate (un răspuns de dinainte rămâne cu `surse` = [] și păstrează eticheta veche). */
export const ETICHETA_VECHE = '🤖 Răspuns AI · informativ, neverificat'
export const ETICHETA_CERCETARE = '🤖 Răspuns AI din cercetare · informativ, neverificat'
export function prezentareRaspuns({ v2, surse, interogari }) {
  if (v2 !== true) return { v2: false, cercetare: false, eticheta: ETICHETA_VECHE }
  const cercetare = surseAfisabile(surse).length > 0 || interogariAfisabile(interogari).length > 0
  return { v2: true, cercetare, eticheta: cercetare ? ETICHETA_CERCETARE : ETICHETA_VECHE }
}

/** Interogările web trimise (audit, doar ownerul le vede): listă de șiruri, max 20 × 200 de caractere. */
export function interogariAfisabile(x) {
  return Array.isArray(x) ? x.filter(q => typeof q === 'string' && q.trim()).slice(0, 20).map(q => q.slice(0, 200)) : []
}

// ─── Regula B (decizia owner-ului 13.11.2026) — aceeași ca aplica_regula_b din cercetare.py (paritate pe teste_regula_b.json).
// „Da” / „Nu” DOAR cu un citat aproape cuvânt cu cuvânt: ≥ CITAT_MIN_CUVINTE cuvinte, ≥ 90% din ele în aceeași ordine într-o singură
// propoziție a sursei marcate pe aceeași linie, aceleași cifre (semn + număr + unitate), aceeași negație, restricțiile sursei păstrate.
// Workerul o aplică înainte de publicare; aici e portarea pentru teste (verificarea pe aceleași cazuri) și pentru o eventuală afișare.
export const CITAT_MIN_CUVINTE = 6
export const CITAT_PRAG = 0.9
const CITAT = /[„“"«]([^„“”"«»\n]{8,800})[”“"»]/g
const CUVINTE_CITAT = /[a-z]+|[0-9]+(?:[.,][0-9]+)?/g
export const INCERT_REGULA_B = `${INCERT}: nicio sursă nu spune aproape cuvânt cu cuvânt același lucru — citește sursele alăturate.`

function lcs(a, b) {
  let prev = new Array(b.length + 1).fill(0)
  for (const x of a) {
    const cur = [0]
    b.forEach((y, j) => cur.push(x === y ? prev[j] + 1 : Math.max(prev[j + 1], cur[j])))
    prev = cur
  }
  return prev[prev.length - 1]
}

// r2 (review PR #1086, P1-3): inversoarele de sens se perechează la aliniere — vezi _aliniere din cercetare.py (aceleași liste).
const INVERSOARE_NEGATIE = /^(?:nu|nici|niciun\w*|nicio|niciodata|nimic|nimeni|fara|exceptand|exceptia|exceptie|decat|ne(?:admis|permis|conform|autorizat|obligatori|avizat|respect|indeplin|corespunz|valid|accept|receptio)\w*)$/
const INVERSOARE_MODAL = /^(?:trebui\w*|poate|pot|obligatori\w*|optional\w*|facultativ\w*|interzi\w*|admis\w*|admit\w*|permis\w*|permit\w*|recomand\w*)$/
const inversor = w => INVERSOARE_NEGATIE.test(w) ? 2 : INVERSOARE_MODAL.test(w) ? 1 : 0

/** Câte cuvinte din citat se perechează, cu inversoarele obligatoriu perechate; -1 = nicio aliniere validă (vezi cercetare.py). */
export function aliniere(q, p) {
  const NU = -1, m = q.length, n = p.length
  const tq = q.map(inversor), tp = p.map(inversor)
  const f = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => [NU, NU, NU]))
  f[0][0][0] = 0
  for (let i = 0; i <= m; i++) for (let j = 0; j <= n; j++) for (let faza = 0; faza < 3; faza++) {
    const v = f[i][j][faza]
    if (v === NU) continue
    if (faza === 1 && v > f[i][j][2]) f[i][j][2] = v
    if (i < m && j < n && faza < 2 && q[i] === p[j] && v + 1 > f[i + 1][j + 1][1]) f[i + 1][j + 1][1] = v + 1
    if (i < m && tq[i] === 0 && v > f[i + 1][j][faza]) f[i + 1][j][faza] = v
    if (j < n && (tp[j] === 0 || (tp[j] === 1 && faza !== 1)) && v > f[i][j + 1][faza]) f[i][j + 1][faza] = v
  }
  return Math.max(...f[m][n])
}

/** Citatul trece pragul „aproape cuvânt cu cuvânt” față de o propoziție a uneia dintre sursele `ids` (Map-ul din hartaSurse). */
function citatSustinut(citat, ids, harta) {
  const n = normalizeaza(citat)
  const q = n.match(CUVINTE_CITAT) || []
  if (q.length < CITAT_MIN_CUVINTE) return false
  const tok = tokeniNumerici(n)
  for (const i of ids) {
    if (!harta.has(i)) continue
    const v = harta.get(i)
    for (const p of propozitii(v.slice(v.indexOf('\n') + 1))) {
      const cp = p.match(CUVINTE_CITAT) || []
      if (lcs(q, cp) < CITAT_PRAG * q.length) continue
      const tp = new Set(tokeniNumerici(p))
      if (aliniere(q, cp) < CITAT_PRAG * q.length || !tok.every(x => tp.has(x))) continue
      if (restrictiiAcoperite(n, p)) return true
    }
  }
  return false
}

/** Răspunsul are măcar un citat care trece pragul, pe o linie cu marcajul sursei citate. */
export function areCitat(text, surse) {
  const harta = hartaSurse(surse)
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const ids = marcaje(linie).filter(i => harta.has(i))
    if (ids.length && [...linie.matchAll(CITAT)].some(m => citatSustinut(m[1], ids, harta))) return true
  }
  return false
}

/** 'da' / 'nu' / 'incert' / 'depinde' / null — după prima linie. */
export function tipVerdict(text) {
  const n = normalizeaza(verdict(text) || '')
  return ['incert', 'depinde', 'da', 'nu'].find(k => new RegExp(`^${k}\\b`).test(n)) || null
}

export const cereCitat = (text, surse) => ['da', 'nu'].includes(tipVerdict(text)) && !areCitat(text, surse)

/** [text, motiv] — ca aplica_regula_b din cercetare.py. */
export function aplicaRegulaB(text, surse) {
  const tip = tipVerdict(text)
  const linii = String(text ?? '').replace(/\r/g, '').split('\n')
  const i = linii.findIndex(l => l.trim())
  if (tip === null || i < 0) return [text, 'fara_verdict']
  if (tip === 'incert') return [text, 'incert']
  if (tip === 'depinde') {
    const v = verdict(text)
    linii[i] = `${INCERT} — ${v.slice(0, 1).toLowerCase()}${v.slice(1)}`
    return [linii.join('\n'), 'depinde']
  }
  if (areCitat(text, surse)) return [text, 'citat']
  linii[i] = INCERT_REGULA_B
  return [linii.join('\n'), 'fara_citat']
}
