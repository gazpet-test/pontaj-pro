// ════════════════════════════════════════════════════════════════
// ❓ Întreabă echipa — mascarea numelor (decizia owner-ului 13.11.2026, A): PREVIZUALIZAREA din ecran.
// Același algoritm ca worker/intrebari-tehnice/mascare.py (care face mascarea REALĂ, pe server, înainte de orice apel către
// furnizorul modelului) — paritate pe worker/intrebari-tehnice/teste_mascare.json (L19). Ecranul arată ce ar pleca: numele cunoscute
// platformei (cât poate citi contul utilizatorului), tiparele (CNP, telefon, e-mail, IBAN, CUI, nr. auto, firme cu SRL / SA …) și
// cuvintele ascunse manual între [[ și ]]. Pe server se ascunde cel puțin la fel (lista completă de nume + aceleași tipare).
// Nimic din acest fișier nu trimite date nicăieri.
// r2 (review PR #1086): genitivele scurte („Anei”), „dl. Ion” cu titlu, entitățile publice dintr-un singur loc
// (worker/intrebari-tehnice/nemascate.json, decizia owner-ului 13.11.2026), demascarea strictă (demascheazaSigur).
// r3: regula tulpinii (componenta), firmele în orice scriere, intrările fără valoare aruncate, același nume ascuns în toată speța
// (invata + propaga), localitățile vizibile, detectorul LARG de etichete rupte (larg) — vezi docstring-ul din mascare.py.
// Previzualizarea nu are lista de localități (o are doar workerul): aici un nume de familie care e și localitate, scris singur,
// apare ascuns; pe server rămâne vizibil.
// ════════════════════════════════════════════════════════════════
import NEMASCATE_JSON from '../worker/intrebari-tehnice/nemascate.json'
import VOCABULAR_JSON from '../worker/intrebari-tehnice/vocabular_web.json'

export const CATEGORII = ['PERSOANA', 'FIRMA', 'CNP', 'CUI', 'TELEFON', 'EMAIL', 'IBAN', 'NR_AUTO', 'ASCUNS']
// eticheta emisă, EXACT (majuscule) — doar așa se pune la loc
const ETICHETA_SURSA = '\\[(PERSOANA|FIRMA|CNP|CUI|TELEFON|EMAIL|IBAN|NR_AUTO|ASCUNS)_([1-9][0-9]{0,3})(?:_F([1-9][0-9]{0,2}))?\\]'
const eticheta = () => new RegExp(ETICHETA_SURSA, 'gu')
// orice „aproape etichetă” (vezi ASEMANATOR din mascare.py)
const CAT_ASEM = '(?:PERSOAN[AĂ]|FIRM[AĂ]|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[ _.\\-]?AUTO|ASCUNS)'
const ASEMANATOR_SURSA = '(?:\\[[ \\t]*' + CAT_ASEM + '[ \\t_\\-#]*[0-9]+|(?<![A-Za-z0-9\\[])' + CAT_ASEM + '[ \\t]*[_\\-#][ \\t]*[0-9]+)'
  + '(?:[ \\t]*[_\\-][ \\t]*[A-Za-z]?[0-9]+)*(?:[ \\t]*\\])?'
const asemanator = () => new RegExp(ASEMANATOR_SURSA, 'giu')
/** Tot șirul e o „aproape etichetă” (pentru testele de paritate cu ASEMANATOR.fullmatch din mascare.py). */
export const eAsemanator = s => new RegExp(`^(?:${ASEMANATOR_SURSA})$`, 'iu').test(String(s ?? ''))

