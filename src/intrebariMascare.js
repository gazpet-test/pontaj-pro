// ════════════════════════════════════════════════════════════════
// ❓ Întreabă echipa — MOTORUL UNIC de mascare și al regulii B (r6, PR #1086; deciziile owner-ului 13.11.2026: A = numele nu pleacă
// la furnizor, B = „Da” / „Nu” doar cu citat). Stau aici, o singură dată:
//   - normalizarea (curata / norm — O SINGURĂ funcție pentru caracterele invizibile, de combinare și formele de compatibilitate;
//     r6: și O SINGURĂ reprezentare a textului pe care rulează TOATE etapele de recunoaștere);
//   - mascarea numelor (dicționarul platformei + tipare), învățarea / propagarea în speță, etichetele, demascarea strictă;
//   - regula B STRUCTURALĂ (r5): paragrafele sursei, paragraful dintr-o singură propoziție, elementul de listă, citatul = paragraful
//     întreg.
// NU stau aici (r5, granița declarată): validarea răspunsului — susținerea afirmațiilor de către surse, polaritatea regulii,
// curățarea liniilor nesusținute — rămâne în worker/intrebari-tehnice/cercetare.py, cu perechea ei din src/intrebariSurse.js
// (același set comun de teste: teste_validare.json, teste_normative.json). Mutarea ei aici = lucrare separată.
// Cine îl folosește:
//   - ecranul (IntrebariTehnice.jsx) — PREVIZUALIZAREA orientativă (lista de nume pe care o poate citi contul; fără localități);
//   - workerul (worker/intrebari-tehnice/motor.py) — prin procesul Node worker/intrebari-tehnice/motor_cli.mjs, câte un proces
//     pe speță; Python orchestrează (ce se trimite, ce se publică) și validează răspunsul (vezi mai sus), fără reguli de mascare
//     sau de regula B.
// Contractul de acoperire (ce TREBUIE ascuns, ce e în afara lui) și regula B: docs/intrebari/MASCARE_SI_VERDICT.md; cazurile:
// worker/intrebari-tehnice/teste_motor.json (aceleași în vitest, prin procesul Node real și în browser) și matricea generativă
// worker/intrebari-tehnice/generativ.mjs (vitest + procesul Node real).
// Unicode: categoriile M / Cf / L / N / Z sunt cele ale motorului JS care rulează (serverul: Node 24.20 = Unicode 17.0, fixat în
// worker/intrebari-tehnice/motor_manifest.json; browserul: versiunea lui). Caracterele numite explicit în contract au aceeași
// categorie în toate versiunile ≥ 6.
// Codul acestui fișier nu conține apeluri de rețea, de fișiere sau de procese: verificarea statică pe ARBORELE sintactic din
// src/intrebariMascare.test.js (importuri, importuri dinamice, identificatori). E o proprietate a codului fixat prin manifest,
// NU o izolare a procesului.
// ════════════════════════════════════════════════════════════════
import NEMASCATE_JSON from '../worker/intrebari-tehnice/nemascate.json' with { type: 'json' }
import VOCABULAR_JSON from '../worker/intrebari-tehnice/vocabular_web.json' with { type: 'json' }
import COMUNE_JSON from '../worker/intrebari-tehnice/cuvinte_comune.json' with { type: 'json' }

export const MOTOR_VERSIUNE = '6.0.0'
export const NUME_MAX_LISTA = 200000      // = NUME_MAX_LISTA din supabase/functions/intrebari-tehnice-worker/logic.js (test)
const U = (...c) => String.fromCharCode(...c)
const NBSP = U(0xa0)
const CRATIME = '\\-' + U(0x2010, 0x2011)                              // cratimele contractului: - U+2010 U+2011
const LINIUTE = U(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)
const RE_CRATIMA = new RegExp(`[${CRATIME}]`, 'u')

// ─── 1. Normalizarea: O SINGURĂ funcție (r6: și O SINGURĂ reprezentare a textului pentru recunoaștere) ──────────────────
// Reprezentarea de recunoaștere (`curata`): fiecare caracter al textului, pe rând, descompus de COMPATIBILITATE (NFKD — literele
// late „ＳＲＬ” → „SRL”, ligaturile, diacriticele „ș” → „s” + semn), fără semnele de combinare (categoria M — diacritice, U+034F,
// selectorii de variantă U+FE00–FE0F și U+E0100–E01EF) și fără caracterele de format (Cf — U+200B, U+00AD, U+FEFF, marcaje de
// direcție). r6 (review r5 P1): TOATE etapele de recunoaștere (forma juridică despărțită / lipită, „SC”, titlurile, tiparele, CUI-ul,
// etichetele, separatoarele, flexiunile, componentele) rulează pe ACEASTĂ reprezentare; intervalele găsite se pun înapoi pe textul
// original prin harta de poziții (ce se înlocuiește e bucata ORIGINALĂ completă: dus-întorsul rămâne exact). Forma de comparare a
// numelor (`norm`) e aceeași funcție, plus literele mici.
const ELIMINABIL = /[\p{M}\p{Cf}]/u
const ASCII = /^[\x00-\x7f]*$/
const MARCA = /^\p{M}$/u

/** {s: reprezentarea de recunoaștere, idx / sf: începutul / sfârșitul în original al caracterului din care vine fiecare unitate din s
 *  (null = textul e ASCII, s e chiar textul)}. Un caracter descompus în mai multe (ligatura „ﬁ” → „fi”) dă unități cu același
 *  interval original. */
export function curata(text) {
  const t = String(text ?? '')
  if (ASCII.test(t)) return { s: t, idx: null, sf: null }
  let s = ''
  const idx = [], sf = []
  for (let i = 0; i < t.length;) {
    const cp = t.codePointAt(i)
    const ch = String.fromCodePoint(cp), n = ch.length
    if (cp < 0x80) { s += ch; idx.push(i); sf.push(i + 1) }
    else if (!ELIMINABIL.test(ch)) {
      for (const c of ch.normalize('NFKD')) {
        if (ELIMINABIL.test(c)) continue
        s += c
        for (let k = 0; k < c.length; k++) { idx.push(i); sf.push(i + n) }
      }
    }
    i += n
  }
  return { s, idx, sf }
}

/** Forma de comparare a numelor: reprezentarea de recunoaștere (curata), cu litere mici — „Șerban” = „Şerban” = „Serban” (și forma
 *  descompusă); literele late și celelalte forme de compatibilitate („ＶＬĂＤＥＳＣＵ”, ligaturi) = literele obișnuite. A doua trecere
 *  prinde literele mici care se descompun („İ” → „i̇”). Se folosește DOAR la comparare. */
export const norm = s => curata(curata(s).s.toLowerCase()).s

/** Intervalul [s, e) din reprezentare → [a, b) în original (caracterele originale întregi); semnele de combinare lipite după ultima
 *  literă intră și ele. */
function inapoi(t, r, s, e) {
  if (!r.idx) return [s, e]
  let b = r.sf[e - 1]
  while (b < t.length) {
    const ch = String.fromCodePoint(t.codePointAt(b))
    if (!MARCA.test(ch)) break
    b += ch.length
  }
  return [r.idx[s], b]
}

// ─── 2. Etichetele ─────────────────────────────────────────────────────────────────────────────────────────────────
export const CATEGORII = ['PERSOANA', 'FIRMA', 'CNP', 'CUI', 'TELEFON', 'EMAIL', 'IBAN', 'NR_AUTO', 'ASCUNS']
// eticheta emisă, EXACT (majuscule) — doar așa se pune la loc
const ETICHETA_SURSA = '\\[(PERSOANA|FIRMA|CNP|CUI|TELEFON|EMAIL|IBAN|NR_AUTO|ASCUNS)_([1-9][0-9]{0,3})(?:_F([1-9][0-9]{0,2}))?\\]'
const eticheta = () => new RegExp(ETICHETA_SURSA, 'g')
// „Aproape etichetă” (r4, pct. 5 din brief): DOAR formele care nu pot fi proză obișnuită —
//   (a) între paranteze drepte: „[” + categoria (orice litere, cu / fără diacritice) + separatori + cifre („[persoana_1]”,
//       „[PERSOANA 1]”, „[FIRMA-2 ]”, „[PERSOANA_1_F9]”);
//   (b) fără paranteze: categoria EXACTĂ cu majuscule + „_” + cifre („PERSOANA_1”, „NR_AUTO_3”).
// „firma 2 a contractat lucrarea”, „persoana 1”, „CUI 12345678” NU mai sunt etichete (r3 le refuza — L20).
const CAT_ASEM = '(?:PERSOAN[AĂ]|FIRM[AĂ]|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[ _.\\-]?AUTO|ASCUNS)'
const ASEM_PARANTEZE = '\\[[ \\t]*' + CAT_ASEM + '[ \\t_\\-#]*[0-9]+(?:[ \\t]*[_\\-][ \\t]*[A-Za-z]?[0-9]+)*(?:[ \\t]*\\])?'
const ASEM_GOL = '(?<![A-Za-z0-9\\[_])(?:PERSOANA|FIRMA|CNP|CUI|TELEFON|EMAIL|IBAN|NR_AUTO|ASCUNS)_[0-9]+(?:_F?[0-9]+)*(?![A-Za-z0-9_])'
// Forma LARGĂ (eticheta „ruptă”): pe textul fără spații albe și caractere invizibile / de combinare, „[” + categoria + separatori
// + cifre („[PERSOANA_\n999]”, NBSP sau U+200B în ea). Paranteza dreaptă e obligatorie; categoria, fără deosebire de majuscule.
const LARG = new RegExp('\\[(?:PERSOANA|FIRMA|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[_.\\-]?AUTO|ASCUNS)[_#.:()\\[\\]' + LINIUTE + '\\-]*[0-9]+', 'gi')
const ALB_LARG = /^[\p{Z}\p{Cc}]$/u

const toate = (re, t) => [...t.matchAll(re)]

/** Aparițiile „aproape etichetă” (a) + (b), fără suprapuneri, în ordine. */
function asemanatoare(t) {
  const m = [...toate(new RegExp(ASEM_PARANTEZE, 'giu'), t), ...toate(new RegExp(ASEM_GOL, 'gu'), t)].sort((a, b) => a.index - b.index)
  const out = []
  let pana = -1
  for (const x of m) if (x.index >= pana) { out.push(x); pana = x.index + x[0].length }
  return out
}

/** Tot șirul e o „aproape etichetă”. */
export const eAsemanator = s => {
  const t = String(s ?? '')
  return new RegExp(`^(?:${ASEM_PARANTEZE})$`, 'iu').test(t) || new RegExp(`^(?:${ASEM_GOL})$`, 'u').test(t)
}

/** [[a, b)] în textul original ale aparițiilor LARGI (a = poziția lui „[”). r6: pe reprezentarea de recunoaștere (curata), din care
 *  se scot în plus spațiile albe și caracterele de control. */
export function larg(t) {
  const r = curata(t)
  let s = ''
  const poz = [], sf = []
  for (let k = 0; k < r.s.length; k++) {
    const c = r.s[k]
    if (ALB_LARG.test(c)) continue
    s += c
    poz.push(r.idx ? r.idx[k] : k); sf.push(r.idx ? r.sf[k] : k + 1)
  }
  return toate(LARG, s).map(m => [poz[m.index], sf[m.index + m[0].length - 1]])
}

