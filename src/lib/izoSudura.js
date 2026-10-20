// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — normalizatorul codului de sudură (E1, design v2.3 §1.5)
// ════════════════════════════════════════════════════════════════════════
// Sursa de adevăr va fi o funcție SQL pe server (E4b). Aici e aceeași logică
// pentru afișare și pentru preview-uri, cu setul comun de cazuri din
// izoSudura.cazuri.json (același set va testa și funcția SQL).
//
// Forme acceptate la intrare (toate dau aceeași identitate):
//   T8S543 · TR8S543 · TR 8 S 543 · tr8s543 · GAZPET TR11 S318/A · T11S318/A
//   S202A1 / 204 (fără tronson → îl ia din context)
// Identitatea = (tronson, nr, sufix). Sufixul păstrează slash-ul: „/A” ≠ „A”
// până când convenția proiectului spune altceva (§1.10 conventie_sufixe).
// Afișarea pe LOT 2 = TR8S478 (Q5 A [D#5]); LOT 1 rămâne pe T8S478.
//
// Regula sufixelor (§1.5):
//   mod 'legacy' (LOT 1, regula de azi din parseSudura): R final = refacere,
//     orice alt sufix trece așa cum e.
//   mod 'strict' (LOT 2): sufixul trebuie să fie în convenția proiectului.
//     Convenție goală sau sufix necunoscut → 'cod_ilizibil';
//     R final necunoscut → 'cod_de_confirmat', cu propunerea „refacere”.
// Un cod ambiguu nu se ghicește niciodată: primește 'cod_ilizibil'.

const RE_PREFIX_FIRMA = /^(GAZPET|GAZPET\s+INSTAL)\s+/i
// T/TR + tronson, apoi S + număr, apoi sufix opțional (literă/„/literă”, cu cifră opțională)
const RE_COMPLET = /^T(?:R)?\s*-?\s*(\d{1,3})\s*-?\s*S\s*-?\s*(\d{1,5})\s*((?:\/\s*)?[A-Z]\d?)?$/
// doar S + număr (+ sufix), tronsonul vine din context
const RE_FARA_TRONSON = /^S\s*-?\s*(\d{1,5})\s*((?:\/\s*)?[A-Z]\d?)?$/
// doar numărul (ex. „204” dintr-o coloană SUDURĂ), tronsonul vine din context
const RE_DOAR_NR = /^(\d{1,5})\s*((?:\/\s*)?[A-Z]\d?)?$/

export const STARI_SUDURA = ['ok', 'cod_de_confirmat', 'cod_ilizibil']

// Tronsonul din context poate veni ca 12, '12', 'T12', 'TR12', 'TR 12'
export function tronsonNr(t) {
  if (t === null || t === undefined || t === '') return null
  const m = String(t).trim().toUpperCase().match(/^(?:T(?:R)?\s*)?(\d{1,3})$/)
  return m ? Number(m[1]) : null
}

function curataSufix(s) {
  if (!s) return ''
  return s.toUpperCase().replace(/\s+/g, '')
}

/**
 * Normalizează un cod de sudură.
 * @param {string|number} raw  textul original (din import, tabletă, NDT)
 * @param {object} [opt]
 * @param {string|number} [opt.tronson]   tronsonul din context (obligatoriu pentru „S202A1”, „204”)
 * @param {'legacy'|'strict'} [opt.mod]   'legacy' = LOT 1 (implicit), 'strict' = LOT 2
 * @param {string[]} [opt.conventie]      sufixele permise în mod 'strict' (ex. ['/A','A','C','R','/A1'])
 * @returns {{original:string, stare:string, motiv:string|null, tronson:number|null, nr:number|null,
 *            sufix:string, refacuta:boolean, refacutaPropusa:boolean, altTronson:boolean, canon:string|null}}
 */