const L = '[\\p{L}\\p{M}]'
const W = '[\\p{L}\\p{M}\\p{N}_]'
const SP = '[ \\t\\u00a0]'
const CUVANT = new RegExp(`(?<!${W})${L}+(?:-${L}+)*(?!${W})`, 'gu')
const NUMAR = /(?<![0-9])[0-9]+(?![0-9])/g
const SPATIU = new RegExp(`^${SP}+$`, 'u')
const GAP_NUME = new RegExp(`^(?:${SP}+|${SP}*[&+\\-]${SP}*)$`, 'u')
const GAP_FORMA_SURSA = `[”"»“]?${SP}*,?${SP}*`
const GAP_FORMA = new RegExp(`^${GAP_FORMA_SURSA}$`, 'u')
const PREFIX_FIRMA = new RegExp(`(?:(?<![\\p{L}\\p{M}\\p{N}_.])(?:S\\.C\\.?|SC)${SP}*)?[„"«“]?$`, 'u')
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
const FORMA_SURSA = '(?<![\\p{L}\\p{M}\\p{N}_.])(S\\.R\\.L\\.?|S\\.A\\.?|P\\.F\\.A\\.?|I\\.I\\.?|I\\.F\\.?|S\\.N\\.C\\.?|S\\.C\\.S\\.?|SRL|Srl|srl|SA|PFA|II|IF|SNC|SCS)'
  + '(?![\\p{L}\\p{M}\\p{N}_])'
const FORMA = new RegExp(FORMA_SURSA, 'gu')
const FORMA_DUPA = new RegExp(GAP_FORMA_SURSA + FORMA_SURSA, 'yu')
const SUFIXE_CRATIMA = new Set(['ului', 'ul', 'lui', 'ei', 'le', 'a', 'i'])
const FORME_JURIDICE = new Set(['sc', 'srl', 'sa', 'pfa', 'ii', 'if', 'snc', 'scs'])
const ordine = (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)
const TITLURI = `d-l d-lui d-na d-nei dl dlui dna dnei domnul domnului doamna doamnei domni[sș]oara domni[sș]oarei ing inginerul
inginerului inginera inginerei arh arhitectul arhitecta dr colegul colegului colega colegei [sș]eful [sș]efului [sș]efa [sș]efei
directorul directorului directoarea directoarei dirigintele dirigintelui diriginta maistrul maistrului sudorul sudorului
[sș]oferul [sș]oferului numitul numitului numita numitei`.split(/\s+/).sort(ordine)
const TITLU = new RegExp(`(?<!${W})(?:${TITLURI.join('|')})\\.?${SP}+`, 'giu')
// r3 (vezi mascare.py): cuvinte fără cratimă pentru firme; golurile dintre cuvintele unei firme / entități publice / după un marcaj
const CUVANT_SIMPLU = new RegExp(`(?<!${L})${L}+(?!${L})`, 'gu')
const GAP_FIRMA = new RegExp(`^(?:(?!${W})[\\s\\S]){1,6}$`, 'u')
const GAP_PUBLIC = new RegExp(`^(?:(?!${W})[^\\n]){1,3}$`, 'u')
const GAP_MARCAJ = new RegExp(`^\\.?${SP}+$`, 'u')
// r3: detectorul LARG de etichete (larg)
const LINIUTE_LARG = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map(c => String.fromCharCode(c)).join('')
const LARG = new RegExp('(?:PERSOANA|FIRMA|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[_.-]?AUTO|ASCUNS)[_#.:()\\[\\]' + LINIUTE_LARG + '-]*[0-9]+', 'g')
const INVIZIBIL = /^[\p{Z}\p{Cc}\p{Cf}]$/u
const LITERA = /^[\p{L}\p{M}]$/u
const FORMAT = /\p{Cf}/u   // r3: lățime zero, cratimă moale, BOM, marcaje de direcție — detecția le ignoră (faraFormat)

/** minuscule, fără diacritice — ca norm() din mascare.py. */
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