// ─── 3. Tipare (date personale cu formă fixă) ──────────────────────────────────────────────────────────────────────
const SP = `[ \\t${NBSP}]`
const ZS = `[\\p{Zs}\\t]`
const MANUAL = /\[\[[^[\]\n]{1,200}\]\]/g
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g
const CNP = /(?<![0-9])[1-9][0-9]{12}(?![0-9])/g
const CUI_RO = /(?<![A-Za-z0-9])RO[ \t]?[0-9]{4,10}(?![0-9])/g
const CUI_CUVANT = new RegExp('(?<![A-Za-z0-9])(?:CUI|C\\.U\\.I\\.?|Cui|CIF|C\\.I\\.F\\.?|[Cc]if|[Cc][Oo][Dd](?:[Uu][Ll])?[ \\t]+(?:[Ff][Ii][Ss][Cc][Aa][Ll]'
  + '|[Uu][Nn][Ii][Cc][ \\t]+[Dd][Ee][ \\t]+[IiÎî][Nn][Rr][Ee][Gg][Ii][Ss][Tt][Rr][Aa][Rr][Ee]))'
  + '[ \\t]*(?:[Nn][Rr]\\.?)?[ \\t]*[:.\\-]?[ \\t]*(?<v>(?:RO[ \\t]?)?[0-9]{2,10})(?![0-9])', 'gd')
const CUI_GRUPE = new RegExp(`(?<![0-9])[0-9]+(?:[ .\\-${NBSP}][0-9]+)*(?![0-9])`, 'g')
const TELEFON = /(?<![0-9A-Za-z+])(?:\+40|0040|0)[ \t.\-/]?[237](?:[ \t.\-/]?[0-9]){8}(?![0-9])/g
const JUDETE = 'AB AG AR BC BH BN BR BT BV BZ CJ CL CS CT CV DB DJ GJ GL GR HD HR IF IL IS MH MM MS NT OT PH SB SJ SM SV TL TM TR VL VN VS'
const NR_AUTO = new RegExp(`(?<![A-Za-z0-9])(?:B[ \\t\\-]?[0-9]{2,3}|(?:${JUDETE.split(' ').join('|')})[ \\t\\-]?[0-9]{2})[ \\t\\-]?([A-Z]{3})(?![A-Za-z0-9])`, 'g')
const NR_AUTO_EXCLUSE = new Set('BAR SDR PEH PVC MPA KPA ISO DIN OTL PEX PPR HDP'.split(' '))
const doarCifre = s => s.replace(/[^0-9]/g, '')

function cnpValid(c) {
  let s = 0
  for (let i = 0; i < 12; i++) s += Number(c[i]) * Number('279146358279'[i])
  s %= 11
  return (s === 10 ? 1 : s) === Number(c[12])
}
function ibanValid(v) {
  if (v.length < 15 || v.length > 34) return false
  let rest = 0
  for (const ch of v.slice(4) + v.slice(0, 4)) {
    const val = ch >= '0' && ch <= '9' ? Number(ch) : ch.charCodeAt(0) - 55
    rest = (rest * (val >= 10 ? 100 : 10) + val) % 97
  }
  return rest === 1
}
/** Lungimea celui mai lung prefix care e un IBAN valid (un cuvânt lipit după nu-l strică); 0 = niciunul. */
function ibanLungime(s) {
  const compact = [...s].map((ch, i) => ch === ' ' ? -1 : i).filter(i => i >= 0)
  for (let n = compact.length; n > 14; n--) if (ibanValid(compact.slice(0, n).map(i => s[i]).join(''))) return compact[n - 1] + 1
  return 0
}

