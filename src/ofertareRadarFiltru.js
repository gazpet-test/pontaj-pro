// Filtrul ecranului „📡 Radar licitații" (RadarLicitatii din OfertareLicitatii.jsx), funcție pură, testată
// în ofertareRadarFiltru.test.js. Nu schimbă ce se încarcă din BD, doar ce se afișează.
//
// Reguli (16.11.2026):
// - Căutarea (nr. anunț, titlu, autoritate, CPV) nu ține cont de litere mari/mici și de diacritice; fiecare
//   cuvânt căutat trebuie să apară undeva în aceste câmpuri. Când se caută, filtrul de STARE și ascunderea
//   expiratelor NU se aplică: omul care caută un număr anume îl găsește oriunde ar fi (starea se vede pe card).
//   Scorul și segmentul rămân aplicate (sunt alegeri vizibile); câte rezultate ascund ele se raportează separat.
// - Fără căutare: anunțurile cu termenul de depunere trecut se ascund, dacă nu e pornit „Arată și expirate".
//   Un anunț fără termen (sau cu termen ilizibil) se afișează.
// - Segment: '' = toate; 'distributie' / 'transgaz' / 'romgaz' = exact; 'altele' = orice altceva
//   (inclusiv 'conpet' și rândurile fără segment), ca niciun anunț să nu rămână de neatins din filtru.

import { ziValida, zileIntre } from './ofertareTermene.js'

const SEMNE_RE =new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g')

export const normCautare = s => String(s ?? '').normalize('NFD').replace(SEMNE_RE, '').toLowerCase().replace(/\s+/g, ' ').trim()

export const SEGMENTE_RADAR = ['distributie', 'transgaz', 'romgaz']

// Un singur formatter pe tot modulul (review #1110: construit pe fiecare rând costa ~34 ms la 1.000 de rânduri).
// Dă data și ora din Europe/Bucharest a unui moment, indiferent de fusul calculatorului.
const FMT_RO = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const partiRo = ms => {
  const p = {}
  for (const x of FMT_RO.formatToParts(new Date(ms))) p[x.type] = x.value
  return p
}

// Data de azi în Europe/Bucharest, ca 'AAAA-LL-ZZ'
const ziuaBucuresti = ms => { const p = partiRo(ms); return `${p.year}-${p.month}-${p.day}` }

// Cât e ora României înaintea UTC la momentul ms (în ms): +2 h iarna, +3 h vara
const decalajRo = ms => {
  const p = partiRo(ms)
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
}

// Ora României scrisă fără fus (ex. 2026-11-16T12:00:00) → momentul UTC. Două treceri, ca la schimbarea orei:
// în ora „sărită” primăvara rezultatul cade după salt, în ora „dublată” toamna se ia a doua apariție (ora de iarnă).
const momentDinOraRo = (an, luna, zi, h, m, s, ms) => {
  const caLaUtc = Date.UTC(an, luna - 1, zi, h, m, s, ms)
  let t = caLaUtc - decalajRo(caLaUtc)
  t = caLaUtc - decalajRo(t)
  return t
}

// AAAA-LL-ZZ, apoi opțional ora (T sau spațiu) cu secunde / fracțiuni opționale și fusul (Z, ±HH, ±HHMM, ±HH:MM).
const TERMEN_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)?)?$/i

/**
 * Momentul termenului (ms UTC) sau null dacă e ilizibil. Data doar cu zi → { zi } (comparat pe zile în România).
 * Ilizibil = altă formă decât cea de mai sus, zi imposibilă în calendar (2026-02-31), oră / fus în afara limitelor.
 */
export function citesteTermen(termen) {
  if (termen == null) return null
  const m = TERMEN_RE.exec(String(termen).trim())
  if (!m) return null
  const zi = `${m[1]}-${m[2]}-${m[3]}`
  if (!ziValida(zi)) return null
  if (m[4] == null) return { zi }
  const [an, luna, z, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number)
  if (h > 23 || mi > 59 || s > 59) return null
  const ms = Number((m[7] || '').padEnd(3, '0').slice(0, 3))
  if (m[8]) return { ms: Date.UTC(an, luna - 1, z, h, mi, s, ms) }
  if (m[9]) {
    const oh = Number(m[10]), om = Number(m[11] || 0)
    if (oh > 14 || om > 59) return null
    const semn = m[9] === '-' ? -1 : 1
    return { ms: Date.UTC(an, luna - 1, z, h, mi, s, ms) - semn * (oh * 60 + om) * 60000 }
  }
  // fără fus: e ora României (termenele SEAP sunt ora locală), nu fusul calculatorului
  return { ms: momentDinOraRo(an, luna, z, h, mi, s, ms) }
}

