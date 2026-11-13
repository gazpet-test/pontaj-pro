// ════════════════════════════════════════════════════════════════
// ❓ Întreabă echipa — MOTORUL UNIC de reguli (r4, PR #1086; deciziile owner-ului 13.11.2026: A = numele nu pleacă la furnizor,
// B = „Da” / „Nu” doar cu citat). TOATE regulile stau aici, o singură dată:
//   - normalizarea (curata / norm — O SINGURĂ funcție pentru caracterele invizibile și de combinare);
//   - mascarea numelor (dicționarul platformei + tipare), învățarea / propagarea în speță, etichetele, demascarea strictă;
//   - regula B (tăierea surselor în propoziții, propoziția „de sine stătătoare”, compararea citatului).
// Cine îl folosește:
//   - ecranul (IntrebariTehnice.jsx) — PREVIZUALIZAREA orientativă (lista de nume pe care o poate citi contul; fără localități);
//   - workerul (worker/intrebari-tehnice/motor.py) — prin procesul Node worker/intrebari-tehnice/motor_cli.mjs, câte un proces
//     pe speță; Python NU mai conține reguli (doar orchestrarea: ce se trimite, ce se publică).
// Contractul de acoperire (ce TREBUIE ascuns, ce e în afara lui) și regula B: docs/intrebari/MASCARE_SI_VERDICT.md; cazurile:
// worker/intrebari-tehnice/teste_motor.json (aceleași în vitest, prin procesul Node real și în browser).
// Unicode: categoriile M / Cf / L / N / Z sunt cele ale motorului JS care rulează (serverul: Node 24.20 = Unicode 17.0, fixat în
// worker/intrebari-tehnice/motor_manifest.json; browserul: versiunea lui). Caracterele numite explicit în contract au aceeași
// categorie în toate versiunile ≥ 6.
// Nimic din acest fișier nu trimite date nicăieri: fără rețea, fără fișiere, fără procese (testul static din motor.test.js).
// ════════════════════════════════════════════════════════════════
import NEMASCATE_JSON from '../worker/intrebari-tehnice/nemascate.json' with { type: 'json' }
import VOCABULAR_JSON from '../worker/intrebari-tehnice/vocabular_web.json' with { type: 'json' }
import COMUNE_JSON from '../worker/intrebari-tehnice/cuvinte_comune.json' with { type: 'json' }

export const MOTOR_VERSIUNE = '4.0.0'
export const NUME_MAX_LISTA = 200000      // = NUME_MAX_LISTA din supabase/functions/intrebari-tehnice-worker/logic.js (test)
const U = (...c) => String.fromCharCode(...c)
const NBSP = U(0xa0)
const CRATIME = '\\-' + U(0x2010, 0x2011)                              // cratimele contractului: - U+2010 U+2011
const LINIUTE = U(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)
const RE_CRATIMA = new RegExp(`[${CRATIME}]`, 'u')

// ─── 1. Normalizarea: O SINGURĂ funcție ─────────────────────────────────────────────────────────────────────────────
// Caracterele care NU contează la recunoaștere: toate semnele de combinare (categoria M — diacritice descompuse, U+034F, selectorii
// de variantă U+FE00–FE0F și U+E0100–E01EF) și toate caracterele de format (Cf — U+200B, U+00AD, U+FEFF, marcaje de direcție).
// Recunoașterea rulează pe textul FĂRĂ ele, iar intervalele se pun înapoi pe textul original (ce se înlocuiește e bucata
// ORIGINALĂ: dus-întorsul rămâne exact).
const ELIMINABIL = /[\p{M}\p{Cf}]/u
const ARE_ELIMINABIL = /[\p{M}\p{Cf}]/u
const MARCA = /^\p{M}$/u