// ─── 4. Liste statice (scurte, închise) ───────────────────────────────────────────────────────────────────────────
const setDin = s => new Set(s.split(/\s+/).filter(Boolean))
const ordine = (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)
const FORME_JURIDICE = new Set(['sc', 'srl', 'sa', 'pfa', 'ii', 'if', 'snc', 'scs'])
const TITLURI = `d-l d-lui d-na d-nei dl dlui dna dnei domnul domnului doamna doamnei domni[sș]oara domni[sș]oarei ing inginerul
inginerului inginera inginerei arh arhitectul arhitecta dr colegul colegului colega colegei [sș]eful [sș]efului [sș]efa [sș]efei
directorul directorului directoarea directoarei dirigintele dirigintelui diriginta maistrul maistrului sudorul sudorului
[sș]oferul [sș]oferului numitul numitului numita numitei`.split(/\s+/).sort(ordine)
const TITLU = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${TITLURI.join('|')})\\.?${SP}+`, 'giu')
const TITLURI_NORM = new Set(TITLURI.map(x => norm(x.replace('[sș]', 's'))))
// cuvinte care nu pot fi (parte din) nume: legături, roluri, documente, structura lucrărilor
const OPRIRE = new Set([...setDin(`si sau de la din cu pe in pentru catre prin despre fara dupa intre sub peste al ale a ai un o unei unui cel cea cei
cele acest aceasta acesta aceste acestui acestei el ea ei ele noi voi dar iar ca ce care cand unde daca nu da firma firmei firme
societatea societatii societate contractul contractului contract beneficiarul beneficiarului beneficiar antreprenorul
antreprenorului furnizorul furnizorului subcontractantul subcontractantului subcontractorul clientul clientului proiectantul
proiectantului executantul executantului ofertantul ofertantului consultantul oferta licitatia proiectul proiect lucrarea lucrare
santierul etapa faza clasa zona lot lotul capitolul anexa anexei tip tipul categoria nivelul nivel treapta grupa varianta partea
titlul sectiunea cartea volumul tronsonul tronson sectorul obiectul etajul articolul gradul plansa corp corpul bloc blocul strada str
nr judetul jud comuna orasul municipiul satul romania ro cui cif comunei orasului municipiului primaria primariei consiliul
consiliului judetean statul ministerul agentia directia administratia regia ocolul parohia asociatia mostenitorii mostenitor
neidentificat`), ...FORME_JURIDICE, ...TITLURI_NORM])
// componente de firmă generice: nu se propagă singure („Servicii” după „Engie Servicii”)
const GENERICE_FIRMA = setDin(`construct constructii instal grup group impex trans service servicii com prod serv consult general
proiect design tehnic tehnica gaz gaze energy energie`)
// intrările din coloanele scrise liber care nu identifică pe nimeni („diverse”, „persoana fizica”, „furnizor necunoscut”)
const FARA_VALOARE = setDin(`diverse divers diversi diversa persoana persoane fizica fizice juridica juridice furnizor furnizori client
clienti necunoscut necunoscuta necunoscuti nespecificat nespecificata altul alta alte altii altele fara nume test teste exista lipsa
niciunul niciuna nimeni toti oricare generic`)
// Flexiuni (contract): UN singur sufix din mulțimea închisă, pe o tulpină de cel puțin 4 litere; plus genitivul feminin.
export const TERMINATII = ['ului', 'ilor', 'ule', 'lui', 'lor', 'ul', 'le', 'ei', 'ii', 'e', 'i']
const COMPONENTA_MIN_TULPINA = 4
const MARCAJE_LOCALITATE = setDin(`comuna comunei comunele com satul satului satele sat orasul orasului oras municipiul municipiului
mun localitatea localitatii loc judetul judetului jud uat`)
const MARCAJE_ABREVIERI = new Set(['com', 'mun', 'loc', 'jud'])
export const CATEGORII_NEMASCATE = ['operator_retea', 'companie_publica', 'institutie_publica', 'societatea_noastra']

/** cuvinte_comune.json, validat: listă nevidă de cuvinte cu litere mici, fără diacritice. Altfel aruncă (motorul nu pornește). */
export function incarcaComune(date) {
  if (!date || typeof date !== 'object' || !Array.isArray(date.cuvinte) || !date.cuvinte.length) throw new Error('cuvinte_comune')
  for (const c of date.cuvinte) if (typeof c !== 'string' || !/^[a-z]+$/.test(c)) throw new Error('cuvinte_comune')
  return new Set(date.cuvinte)
}
const VOCABULAR_COMUN = (() => {
  if (!VOCABULAR_JSON || !Array.isArray(VOCABULAR_JSON.termeni) || !VOCABULAR_JSON.termeni.length) throw new Error('vocabular_web')
  return new Set(VOCABULAR_JSON.termeni.flatMap(t => String(t).split(/\s+/).filter(Boolean)).map(norm))
})()
// „Componentă comună” (contract): un cuvânt obișnuit — singur, fără context identificator, rămâne vizibil.
const COMUN = new Set([...setDin(`mare mic mica micu preda verde rosu negru alb albu bun buna lung lungu gros grosu scurt nou noua vechi
ion ioni mai iunie iulie august tot toma`), ...GENERICE_FIRMA, ...FARA_VALOARE, ...VOCABULAR_COMUN, ...incarcaComune(COMUNE_JSON)])

// ─── 5. Entitățile publice (decizia owner-ului; lista ÎNCHISĂ din nemascate.json) ────────────────────────────────
const RE_SIMPLU = /\p{L}+|[0-9]+/gu

/** Cuvintele normalizate ale unui nume de firmă, fără „SC” / „SRL” / „S.R.L.” / „societatea comercială”. */
function tokeniFirmaLista(nume) {
  const toks = toate(RE_SIMPLU, curata(nume).s).map(m => norm(m[0]))
  const out = []
  let i = 0
  while (i < toks.length) {
    const t = toks[i]
    let j = i
    while (j < toks.length && toks[j].length === 1 && /^\p{L}$/u.test(toks[j])) j++
    if (j - i >= 2 && FORME_JURIDICE.has(toks.slice(i, j).join(''))) { i = j; continue }
    if (FORME_JURIDICE.has(t)) { i++; continue }
    if (t === 'societatea' && toks[i + 1] === 'comerciala') { i += 2; continue }
    out.push(t); i++
  }
  return out
}

/** Forma canonică a numelui unei firme: fără forma juridică, inițialele lipite („S.N.T.G.N.” → „sntgn”; „E.ON” → „e on”). */
export function cheieEntitate(nume) {
  const toks = tokeniFirmaLista(nume)
  const out = []
  let i = 0
  while (i < toks.length) {
    let j = i
    while (j < toks.length && toks[j].length === 1 && /^\p{L}$/u.test(toks[j])) j++
    if (j - i >= 2) { out.push(toks.slice(i, j).join('')); i = j } else { out.push(toks[i]); i++ }
  }
  return out.join(' ')
}

/** Formele canonice din nemascate.json, validate; invalid → aruncă (motorul nu pornește — fail closed). */
export function incarcaNemascate(date) {
  if (!date || typeof date !== 'object' || !Array.isArray(date.entitati) || !date.entitati.length) throw new Error('entitati')
  const cat = Object.keys(date.categorii || {}).sort()
  if (cat.join('|') !== [...CATEGORII_NEMASCATE].sort().join('|')) throw new Error('categorii')
  const out = new Set()
  for (const e of date.entitati) {
    if (!e || typeof e !== 'object' || Object.keys(e).sort().join('|') !== 'categorie|forme|nume') throw new Error('intrare')
    if (typeof e.nume !== 'string' || !e.nume.trim() || !CATEGORII_NEMASCATE.includes(e.categorie)) throw new Error('intrare')
    if (!Array.isArray(e.forme) || !e.forme.length) throw new Error('forme')
    for (const f of e.forme) { if (typeof f !== 'string' || !f || cheieEntitate(f) !== f) throw new Error('forma'); out.add(f) }
  }
  return out
}
export const NEMASCATE = incarcaNemascate(NEMASCATE_JSON)
const NEMASCATE_UN_CUVANT = new Set([...NEMASCATE].filter(f => !f.includes(' ')))
const PRIMELE_PUBLICE = new Set([...NEMASCATE].flatMap(f => [f.split(' ')[0], f[0]]))
// r5: orice cuvânt din numele unei entități publice („transgaz”, „romania”, „grid”) — nu e componentă distinctivă de firmă privată
const CUVINTE_PUBLICE = new Set([...NEMASCATE].flatMap(f => f.split(' ')))

// ─── 6. Componentele de nume (regula tulpinii) ───────────────────────────────────────────────────────────────────
/** Componenta din `multime` (Set / Map) a cuvântului normalizat `n`: el însuși; genitivul feminin (-a → -ei / -ăi, -ea → -eei:
 *  „Anei”, „Mariei”, „Olgăi”, „Andreei”); tulpina ≥ 4 litere + UN sufix din TERMINATII („Popescului”, „Popescule”). null = nu. */
export function componenta(n, multime) {
  if (multime.has(n)) return n
  if (n.length >= 4 && (n.endsWith('ei') || n.endsWith('ai')) && multime.has(n.slice(0, -2) + 'a')) return n.slice(0, -2) + 'a'
  if (n.length >= 5 && n.endsWith('ei') && multime.has(n.slice(0, -1) + 'a')) return n.slice(0, -1) + 'a'
  for (const t of TERMINATII) {
    const b = n.slice(0, -t.length)
    if (n.endsWith(t) && b.length >= COMPONENTA_MIN_TULPINA && multime.has(b)) return b
  }
  return null
}
const majuscula = t => /^\p{Lu}/u.test(t)
// r5: „scris cu majusculă” = conține CEL PUȚIN o majusculă, oriunde („Vlădescu”, „VLĂDESCU”, „vLĂDESCU”); „scris mic” = niciuna
const areMajuscula = t => /\p{Lu}/u.test(t)
const toateMari = t => t.toUpperCase() === t && t.toLowerCase() !== t
const titluCaz = t => majuscula(t) && /\p{Ll}/u.test(t.slice(1))
const cifra = t => /^[0-9]/.test(t)

// ─── 7. Dicționarul (numele cunoscute platformei — doar pentru căutare locală) ───────────────────────────────────
const RE_COMPUS = new RegExp(`(?<![\\p{L}\\p{N}_])\\p{L}+(?:[${CRATIME}]\\p{L}+)*(?![\\p{L}\\p{N}_])`, 'gu')
const RE_NUMAR = /(?<![0-9])[0-9]+(?![0-9])/g
const parti = tok => tok.split(RE_CRATIMA).filter(Boolean)

const cheiePereche = (a, b) => a < b ? a + U(1) + b : b + U(1) + a

/** Intrarea de firmă nu identifică pe nimeni: goală sau făcută doar din cuvinte fără valoare / de legătură. */
const firmaFaraValoare = tok => !tok.length || tok.every(t => FARA_VALOARE.has(t) || OPRIRE.has(t))

export class Dictionar {
  constructor(persoane = [], firme = [], cui = [], localitati = []) {
    this.aruncate = { persoane: 0, firme: 0, firme_publice: 0 }
    this.localitati = new Set()
    for (const v of localitati) for (const m of toate(RE_COMPUS, curata(v).s))
      for (const p of [m[0], ...parti(m[0])]) {
        const n = norm(p)
        if (n.length >= 3 && !OPRIRE.has(n) && !MARCAJE_LOCALITATE.has(n)) this.localitati.add(n)
      }
    this.persoane = new Set()
    this.perechi = new Set()          // două componente ale ACELUIAȘI nume din listă („vladescu” + „ana”)
    // r6 (review r5 P2): numele din listă, fiecare ca mulțimea componentelor lui, și componenta → numele în care apare
    this.nume = []
    this.numeDe = new Map()
    const vazut = new Set()
    for (const nume of persoane) {
      const comp = new Set()
      for (const m of toate(RE_COMPUS, curata(nume).s))
        for (const p of parti(m[0])) {
          const n = norm(p)
          if (n.length >= 3 && !OPRIRE.has(n) && !FARA_VALOARE.has(n)) comp.add(n)
        }
      if (!comp.size) { this.aruncate.persoane++; continue }
      for (const n of comp) this.persoane.add(n)
      const c = [...comp]
      for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) this.perechi.add(cheiePereche(c[i], c[j]))
      const k = cheiePers(comp)
      if (vazut.has(k)) continue
      vazut.add(k)
      const id = this.nume.length
      this.nume.push(comp)
      for (const n of comp) { if (!this.numeDe.has(n)) this.numeDe.set(n, []); this.numeDe.get(n).push(id) }
    }
    const index = new Map()
    this.firmeCuContext = 0
    for (const nume of firme) {
      const tok = tokeniFirmaLista(nume)
      if (tok.length && NEMASCATE.has(cheieEntitate(nume))) { this.aruncate.firme_publice++; continue }
      if (firmaFaraValoare(tok)) { this.aruncate.firme++; continue }
      const cheie = tok.join(' ')
      if (!index.has(tok[0])) index.set(tok[0], new Map())
      if (!index.get(tok[0]).has(cheie)) { index.get(tok[0]).set(cheie, tok); if (this.firmaComuna(tok)) this.firmeCuContext++ }
    }
    this.firme = new Map([...index].map(([k, v]) => [k, [...v.values()].sort((a, b) => b.length - a.length || ordine(a.join(' '), b.join(' ')))]))
    // r5: componentele DISTINCTIVE ale firmelor private (oricare, nu doar prima) → cheia firmei (sau componenta, dacă e în mai multe)
    this.componenteFirma = new Map()
    for (const lista of this.firme.values()) for (const tup of lista) {
      const cheie = tup.join(' ')
      for (const c of tup) {
        if (!this.distinctivFirma(c)) continue
        const v = this.componenteFirma.get(c)
        this.componenteFirma.set(c, v === undefined || v === cheie ? cheie : c)
      }
    }
    this.cui = new Set()
    for (const c of cui) { const d = doarCifre(String(c ?? '')); if (d.length >= 6 && d.length <= 10) this.cui.add(d) }
  }

  /** Componenta comună (contract): cuvânt obișnuit sau localitate cunoscută — singură, fără context, rămâne vizibilă. */
  comun(c) { return COMUN.has(c) || this.localitati.has(c) }
  /** `a` și `b` sunt componente ale aceluiași nume din listă. */
  pereche(a, b) { return a !== b && this.perechi.has(cheiePereche(a, b)) }
  /** r6 — componentele `chei` (distincte) aparțin TOATE aceluiași nume din listă (și sunt cel mult câte componente are el). */
  acelasiNume(chei) {
    if (new Set(chei).size !== chei.length) return false
    const cand = this.numeDe.get(chei[0])
    return !!cand && cand.some(id => chei.every(c => this.nume[id].has(c)))
  }
  /** O firmă dintr-un singur cuvânt comun / scurt / numeric / localitate cere context (formă juridică, „SC”, numele întreg văzut). */
  firmaComuna(tup) { return tup.length === 1 && (this.comun(tup[0]) || tup[0].length < 4 || /^[0-9]+$/.test(tup[0])) }
  /** r5 — componentă DISTINCTIVĂ de firmă privată (se ascunde și singură, scrisă cu majusculă sau cu formă juridică / „SC” lângă):
   *  baza normalizată are ≥ 4 litere, nu e număr și NU e în listele închise: cuvintele comune (cuvinte_comune.json, vocabular_web.json,
   *  listele scurte din motor), localitățile cunoscute, cuvintele entităților publice (nemascate.json), formele juridice, cuvintele de
   *  legătură / roluri / titluri (OPRIRE). */
  distinctivFirma(c) {
    return c.length >= COMPONENTA_MIN_TULPINA && !/^[0-9]+$/.test(c) && !this.comun(c) && !CUVINTE_PUBLICE.has(c)
      && !FORME_JURIDICE.has(c) && !OPRIRE.has(c)
  }
  /** r5 — componentă DISTINCTIVĂ de persoană (se ascunde și singură, în orice scriere, inclusiv cu litere mici): baza ≥ 4 litere și
   *  în afara listelor închise (cuvinte comune, localități). Cele scurte sau comune cer context. */
  distinctivPersoana(c) { return c.length >= COMPONENTA_MIN_TULPINA && !this.comun(c) }

  /** Dicționarul din răspunsul edge-ului („nume”). Formă greșită / gol → aruncă (workerul nu preia nimic — fail closed).
   *  „localitati” e opțională (lipsă = listă goală: mai multe cuvinte ascunse, direcția prudentă), dar dacă vine, e validată. */
  static dinRaspuns(r, maxim = NUME_MAX_LISTA) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('raspuns')
    const liste = {}
    for (const k of ['persoane', 'firme', 'cui', 'localitati']) {
      const v = k === 'localitati' && !('localitati' in r) ? [] : r[k]
      if (!Array.isArray(v) || v.length > maxim || !v.every(x => typeof x === 'string')) throw new Error(k)
      liste[k] = v
    }
    if (!liste.persoane.length) throw new Error('persoane_goale')   // platforma are mereu angajați: gol = citire eșuată
    return new Dictionar(liste.persoane, liste.firme, liste.cui, liste.localitati)
  }

  statistici() {
    return { persoane: this.persoane.size, firme: [...this.firme.values()].reduce((s, v) => s + v.length, 0),
      firme_cu_context: this.firmeCuContext, cui: this.cui.size, localitati: this.localitati.size, aruncate: { ...this.aruncate } }
  }
}

// ─── 8. Firmele din dicționar (contract: majuscule, diacritice, separatoare, forme juridice, „SC”, flexiuni, invizibile) ──
// separatoarele dintre componentele unei firme: 1–6 caractere din mulțimea ÎNCHISĂ (spații — orice caracter Zs, inclusiv NBSP —,
// tab, CR / LF, virgulă, punct, ghilimele „ ” “ ” « » ‚ ‘ ’ " ', paranteze rotunde, &, +, „/”, „\” (r5), cratimele contractului)
const SEP_CLASA = `\\p{Zs}\\t\\r\\n,."'„”“«»‚‘’()&+/\\\\${CRATIME}`
const SEP_FIRMA = new RegExp(`^[${SEP_CLASA}]{1,6}$`, 'u')
// la persoane: aceeași mulțime FĂRĂ punct și rând nou (sfârșitul unei propoziții nu leagă două nume)
const SEP_PERS = new RegExp(`^[\\p{Zs}\\t,"'„”“«»‚‘’()&+/\\\\${CRATIME}]{1,6}$`, 'u')
const SPATIU = new RegExp(`^${ZS}+$`, 'u')
// forma juridică, orice capitalizare, cu puncte („S.R.L.”, punctul final inclus) sau fără („SRL” — punctul de după e al propoziției)
const FORMA_I = '(?:S\\.R\\.L\\.?|S\\.N\\.C\\.?|S\\.C\\.S\\.?|P\\.F\\.A\\.?|S\\.A\\.?|I\\.I\\.?|I\\.F\\.?|SRL|SNC|SCS|PFA|SA|II|IF)(?![\\p{L}\\p{N}])'
const FORMA_LIPITA = new RegExp(FORMA_I, 'iuy')
const FORMA_SEPARATA = new RegExp(`[${SEP_CLASA}]{1,6}(${FORMA_I})`, 'iuy')
// „sa”, „ii”, „if” scrise mic și despărțite sunt cuvinte („să”, „îi”) — nu se lipesc la etichetă (firma rămâne oricum ascunsă)
const FORMA_AMBIGUA = new Set(['sa', 'ii', 'if'])
const PREFIX_SC = new RegExp(`(?:^|[^\\p{L}\\p{N}])(S\\.?${ZS}{0,2}C\\.?${ZS}{0,2})$`, 'iu')

