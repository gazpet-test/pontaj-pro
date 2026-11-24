// Registru DCC — formatorul de cod și de nume de fișier (oglinda EXACTĂ a funcțiilor SQL din 20270108a: fn_dcc_format_valid,
// fn_dcc_cod_text, fn_dcc_titlu_scurt, fn_dcc_nume_fisier, fn_dcc_interval_canonic, fn_dcc_interval_e_canonic). Funcții pure, fără importuri.
// Paritatea SQL <-> JS e testată pe ACELAȘI tabel de cazuri (src/dcc/dccCodCazuri.json, valori scrise de mână) + 500 de combinații generate
// (scripts/pglite/test_executie_dcc_registru_local.mjs, blocul p_paritate_formator). L19: orice schimbare aici se face și în migrare.
//
// Formatul (dcc_ghiduri.format_cod / format_fisier): tablou ordonat de segmente {camp, prefix, cifre?}.
//   camp   ∈ contract | emitent | tematica | tip | secventa | fila | anexa | revizie | limba (fiecare cel mult o dată)
//   prefix = textul pus înaintea valorii, din [-._A-Za-z]{0,6}; primul segment are prefix gol, celelalte prefix nevid
//   cifre  = completarea cu zerouri: exact 5 la secventa, 1..3 la fila / anexa; absent (sau null) în rest
// Obligatorii în orice format: contract, emitent, tematica, tip, secventa, fila, anexa, revizie (un câmp NULL se omite la formatare,
//   deci prezența lui nu costă nimic). limba e opțională în cod (Lot 2), dar perechea (cod, fișier) trebuie s-o conțină (formatePereche).
//   Prefixele filei și anexei diferă (altfel fila 1 și anexa 1 ar da același text).

const CAMPURI = ['contract', 'emitent', 'tematica', 'tip', 'secventa', 'fila', 'anexa', 'revizie', 'limba']
const OBLIGATORII = ['contract', 'emitent', 'tematica', 'tip', 'secventa', 'fila', 'anexa', 'revizie']
const PREFIX_RE = /^[-._A-Za-z]{0,6}$/
const INTERVAL_RE = /^(general|[A-Z]{1,4}[0-9]{1,3})$/
// diacriticele românești -> ASCII (aceeași hartă ca translate() din fn_dcc_titlu_scurt); ş / ţ cu sedilă incluse
const DIACRITICE_DIN = 'ăâîșşțţĂÂÎȘŞȚŢ'
const DIACRITICE_IN = 'aaissttAAISSTT'

const eroare = (cod, detaliu) => new Error(`${cod}: ${detaliu}`)
const eObiect = x => x !== null && typeof x === 'object' && !Array.isArray(x)

export function formatValid(format) {
  if (!Array.isArray(format) || format.length === 0) return false
  const vazute = new Set()
  const prefixe = {}
  for (let i = 0; i < format.length; i++) {
    const s = format[i]
    if (!eObiect(s)) return false
    for (const k of Object.keys(s)) if (k !== 'camp' && k !== 'prefix' && k !== 'cifre') return false
    if (typeof s.camp !== 'string' || !CAMPURI.includes(s.camp) || vazute.has(s.camp)) return false
    vazute.add(s.camp)
    if (typeof s.prefix !== 'string' || !PREFIX_RE.test(s.prefix)) return false
    if (i === 0 ? s.prefix !== '' : s.prefix === '') return false
    prefixe[s.camp] = s.prefix
    const areCifre = Object.prototype.hasOwnProperty.call(s, 'cifre') && s.cifre !== null
    if (s.camp === 'secventa') { if (s.cifre !== 5) return false }
    else if (s.camp === 'fila' || s.camp === 'anexa') { if (!Number.isInteger(s.cifre) || s.cifre < 1 || s.cifre > 3) return false }
    else if (areCifre) return false
  }
  for (const c of OBLIGATORII) if (!vazute.has(c)) return false
  if (prefixe.fila === prefixe.anexa) return false
  return true
}

// perechea de formate a unui ghid: ambele valide și limba prezentă în cel puțin unul (oglinda CHECK-ului dcc_ghiduri_limba_ck)
export function formatePereche(formatCod, formatFisier) {
  if (!formatValid(formatCod) || !formatValid(formatFisier)) return false
  return formatCod.some(s => s.camp === 'limba') || formatFisier.some(s => s.camp === 'limba')
}

const cifreDe = (format, camp) => format.find(s => s.camp === camp)?.cifre
const intreg = (v, min, max) => Number.isInteger(v) && v >= min && v <= max