/** {s: textul fără caracterele M / Cf, idx: poziția în original a fiecărei unități din s (null dacă n-a fost nimic de scos)}. */
export function curata(text) {
  const t = String(text ?? '')
  if (!ARE_ELIMINABIL.test(t)) return { s: t, idx: null }
  let s = ''
  const idx = []
  for (let i = 0; i < t.length;) {
    const ch = String.fromCodePoint(t.codePointAt(i))
    if (!ELIMINABIL.test(ch)) { s += ch; for (let k = 0; k < ch.length; k++) idx.push(i + k) }
    i += ch.length
  }
  return { s, idx }
}

/** Forma de comparare a numelor: minuscule, descompus (NFD), fără M / Cf — „Șerban” = „Şerban” = „Serban” (și forma descompusă). */
export const norm = s => curata(String(s ?? '').toLowerCase().normalize('NFD')).s

/** Intervalul [s, e) din textul curățat → [a, b) în original; semnele de combinare lipite după ultima literă intră și ele. */
function inapoi(t, idx, s, e) {
  if (!idx) return [s, e]
  let b = idx[e - 1] + 1
  while (b < t.length) {
    const ch = String.fromCodePoint(t.codePointAt(b))
    if (!MARCA.test(ch)) break
    b += ch.length
  }
  return [idx[s], b]
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
const INVIZIBIL_LARG = /^[\p{Z}\p{Cc}\p{Cf}\p{M}]$/u

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

/** [[a, b)] în textul original ale aparițiilor LARGI (a = poziția lui „[”). */
export function larg(t) {
  let s = ''
  const poz = [], sf = []
  for (let i = 0; i < t.length;) {
    const ch = String.fromCodePoint(t.codePointAt(i))
    if (!INVIZIBIL_LARG.test(ch)) {
      for (const c of ch.normalize('NFKD')) {
        if (MARCA.test(c)) continue
        s += c
        for (let k = 0; k < c.length; k++) { poz.push(i); sf.push(i + ch.length) }
      }
    }
    i += ch.length
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
const CUI_LISTA = /(?<![0-9])[0-9]{6,10}(?![0-9])/g
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
    this.cui = new Set()
    for (const c of cui) { const d = doarCifre(String(c ?? '')); if (d.length >= 6 && d.length <= 10) this.cui.add(d) }
  }

  /** Componenta comună (contract): cuvânt obișnuit sau localitate cunoscută — singură, fără context, rămâne vizibilă. */
  comun(c) { return COMUN.has(c) || this.localitati.has(c) }
  /** `a` și `b` sunt componente ale aceluiași nume din listă. */
  pereche(a, b) { return a !== b && this.perechi.has(cheiePereche(a, b)) }
  /** O firmă dintr-un singur cuvânt comun / scurt / numeric / localitate cere context (formă juridică, „SC”, numele întreg văzut). */
  firmaComuna(tup) { return tup.length === 1 && (this.comun(tup[0]) || tup[0].length < 4 || /^[0-9]+$/.test(tup[0])) }

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
// separatoarele dintre componentele unei firme: 1–6 caractere din mulțimea ÎNCHISĂ (spații — inclusiv NBSP —, tab, CR / LF,
// virgulă, punct, ghilimele, paranteze rotunde, &, +, cratimele contractului)
const SEP_CLASA = `\\p{Zs}\\t\\r\\n,."'„”“«»‚‘’()&+${CRATIME}`
const SEP_FIRMA = new RegExp(`^[${SEP_CLASA}]{1,6}$`, 'u')
// la persoane: aceeași mulțime FĂRĂ punct și rând nou (sfârșitul unei propoziții nu leagă două nume)
const SEP_PERS = new RegExp(`^[\\p{Zs}\\t,"'„”“«»‚‘’()&+${CRATIME}]{1,6}$`, 'u')
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

  /** [[s, e, categorie, cheie, asemanator]] pe textul CURĂȚAT `t`, fără suprapuneri; prioritatea = ordinea de mai jos. */
  detecteaza(t, protejeaza) {
    const luate = [], out = []
    const ocupat = (s, e) => luate.some(([a, b]) => s < b && a < e)
    const adauga = (s, e, cat, cheie, asem = false) => {
      if (s >= e || ocupat(s, e)) return false
      luate.push([s, e])
      if (cat) out.push([s, e, cat, cheie, asem])
      return true
    }
    for (const m of asemanatoare(t)) {                    // 1. etichetele noastre EXACTE rămân (textul modelului); restul se ascund
      if (protejeaza && this.tabel.has(m[0])) adauga(m.index, m.index + m[0].length, null, null)
      else adauga(m.index, m.index + m[0].length, 'ASCUNS', m[0], true)
    }
    for (const m of toate(MANUAL, t)) adauga(m.index, m.index + m[0].length, 'ASCUNS', m[0])            // 2. [[ascuns de om]]
    for (const m of toate(EMAIL, t)) adauga(m.index, m.index + m[0].length, 'EMAIL', m[0].toLowerCase()) // 3.
    for (const m of toate(IBAN, t)) {                                                                    // 4.
      const n = ibanLungime(m[0])
      if (n) adauga(m.index, m.index + n, 'IBAN', m[0].slice(0, n).replace(/ /g, ''))
    }
    for (const m of toate(CNP, t)) if (cnpValid(m[0])) adauga(m.index, m.index + m[0].length, 'CNP', m[0])   // 5.
    for (const m of toate(CUI_RO, t)) adauga(m.index, m.index + m[0].length, 'CUI', doarCifre(m[0]))       // 6.
    for (const m of toate(CUI_CUVANT, t)) { const [a, b] = m.indices.groups.v; adauga(a, b, 'CUI', doarCifre(m.groups.v)) }
    for (const m of toate(TELEFON, t)) adauga(m.index, m.index + m[0].length, 'TELEFON', '0' + doarCifre(m[0]).slice(-9))   // 7.
    for (const m of toate(CUI_LISTA, t)) if (this.d.cui.has(m[0])) adauga(m.index, m.index + m[0].length, 'CUI', m[0])       // 8.
    for (const m of toate(NR_AUTO, t)) if (!NR_AUTO_EXCLUSE.has(m[1])) adauga(m.index, m.index + m[0].length, 'NR_AUTO', m[0].replace(/[ \t-]/g, ''))
    for (let [a, b] of larg(t)) {                                    // 9. etichetă ruptă („[PERSOANA_\n1]”) în textul omului
      if (b < t.length && t[b] === ']') b++
      adauga(a, b, 'ASCUNS', t.slice(a, b), true)
    }
    const cuv = toate(RE_COMPUS, t).map(m => [m.index, m.index + m[0].length, m[0]])
    const simpli = toate(RE_SIMPLU, t).map(m => [m.index, m.index + m[0].length, m[0]])
    const at = [...cuv, ...toate(RE_NUMAR, t).map(m => [m.index, m.index + m[0].length, m[0]])].sort((x, y) => x[0] - y[0])
    this.firmeDictionar(t, simpli, adauga)          // 10. potrivirea COMPLETĂ a firmelor din dicționar — ÎNAINTEA oricărei excepții
    this.localitatiMarcate(t, cuv, adauga)          // 11. „comuna Berceni” rămâne
    this.firmeForma(t, at, adauga)                  // 12. firme NECUNOSCUTE, după forma juridică (tipar; numele întreg public rămâne)
    this.publice(t, simpli, adauga)                 // 13. entitățile publice (nume întreg) rămân
    this.persoaneTitlu(t, cuv, adauga, ocupat)      // 14. „dl. X”, „ing. Y”
    this.persoaneLista(t, cuv, adauga, ocupat)      // 15. persoanele din dicționar
    this.invataDin([...out].sort((a, b) => a[0] - b[0]))
    this.propaga(t, cuv, adauga)                    // 16. același nume, în toată speța
    return out.sort((a, b) => a[0] - b[0])
  }

  /** Potrivirea firmei `tup` începând cu cuvântul simplu `i`: {start, end, context} sau null. */
  potrivireFirma(t, simpli, i, tup) {
    const ultim = tup.length - 1
    let start = simpli[i][0], context = false, k = i, end = -1
    for (let x = 0; x <= ultim; x++) {
      if (x > 0) {
        if (k + 1 >= simpli.length || !potriveste(SEP_FIRMA, t, simpli[k][1], simpli[k + 1][0])) return null
        k++
      }
      const [s, e, tok] = simpli[k]
      let corp = tok, off = 0
      if (x === 0) {   // „SC” lipit în față: „SCEngie”
        const n0 = norm(tok)
        if (n0 !== tup[0] && n0.startsWith('sc') && n0.length > 2) {
          const p = prefixNorm(tok, 'sc')
          if (p > 0 && componentaFirma(norm(tok.slice(p)), tup[0], x === ultim) !== null) { corp = tok.slice(p); off = p; context = true }
        }
      }
      const n = norm(corp)
      if (n === tup[x]) { end = e; continue }
      if (x !== ultim) return null
      if (componentaFirma(n, tup[x], true) !== null) { end = e; continue }   // flexiune pe ultima componentă
      const p = prefixNorm(corp, tup[x])                                     // forma juridică LIPITĂ: „ServiciiSRL”, „ServiciiS.R.L.”
      if (p <= 0) return null
      FORMA_LIPITA.lastIndex = s + off + p
      const f = FORMA_LIPITA.exec(t)
      if (!f) return null
      end = f.index + f[0].length; context = true
      return this.prefixSC(t, start, end, context)
    }
    FORMA_SEPARATA.lastIndex = end                                           // forma juridică despărțită: „Servicii, S.R.L.”
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
      const n = norm(simpli[i][2])
      const chei = new Set([n])
      if (n.startsWith('sc') && n.length > 2) chei.add(n.slice(2))
      const cand = []
      for (const c of chei) for (const tup of this.d.firme.get(c) || []) cand.push(tup)
      for (const tup of this.firmeFlexionate(n)) cand.push(tup)
      cand.sort((a, b) => b.length - a.length)
      for (const tup of cand) {
        const r = this.potrivireFirma(t, simpli, i, tup)
        if (!r) continue
        const cheie = tup.join(' ')
        if (this.d.firmaComuna(tup) && !r.context) continue           // cuvânt comun fără context: rămâne (sau îl prinde propagarea)
        if (adauga(r.start, r.end, 'FIRMA', cheie)) break
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

  /** Componentele din dicționar ale unui cuvânt (cu cratimă: fiecare parte cu majusculă): {chei, comun} sau null. */
  componenteToken(tok) {
    const chei = []
    let comun = true
    for (const p of parti(tok)) {
      if (!majuscula(p)) continue
      const n = norm(p)
      const c = componenta(n, this.d.persoane)
      if (c === null) continue
      chei.push(c)
      if (!(this.d.comun(c) || this.d.localitati.has(n))) comun = false
    }
    return chei.length ? { chei, comun } : null
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
   *  Cuvintele cunoscute despărțite de SPAȚII formează un nume (până la 4); prin celelalte separatoare ale contractului (virgulă,
   *  ghilimele, paranteze, &, +) se leagă DOAR două componente ale aceluiași nume din listă („Vlădescu, Ana”) — o enumerare de
   *  persoane diferite („Ana Vlădescu, Maria Zamfirescu”) rămâne pe etichete diferite. Cel mult un cuvânt necunoscut ÎNTRE două
   *  cunoscute (al doilea prenume). O componentă COMUNĂ singură, fără context, rămâne vizibilă. */
  persoaneLista(t, cuv, adauga, ocupat) {
    const info = cuv.map(([s, e, tok]) => {
      const liber = !ocupat(s, e)
      return { s, e, tok, liber, c: liber ? this.componenteToken(tok) : null }
    })
    const n = info.length
    const pereche = (a, b) => info[a].c.chei.some(x => info[b].c.chei.some(y => this.d.pereche(x, y)))
    const lipit = (a, b) => potriveste(SPATIU, t, info[a].e, info[b].s) || (potriveste(SEP_PERS, t, info[a].e, info[b].s) && pereche(a, b))
    const spatiu = (a, b) => potriveste(SPATIU, t, info[a].e, info[b].s)
    let i = 0
    while (i < n) {
      if (!info[i].c) { i++; continue }
      let j = i
      const chei = [...info[i].c.chei]
      while (j - i < 3) {
        if (j + 1 < n && info[j + 1].c && lipit(j, j + 1)) { j++; chei.push(...info[j].c.chei); continue }
        const mij = info[j + 1]
        if (j + 2 < n && j + 2 - i <= 3 && mij.liber && !mij.c && info[j + 2].c && spatiu(j, j + 1) && spatiu(j + 1, j + 2)
            && titluCaz(mij.tok) && !OPRIRE.has(norm(mij.tok)) && !COMUN.has(norm(mij.tok))) {
          chei.push(norm(mij.tok), ...info[j + 2].c.chei); j += 2; continue
        }
        break
      }
      if (j > i || !info[i].c.comun) adauga(info[i].s, info[j].e, 'PERSOANA', new Set(chei))
      i = j + 1
    }
  }

  /** Componentele numelor recunoscute (persoane și firme) devin „văzute” pentru restul spețe. Nu se învață: sub 3 litere,
   *  OPRIRE, cuvinte generice de firmă, forme juridice, cifre, cuvintele-entitate publice. O componentă din două nume diferite
   *  primește cheia doar a ei. */
  invataDin(gasite) {
    const aceeasi = (a, b) => a[0] === b[0] && (a[0] === 'PERSOANA' ? cheiePers(a[1]) === cheiePers(b[1]) : a[1] === b[1])
    for (const [, , cat, cheie] of gasite) {
      let comp
      if (cat === 'PERSOANA') comp = [...cheie].sort()
      else if (cat === 'FIRMA') comp = cheie.split(' ').filter(x => !/^[0-9]+$/.test(x) && !GENERICE_FIRMA.has(x) && !FORME_JURIDICE.has(x))
      else continue
      for (const c of comp) {
        if (c.length < 3 || OPRIRE.has(c) || NEMASCATE_UN_CUVANT.has(c)) continue
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
   *  cheia numelui întreg — chiar dacă singur ar fi cuvânt comun (compromisul declarat). Excepție: localitățile cunoscute. */
  propaga(t, cuv, adauga) {
    if (!this.vazute.size) return
    for (const [s, e, tok] of cuv) {
      for (const p of parti(tok)) {
        if (!majuscula(p)) continue
        const n = norm(p)
        if (this.d.localitati.has(n)) continue
        const c = componenta(n, this.vazute)
        if (c !== null && !this.d.localitati.has(c)) { const [cat, cheie] = this.vazute.get(c); adauga(s, e, cat, cheie); break }
      }
    }
  }

  /** Pre-trecerea peste titlu / speță / context, ÎNAINTEA mascării lor: un nume recunoscut într-unul se ascunde în toate. */
  invata(...texte) { for (const t of texte) this.detecteaza(curata(t).s, false) }

  /** Textul cu etichete. `protejeaza = false` la textele scrise de om (o etichetă scrisă de mână se ascunde și ea). */
  mascheaza(text, protejeaza = true) {
    const t = String(text ?? '')
    const { s: c, idx } = curata(t)
    let out = '', poz = 0
    for (const [s0, e0, cat, cheie, asem] of this.detecteaza(c, protejeaza)) {
      const [s, e] = inapoi(t, idx, s0, e0)
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

// ─── 10. Regula B (decizia owner-ului 13.11.2026; r4 conservatoare) ──────────────────────────────────────────────
// „Da” / „Nu” trec DOAR cu un citat INTEGRAL dintr-o propoziție AUTONOMĂ a sursei marcate pe aceeași linie; orice dependență
// structurală nereconstituită → „Incert”. Propoziția NU e autonomă dacă:
//   - e un element de listă (numerotată, cu litere, cu liniuțe / buline), introducerea unei liste („…:”), are „;” sau e o celulă
//     de tabel („|”, tab) — chiar dacă introducerea conține „nu”;
//   - are o trimitere (art., alin., lit., pct., anexa, „conform”, „potrivit”, „prevăzut la”) sau o expresie care se sprijină pe alt
//     text („aceste condiții”, „acesta”, „respectiv”, „prezentul”, „de mai sus”);
//   - are o excepție / derogare („prin derogare”, „cu excepția”, „nu se aplică”), sau ALTĂ propoziție din același paragraf are o
//     restricție (excepție, derogare, „numai / doar dacă”, „cu condiția”, „dar / însă numai”);
//   - paragraful ei e tăiat la marginea extrasului (începutul / sfârșitul extrasului nu e o margine sigură, sau „…” în extras):
//     lipsa vecinului nu înseamnă lipsa restricției;
//   - începe cu literă mică (fragment) sau nu se termină cu „.”, „!”, „?”.
// Citatul se compară cu propoziția fără normalizarea permisivă a numelor: semnele, cifrele, operatorii și diacriticele rămân
// („-5” ≠ „5”, „≤” ≠ „<”, „sau” ≠ „său”); contează doar: majusculele, spațiile, ghilimelele, sedila / virgula de sub ș / ț,
// liniuțele tipografice (= „-”) și punctuația de la sfârșit.
// Limita declarată: un citat autonom și autentic poate totuși susține o concluzie greșită pentru speța concretă; o restricție
// aflată în ALT paragraf nu e văzută. Omul vede sursele alăturate.
export const INCERT = 'Incert — de verificat'
export const INCERT_REGULA_B = `${INCERT}: niciun citat nu reproduce exact o propoziție întreagă și de sine stătătoare dintr-o sursă — citește sursele alăturate.`
export const CITAT_MIN_CUVINTE = 6
const CITAT = /[„“"«]([^„“”"«»\n]{8,800})[”“"»]/g
const FARA_SURSA = 'nu am gasit sursa oficiala'
const VERDICT_CURATA = /^[\s#>*_`-]*(?:verdict\s*[:\-–—]?\s*)?[*_`]*\s*/i
const MARCAJ = /\[\s*([cw]\d{1,2}(?:\s*[,;]\s*[cw]\d{1,2})*)\s*\]/g
const ABREVIERI = new Set('art alin pct lit nr ord hg oug cap sect par fig pag ex cca min max str ed vol pt np sr en iso stas tab pl ing dl dna'.split(' '))
const MARCAJ_LISTA = '(?:\\d{1,3}[.)]|\\(\\d{1,3}\\)|\\p{Ll}\\)|\\(\\p{Ll}\\)|[ivx]{1,4}[.)]|[-–—•▪◦*·])(?=\\s)'
const INCEPE_LISTA = new RegExp(`^\\s*${MARCAJ_LISTA}`, 'u')
const LISTA_INAUNTRU = new RegExp(`(?:^|[:;\\n])\\s*${MARCAJ_LISTA}`, 'u')
const TRIMITERE = /\b(?:conform|potrivit|in conformitate|prevazut\w*|mentionat\w*|mai sus|mai jos|precedent\w*|anterior\w*|urmator\w*|acest\w*|aceast\w*|acel|acela|acelei|acelui|acea|aceea|acele|acelor|respectiv\w*|prezent(?:ul|a|ele|ului|ei|elor)|art|articol\w*|alin|alineat\w*|lit|litera|pct|punct(?:ul|ele)|anex\w*|capitol\w*|sectiun\w*|tabel\w*|figur\w*|el|ea|ei|ele)\b/
const EXCEPTIE = /\b(?:prin derogare|derog\w*|cu exceptia|exceptand|exceptie|exceptii|nu se aplica|nu sunt aplicabile|nu este aplicabil\w*|in afara (?:de|cazului|situatiei)|sub rezerva|fara a aduce atingere)\b/
const RESTRICTIE = /\b(?:prin derogare|derog\w*|cu exceptia|exceptand|exceptie|exceptii|nu se aplica|nu sunt aplicabile|nu este aplicabil\w*|in afara (?:de|cazului|situatiei)|sub rezerva|fara a aduce atingere|numai daca|doar daca|numai cu|doar cu|numai in|doar in|numai pentru|doar pentru|numai dupa|doar dupa|cu conditia|in cazul in care|dar numai|insa numai|dar doar|insa doar)\b/
const normB = s => norm(s)   // forma pentru CĂUTAREA cuvintelor-semnal (nu pentru compararea citatului)

/** Forma de comparare a unui citat și a unei propoziții din sursă (fără normalizarea permisivă a numelor — vezi mai sus). */
export function formaCitat(s) {
  return String(s ?? '').normalize('NFC').replace(/\p{Cf}/gu, '')
    .replace(/[şŞ]/g, x => x === 'ş' ? 'ș' : 'Ș').replace(/[ţŢ]/g, x => x === 'ţ' ? 'ț' : 'Ț').toLowerCase()
    .replace(/[„“”"«»‚‘’'`´]/g, '').replace(new RegExp(`[${LINIUTE}]`, 'g'), '-')
    .replace(/\s+/g, ' ').replace(/ ?([^\p{L}\p{N} ]) ?/gu, '$1').trim().replace(/[.;:!?]+$/, '')
}

/** Paragrafele unei surse: [{text, taiatInceput, taiatSfarsit}] — rând gol = paragraf nou; „…” = tăietură (ambele părți). */
function paragrafe(sursa) {
  const text = String(sursa.extras ?? '').replace(/\r\n?/g, '\n')
  const blocuri = text.split(/\n[ \t]*\n/)
  const out = []
  blocuri.forEach((b, bi) => {
    const bucati = b.split(/…|\.\.\./)
    bucati.forEach((x, xi) => {
      out.push({ text: x, taiatInceput: xi > 0 || (bi === 0 && sursa.inceput_sigur !== true),
        taiatSfarsit: xi < bucati.length - 1 || (bi === blocuri.length - 1 && sursa.sfarsit_sigur !== true) })
    })
  })
  return out.filter(p => p.text.trim())
}

// un marcaj de listă începe un element la început, după „:” / „;” sau la rând nou (după „.” ar fi abrevierea: „lit. b)”, „alin. (2)”);
// „lucrări. 2. Executarea” rămâne o propoziție care ÎNCEPE cu marcaj → tot element de listă (INCEPE_LISTA în propozitiiSursa)
const MARCAJ_LISTA_G = new RegExp(`(?:^|(?<=[:;\\n]))[ \\t]*(${MARCAJ_LISTA})`, 'gu')

/** Propozițiile unei bucăți: se despart la „.” / „!” / „?” urmate de spațiu (sau la capăt); NU după o abreviere (ABREVIERI) sau o
 *  inițială, nici înaintea unei cifre / „(” („art. 5”, „alin. (2)”). O despărțire ratată lipește două propoziții → citatul uneia
 *  nu mai e identic → „Incert” (direcția prudentă). */
function taiePropozitii(bucata) {
  const out = []
  let start = 0
  for (const m of bucata.matchAll(/[.!?](?=\s|$)/g)) {
    const k = m.index
    if (/^\s*(?:[0-9]{1,3}|[ivx]{1,4})$/i.test(bucata.slice(start, k))) continue   // marcajul de listă „2.” rămâne cu elementul lui
    if (bucata[k] === '.') {
      const w = normB(bucata.slice(start, k)).match(/(\p{L}+)$/u)
      if (w && (ABREVIERI.has(w[1]) || w[1].length === 1)) continue
    }
    const urm = bucata.slice(k + 1).match(/^\s*(\S)/)
    if (urm && /[0-9(]/.test(urm[1])) continue
    out.push(bucata.slice(start, k + 1)); start = k + 1
  }
  out.push(bucata.slice(start))
  return out.map(x => x.trim()).filter(Boolean)
}

/** Propozițiile unui paragraf: [{text, lista}]. Fiecare marcaj de listă („1. ”, „a) ”, „(2) ”, „- ”, „• ”) aflat la început, după
 *  „:” / „;” / sfârșit de propoziție sau rând nou începe un ELEMENT de listă (lista = true). */
function propozitiiParagraf(text) {
  const taieturi = new Set([0])
  for (const m of text.matchAll(MARCAJ_LISTA_G)) taieturi.add(m.index + m[0].length - m[1].length)
  const poz = [...taieturi].sort((a, b) => a - b)
  const out = []
  poz.forEach((p, i) => {
    const bucata = text.slice(p, i + 1 < poz.length ? poz[i + 1] : text.length)
    const lista = INCEPE_LISTA.test(bucata)
    for (const x of taiePropozitii(bucata)) out.push({ text: x, lista })
  })
  return out
}

/** Propozițiile unei surse, fiecare cu motivul pentru care NU e autonomă (null = autonomă). */
export function propozitiiSursa(sursa) {
  const out = []
  for (const p of paragrafe(sursa)) {
    const prop = propozitiiParagraf(p.text)
    const restrictii = prop.map(x => RESTRICTIE.test(normB(x.text)))
    prop.forEach((x, i) => {
      const n = normB(x.text)
      let motiv = null
      if (p.taiatInceput || p.taiatSfarsit) motiv = 'context_taiat'
      else if (x.lista || INCEPE_LISTA.test(x.text) || LISTA_INAUNTRU.test(x.text) || /[;|\t]/.test(x.text) || /:\s*$/.test(x.text)) motiv = 'lista_sau_tabel'
      else if (TRIMITERE.test(n)) motiv = 'trimitere'
      else if (EXCEPTIE.test(n)) motiv = 'exceptie'
      else if (restrictii.some((r, j) => r && j !== i)) motiv = 'restrictie_in_paragraf'
      else if (!/^[\p{Lu}0-9]/u.test(x.text.replace(/^[„“"«(\s]+/, ''))) motiv = 'fragment'
      else if (!/[.!?]["”»]?$/.test(x.text)) motiv = 'fara_sfarsit'
      out.push({ text: x.text, motiv })
    })
  }
  return out
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

/** Citatul e IDENTIC (formaCitat) cu o propoziție AUTONOMĂ a uneia dintre sursele `ids`, cu ≥ CITAT_MIN_CUVINTE cuvinte. */
function citatSustinut(citat, ids, harta) {
  const f = formaCitat(citat)
  if ((f.match(/[\p{L}\p{N}]+/gu) || []).length < CITAT_MIN_CUVINTE) return false
  for (const i of ids) {
    if (!harta.has(i)) continue
    if (harta.get(i).some(p => p.motiv === null && formaCitat(p.text) === f)) return true
  }
  return false
}

/** Harta {ID → propozițiile sursei} din lista de surse [{id, extras, inceput_sigur, sfarsit_sigur}]. */
function hartaPropozitii(surse) {
  const h = new Map()
  for (const s of surse || []) {
    const id = String(s?.id ?? '').trim().toUpperCase()
    if (id) h.set(id, propozitiiSursa(s))
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