/** Prima poziție k în `tok` la care prefixul tok[0..k) are forma normalizată `c` (sau -1). */
function prefixNorm(tok, c) {
  for (let k = 1; k <= tok.length; k++) {
    const n = norm(tok.slice(0, k))
    if (n === c) return k
    if (n.length > c.length) return -1
  }
  return -1
}

// ─── 9. Mascarea unei spețe ─────────────────────────────────────────────────────────────────────────────────────
const cheiePers = set => [...set].sort().join(U(1))
const subset = (a, b) => [...a].every(x => b.has(x))
// cuvintele de dinaintea formei juridice, pentru firmele NECUNOSCUTE platformei (tipar: „[SC] Nume Firmă SRL”)
const FORMA_CS = `(?<![\\p{L}\\p{N}_.])(S\\.R\\.L\\.?|S\\.A\\.?|P\\.F\\.A\\.?|I\\.I\\.?|I\\.F\\.?|S\\.N\\.C\\.?|S\\.C\\.S\\.?|SRL|Srl|srl|SA|PFA|II|IF|SNC|SCS)(?![\\p{L}\\p{N}_])`
const FORMA = new RegExp(FORMA_CS, 'gu')
const GAP_FORMA_SURSA = `[”"»“]?${SP}*,?${SP}*`
const GAP_FORMA = new RegExp(`^${GAP_FORMA_SURSA}$`, 'u')
const FORMA_DUPA = new RegExp(GAP_FORMA_SURSA + FORMA_CS, 'yu')
const GAP_NUME = new RegExp(`^(?:${SP}+|${SP}*[&+\\-]${SP}*)$`, 'u')
const PREFIX_FIRMA = new RegExp(`(?:(?<![\\p{L}\\p{N}_.])(?:S\\.C\\.?|SC)${SP}*)?[„"«“]?$`, 'u')
const GAP_PUBLIC = new RegExp(`^(?:(?![\\p{L}\\p{N}_])[^\\n]){1,3}$`, 'u')
const GAP_MARCAJ = new RegExp(`^\\.?${SP}+$`, 'u')
const potriveste = (re, t, a, b) => re.test(t.slice(a, b))

export class Mascare {
  constructor(dictionar = null) {
    this.d = dictionar || new Dictionar()
    this.tabel = new Map()                                   // eticheta → textul original (DOAR în memorie)
    this.ent = Object.fromEntries(CATEGORII.map(c => [c, []]))
    this.inlocuiri = 0
    this.asemOm = new Set(); this.asemMasina = new Set()     // etichetele ASCUNS puse pe „aproape etichete” din textul omului / al mașinii
    this.vazute = new Map()                                  // componentă recunoscută în speță → [categorie, cheie]
    this.vazuteMici = new Set()                              // r5: componentele care se propagă și scrise cu litere mici (numele întreg văzut)
  }
  contoare() { return Object.fromEntries(CATEGORII.filter(c => this.ent[c].length).map(c => [c, this.ent[c].length])) }
  total() { return CATEGORII.reduce((s, c) => s + this.ent[c].length, 0) }

  entitate(cat, cheie) {
    const lista = this.ent[cat]
    const egal = x => cat === 'PERSOANA' ? cheiePers(x.cheie) === cheiePers(cheie) : x.cheie === cheie
    const gasit = lista.find(egal)
    if (gasit) return gasit
    if (cat === 'PERSOANA') {   // „Popescu” și „Ion Popescu”: aceeași persoană dacă potrivirea e unică
      const cand = lista.filter(x => subset(x.cheie, cheie) || subset(cheie, x.cheie))
      if (cand.length === 1) { cand[0].cheie = new Set([...cand[0].cheie, ...cheie]); return cand[0] }
    }
    const x = { n: lista.length + 1, cheie, forme: new Map() }
    lista.push(x)
    return x
  }
  eticheta(cat, cheie, text) {
    const x = this.entitate(cat, cheie)
    if (x.forme.has(text)) return x.forme.get(text)
    const k = x.forme.size + 1
    const e = k === 1 ? `[${cat}_${x.n}]` : `[${cat}_${x.n}_F${k}]`
    x.forme.set(text, e); this.tabel.set(e, text)
    return e
  }

  /** [[s, e, categorie, cheie, asemanator, fel]] pe textul CURĂȚAT `t`, fără suprapuneri; prioritatea = ordinea de mai jos.
   *  `fel` (doar pentru învățare): 'firma_lista' = firma ÎNTREAGĂ din dicționar, 'nume_intreg' = două componente ale aceleiași
   *  persoane din listă, null = restul. */
  detecteaza(t, protejeaza, exact = () => true) {
    const luate = [], out = []
    const ocupat = (s, e) => luate.some(([a, b]) => s < b && a < e)
    const adauga = (s, e, cat, cheie, asem = false, fel = null) => {
      if (s >= e || ocupat(s, e)) return false
      luate.push([s, e])
      if (cat) out.push([s, e, cat, cheie, asem, fel])
      return true
    }
    for (const m of asemanatoare(t)) {                    // 1. etichetele noastre EXACTE rămân (textul modelului); restul se ascund
      if (protejeaza && this.tabel.has(m[0]) && exact(m.index, m.index + m[0].length)) adauga(m.index, m.index + m[0].length, null, null)
      else adauga(m.index, m.index + m[0].length, 'ASCUNS', m[0], true)
    }
    for (const m of toate(MANUAL, t)) adauga(m.index, m.index + m[0].length, 'ASCUNS', m[0])            // 2. [[ascuns de om]]
    for (const m of toate(EMAIL, t)) adauga(m.index, m.index + m[0].length, 'EMAIL', m[0].toLowerCase()) // 3.
    for (const m of toate(IBAN, t)) {                                                                    // 4.
      const n = ibanLungime(m[0])
      if (n) adauga(m.index, m.index + n, 'IBAN', m[0].slice(0, n).replace(/ /g, ''))
    }
    for (const m of toate(CNP, t)) if (cnpValid(m[0])) adauga(m.index, m.index + m[0].length, 'CNP', m[0])   // 5.
    this.cuiLista(t, adauga)                                                                                  // 6. CUI din listă (și fragmentat)
    for (const m of toate(CUI_RO, t)) adauga(m.index, m.index + m[0].length, 'CUI', doarCifre(m[0]))
    for (const m of toate(CUI_CUVANT, t)) { const [a, b] = m.indices.groups.v; adauga(a, b, 'CUI', doarCifre(m.groups.v)) }
    for (const m of toate(TELEFON, t)) adauga(m.index, m.index + m[0].length, 'TELEFON', '0' + doarCifre(m[0]).slice(-9))   // 7.
    for (const m of toate(NR_AUTO, t)) if (!NR_AUTO_EXCLUSE.has(m[1])) adauga(m.index, m.index + m[0].length, 'NR_AUTO', m[0].replace(/[ \t-]/g, ''))
    for (let [a, b] of larg(t)) {                                    // 9. etichetă ruptă („[PERSOANA_\n1]”) în textul omului
      if (b < t.length && t[b] === ']') b++
      adauga(a, b, 'ASCUNS', t.slice(a, b), true)
    }
    const cuv = toate(RE_COMPUS, t).map(m => [m.index, m.index + m[0].length, m[0]])
    const simpli = toate(RE_SIMPLU, t).map(m => [m.index, m.index + m[0].length, m[0]])
    const at = [...cuv, ...toate(RE_NUMAR, t).map(m => [m.index, m.index + m[0].length, m[0]])].sort((x, y) => x[0] - y[0])
    this.firmeDictionar(t, simpli, adauga)          // 10. potrivirea COMPLETĂ a firmelor din dicționar — ÎNAINTEA oricărei excepții
    this.firmeComponente(t, cuv, adauga)            // 10b. r5: o componentă DISTINCTIVĂ de firmă privată, singură (cu intervalul ei exact)
    this.localitatiMarcate(t, cuv, adauga)          // 11. „comuna Berceni” rămâne
    this.firmeForma(t, at, adauga)                  // 12. firme NECUNOSCUTE, după forma juridică (tipar; numele întreg public rămâne)
    this.publice(t, simpli, adauga)                 // 13. entitățile publice (nume întreg) rămân
    this.persoaneTitlu(t, cuv, adauga, ocupat)      // 14. „dl. X”, „ing. Y”
    this.persoaneLista(t, cuv, adauga, ocupat)      // 15. persoanele din dicționar
    this.invataDin([...out].sort((a, b) => a[0] - b[0]))
    this.propaga(t, cuv, adauga)                    // 16. același nume, în toată speța
    return out.sort((a, b) => a[0] - b[0])
  }

  /** r5 — CUI-urile din listă, și fragmentate: grupe de cifre despărțite de UN caracter (spațiu, NBSP, punct, cratimă) a căror
   *  alăturare e un CUI cunoscut („2345 6789”, „2345.6789”); intervalul ascuns = de la prima la ultima cifră, cu „RO” lipit sau
   *  despărțit printr-un spațiu în față. Rulează înaintea tiparelor „RO …” / „CUI …” (care ar lua doar prima grupă). */
  cuiLista(t, adauga) {
    for (const m of toate(CUI_GRUPE, t)) {
      const grupe = toate(/[0-9]+/g, m[0]).map(g => [m.index + g.index, m.index + g.index + g[0].length, g[0]])
      for (let a = 0; a < grupe.length; a++) {
        let cel = -1, cifre = '', gasit = ''
        for (let b = a; b < grupe.length && cifre.length < 10; b++) {
          cifre += grupe[b][2]
          if (cifre.length >= 6 && cifre.length <= 10 && this.d.cui.has(cifre)) { cel = b; gasit = cifre }
        }
        if (cel < 0) continue
        const ro = /(?<![A-Za-z0-9])RO[ \t]?$/.exec(t.slice(Math.max(0, grupe[a][0] - 3), grupe[a][0]))
        if (adauga(grupe[a][0] - (ro ? ro[0].length : 0), grupe[cel][1], 'CUI', gasit)) a = cel
      }
    }
  }

  /** Variantele unui cuvânt simplu `[s, e, tok]` care pot fi o componentă de firmă (r5, normalizarea ÎNAINTEA recunoașterii):
   *  [{n, off, sc, forma}] — cuvântul întreg; fără „SC” lipit în față („SCVarnitec”); tulpina dinaintea unei forme juridice LIPITE
   *  („VarnitecSRL”, „Varnitecsrl”, „VarnitecS.R.L.”, „ServiciilorSRL”), cu sau fără „SC” în față. `forma` = sfârșitul formei
   *  juridice lipite în t (sau -1); `sc` = „SC” lipit; `off` = poziția corpului în cuvânt. */
  variante(t, s, tok) {
    const out = []
    const corpuri = [[tok, 0, false]]
    const n0 = norm(tok)
    if (n0.startsWith('sc') && n0.length > 2) { const p = prefixNorm(tok, 'sc'); if (p > 0 && p < tok.length) corpuri.push([tok.slice(p), p, true]) }
    for (const [corp, off, sc] of corpuri) {
      out.push({ n: off ? norm(corp) : n0, off, sc, forma: -1 })
      for (let p = 1; p < corp.length; p++) {
        FORMA_LIPITA.lastIndex = s + off + p
        const f = FORMA_LIPITA.exec(t)
        // „sa” / „ii” / „if” lipite și scrise MIC sunt ambigue (sufixul „-ii”: „Lumivoii”) — nu sunt formă juridică (ca despărțite)
        if (f && !(f[0] === f[0].toLowerCase() && FORMA_AMBIGUA.has(f[0].replace(/\./g, '')))) out.push({ n: norm(corp.slice(0, p)), off, sc, forma: f.index + f[0].length })
      }
    }
    return out
  }