const setDin = s => new Set(s.split(/\s+/).filter(Boolean))
const TITLURI_NORM = new Set(TITLURI.map(x => norm(x.replace('[sș]', 's'))))
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
const COMUNE = setDin(`mare mic mica micu preda verde rosu negru alb albu bun buna lung lungu gros grosu scurt nou noua vechi ion ioni
mai iunie iulie august tot toma`)
const GENERICE_FIRMA = setDin(`construct constructii instal grup group impex trans service servicii com prod serv consult general
proiect design tehnic tehnica gaz gaze energy energie`)
// r3 — aceleași liste ca în mascare.py (testul de paritate le compară)
const FARA_VALOARE = setDin(`diverse divers diversi diversa persoana persoane fizica fizice juridica juridice furnizor furnizori client
clienti necunoscut necunoscuta necunoscuti nespecificat nespecificata altul alta alte altii altele fara nume test teste exista lipsa
niciunul niciuna nimeni toti oricare generic`)
const TERMINATII = ['ului', 'ilor', 'ule', 'lui', 'lor', 'ul', 'le', 'ei', 'ii', 'e', 'i']
const COMPONENTA_MIN_TULPINA = 4
const MARCAJE_LOCALITATE = setDin(`comuna comunei comunele com satul satului satele sat orasul orasului oras municipiul municipiului
mun localitatea localitatii loc judetul judetului jud uat`)
const MARCAJE_ABREVIERI = new Set(['com', 'mun', 'loc', 'jud'])
export const CATEGORII_NEMASCATE = ['operator_retea', 'companie_publica', 'institutie_publica', 'societatea_noastra']

