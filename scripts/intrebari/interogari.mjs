// Compunerea interogărilor web din vocabularul aprobat — portarea JS a compune_interogari() / pregateste_vocabular() din
// worker/intrebari-tehnice/cercetare.py (runda 3, review #1012 r2 P1-1). Workerul real e Python; aici e a doua implementare,
// rulată de vitest pe ACELEAȘI cazuri (worker/intrebari-tehnice/teste_interogari.json), ca regula să fie verificată în ambele.
import { normalizeaza, STOP } from '../../src/intrebariSurse.js'

export const INTEROGARI_MAX = 5
export const INTEROGARE_MAX = 80
export const ELEMENTE_MAX = 8
const TOKEN = /[a-z]+|\d+(?:[/.-]\d+)*/g
const TIP_ACT = { legea: 'legea', legii: 'legea', lege: 'legea', hg: 'hg', hotararea: 'hg', hotararii: 'hg', oug: 'oug',
  ordinul: 'ordinul', ordin: 'ordinul', ordinului: 'ordinul', ord: 'ordinul', np: 'np', ntpee: 'ntpee', sr: 'std', en: 'std', iso: 'std' }
const UMPLUTURA = new Set(['nr', 'guvernului', 'anre', 'mdlpa', 'mdrap', 'iscir', 'anap', 'presedintelui'])
const AN = /^(?:19|20)\d{2}$/

const tokeni = s => normalizeaza(s).match(TOKEN) || []

/** [cheie, poziția de după act] sau [null, i] — = _cheie_act din cercetare.py. */
export function cheieAct(tok, i) {
  const tip = Object.hasOwn(TIP_ACT, tok[i]) ? TIP_ACT[tok[i]] : null
  if (!tip) return [null, i]
  let j = i + 1
  if (tip === 'std') {
    while (j < tok.length && ['sr', 'en', 'iso'].includes(tok[j])) j++
    if (j < tok.length && /^\d{3,5}(?:-\d{1,2})?$/.test(tok[j])) return ['std:' + tok[j], j + 1]
    return [null, i]
  }
  let k = 0
  while (j < tok.length && UMPLUTURA.has(tok[j]) && k < 3) { j++; k++ }
  if (j >= tok.length) return [null, i]
  if (tip === 'ntpee') return AN.test(tok[j]) ? ['ntpee:' + tok[j], j + 1] : [null, i]
  if (tip === 'np') return /^\d{2,3}$/.test(tok[j]) ? ['np:' + tok[j], j + 1] : [null, i]
  const m = tok[j].match(/^(\d{1,4})\/((?:19|20)\d{2})$/)
  if (m) return [`${tip}:${Number(m[1])}/${m[2]}`, j + 1]
  if (/^\d{1,4}$/.test(tok[j])) {
    let h = j + 1
    if (h < tok.length && tok[h] === 'din') h++
    if (h < tok.length && AN.test(tok[h])) return [`${tip}:${Number(tok[j])}/${tok[h]}`, h + 1]
  }
  return [null, i]
}

/** vocabular_web.json → { versiune, exact, rad, acte } sau null (forma greșită) — = pregateste_vocabular. */
export function pregatesteVocabular(v) {
  if (!v || typeof v !== 'object' || typeof v.versiune !== 'string' || !v.versiune.trim()) return null
  if (!Array.isArray(v.termeni) || !Array.isArray(v.acte) || !v.termeni.length) return null
  const exact = new Map(), rad = new Map(), acte = new Map()
  for (const t of v.termeni) {
    if (typeof t !== 'string' || !/^[a-z]{3,24}$/.test(t) || exact.has(t)) return null
    exact.set(t, t)
    if (!rad.has(t.slice(0, 6))) rad.set(t.slice(0, 6), t)
  }
  for (const a of v.acte) {
    if (typeof a !== 'string' || !/^[A-Za-z0-9 ./-]{4,40}$/.test(a)) return null
    const tok = tokeni(a)
    const [cheie, j] = tok.length ? cheieAct(tok, 0) : [null, 0]
    if (!cheie || j !== tok.length || acte.has(cheie)) return null
    acte.set(cheie, a)
  }
  return { versiune: v.versiune.trim(), exact, rad, acte }
}

function termen(voc, t) {
  if (!/^[a-z]+$/.test(t) || t.length < 3) return null
  if (voc.exact.has(t)) return t
  return t.length >= 6 ? (voc.rad.get(t.slice(0, 6)) ?? null) : null
}

/** [interogări, aruncate] — = compune_interogari din cercetare.py. */
export function compuneInterogari(propuse, voc, maxim = INTEROGARI_MAX, lungime = INTEROGARE_MAX, elemente = ELEMENTE_MAX) {
  if (!voc || !Array.isArray(propuse)) return [[], 0]
  const out = [], acte = new Set(voc.acte.values())
  let aruncate = 0
  for (const p of propuse) {
    if (out.length >= maxim) break
    if (typeof p !== 'string') { aruncate++; continue }
    const tok = tokeni(p.slice(0, 300))
    const elem = []
    let i = 0
    while (i < tok.length) {
      const [cheie, j] = cheieAct(tok, i)
      if (cheie && voc.acte.has(cheie)) {
        if (!elem.includes(voc.acte.get(cheie))) elem.push(voc.acte.get(cheie))
        i = j; continue
      }
      const t = tok[i++]
      const x = termen(voc, t)
      if (x) { if (!elem.includes(x)) elem.push(x) } else if (!STOP.has(t)) aruncate++
    }
    let q = ''
    const luate = []
    for (const x of elem.slice(0, elemente)) {
      const cand = `${q} ${x}`.trim()
      if (cand.length > lungime) break
      q = cand; luate.push(x)
    }
    if ((luate.length >= 2 || (luate.length && acte.has(luate[0]))) && !out.includes(q)) out.push(q)
  }
  return [out, aruncate]
}

export const canonInterogare = q => tokeni(q).join(' ')
export const interogareRespectata = (executate, compusa) => executate.length === 1 && canonInterogare(executate[0]) === canonInterogare(compusa)