  /** Potrivirea firmei `tup` începând cu cuvântul simplu `i`: {start, end, context} sau null. Prima componentă poate avea „SC” lipit;
   *  ULTIMA poate avea UN sufix de flexiune și / sau forma juridică lipită (r5: și împreună — „Lumivo ServiciilorSRL”); o formă
   *  juridică despărțită (1–6 separatoare) după firmă intră în interval. Context = forma juridică sau „SC”. */
  potrivireFirma(t, simpli, i, tup) {
    const ultim = tup.length - 1
    const start = simpli[i][0]
    let context = false, k = i, end = -1
    for (let x = 0; x <= ultim; x++) {
      if (x > 0) {
        if (k + 1 >= simpli.length || !potriveste(SEP_FIRMA, t, simpli[k][1], simpli[k + 1][0])) return null
        k++
      }
      const [s, e, tok] = simpli[k]
      // r6: varianta care acoperă cel mai mult („VarnitecI.I.” = forma lipită, nu flexiunea „-i” + „.I.” rămas afară); la egalitate,
      // cea cu context („alfaII” = „Alfa” + „II”, nu flexiunea „-ii”): forma juridică lipită, apoi „SC” lipit, apoi cuvântul ca atare
      let gasit = null, rang = -1, fin = -1
      for (const v of this.variante(t, s, tok)) {
        if (v.sc && x !== 0) continue
        if (v.forma >= 0 && x !== ultim) continue
        if (!(v.n === tup[x] || (x === ultim && componentaFirma(v.n, tup[x], true) !== null))) continue
        const r = v.forma >= 0 ? 2 : v.sc ? 1 : 0, f = v.forma >= 0 ? v.forma : e
        if (f > fin || (f === fin && r > rang)) { gasit = v; rang = r; fin = f }
      }
      if (!gasit) return null
      if (gasit.sc) context = true
      if (gasit.forma >= 0) { end = gasit.forma; context = true; break }      // forma lipită e ultima componentă
      end = e
    }
    // forma juridică despărțită: „Servicii, S.R.L.”; r6: și după o formă lipită („SERVICIIII SRL” = flexiunea / forma „II” + „ SRL”)
    FORMA_SEPARATA.lastIndex = end
    const f = FORMA_SEPARATA.exec(t)
    if (f && !(FORMA_AMBIGUA.has(f[1]) && f[1] === f[1].toLowerCase())) { end = f.index + f[0].length; context = true }
    return this.prefixSC(t, start, end, context)
  }
  prefixSC(t, start, end, context) {
    const p = PREFIX_SC.exec(t.slice(Math.max(0, start - 16), start))
    if (p) return { start: start - p[1].length, end, context: true }
    return { start, end, context }
  }

  /** Firmele din dicționar — contractul din docs/intrebari/MASCARE_SI_VERDICT.md (rândurile „Firme”). */
  firmeDictionar(t, simpli, adauga) {
    for (let i = 0; i < simpli.length; i++) {
      const chei = new Set(this.variante(t, simpli[i][0], simpli[i][2]).map(v => v.n))   // r5: și „VarnitecSRL” → „varnitec”
      const cand = []
      for (const c of chei) {
        for (const tup of this.d.firme.get(c) || []) cand.push(tup)
        for (const tup of this.firmeFlexionate(c)) cand.push(tup)
      }
      cand.sort((a, b) => b.length - a.length)
      for (const tup of cand) {
        const r = this.potrivireFirma(t, simpli, i, tup)
        if (!r) continue
        const cheie = tup.join(' ')
        if (this.d.firmaComuna(tup) && !r.context) continue           // cuvânt comun fără context: rămâne (sau îl prinde propagarea)
        if (adauga(r.start, r.end, 'FIRMA', cheie, false, 'firma_lista')) break
      }
    }
  }

  /** r5 — o componentă DISTINCTIVĂ a unei firme private din listă, SINGURĂ (oricare componentă, nu doar prima): se ascunde dacă e
   *  scrisă cu cel puțin o majusculă sau are context (forma juridică lipită / despărțită după ea, „SC” lipit / despărțit în fața ei);
   *  cu UN sufix de flexiune. Scrisă integral mic și fără context: doar prin propagare (numele întreg al firmei în speță). La un cuvânt
   *  compus cu cratimă se ascunde tot cuvântul. */
  firmeComponente(t, cuv, adauga) {
    if (!this.d.componenteFirma.size) return
    for (const [s, e, tok] of cuv) {
      let poz = 0
      for (const p of parti(tok)) {
        const ps = s + tok.indexOf(p, poz)
        poz = ps - s + p.length
        let gasit = null                // r6: varianta care acoperă cel mai mult; la egalitate, cea cu context (formă lipită, „SC” lipit)
        for (const v of this.variante(t, ps, p)) {
          const c = componenta(v.n, this.d.componenteFirma)
          const rang = v.forma >= 0 ? 2 : v.sc ? 1 : 0, fin = v.forma >= 0 ? v.forma : e
          if (c !== null && (!gasit || fin > gasit.fin || (fin === gasit.fin && rang > gasit.rang))) gasit = { c, v, rang, fin }
        }
        if (!gasit) continue
        let end = Math.max(e, gasit.v.forma)
        let context = gasit.v.sc || gasit.v.forma >= 0
        FORMA_SEPARATA.lastIndex = end                        // forma juridică despărțită după componentă („Pelorin, S.R.L.”; r6: și după una lipită)
        const f = FORMA_SEPARATA.exec(t)
        if (f && !(FORMA_AMBIGUA.has(f[1]) && f[1] === f[1].toLowerCase())) { end = f.index + f[0].length; context = true }
        const r = this.prefixSC(t, s, end, context)
        if (!(r.context || areMajuscula(p))) continue
        if (adauga(r.start, r.end, 'FIRMA', this.d.componenteFirma.get(gasit.c), false, null)) break
      }
    }
  }
  /** Firmele dintr-un singur cuvânt a căror formă flexionată e `n` („Comesadului”). */
  firmeFlexionate(n) {
    const out = []
    for (const t of TERMINATII) {
      const b = n.slice(0, -t.length)
      if (n.endsWith(t) && b.length >= COMPONENTA_MIN_TULPINA) for (const tup of this.d.firme.get(b) || []) if (tup.length === 1) out.push(tup)
    }
    if (n.length >= 4 && (n.endsWith('ei') || n.endsWith('ai'))) for (const tup of this.d.firme.get(n.slice(0, -2) + 'a') || []) if (tup.length === 1) out.push(tup)
    return out
  }

  /** „comuna Berceni” — cuvântul de după un marcaj de localitate rămâne (+ cel mult două cuvinte cu majusculă care nu sunt nume). */
  localitatiMarcate(t, cuv, adauga) {
    for (let i = 0; i < cuv.length - 1; i++) {
      const n = norm(cuv[i][2])
      if (!MARCAJE_LOCALITATE.has(n)) continue
      const gap = t.slice(cuv[i][1], cuv[i + 1][0])
      if (!GAP_MARCAJ.test(gap) || (MARCAJE_ABREVIERI.has(n) && !gap.startsWith('.'))) continue
      let j = i + 1
      adauga(cuv[j][0], cuv[j][1], null, null)
      while (j + 1 < cuv.length && j - i < 3 && potriveste(SPATIU, t, cuv[j][1], cuv[j + 1][0])) {
        const urm = cuv[j + 1][2]
        if (!majuscula(urm) || OPRIRE.has(norm(urm)) || this.componenteToken(urm) !== null) break
        j++
        adauga(cuv[j][0], cuv[j][1], null, null)
      }
    }
  }

  /** Entitățile publice: numele ÎNTREG (+ forma juridică lipită) se rezervă, ca nimic de după să nu le rupă. */
  publice(t, simpli, adauga) {
    for (let i = 0; i < simpli.length; i++) {
      if (!PRIMELE_PUBLICE.has(norm(simpli[i][2]))) continue
      let gasit = null
      for (let j = i; j < Math.min(simpli.length, i + 8); j++) {
        if (j > i && !potriveste(GAP_PUBLIC, t, simpli[j - 1][1], simpli[j][0])) break
        if (NEMASCATE.has(cheieEntitate(t.slice(simpli[i][0], simpli[j][1])))) gasit = j
      }
      if (gasit !== null) {
        const e = simpli[gasit][1]
        FORMA_DUPA.lastIndex = e
        const f = FORMA_DUPA.exec(t)
        adauga(simpli[i][0], f ? f.index + f[0].length : e, null, null)
      }
    }
  }

  /** Firme NECUNOSCUTE platformei: „[SC] Nume Firmă SRL” — până la 6 cuvinte cu majusculă (sau cifre) înaintea formei juridice. */
  firmeForma(t, at, adauga) {
    for (const m of toate(FORMA, t)) {
      let j = -1
      for (let x = 0; x < at.length && at[x][1] <= m.index; x++) j = x
      if (j < 0 || !potriveste(GAP_FORMA, t, at[j][1], m.index)) continue
      const nume = []
      let k = j, prefix = null
      while (k >= 0 && nume.length < 6) {
        const [s, , tok] = at[k]
        const n = norm(tok)
        if (n === 'sc') { prefix = s; break }
        if (!(cifra(tok) || majuscula(tok)) || OPRIRE.has(n)) break
        nume.unshift(at[k])
        if (k === 0 || !potriveste(GAP_NUME, t, at[k - 1][1], s)) break
        k--
      }
      const cuvinte = nume.filter(a => !cifra(a[2]))
      if (!cuvinte.length) continue
      if (m[1].startsWith('I') && (nume.length < 2 || cuvinte.length !== nume.length)) continue   // II / IF: „Nume Prenume II”
      const cheie = nume.map(a => norm(a[2])).join(' ')
      if (NEMASCATE.has(cheieEntitate(nume.map(a => a[2]).join(' ')))) continue                 // numele ÎNTREG, nu un cuvânt din el
      let start = prefix !== null ? prefix : nume[0][0]
      if (prefix === null) { const p = PREFIX_FIRMA.exec(t.slice(Math.max(0, start - 12), start)); if (p) start -= p[0].length }
      adauga(start, m.index + m[0].length, 'FIRMA', cheie)
    }
  }