const majuscula = t => /^\p{Lu}/u.test(t)
const toateMari = t => t.toUpperCase() === t && t.toLowerCase() !== t
const titluCaz = t => majuscula(t) && /\p{Ll}/u.test(t.slice(1))
const cifra = t => /^[0-9]/.test(t)
function desparte(t) {
  const i = t.lastIndexOf('-')
  return i > 0 && SUFIXE_CRATIMA.has(t.slice(i + 1).toLowerCase()) ? t.slice(0, i) : t
}
const potriveste = (re, t, a, b) => re.test(t.slice(a, b))
const toate = (re, t) => [...t.matchAll(re)]
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
function ibanLungime(s) {
  const compact = [...s].map((ch, i) => ch === ' ' ? -1 : i).filter(i => i >= 0)
  for (let n = compact.length; n > 14; n--) if (ibanValid(compact.slice(0, n).map(i => s[i]).join(''))) return compact[n - 1] + 1
  return 0
}
function atomi(t, cuNumere, re = CUVANT) {
  const a = toate(re, t).map(m => [m.index, m.index + m[0].length, m[0]])
  if (cuNumere) for (const m of toate(NUMAR, t)) a.push([m.index, m.index + m[0].length, m[0]])
  return a.sort((x, y) => x[0] - y[0])
}
const atomiSimpli = t => atomi(t, true, CUVANT_SIMPLU)
function tokeniFirmaLista(nume) {
  const toks = atomiSimpli(String(nume ?? '')).map(x => norm(x[2]))
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

/** Forma canonică a numelui unei firme (vezi cheie_entitate din mascare.py): fără forma juridică, inițialele lipite. */
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

/** Formele canonice din nemascate.json, validate ca în incarca_nemascate (mascare.py); invalid → aruncă. */
export function incarcaNemascate(date) {
  if (!date || typeof date !== 'object' || !Array.isArray(date.entitati) || !date.entitati.length) throw new Error('entitati')
  const cat = Object.keys(date.categorii || {}).sort()
  if (cat.join('|') !== [...CATEGORII_NEMASCATE].sort().join('|')) throw new Error('categorii')
  const out = new Set()
  for (const e of date.entitati) {
    if (!e || typeof e !== 'object' || Object.keys(e).sort().join('|') !== 'categorie|forme|nume') throw new Error('intrare')
    if (typeof e.nume !== 'string' || !e.nume.trim() || !CATEGORII_NEMASCATE.includes(e.categorie)) throw new Error('intrare')
    if (!Array.isArray(e.forme) || !e.forme.length) throw new Error('forme')
    for (const f of e.forme) { if (typeof f !== 'string' || !f || cheieEntitate(f) !== f) throw new Error(`forma ${f}`); out.add(f) }
  }
  return out
}
export const NEMASCATE = incarcaNemascate(NEMASCATE_JSON)
const NEMASCATE_UN_CUVANT = new Set([...NEMASCATE].filter(f => !f.includes(' ')))

// r3: „cuvânt comun” pentru o firmă dintr-un singur cuvânt (vezi COMUN_FIRMA din mascare.py)
const VOCABULAR_COMUN = new Set(VOCABULAR_JSON.termeni.flatMap(t => String(t).split(/\s+/).filter(Boolean)).map(norm))
const COMUN_FIRMA = new Set([...COMUNE, ...GENERICE_FIRMA, ...OPRIRE, ...FARA_VALOARE, ...VOCABULAR_COMUN])
const SEP_TUPLU = String.fromCharCode(1)   // sub orice literă: ordinea = ordinea tuplurilor din mascare.py
const PRIMELE_PUBLICE = new Set([...NEMASCATE].flatMap(f => [f.split(' ')[0], f[0]]))

/** Componenta de nume din `multime` (Set / Map) a cuvântului normalizat `n` — regula tulpinii (= _componenta din mascare.py). */
function componenta(n, multime) {
  if (multime.has(n)) return n
  if (n.length >= 4 && (n.endsWith('ei') || n.endsWith('ai')) && multime.has(n.slice(0, -2) + 'a')) return n.slice(0, -2) + 'a'
  if (n.length >= 5 && n.endsWith('ei') && multime.has(n.slice(0, -1) + 'a')) return n.slice(0, -1) + 'a'
  for (const t of TERMINATII) {
    const b = n.slice(0, -t.length)
    if (n.endsWith(t) && b.length >= COMPONENTA_MIN_TULPINA && multime.has(b)) return b
  }
  return null
}

/** componenta pe cuvântul întreg sau, la un cuvânt cu cratimă, pe prima parte cunoscută (= _componenta_cuvant din mascare.py). */
function componentaCuvant(n, multime) {
  let c = componenta(n, multime)
  if (c === null && n.includes('-')) for (const p of n.split('-')) { if (!p) continue; c = componenta(p, multime); if (c !== null) break }
  return c
}

/** Intrarea de firmă nu identifică pe nimeni (= _firma_fara_valoare din mascare.py). */
function firmaFaraValoare(tok) {
  if (!tok.length || tok.every(t => FARA_VALOARE.has(t) || OPRIRE.has(t))) return true
  return tok.length === 1 && (tok[0].length < 4 || /^[0-9]+$/.test(tok[0]) || COMUN_FIRMA.has(tok[0]))
}

/** [textul fără caracterele de format (Cf), pozițiile unităților rămase în original] sau [t, null] (= _fara_format din mascare.py). */
function faraFormat(t) {
  if (!FORMAT.test(t)) return [t, null]
  let curat = ''
  const idx = []
  for (let i = 0; i < t.length;) {
    const ch = String.fromCodePoint(t.codePointAt(i))
    if (!FORMAT.test(ch)) { curat += ch; for (let k = 0; k < ch.length; k++) idx.push(i + k) }
    i += ch.length
  }
  return [curat, idx]
}

/** [[start, end]] ale aparițiilor LARGI ale unei etichete în textul original (= _larg din mascare.py). */
export function larg(t) {
  let s = ''
  const poz = []
  for (let i = 0; i < t.length;) {
    const ch = String.fromCodePoint(t.codePointAt(i))
    if (!INVIZIBIL.test(ch)) {
      for (const c of ch.normalize('NFKD')) {
        if (/^\p{M}$/u.test(c)) continue
        for (const u of c.toUpperCase()) { s += u; for (let k = 0; k < u.length; k++) poz.push(i) }
      }
    }
    i += ch.length
  }
  const out = []
  for (const m of s.matchAll(LARG)) {
    const a = poz[m.index]
    if (a > 0 && LITERA.test(t[a - 1])) continue
    out.push([a, poz[m.index + m[0].length - 1] + 1])
  }
  return out
}

/** Numele cunoscute platformei, DOAR pentru căutare locală (vezi Dictionar din mascare.py; r3: localități, intrări aruncate). */
export class Dictionar {
  constructor(persoane = [], firme = [], cui = [], localitati = []) {
    this.aruncate = { persoane: 0, firme: 0, firme_publice: 0 }
    this.localitati = new Set()
    for (const v of localitati) for (const [, , t] of atomi(String(v ?? ''), false))
      for (const p of [t, ...(t.includes('-') ? t.split('-') : [])]) {
        const n = norm(p)
        if (n.length >= 3 && !OPRIRE.has(n) && !MARCAJE_LOCALITATE.has(n)) this.localitati.add(n)
      }
    this.persoane = new Set()
    for (const nume of persoane) {
      const comp = new Set()
      for (const [, , t] of atomi(String(nume ?? ''), false))
        for (const p of [t, ...(t.includes('-') ? t.split('-') : [])]) {
          const n = norm(p)
          if (n.length >= 3 && !OPRIRE.has(n) && !FARA_VALOARE.has(n)) comp.add(n)
        }
      if (comp.size) for (const n of comp) this.persoane.add(n)
      else this.aruncate.persoane++
    }
    const index = new Map()
    for (const nume of firme) {
      const tok = tokeniFirmaLista(nume)
      if (tok.length && NEMASCATE.has(cheieEntitate(nume))) { this.aruncate.firme_publice++; continue }
      if (firmaFaraValoare(tok) || (tok.length === 1 && this.localitati.has(tok[0]))) { this.aruncate.firme++; continue }
      if (!index.has(tok[0])) index.set(tok[0], new Map())
      index.get(tok[0]).set(tok.join(SEP_TUPLU), tok)
    }
    const cmpTup = (a, b) => b.length - a.length || (a.join(SEP_TUPLU) < b.join(SEP_TUPLU) ? -1 : a.join(SEP_TUPLU) > b.join(SEP_TUPLU) ? 1 : 0)
    this.firme = new Map([...index].map(([k, v]) => [k, [...v.values()].sort(cmpTup)]))
    this.cui = new Set()
    for (const c of cui) { const d = doarCifre(String(c ?? '')); if (d.length >= 6 && d.length <= 10) this.cui.add(d) }
  }
  persoana(baza) { return componentaCuvant(norm(baza), this.persoane) }
  statistici() {
    return { persoane: this.persoane.size, firme: [...this.firme.values()].reduce((s, v) => s + v.length, 0), cui: this.cui.size,
      localitati: this.localitati.size, aruncate: { ...this.aruncate } }
  }
}

const cheiePers = set => [...set].sort().join('\u0001')
const subset = (a, b) => [...a].every(x => b.has(x))

/** Mascarea unei spețe — etichete stabile pe durata obiectului (vezi Mascare din mascare.py). */
export class Mascare {
  constructor(dictionar = null) {
    this.d = dictionar || new Dictionar()
    this.tabel = new Map()
    this.ent = Object.fromEntries(CATEGORII.map(c => [c, []]))
    this.inlocuiri = 0
    this.asemOm = new Set(); this.asemMasina = new Set()
    this.vazute = new Map()   // r3: componentă recunoscută în speță → [categorie, cheie] (vezi _vazute din mascare.py)
  }
  contoare() { return Object.fromEntries(CATEGORII.filter(c => this.ent[c].length).map(c => [c, this.ent[c].length])) }
  total() { return CATEGORII.reduce((s, c) => s + this.ent[c].length, 0) }

  entitate(cat, cheie) {
    const lista = this.ent[cat]
    const egal = x => cat === 'PERSOANA' ? cheiePers(x.cheie) === cheiePers(cheie) : x.cheie === cheie
    const gasit = lista.find(egal)
    if (gasit) return gasit
    if (cat === 'PERSOANA') {
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

  detecteaza(t, protejeaza) {
    const luate = [], out = []
    const ocupat = (s, e) => luate.some(([a, b]) => s < b && a < e)
    const adauga = (s, e, cat, cheie, asem = false) => {
      if (s >= e || ocupat(s, e)) return false
      luate.push([s, e])
      if (cat) out.push([s, e, cat, cheie, asem])
      return true
    }
    for (const m of toate(asemanator(), t)) {
      if (protejeaza && this.tabel.has(m[0])) adauga(m.index, m.index + m[0].length, null, null)
      else adauga(m.index, m.index + m[0].length, 'ASCUNS', m[0], true)
    }
    for (const m of toate(MANUAL, t)) adauga(m.index, m.index + m[0].length, 'ASCUNS', m[0])
    for (const m of toate(EMAIL, t)) adauga(m.index, m.index + m[0].length, 'EMAIL', m[0].toLowerCase())
    for (const m of toate(IBAN, t)) {
      const n = ibanLungime(m[0])
      if (n) adauga(m.index, m.index + n, 'IBAN', m[0].slice(0, n).replace(/ /g, ''))
    }
    for (const m of toate(CNP, t)) if (cnpValid(m[0])) adauga(m.index, m.index + m[0].length, 'CNP', m[0])
    for (const m of toate(CUI_RO, t)) adauga(m.index, m.index + m[0].length, 'CUI', doarCifre(m[0]))
    for (const m of toate(CUI_CUVANT, t)) { const [a, b] = m.indices.groups.v; adauga(a, b, 'CUI', doarCifre(m.groups.v)) }
    for (const m of toate(TELEFON, t)) adauga(m.index, m.index + m[0].length, 'TELEFON', '0' + doarCifre(m[0]).slice(-9))
    for (const m of toate(CUI_LISTA, t)) if (this.d.cui.has(m[0])) adauga(m.index, m.index + m[0].length, 'CUI', m[0])
    for (const m of toate(NR_AUTO, t)) if (!NR_AUTO_EXCLUSE.has(m[1])) adauga(m.index, m.index + m[0].length, 'NR_AUTO', m[0].replace(/[ \t-]/g, ''))

    for (let [a, b] of larg(t)) {   // r3: formă LARGĂ de etichetă (rânduri noi / NBSP / invizibile în ea, „persoana 1”)
      if (a > 0 && t[a - 1] === '[') a--
      if (b < t.length && t[b] === ']') b++
      adauga(a, b, 'ASCUNS', t.slice(a, b), true)
    }

    const cuv = atomi(t, false), at = atomi(t, true), simpli = atomiSimpli(t)
    this.localitatiMarcate(t, cuv, adauga)
    this.firmeForma(t, at, adauga)
    this.firmeLista(t, simpli, adauga)
    this.publice(t, simpli, adauga)
    this.persoaneTitlu(t, cuv, adauga, ocupat)
    this.persoaneLista(t, cuv, adauga, ocupat)
    this.invataDin([...out].sort((a, b) => a[0] - b[0]))
    this.propaga(t, cuv, adauga)
    return out.sort((a, b) => a[0] - b[0])
  }

  /** r3: „comuna Berceni” — cuvântul de după un marcaj de localitate rămâne (= _localitati_marcate din mascare.py). */
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
        if (!majuscula(urm) || OPRIRE.has(norm(urm)) || this.d.persoana(desparte(urm)) !== null) break
        j++
        adauga(cuv[j][0], cuv[j][1], null, null)
      }
    }
  }

  /** r3: entitățile publice, numele ÎNTREG + forma juridică, rezervate (= _publice din mascare.py). */
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

  /** r3: componentele numelor recunoscute devin „văzute” pentru restul spețe (= _invata_din din mascare.py). */
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

  /** r3: același nume, în toată speța (= _propaga din mascare.py). */
  propaga(t, cuv, adauga) {
    if (!this.vazute.size) return
    for (const [s, , tok] of cuv) {
      const baza = desparte(tok)
      if (!majuscula(baza)) continue
      const n = norm(baza)
      if (this.d.localitati.has(n)) continue
      const c = componentaCuvant(n, this.vazute)
      if (c !== null && !this.d.localitati.has(c)) { const [cat, cheie] = this.vazute.get(c); adauga(s, s + baza.length, cat, cheie) }
    }
  }

  /** r3: pre-trecerea peste titlu / speță / context, înaintea mascării lor (= invata din mascare.py). */
  invata(...texte) { for (const t of texte) this.detecteaza(faraFormat(String(t ?? ''))[0], false) }

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
      if (m[1].startsWith('I') && (nume.length < 2 || cuvinte.length !== nume.length)) continue
      const cheie = nume.map(a => norm(a[2])).join(' ')
      if (NEMASCATE.has(cheieEntitate(nume.map(a => a[2]).join(' ')))) continue   // numele ÎNTREG, nu un cuvânt din el
      let start = prefix !== null ? prefix : nume[0][0]
      if (prefix === null) { const p = PREFIX_FIRMA.exec(t.slice(Math.max(0, start - 12), start)); if (p) start -= p[0].length }
      adauga(start, m.index + m[0].length, 'FIRMA', cheie)
    }
  }

  /** r3: firmele din dicționar pe șirul de cuvinte normalizat, în orice scriere (= _firme_lista din mascare.py). */
  firmeLista(t, at, adauga) {
    at.forEach(([s, , tok], i) => {
      for (const tup of this.d.firme.get(norm(tok)) || []) {
        let k = i, ok = true
        for (let idx = 1; idx < tup.length; idx++) {
          if (k + 1 >= at.length || !potriveste(GAP_FIRMA, t, at[k][1], at[k + 1][0])) { ok = false; break }
          if (norm(at[k + 1][2]) !== tup[idx]) { ok = false; break }
          k++
        }
        if (!ok) continue
        let start = s, end = at[k][1]
        if (i > 0 && norm(at[i - 1][2]) === 'sc' && potriveste(SPATIU, t, at[i - 1][1], s)) start = at[i - 1][0]
        else { const p = PREFIX_FIRMA.exec(t.slice(Math.max(0, start - 12), start)); if (p) start -= p[0].length }
        FORMA_DUPA.lastIndex = end
        const f = FORMA_DUPA.exec(t)
        if (f) end = f.index + f[0].length
        adauga(start, end, 'FIRMA', tup.join(' '))
        break
      }
    })
  }

  persoaneTitlu(t, cuv, adauga, ocupat) {
    const dupaStart = new Map(cuv.map((c, i) => [c[0], i]))
    for (const m of toate(TITLU, t)) {
      let i = dupaStart.get(m.index + m[0].length)
      const luat = []
      while (i !== undefined && i < cuv.length && luat.length < 3) {
        const [s, e, tok] = cuv[i]
        const baza = desparte(tok)
        if (ocupat(s, s + baza.length)) break   // r3: șirul se oprește înaintea unui cuvânt deja rezervat
        const n = norm(baza), k = this.d.persoana(baza)
        // r2: după un titlu, un cuvânt din COMUNE se ascunde și el („dl. Ion”); entitățile publice dintr-un cuvânt nu sunt persoane
        if (!(majuscula(baza) && !OPRIRE.has(n) && !NEMASCATE_UN_CUVANT.has(n) && (titluCaz(baza) || k !== null || (toateMari(baza) && baza.length >= 6)))) break
        luat.push([s, s + baza.length, k || n])
        if (baza !== tok || i + 1 >= cuv.length || !potriveste(SPATIU, t, e, cuv[i + 1][0])) break
        i++
      }
      if (luat.length) adauga(luat[0][0], luat[luat.length - 1][1], 'PERSOANA', new Set(luat.map(x => x[2])))
    }
  }

  persoaneLista(t, cuv, adauga, ocupat) {
    const info = cuv.map(([s, e, tok]) => {
      const baza = desparte(tok), liber = !ocupat(s, s + baza.length)   // r3: un cuvânt deja rezervat nu intră în șir
      return { s, e, eb: s + baza.length, baza, sufix: baza !== tok || !liber, k: majuscula(baza) && liber ? this.d.persoana(baza) : null }
    })
    const lipit = (a, b) => potriveste(SPATIU, t, info[a].e, info[b].s)
    const n = info.length
    let i = 0
    while (i < n) {
      if (info[i].k === null) { i++; continue }
      let j = i
      const chei = [info[i].k]
      while (j - i < 3 && !info[j].sufix) {
        if (j + 1 < n && lipit(j, j + 1) && info[j + 1].k) { j++; chei.push(info[j].k); continue }
        if (j + 2 < n && j + 2 - i <= 3 && lipit(j, j + 1) && lipit(j + 1, j + 2) && info[j + 1].k === null && !info[j + 1].sufix
            && titluCaz(info[j + 1].baza) && info[j + 2].k && !OPRIRE.has(norm(info[j + 1].baza)) && !COMUNE.has(norm(info[j + 1].baza))) {
          chei.push(norm(info[j + 1].baza), info[j + 2].k); j += 2; continue
        }
        break
      }
      // un cuvânt singur rămâne dacă e cuvânt comun sau, r3, o localitate cunoscută (vezi _persoane_lista din mascare.py)
      const singurVizibil = j === i && (COMUNE.has(chei[0]) || this.d.localitati.has(chei[0]) || this.d.localitati.has(norm(info[i].baza)))
      if (!singurVizibil) adauga(info[i].s, info[j].eb, 'PERSOANA', new Set(chei))
      i = j + 1
    }
  }

  /** Textul cu etichete (string). `protejeaza = false` la textele scrise de om (vezi mascheaza din mascare.py). */
  mascheaza(text, protejeaza = true) {
    const t = String(text ?? '')
    const [curat, idx] = faraFormat(t)
    let out = '', poz = 0
    for (let [s, e, cat, cheie, asem] of this.detecteaza(curat, protejeaza)) {
      if (idx) { s = idx[s]; e = idx[e - 1] + 1 }
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

  /** {afisat, motiv}: motiv null = se poate publica (vezi demascheaza_sigur din mascare.py). */
  demascheazaSigur(text) {
    const t = String(text ?? '')
    for (const m of toate(asemanator(), t)) {
      if (!this.tabel.has(m[0])) return { afisat: null, motiv: 'eticheta_neemisa' }
      if (this.asemMasina.has(m[0]) && !this.asemOm.has(m[0])) return { afisat: null, motiv: 'eticheta_din_model' }
    }
    // r3: detectorul LARG — fiecare apariție trebuie să fie începutul unei etichete emise, scrise exact, în acel loc
    const exacte = new Map()
    for (const m of toate(eticheta(), t)) if (this.tabel.has(m[0])) exacte.set(m.index + 1, m.index + m[0].length)
    for (const [a, b] of larg(t)) if ((exacte.get(a) ?? -1) < b) return { afisat: null, motiv: 'eticheta_rupta' }
    return { afisat: this.demascheaza(t), motiv: null }
  }

  /** Câte etichete emise de această mascare apar în text (după demascare: 0). */
  emiseIn(text) { return toate(eticheta(), String(text ?? '')).filter(m => this.tabel.has(m[0])).length }
}

/** Bucățile textului mascat pentru ecran: [{t: 'text' | 'eticheta', v}] — etichetele se evidențiază. */
export function bucatiMascate(text) {
  const out = []
  let poz = 0
  for (const m of toate(eticheta(), String(text ?? ''))) {
    if (m.index > poz) out.push({ t: 'text', v: text.slice(poz, m.index) })
    out.push({ t: 'eticheta', v: m[0] })
    poz = m.index + m[0].length
  }
  if (poz < String(text ?? '').length) out.push({ t: 'text', v: String(text).slice(poz) })
  return out
}

const NUME_CATEGORII = { PERSOANA: ['persoană', 'persoane'], FIRMA: ['firmă', 'firme'], CNP: ['CNP', 'CNP-uri'], CUI: ['CUI', 'CUI-uri'],
  TELEFON: ['telefon', 'telefoane'], EMAIL: ['e-mail', 'e-mailuri'], IBAN: ['IBAN', 'IBAN-uri'], NR_AUTO: ['nr. auto', 'nr. auto'],
  ASCUNS: ['cuvânt ascuns de tine', 'cuvinte ascunse de tine'] }

/** Previzualizarea a ce pleacă la furnizor: titlu, speță, context mascate în ACEEAȘI ordine ca workerul + rezumatul pentru ecran. */
export function previzualizare({ titlu, intrebare, context }, dictionar) {
  const m = new Mascare(dictionar)
  m.invata(titlu, intrebare, context)   // r3: ca workerul — un nume recunoscut într-un câmp se ascunde în toate
  const rez = {
    titlu: m.mascheaza(titlu, false),
    intrebare: m.mascheaza(intrebare, false),
    context: context ? m.mascheaza(context, false) : '',
  }
  const c = m.contoare()
  const parti = CATEGORII.filter(k => c[k]).map(k => `${c[k]} ${NUME_CATEGORII[k][c[k] === 1 ? 0 : 1]}`)
  return { ...rez, total: m.total(), contoare: c, rezumat: parti.join(', ') }
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