/**
 * Momentul termenului în NANOSECUNDE (BigInt), pentru ORDONARE: păstrează toată fracțiunea de secundă (până la 9 cifre),
 * nu doar milisecundele din citesteTermen (review #1113: .000900Z și .000100Z ajungeau egale și se departajau după id).
 * Aceeași citire ca citesteTermen (formă, zi validă, fus, ora României). Data doar cu zi → miezul nopții UTC al zilei.
 * Termen lipsă / ilizibil → null.
 */
export function momentTermenNs(termen) {
  const c = citesteTermen(termen)
  if (!c) return null
  if (c.zi) return BigInt(Date.UTC(+c.zi.slice(0, 4), +c.zi.slice(5, 7) - 1, +c.zi.slice(8, 10))) * 1000000n
  const fractie = TERMEN_RE.exec(String(termen).trim())[7] || ''
  return BigInt(c.ms) * 1000000n + BigInt(Number(fractie.padEnd(9, '0').slice(3, 9)))
}

// true doar dacă termenul e citibil și a trecut. Termen cu oră = comparat pe momentul exact;
// termen doar cu dată = expirat abia după ce s-a terminat acea zi în România.
export function eExpirat(termen, acumMs) {
  const t = citesteTermen(termen)
  if (!t) return false
  if (t.zi) return ziuaBucuresti(acumMs) > t.zi
  return t.ms < acumMs
}

/**
 * Ce arată cardul la „zile rămase”, cu ACEEAȘI citire a termenului și aceeași regulă de expirare ca filtrarea:
 *   null                       → termen lipsă sau ilizibil (cardul nu arată nimic în plus)
 *   { expirat: true }          → expirat după eExpirat()
 *   { expirat: false, zile: n } → n = zile calendaristice în România până în ziua termenului (0 = expiră azi, încă deschis)
 */
export function zileRamaseTermen(termen, acumMs) {
  const t = citesteTermen(termen)
  if (!t) return null
  if (eExpirat(termen, acumMs)) return { expirat: true }
  const ziTermen = t.zi || ziuaBucuresti(t.ms)
  return { expirat: false, zile: Math.max(0, zileIntre(ziuaBucuresti(acumMs), ziTermen)) }
}

const potrivesteStare = (status, stare) => {
  if (!stare || stare === 'toate') return true
  if (stare === 'activ') return status === 'nou' || status === 'interesant'
  return status === stare
}

const potrivesteSegment = (segment, fSegment) => {
  if (!fSegment) return true
  if (fSegment === 'altele') return !SEGMENTE_RADAR.includes(segment)
  return segment === fSegment
}

const potrivesteScor = (scor, scorMin) => !scorMin || (scor != null && Number.isFinite(Number(scor)) && Number(scor) >= scorMin)

/**
 * @param rows   rândurile radarului (ordinea se păstrează)
 * @param f      { cautare, stare, scorMin, segment, cuExpirate, acumMs }
 * @returns      { lista, total, ascunsePeScorSegment }
 *   total = câte rânduri sunt încărcate; ascunsePeScorSegment = la căutare, câte potriviri au fost
 *   ascunse doar de scor / segment (0 când nu se caută).
 */
export function filtreazaRadar(rows, f = {}) {
  const lista0 = Array.isArray(rows) ? rows : []
  const acumMs = Number.isFinite(f.acumMs) ? f.acumMs : Date.now()
  const termeni = normCautare(f.cautare).split(' ').filter(Boolean)
  const cauta = termeni.length > 0
  const lista = []
  let ascunse = 0
  for (const r of lista0) {
    if (!r) continue
    if (cauta) {
      const fan = normCautare([r.nr_seap, r.titlu, r.autoritate, r.cpv].filter(x => x != null).join(' '))
      if (!termeni.every(t => fan.includes(t))) continue
      if (!potrivesteScor(r.scor_potrivire, f.scorMin) || !potrivesteSegment(r.segment, f.segment)) { ascunse++; continue }
      lista.push(r)
      continue
    }
    if (!potrivesteStare(r.status, f.stare)) continue
    if (!f.cuExpirate && eExpirat(r.termen_depunere, acumMs)) continue
    if (!potrivesteScor(r.scor_potrivire, f.scorMin)) continue
    if (!potrivesteSegment(r.segment, f.segment)) continue
    lista.push(r)
  }
  return { lista, total: lista0.length, ascunsePeScorSegment: ascunse }
}