  /** Componentele de persoană din dicționar ale unui cuvânt (cu cratimă: fiecare parte), în ORICE scriere (r5):
   *  {chei, comun, mare, distinct} sau null. `mare` = o parte recunoscută are majusculă; `distinct` = o parte e componentă
   *  distinctivă (distinctivPersoana) — atunci cuvântul se ascunde și singur, și scris mic. */
  componenteToken(tok) {
    const chei = []
    let comun = true, mare = false, distinct = false
    for (const p of parti(tok)) {
      const n = norm(p)
      const c = componenta(n, this.d.persoane)
      if (c === null) continue
      chei.push(c)
      if (areMajuscula(p)) mare = true
      const com = this.d.comun(c) || this.d.localitati.has(n)
      if (!com) comun = false
      if (!com && this.d.distinctivPersoana(c)) distinct = true
    }
    return chei.length ? { chei, comun, mare, distinct } : null
  }

  /** După „dl.”, „ing.”, „colegul” …: 1–3 cuvinte cu majusculă (și necunoscute platformei — tipar). */
  persoaneTitlu(t, cuv, adauga, ocupat) {
    const dupaStart = new Map(cuv.map((c, i) => [c[0], i]))
    for (const m of toate(TITLU, t)) {
      let i = dupaStart.get(m.index + m[0].length)
      const luat = []
      while (i !== undefined && i < cuv.length && luat.length < 3) {
        const [s, e, tok] = cuv[i]
        if (ocupat(s, e)) break
        const n = norm(tok), k = this.componenteToken(tok)
        if (!(majuscula(tok) && !OPRIRE.has(n) && !NEMASCATE_UN_CUVANT.has(n) && (titluCaz(tok) || k !== null || (toateMari(tok) && tok.length >= 6)))) break
        luat.push([s, e, k ? k.chei : [n]])
        if (i + 1 >= cuv.length || !potriveste(SPATIU, t, e, cuv[i + 1][0])) break
        i++
      }
      if (luat.length) adauga(luat[0][0], luat[luat.length - 1][1], 'PERSOANA', new Set(luat.flatMap(x => x[2])))
    }
  }

  /** Persoanele din dicționar (contract: forma uzuală și integral cu majuscule, diacritice, flexiuni, cratimă, ambele ordini).
   *  r6: cuvintele cunoscute alăturate (spațiile și celelalte separatoare ale contractului: virgulă, ghilimele, paranteze, &, +, /)
   *  formează un nume DOAR dacă toate componentele lor sunt ale ACELUIAȘI nume din listă („Vlădescu, Ana”); persoane diferite
   *  alăturate („ana maria vladescu ion mare”, „Ana Vlădescu, Maria Zamfirescu”) primesc etichete diferite. Cel mult un cuvânt
   *  „Ca Titlu” ÎNTRE două componente ale aceluiași nume (al doilea prenume: necunoscut sau componentă a altui nume). O componentă
   *  COMUNĂ singură, fără context, rămâne vizibilă. */
  persoaneLista(t, cuv, adauga, ocupat) {
    const info = cuv.map(([s, e, tok]) => {
      const liber = !ocupat(s, e)
      return { s, e, tok, liber, c: liber ? this.componenteToken(tok) : null }
    })
    const n = info.length
    const pereche = (a, b) => !!(info[a].c && info[b].c) && info[a].c.chei.some(x => info[b].c.chei.some(y => this.d.pereche(x, y)))
    const spatiu = (a, b) => potriveste(SPATIU, t, info[a].e, info[b].s)
    // r5: un cuvânt scris integral mic, care nu e componentă distinctivă, e nume DOAR lângă o altă componentă a ACELEIAȘI persoane din
    // listă (numele întreg, în orice scriere: „zamfirescu maria”, „mare ion”); altfel e un cuvânt obișnuit („mare parte”, „ion”)
    // (și în interiorul aceluiași cuvânt cu cratimă: „mare-ion”)
    const interna = c => c.chei.some((x, a) => c.chei.some((y, b) => b > a && this.d.pereche(x, y)))
    const vecinPereche = k => (k > 0 && potriveste(SEP_PERS, t, info[k - 1].e, info[k].s) && pereche(k - 1, k))
      || (k + 1 < n && potriveste(SEP_PERS, t, info[k].e, info[k + 1].s) && pereche(k, k + 1))
    const fara = []
    for (let k = 0; k < n; k++) { const c = info[k].c; if (c && !c.mare && !c.distinct && !interna(c) && !vecinPereche(k)) fara.push(k) }
    for (const k of fara) info[k].c = null
    // r6 (review r5 P2): persoanele se DELIMITEAZĂ înaintea grupării. Un grup = cuvinte cunoscute alăturate (plus cel mult un cuvânt
    // necunoscut între două cunoscute — al doilea prenume) ale căror componente aparțin TOATE aceluiași nume din listă, fiecare o
    // singură dată (deci cel mult atâtea cuvinte câte componente are numele); după un nume complet începe alt grup. Un cuvânt
    // singur e mereu un grup (componentele lui pot fi ale unor nume diferite: „Popescu-Ionescu”). Împărțirea unui șir de cuvinte
    // cunoscute în grupuri: cea care lasă cele mai puține cuvinte vizibile (o componentă comună singură, fără context, rămâne
    // vizibilă), apoi cea cu cele mai puține grupuri.
    const grup = (i, j) => {               // [i..j] e un grup valid? → {chei, intreg} sau null
      if (!info[i].c || !info[j].c) return null
      const chei = [...info[i].c.chei], cunoscute = [...info[i].c.chei]
      let mijloc = false
      for (let k = i; k < j;) {
        if (info[k + 1].c && potriveste(SEP_PERS, t, info[k].e, info[k + 1].s) && this.d.acelasiNume([...cunoscute, ...info[k + 1].c.chei])) { k++; chei.push(...info[k].c.chei); cunoscute.push(...info[k].c.chei); continue }
        // al doilea prenume: un cuvânt scris „Ca Titlu” între două componente ale aceluiași nume, despărțit prin spații — necunoscut
        // (și necomun) sau componentă a ALTUI nume din listă („Ana Gheorghe Vlădescu”, cu „Gheorghe” din alt nume)
        const mij = info[k + 1]
        if (!mijloc && k + 2 <= j && mij.liber && info[k + 2].c && spatiu(k, k + 1) && spatiu(k + 1, k + 2) && titluCaz(mij.tok)
            && !OPRIRE.has(norm(mij.tok)) && (mij.c || !COMUN.has(norm(mij.tok)))) {
          mijloc = true
          chei.push(...(mij.c ? mij.c.chei : [norm(mij.tok)]), ...info[k + 2].c.chei); cunoscute.push(...info[k + 2].c.chei); k += 2; continue
        }
        return null
      }
      if (i === j) return { chei, intreg: interna(info[i].c) }
      return this.d.acelasiNume(cunoscute) ? { chei, intreg: true } : null
    }
    const MAX = 6                          // cuvinte într-un grup (componentele unui nume + cuvântul din mijloc)
    const cost = new Array(n + 1).fill(null)
    const alege = new Array(n).fill(null)
    cost[n] = [0, 0]
    for (let i = n - 1; i >= 0; i--) {
      if (!info[i].c) { cost[i] = cost[i + 1]; continue }
      let best = null
      for (let j = i; j < Math.min(n, i + MAX); j++) {
        const g = grup(i, j)
        if (!g) continue
        const vizibil = i === j && info[i].c.comun && !g.intreg ? 1 : 0
        const c = [vizibil + cost[j + 1][0], 1 + cost[j + 1][1]]
        if (!best || c[0] < best.c[0] || (c[0] === best.c[0] && c[1] < best.c[1])) best = { c, j, g }
      }
      cost[i] = best.c; alege[i] = best
    }
    for (let i = 0; i < n;) {
      if (!info[i].c) { i++; continue }
      const { j, g } = alege[i]
      if (j > i || !info[i].c.comun || g.intreg) adauga(info[i].s, info[j].e, 'PERSOANA', new Set(g.chei), false, g.intreg ? 'nume_intreg' : null)
      i = j + 1
    }
  }

  /** Componentele numelor recunoscute (persoane și firme) devin „văzute” pentru restul spețe. Nu se învață: sub 3 litere,
   *  OPRIRE, cuvinte generice de firmă, forme juridice, cifre, cuvintele-entitate publice. O componentă din două nume diferite
   *  primește cheia doar a ei. */
  invataDin(gasite) {
    const aceeasi = (a, b) => a[0] === b[0] && (a[0] === 'PERSOANA' ? cheiePers(a[1]) === cheiePers(b[1]) : a[1] === b[1])
    for (const [, , cat, cheie, , fel] of gasite) {
      let comp
      if (cat === 'PERSOANA') comp = [...cheie].sort()
      else if (cat === 'FIRMA') comp = cheie.split(' ').filter(x => !/^[0-9]+$/.test(x) && !GENERICE_FIRMA.has(x) && !FORME_JURIDICE.has(x))
      else continue
      for (const c of comp) {
        if (c.length < 3 || OPRIRE.has(c) || NEMASCATE_UN_CUVANT.has(c)) continue
        // r5: și scrisă mic se propagă — la persoane, orice componentă a numelui ÎNTREG văzut (și cele comune) și orice componentă
        // distinctivă; la firme, componentele distinctive ale firmei ÎNTREGI din listă
        if ((cat === 'PERSOANA' && (fel === 'nume_intreg' || (this.d.persoane.has(c) && this.d.distinctivPersoana(c))))
            || (cat === 'FIRMA' && fel === 'firma_lista' && this.d.componenteFirma.has(c))) this.vazuteMici.add(c)
        const v = [cat, cheie]
        if (!this.vazute.has(c)) this.vazute.set(c, v)
        else if (!aceeasi(this.vazute.get(c), v)) {
          const cat0 = this.vazute.get(c)[0]
          this.vazute.set(c, [cat0, cat0 === 'PERSOANA' ? new Set([c]) : c])
        }
      }
    }
  }

  /** Același nume în toată speța: orice cuvânt cu MAJUSCULĂ care e (după regula tulpinii) o componentă deja văzută se ascunde, cu
   *  cheia numelui întreg — chiar dacă singur ar fi cuvânt comun (compromisul declarat). r5: scris integral MIC, doar componentele
   *  din `vazuteMici` (vezi invataDin). Excepție: localitățile cunoscute. */
  propaga(t, cuv, adauga) {
    if (!this.vazute.size) return
    for (const [s, e, tok] of cuv) {
      for (const p of parti(tok)) {
        const n = norm(p)
        if (this.d.localitati.has(n)) continue
        const c = componenta(n, this.vazute)
        if (c === null || this.d.localitati.has(c) || (!areMajuscula(p) && !this.vazuteMici.has(c))) continue
        const [cat, cheie] = this.vazute.get(c)
        adauga(s, e, cat, cheie)
        break
      }
    }
  }

  /** Pre-trecerea peste titlu / speță / context, ÎNAINTEA mascării lor: un nume recunoscut într-unul se ascunde în toate. */
  invata(...texte) { for (const t of texte) this.detecteaza(curata(t).s, false) }

  /** Textul cu etichete. `protejeaza = false` la textele scrise de om (o etichetă scrisă de mână se ascunde și ea). */
  mascheaza(text, protejeaza = true) {
    const t = String(text ?? '')
    const r = curata(t)
    // o etichetă emisă rămâne neatinsă DOAR dacă e scrisă exact așa în original (nu una cu litere late, care arată la fel în reprezentare)
    const exact = (s0, e0) => { const [s, e] = inapoi(t, r, s0, e0); return t.slice(s, e) === r.s.slice(s0, e0) }
    let out = '', poz = 0
    for (const [s0, e0, cat, cheie, asem] of this.detecteaza(r.s, protejeaza, exact)) {
      let [s, e] = inapoi(t, r, s0, e0)
      // două intervale din același caracter original descompus (o ligatură tăiată între două nume): al doilea începe după primul
      if (s < poz) s = poz
      if (e <= s) continue
      const et = this.eticheta(cat, cheie, t.slice(s, e))
      if (asem) (protejeaza ? this.asemMasina : this.asemOm).add(et)
      out += t.slice(poz, s) + et
      poz = e
      this.inlocuiri++
    }
    return out + t.slice(poz)
  }