export function codDcc(format, comp) {
  if (!formatValid(format)) throw eroare('DCC_FORMAT_INVALID', 'formatul ghidului nu e valid')
  const c = eObiect(comp) ? comp : {}
  const val = k => (c[k] === undefined ? null : c[k])
  for (const k of ['contract', 'emitent', 'tip', 'secventa', 'revizie']) {
    if (val(k) === null) throw eroare('DCC_CAMP_LIPSA', `lipsește ${k}`)
  }
  const inv = k => eroare('DCC_VALOARE_INVALIDA', `valoare invalidă pentru ${k}`)
  if (typeof val('contract') !== 'string' || !/^[0-9]{2}$/.test(val('contract'))) throw inv('contract')
  if (typeof val('emitent') !== 'string' || !/^[A-Z]{3}$/.test(val('emitent'))) throw inv('emitent')
  if (val('tematica') !== null && (typeof val('tematica') !== 'string' || !/^[A-Z0-9]{2,4}$/.test(val('tematica')))) throw inv('tematica')
  if (typeof val('tip') !== 'string' || !/^[A-Z]{2,4}$/.test(val('tip'))) throw inv('tip')
  if (!intreg(val('secventa'), 1, 99999)) throw inv('secventa')
  if (val('fila') !== null && !intreg(val('fila'), 1, 10 ** cifreDe(format, 'fila') - 1)) throw inv('fila')
  if (val('anexa') !== null && !intreg(val('anexa'), 1, 10 ** cifreDe(format, 'anexa') - 1)) throw inv('anexa')
  if (val('fila') !== null && val('anexa') !== null) throw inv('fila/anexa')
  if (!intreg(val('revizie'), 0, 2147483647)) throw inv('revizie')
  if (val('limba') !== null && (typeof val('limba') !== 'string' || !/^(RO|EN|BI)$/.test(val('limba')))) throw inv('limba')
  if (val('limba') === null && format.some(s => s.camp === 'limba')) throw eroare('DCC_LIMBA_LIPSA', 'ghidul cere limba')
  let out = ''
  for (const s of format) {
    const v = val(s.camp)
    if (v === null) continue
    const txt = (s.camp === 'secventa' || s.camp === 'fila' || s.camp === 'anexa') ? String(v).padStart(s.cifre, '0') : String(v)
    out += s.prefix + txt
  }
  return out
}

export function titluScurtDcc(titlu) {
  if (typeof titlu !== 'string') throw eroare('DCC_TITLU_SCURT_GOL', 'titlul scurt lipsește')
  let t = ''
  for (const ch of titlu) {
    const i = DIACRITICE_DIN.indexOf(ch)
    t += i >= 0 ? DIACRITICE_IN[i] : ch
  }
  t = t.replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  t = t.slice(0, 60).replace(/_+$/g, '')
  if (t === '') throw eroare('DCC_TITLU_SCURT_GOL', 'titlul scurt e gol după curățare')
  return t
}

export function numeFisierDcc(formatFisier, comp, titluScurt, ext) {
  const cod = codDcc(formatFisier, comp)
  const titlu = titluScurtDcc(titluScurt)
  // extensia se verifică ÎNAINTEA literelor mici (lower() din SQL și toLowerCase() din JS diferă pe litere non-ASCII)
  if (typeof ext !== 'string' || !/^[A-Za-z0-9]{1,8}$/.test(ext)) throw eroare('DCC_EXTENSIE_INVALIDA', 'extensia nu e [a-z0-9]{1,8}')
  return cod + '_' + titlu + '.' + ext.toLowerCase()
}

// forma canonică a intervalului (oglinda fn_dcc_interval_e_canonic): adevărat DOAR pentru un șir deja canonic; niciodată null, nu aruncă
export function intervalECanonic(s) {
  return typeof s === 'string' && INTERVAL_RE.test(s)
}

// reprezentarea UNICĂ a intervalului (oglinda fn_dcc_interval_canonic): null / gol după tăierea spațiului ASCII de la capete -> null;
// doar [A-Za-z0-9]; „general” în orice combinație de majuscule -> general; altfel majuscule; rezultatul trebuie să fie canonic
export function intervalCanonic(s) {
  if (s === null || s === undefined) return null
  if (typeof s !== 'string') throw eroare('DCC_INTERVAL_INVALID', 'intervalul nu e text')
  const t = s.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '')
  if (t === '') return null
  if (!/^[A-Za-z0-9]+$/.test(t)) throw eroare('DCC_INTERVAL_INVALID', 'intervalul are caractere nepermise')
  const r = t.toLowerCase() === 'general' ? 'general' : t.toUpperCase()
  if (!intervalECanonic(r)) throw eroare('DCC_INTERVAL_INVALID', 'intervalul nu are forma general / SR1')
  return r
}