export function normalizeazaSudura(raw, opt = {}) {
  const mod = opt.mod === 'strict' ? 'strict' : 'legacy'
  const conventie = (opt.conventie || []).map(curataSufix)
  const tCtx = tronsonNr(opt.tronson)
  const original = raw === null || raw === undefined ? '' : String(raw)
  const rez = {
    original, stare: 'cod_ilizibil', motiv: null, tronson: null, nr: null, sufix: '',
    refacuta: false, refacutaPropusa: false, altTronson: false, canon: null,
  }
  let s = original.trim().toUpperCase().replace(RE_PREFIX_FIRMA, '').replace(/\s+/g, ' ').trim()
  if (!s) { rez.motiv = 'gol'; return rez }

  let tronson = null, nr = null, sufix = ''
  let m = s.match(RE_COMPLET)
  if (m) { tronson = Number(m[1]); nr = Number(m[2]); sufix = curataSufix(m[3]) }
  else if ((m = s.match(RE_FARA_TRONSON)) || (m = s.match(RE_DOAR_NR))) {
    if (tCtx === null) { rez.motiv = 'fara_tronson'; return rez }
    tronson = tCtx; nr = Number(m[1]); sufix = curataSufix(m[2])
  } else {
    rez.motiv = 'format'
    return rez
  }
  if (!Number.isInteger(nr) || nr <= 0) { rez.motiv = 'numar'; return rez }

  rez.tronson = tronson
  rez.nr = nr
  rez.altTronson = tCtx !== null && tCtx !== tronson

  if (mod === 'legacy') {
    // Regula de azi (src/Izometrie.jsx parseSudura): R final = refacere, scos din cod.
    if (sufix === 'R') { rez.refacuta = true; sufix = '' }
    rez.sufix = sufix
    rez.stare = 'ok'
  } else {
    rez.sufix = sufix
    if (!sufix || conventie.includes(sufix)) {
      rez.stare = 'ok'
      rez.refacuta = sufix === 'R' && conventie.includes('R')
    } else if (sufix === 'R') {
      rez.stare = 'cod_de_confirmat'
      rez.refacutaPropusa = true
      rez.motiv = 'sufix_r_neconfirmat'
    } else {
      rez.stare = 'cod_ilizibil'
      rez.motiv = conventie.length ? 'sufix_necunoscut' : 'conventie_goala'
    }
  }
  rez.canon = `TR${tronson}S${nr}${rez.sufix}`
  return rez
}

/**
 * Forma afișată. LOT 2: prefix 'TR' (TR8S478); LOT 1: prefix 'T' (T8S478).
 * pad = numărul minim de cifre al numărului sudurii (0 = fără zerouri, ca în fișe și IZO).
 */
export function formatSudura({ tronson, nr, sufix = '' }, { prefix = 'TR', pad = 0 } = {}) {
  if (tronson === null || tronson === undefined || nr === null || nr === undefined) return ''
  return `${prefix}${tronson}S${String(nr).padStart(pad, '0')}${sufix || ''}`
}

/** Cheia de identitate în cadrul proiectului (legarea NDT se face doar în proiect). */
export function cheieSudura({ tronson, nr, sufix = '' }) {
  return `${tronson}|${nr}|${sufix || ''}`
}

/**
 * Coloana SUDURI din fișa de tăiere: „T8S543 - T8S544” (cele 2 capete ale bucății).
 * Întoarce lista codurilor normalizate; o singură sudură e permisă (capăt de lanț).
 */
export function parseazaPerecheSuduri(raw, opt = {}) {
  const s = String(raw ?? '').trim()
  if (!s) return []
  return s.split(/\s+-\s+|\s*;\s*/).filter(Boolean).map(p => normalizeazaSudura(p, opt))
}

/**
 * Maparea rândurilor vechi din executie_tevi pe modelul nou (§1.5, tabelul „Azi → În modelul nou”).
 * Nu scrie nimic: e folosită în preview-ul importului istoric (E4c) și la afișare.
 */
export function mapeazaRandVechi(r = {}) {
  if (r.tip_rand === 'separator') return { ignora: true, motiv: 'separator fără semnificație fizică' }
  return {
    ignora: false,
    tip_sudura: r.tip_rand === 'legare' ? 'cuplare' : 'linie',
    operatii: r.sudura_refacuta ? ['refacere'] : [],
    // sudura_sant_pending = slotul n-are încă sudură aval; nu se stochează nimic
    fara_sudura_aval: !!r.sudura_sant_pending,
  }
}