  /** Etichetele EMISE, scrise exact, puse la loc; orice altceva rămâne cum e (nu se repară nimic). */
  demascheaza(text) {
    return String(text ?? '').replace(eticheta(), tot => this.tabel.get(tot) ?? tot)
  }

  /** {afisat, motiv}: motiv null = se poate publica. Refuz dacă rămâne orice „aproape etichetă” care nu e EXACT o etichetă emisă
   *  ('eticheta_neemisa'), o etichetă emisă pentru o „aproape etichetă” a modelului ('eticheta_din_model') sau o etichetă ruptă
   *  ('eticheta_rupta': forma largă nu coincide cu o etichetă emisă scrisă exact în același loc). */
  demascheazaSigur(text) {
    const t = String(text ?? '')
    for (const m of asemanatoare(t)) {
      if (!this.tabel.has(m[0])) return { afisat: null, motiv: 'eticheta_neemisa' }
      if (this.asemMasina.has(m[0]) && !this.asemOm.has(m[0])) return { afisat: null, motiv: 'eticheta_din_model' }
    }
    const exacte = new Map()
    for (const m of toate(eticheta(), t)) if (this.tabel.has(m[0])) exacte.set(m.index, m.index + m[0].length)
    for (const [a, b] of larg(t)) if ((exacte.get(a) ?? -1) < b) return { afisat: null, motiv: 'eticheta_rupta' }
    return { afisat: this.demascheaza(t), motiv: null }
  }

  /** Câte etichete emise de această mascare apar în text. */
  emiseIn(text) { return toate(eticheta(), String(text ?? '')).filter(m => this.tabel.has(m[0])).length }
}

/** Componenta de firmă `c` a cuvântului normalizat `n` (exact sau — pe ultima componentă — flexionat). */
function componentaFirma(n, c, flex) {
  if (n === c) return c
  return flex ? componenta(n, new Set([c])) : null
}

// ─── 10. Regula B (decizia owner-ului 13.11.2026; r5 STRUCTURALĂ) ───────────────────────────────────────────────
// „Da” / „Nu” trec DOAR cu un citat egal cu un PARAGRAF ÎNTREG al sursei marcate pe aceeași linie, iar paragraful trebuie să fie
// AUTONOM (vezi motivParagraf). Structura (paragrafele, numărul de propoziții, listele) se stabilește pe textul BRUT al sursei
// (`brut`, cu rândurile noi păstrate), înainte de mascare; citatul se compară cu paragraful corespunzător din textul MASCAT (`extras`,
// cel văzut de model). Autonomia e NECESARĂ, nu suficientă: susținerea și polaritatea le verifică după aceea validarea răspunsului
// (cercetare.py / intrebariSurse.js), iar refuzul de aici nu poate fi întors de niciun pas ulterior.
// Citatul se compară fără normalizarea permisivă a numelor: semnele, cifrele, operatorii și diacriticele rămân („-5” ≠ „5”,
// „≤” ≠ „<”, „sau” ≠ „său”); contează doar: majusculele, spațiile, ghilimelele, sedila / virgula de sub ș / ț, liniuțele tipografice
// (= „-”) și punctuația de la sfârșit.
// Limita declarată: dependențele pe care regula nu le recunoaște (alte formulări decât listele închise de mai jos, restricții aflate în
// ALT paragraf decât cel precedent) nu sunt văzute; un paragraf autonom și autentic poate totuși susține o concluzie greșită pentru
// speța concretă. Omul vede sursele alăturate.
export const INCERT = 'Incert — de verificat'
export const INCERT_REGULA_B = `${INCERT}: niciun citat nu reproduce exact un paragraf întreg și de sine stătător dintr-o sursă — citește sursele alăturate.`
export const CITAT_MIN_CUVINTE = 6
const CITAT = /[„“"«]([^„“”"«»\n]{8,800})[”“"»]/g
const FARA_SURSA = 'nu am gasit sursa oficiala'
const VERDICT_CURATA = /^[\s#>*_`-]*(?:verdict\s*[:\-–—]?\s*)?[*_`]*\s*/i
const MARCAJ = /\[\s*([cw]\d{1,2}(?:\s*[,;]\s*[cw]\d{1,2})*)\s*\]/g
const normB = s => norm(s)   // forma pentru CĂUTAREA cuvintelor-semnal (nu pentru compararea citatului)

// Listele ÎNCHISE ale regulii B (forme normalizate: litere mici, fără diacritice), enumerate integral. Se caută ca CUVINTE ÎNTREGI
// (expresiile: ca șir de cuvinte întregi consecutive) în paragraful cu o singură propoziție. Altă formulare = limită declarată.
// Trimiteri / expresii care se sprijină pe alt text:
export const TRIMITERI = [...setDin(`conform conformitate potrivit
prevazut prevazuta prevazute prevazuti prevazutul prevazutei prevazutului prevazutelor prevazutilor
mentionat mentionata mentionate mentionati mentionatul mentionatei mentionatului mentionatelor mentionatilor
precedent precedenta precedente precedenti precedentul precedentei precedentului precedentelor precedentilor
anterior anterioara anterioare anteriori anteriorul anterioarei anteriorului anterioarelor anteriorilor
urmator urmatoare urmatori urmatorul urmatoarea urmatoarele urmatorii urmatorului urmatoarei urmatorilor
acest aceasta acesta aceste acestea acesti acestia acestui acestei acestor acestuia acesteia acestora
acel acela acea aceea acei aceia acele acelea acelui acelei acelor aceluia aceleia acelora
respectiv respectiva respective respectivi respectivul respectivei respectivului respectivelor respectivilor
prezentul prezenta prezentele prezentului prezentei prezentelor
art articol articolul articolului articole articolele articolelor alin alineat alineatul alineatului alineate alineatele alineatelor
lit litera literei literele literelor pct punctul punctului punctele punctelor
anexa anexe anexei anexele anexelor anexat anexata anexate anexati
capitol capitolul capitolului capitole capitolele capitolelor sectiune sectiunea sectiunii sectiuni sectiunile sectiunilor
tabel tabelul tabelului tabele tabelele tabelelor tabela tabelei figura figurii figuri figurile figurilor
el ea ei ele`)]
export const TRIMITERI_EXPRESII = ['mai sus', 'mai jos']
// Deschideri de excepție / derogare:
export const EXCEPTII = [...setDin(`derogare derogarea derogari derogarile derogarii derogarilor deroga derogat derogata derogate
exceptand exceptie exceptia exceptii exceptiile exceptiei exceptiilor`)]
export const EXCEPTII_EXPRESII = ['prin derogare', 'cu exceptia', 'nu se aplica', 'nu sunt aplicabile', 'nu este aplicabil', 'nu este aplicabila',
  'nu sunt aplicabili', 'in afara de', 'in afara cazului', 'in afara situatiei', 'sub rezerva', 'fara a aduce atingere']
const SET_TRIMITERI = new Set(TRIMITERI), SET_EXCEPTII = new Set(EXCEPTII)
/** Paragraful (normalizat) conține un cuvânt din `set` sau o expresie din `expresii`, ca șir de cuvinte întregi. */
function areDinLista(text, set, expresii) {
  const cuv = normB(text).match(/[\p{L}\p{N}]+/gu) || []
  if (cuv.some(c => set.has(c))) return true
  const sir = ` ${cuv.join(' ')} `
  return expresii.some(x => sir.includes(` ${x} `))
}

// Elementul de listă (structural, fără alfabete enumerate și fără plafon de lungime): după spațiile și ghilimelele de deschidere
// („ “ " « ‚ ‘ ' `), paragraful începe cu
//   - un șir de litere / cifre Unicode (orice capitalizare, cifre romane incluse, fără plafon de lungime) urmat de „)”, sau de „.” /
//     „:” urmat de spațiu, de sfârșit sau DIRECT de o literă: „B) ”, „12345) ”, „iv. ”, „Art. ”, „B.Executarea”, „1.Executarea”
//     (r6: NU și de o cifră — „6.5 bar …” nu e marcaj);
//   - „(” + litere / cifre + „)”: „(b)”, „(12)”;
//   - un semn de listă: U+2022 •, U+2023 ‣, U+2043 ⁃, U+2219 ∙, U+25AA ▪, U+25AB ▫, U+25A0 ■, U+25A1 □, U+25CF ●, U+25CB ○,
//     U+25E6 ◦, U+25B8 ▸, U+25BA ►, U+00B7 · (punctul median), „*”, „+”, U+2212 − (minus), „§”, ORICE caracter din categoria
//     Unicode Pd (cratimele / liniuțele: „-”, U+2010–U+2015, U+2E3A, U+301C …— toată categoria).
export const SEMNE_LISTA = U(0x2022, 0x2023, 0x2043, 0x2219, 0x25aa, 0x25ab, 0x25a0, 0x25a1, 0x25cf, 0x25cb, 0x25e6, 0x25b8, 0x25ba, 0xb7, 0x2a, 0x2b, 0x2212, 0xa7)
const inClasa = s => s.replace(/[\\\]\[\-^*+()]/g, '\\$&')        // caractere puse într-o clasă de caractere
const DESCHIDERE = new RegExp(`^[\\s${inClasa(U(0x201e, 0x201c, 0x22, 0xab, 0x201a, 0x2018, 0x27, 0x60))}]*`, 'u')
const MARCAJ_ELEMENT = new RegExp(`^(?:[\\p{L}\\p{M}\\p{N}]+(?:\\)|[.:](?=[\\s\\p{L}]|$))|\\([\\p{L}\\p{M}\\p{N}]+\\)|[\\p{Pd}${inClasa(SEMNE_LISTA)}])`, 'u')
// sfârșitul unui paragraf, fără spațiile, ghilimelele / parantezele de închidere și semnele de evidențiere de după el
const INCHIDERE = new RegExp(`[\\s${inClasa(U(0x201d, 0x201c, 0x22, 0xbb, 0x2019, 0x27, 0x29, 0x5d, 0x2a, 0x5f, 0x60))}]*$`, 'u')
const ultimulSemn = s => String(s ?? '').replace(INCHIDERE, '').slice(-1)
// granița de propoziție, VOIT EXCESIVĂ: „.” „!” „?” „;” urmat (după ghilimele / paranteze de închidere) de un spațiu, sau orice rând
// nou din interiorul paragrafului; abrevierile („art. 5”) dau granițe false → paragraf cu „mai multe propoziții” → Incert
const GRANITA = new RegExp(`[.!?;][${inClasa(U(0x201d, 0x22, 0xbb, 0x2019, 0x27, 0x29, 0x5d))}]*\\s|\\n`, 'u')

/** Forma de comparare a unui citat și a unei propoziții din sursă (fără normalizarea permisivă a numelor — vezi mai sus). */
export function formaCitat(s) {
  return String(s ?? '').normalize('NFC').replace(/\p{Cf}/gu, '')
    .replace(/[şŞ]/g, x => x === 'ş' ? 'ș' : 'Ș').replace(/[ţŢ]/g, x => x === 'ţ' ? 'ț' : 'Ț').toLowerCase()
    .replace(/[„“”"«»‚‘’'`´]/g, '').replace(new RegExp(`[${LINIUTE}]`, 'g'), '-')
    .replace(/\s+/g, ' ').replace(/ ?([^\p{L}\p{N} ]) ?/gu, '$1').trim().replace(/[.;:!?]+$/, '')
}

/** Paragrafele unui text: rând gol (unul sau mai multe, cu spații / tab-uri) = paragraf nou; fiecare paragraf fără spațiile de la
 *  capete, cu rândurile noi din interior PĂSTRATE. */
export function paragrafeText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split(/\n(?:[ \t]*\n)+/).map(p => p.trim()).filter(Boolean)
}

/** Motivul pentru care paragraful `p` (text BRUT) NU susține singur un „Da” / „Nu” (null = autonom). `precedent` = paragraful de
 *  dinaintea lui în sursă (text brut), '' = nu există (începutul documentului), null = necunoscut. Primul motiv aplicabil:
 *  - 'context_taiat': paragraful e la o margine a extrasului care nu e margine de paragraf în sursă, sau are „…” / „...”;
 *  - 'context_necunoscut': paragraful precedent din sursă nu se cunoaște;
 *  - 'tabel': are „|” sau tab;
 *  - 'element_lista': începe cu un marcaj de element (MARCAJ_ELEMENT), paragraful precedent se termină cu „:” sau „;”, sau el însuși
 *    se termină cu „:” sau „;”;
 *  - 'mai_multe_propozitii': are o graniță de propoziție (GRANITA) în interior;
 *  - 'trimitere' / 'exceptie': un cuvânt sau o expresie din listele închise TRIMITERI / EXCEPTII;
 *  - 'fragment': nu începe cu majusculă sau cifră; 'fara_sfarsit': nu se termină cu „.”, „!” sau „?”. */
export function motivParagraf(p, { taiat = false, precedent = '' } = {}) {
  const text = String(p ?? '').trim()
  if (taiat || /…|\.\.\./.test(text)) return 'context_taiat'
  if (typeof precedent !== 'string') return 'context_necunoscut'
  if (/[|\t]/.test(text)) return 'tabel'
  if (MARCAJ_ELEMENT.test(text.replace(DESCHIDERE, '')) || /[:;]/.test(ultimulSemn(precedent)) || /[:;]/.test(ultimulSemn(text))) return 'element_lista'
  if (GRANITA.test(text)) return 'mai_multe_propozitii'
  if (areDinLista(text, SET_TRIMITERI, TRIMITERI_EXPRESII)) return 'trimitere'
  if (areDinLista(text, SET_EXCEPTII, EXCEPTII_EXPRESII)) return 'exceptie'
  if (!/^[\p{Lu}\p{N}]/u.test(text.replace(DESCHIDERE, '').replace(/^\(+/, ''))) return 'fragment'
  if (!/[.!?]/.test(ultimulSemn(text))) return 'fara_sfarsit'
  return null
}

/** Paragrafele unei surse {extras (mascat), brut (textul brut al extrasului), inceput_sigur, sfarsit_sigur, precedent}:
 *  [{text: paragraful din `extras` (cu care se compară citatul), brut: același paragraf brut, motiv: motivParagraf(brut) }].
 *  Structura se stabilește pe `brut`; dacă `extras` și `brut` nu au ACELAȘI număr de paragrafe (mascarea a unit două paragrafe),
 *  toate paragrafele primesc 'context_necunoscut'. */
export function paragrafeSursa(sursa) {
  const brute = paragrafeText(sursa?.brut)
  const mascate = paragrafeText(sursa?.extras)
  const aliniat = brute.length === mascate.length
  return mascate.map((text, k) => {
    if (!aliniat) return { text, brut: null, motiv: 'context_necunoscut' }
    const taiat = (k === 0 && sursa.inceput_sigur !== true) || (k === brute.length - 1 && sursa.sfarsit_sigur !== true)
    const precedent = k > 0 ? brute[k - 1] : sursa.precedent
    return { text, brut: brute[k], motiv: motivParagraf(brute[k], { taiat, precedent: typeof precedent === 'string' ? precedent : null }) }
  })
}

/** Prima linie nevidă, dacă e un verdict: Da / Nu / Depinde de X / Incert. Altfel null. */
export function verdict(text) {
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!linie.trim()) continue
    const curat = linie.replace(VERDICT_CURATA, '').trim().replace(/^[*_`]+|[*_`]+$/g, '').trim()
    const n = normB(curat)
    if (n.startsWith(FARA_SURSA.slice(0, 11))) return null
    if (/^(?:da|nu|incert)\b/.test(n) || /^depinde de\s+\S/.test(n)) return curat
    return null
  }
  return null
}

/** 'da' / 'nu' / 'incert' / 'depinde' / null — după prima linie. */
export function tipVerdict(text) {
  const n = normB(verdict(text) || '')
  return ['incert', 'depinde', 'da', 'nu'].find(k => new RegExp(`^${k}\\b`).test(n)) || null
}

const marcaje = linie => [...normB(linie).matchAll(MARCAJ)].flatMap(m => m[1].split(/[,;]/).map(x => x.trim().toUpperCase()))

/** Citatul e IDENTIC (formaCitat) cu un PARAGRAF ÎNTREG și AUTONOM al uneia dintre sursele `ids`, cu ≥ CITAT_MIN_CUVINTE cuvinte. */
function citatSustinut(citat, ids, harta) {
  const f = formaCitat(citat)
  if ((f.match(/[\p{L}\p{N}]+/gu) || []).length < CITAT_MIN_CUVINTE) return false
  for (const i of ids) {
    if (!harta.has(i)) continue
    if (harta.get(i).some(p => p.motiv === null && formaCitat(p.text) === f)) return true
  }
  return false
}

/** Harta {ID → paragrafele sursei} din lista de surse [{id, extras, brut, inceput_sigur, sfarsit_sigur, precedent}]. */
function hartaPropozitii(surse) {
  const h = new Map()
  for (const s of surse || []) {
    const id = String(s?.id ?? '').trim().toUpperCase()
    if (id) h.set(id, paragrafeSursa(s))
  }
  return h
}

/** Răspunsul are măcar un citat care trece regula, pe o linie cu marcajul sursei citate. */
export function areCitat(text, surse) {
  const harta = hartaPropozitii(surse)
  for (const linie of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const ids = marcaje(linie).filter(i => harta.has(i))
    if (ids.length && toate(CITAT, linie).some(m => citatSustinut(m[1], ids, harta))) return true
  }
  return false
}

/** „Da” / „Nu” fără un citat care trece regula (motiv de reparare). */
export const cereCitat = (text, surse) => ['da', 'nu'].includes(tipVerdict(text)) && !areCitat(text, surse)

/** {text, motiv, tip} — ultimul pas înainte de publicare: „Da” / „Nu” rămân DOAR cu un citat care trece regula ('citat');
 *  altfel prima linie devine INCERT_REGULA_B ('fara_citat'); „Depinde de X” → „Incert — depinde de X” ('depinde'); „Incert”
 *  rămâne ('incert'); fără verdict → neschimbat ('fara_verdict'). `tip` = verdictul final ('da' / 'nu' / 'incert' / null). */
export function aplicaRegulaB(text, surse) {
  const t = String(text ?? '')
  const tip = tipVerdict(t)
  const linii = t.replace(/\r/g, '').split('\n')
  const i = linii.findIndex(l => l.trim())
  if (tip === null || i < 0) return { text: t, motiv: 'fara_verdict', tip: null }
  if (tip === 'incert') return { text: t, motiv: 'incert', tip: 'incert' }
  if (tip === 'depinde') {
    const v = verdict(t)
    linii[i] = `${INCERT} — ${v.slice(0, 1).toLowerCase()}${v.slice(1)}`
    return { text: linii.join('\n'), motiv: 'depinde', tip: 'incert' }
  }
  if (areCitat(t, surse)) return { text: t, motiv: 'citat', tip }
  linii[i] = INCERT_REGULA_B
  return { text: linii.join('\n'), motiv: 'fara_citat', tip: 'incert' }
}

// ─── 11. Ecranul (previzualizarea orientativă) ──────────────────────────────────────────────────────────────────
/** Bucățile textului mascat pentru ecran: [{t: 'text' | 'eticheta', v}] — etichetele se evidențiază. */
export function bucatiMascate(text) {
  const s = String(text ?? '')
  const out = []
  let poz = 0
  for (const m of toate(eticheta(), s)) {
    if (m.index > poz) out.push({ t: 'text', v: s.slice(poz, m.index) })
    out.push({ t: 'eticheta', v: m[0] })
    poz = m.index + m[0].length
  }
  if (poz < s.length) out.push({ t: 'text', v: s.slice(poz) })
  return out
}

const NUME_CATEGORII = { PERSOANA: ['persoană', 'persoane'], FIRMA: ['firmă', 'firme'], CNP: ['CNP', 'CNP-uri'], CUI: ['CUI', 'CUI-uri'],
  TELEFON: ['telefon', 'telefoane'], EMAIL: ['e-mail', 'e-mailuri'], IBAN: ['IBAN', 'IBAN-uri'], NR_AUTO: ['nr. auto', 'nr. auto'],
  ASCUNS: ['cuvânt ascuns de tine', 'cuvinte ascunse de tine'] }

/** Previzualizarea: titlu, speță, context mascate în ACEEAȘI ordine ca workerul (pre-trecere, apoi titlu → speță → context). */
export function previzualizare({ titlu, intrebare, context }, dictionar) {
  const m = new Mascare(dictionar)
  m.invata(titlu, intrebare, context)
  const rez = { titlu: m.mascheaza(titlu, false), intrebare: m.mascheaza(intrebare, false), context: context ? m.mascheaza(context, false) : '' }
  const c = m.contoare()
  const parti2 = CATEGORII.filter(k => c[k]).map(k => `${c[k]} ${NUME_CATEGORII[k][c[k] === 1 ? 0 : 1]}`)
  return { ...rez, total: m.total(), contoare: c, rezumat: parti2.join(', ') }
}

/** Ascunde manual selecția dintr-un câmp: o înconjoară cu [[ ]] (fără rânduri noi, max 200 de caractere). null = nimic de ascuns. */
export function ascundeSelectia(text, start, end) {
  const t = String(text ?? '')
  let a = Math.max(0, Math.min(start, end)), b = Math.min(t.length, Math.max(start, end))
  while (a < b && /\s/.test(t[a])) a++
  while (b > a && /\s/.test(t[b - 1])) b--
  const sel = t.slice(a, b)
  if (!sel || sel.length > 200 || /[\n[\]]/.test(sel)) return null
  return { text: t.slice(0, a) + '[[' + sel + ']]' + t.slice(b), cursor: b + 4 }
}

/** Dicționarul din rândurile citite în ecran (angajați: name; terți: nume, contact_nume, cif) — ce poate citi contul curent. */
export function dictionarDinRanduri(angajati, terti) {
  return new Dictionar(
    [...(angajati || []).map(r => r?.name), ...(terti || []).map(r => r?.contact_nume)].filter(x => typeof x === 'string' && x.trim()),
    (terti || []).map(r => r?.nume).filter(x => typeof x === 'string' && x.trim()),
    (terti || []).map(r => r?.cif).filter(x => typeof x === 'string' || typeof x === 'number').map(String),
  )
}
