// ════════════════════════════════════════════════════════════════
// ofertareGarantieValabilitate.js — perioada de valabilitate a garanției de participare (R7, 26.09.2026)
//
// De ce există: OfertareGarantie.jsx citea doar „NNN zile” și, când nu găsea, punea IMPLICIT 90 de zile.
// La Vâlcelele (lic. 95) fișa de date cere „4 luni de la data limită de depunere” ⇒ 19.10.2026 → 19.02.2027
// (123 de zile), iar UI-ul propunea 17.01.2027 — o poliță cu o lună mai scurtă decât cerința.
//
// REGULI:
//  1. Durata se citește din text în ZILE sau în LUNI („4 luni”, „4 (patru) luni”, „patru (4) luni”,
//     „minim 120 zile (4 luni) de la…”). Luni = luni CALENDARISTICE (ziua corespunzătoare din luna
//     de sosire; dacă ea nu există, ultima zi a lunii: 31.10 + 4 luni = 28.02), NU 30 × N.
//  2. Nu se citește nimic ⇒ NICIO valoare implicită: durata rămâne goală și UI-ul cere completare manuală.
//     (Nici 90, nici 150 — 150 de zile e o propunere comercială pentru o licitație, nu o regulă.)
//  3. Mai multe durate în cerințe (ex. „120 zile (4 luni)”) ⇒ se propune cea care dă data de expirare
//     cea mai târzie (le satisface pe toate), iar celelalte se afișează ca atenționare.
//  4. Dacă textul garanției spune doar „cel puțin egală cu valabilitatea ofertei”, durata se ia din
//     cerința despre valabilitatea ofertei — marcată ca atare (legătura e în pasajul citat).
//
// Funcții PURE (fără React / Supabase), testate în ofertareGarantieValabilitate.test.js.
// ════════════════════════════════════════════════════════════════

export const MESAJ_NECITIT = 'Valabilitatea nu a putut fi citită din cerință — completează manual.'

// ── date calendaristice 'YYYY-MM-DD', calculate în UTC (fără surprize de fus orar / oră de vară)
const ISO = /^(\d{4})-(\d{2})-(\d{2})/
const msDin = iso => { const m = ISO.exec(String(iso || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN }
const isoDin = ms => new Date(ms).toISOString().slice(0, 10)

export const plusZile = (iso, n) => { const ms = msDin(iso); return isNaN(ms) || !Number.isFinite(Number(n)) ? null : isoDin(ms + Math.round(Number(n)) * 86400000) }

export const plusLuni = (iso, n) => {
  const m = ISO.exec(String(iso || '')); if (!m || !Number.isFinite(Number(n))) return null
  const tot = (+m[2] - 1) + Math.round(Number(n))
  const an = +m[1] + Math.floor(tot / 12), luna = ((tot % 12) + 12) % 12
  const ultimaZi = new Date(Date.UTC(an, luna + 1, 0)).getUTCDate()
  return isoDin(Date.UTC(an, luna, Math.min(+m[3], ultimaZi)))
}

export const zileIntre = (a, b) => { const x = msDin(a), y = msDin(b); return isNaN(x) || isNaN(y) ? null : Math.round((y - x) / 86400000) }

// ziua calendaristică (ora României) a unui timestamptz — '2026-10-19T12:00:00+00:00' → '2026-10-19'.
// Un termen la 00:30 ora RO e încă ziua precedentă în UTC; slice(0, 10) ar fi greșit acolo.
export const ziDepunere = ts => {
  if (!ts) return null
  const s = String(ts)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s); if (isNaN(d)) return null
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]))
    return `${p.year}-${p.month}-${p.day}`
  } catch { return s.slice(0, 10) }
}

// ── citirea duratei din text
// normalizare cu ACEIAȘI indici ca originalul: fiecare caracter → litera de bază, minusculă (ș/ş/ţ/ț/ă/â/î)
const norm = s => String(s || '').split('').map(ch => { const b = ch.normalize('NFD')[0] || ch; const l = b.toLowerCase(); return l.length === 1 ? l : b }).join('')

const CUV_LUNI = { o: 1, una: 1, unu: 1, doua: 2, doi: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10,
  unsprezece: 11, douasprezece: 12, doisprezece: 12, optsprezece: 18, 'douazeci si patru': 24 }
const CUV_ZILE = { treizeci: 30, 'patruzeci si cinci': 45, saizeci: 60, nouazeci: 90, 'o suta douazeci': 120, 'o suta cincizeci': 150, 'o suta optzeci': 180 }
const alt = o => Object.keys(o).sort((a, b) => b.length - a.length).map(k => k.replace(/ /g, '\\s+')).join('|')
const cuvant = (o, w) => o[String(w).replace(/\s+/g, ' ')]

const RE_LUNI = new RegExp(`\\b(?:(\\d{1,2})|(${alt(CUV_LUNI)}))\\s*(?:\\(\\s*(?:\\d{1,2}|[a-z]+(?:\\s+[a-z]+){0,3})\\s*\\)\\s*)?(?:de\\s+)?(?:luni|luna)(?![a-z])`, 'g')
const RE_ZILE = new RegExp(`\\b(?:(\\d{1,3})|(${alt(CUV_ZILE)}))\\s*(?:\\(\\s*[^)]{1,40}\\)\\s*)?(?:de\\s+)?zile(?![a-z])(?!\\s+lucr)`, 'g')

// o durată contează doar dacă textul din jur vorbește de valabilitate / perioadă sau o ancorează de termen
const CONTEXT_INAINTE = /valabil|perioad/
const CONTEXT_DUPA = /^\s*(?:\([^)]*\)\s*)?(?:calendaristice\s*)?,?\s*(?:de\s+la|incepand|socotit|calculat)/
// …dar nu durata contractului / a execuției / a garanției de bună execuție
const CONTEXT_STRAIN = /(?:durata|perioada)\s+(?:de\s+)?(?:executie|contractului|lucrarilor|derulare)|buna\s+executie|garantie\s+a\s+lucrarilor/
// plaje plauzibile pentru valabilitatea unei oferte / garanții de participare; sub 30 de zile e un termen
// de prezentare sau de restituire („în 5 zile de la comunicare”), nu o valabilitate
const LIMITE = { luni: [1, 36], zile: [30, 730] }

const fragmentDin = (text, a, b) => {
  const s = Math.max(0, a - 70), e = Math.min(text.length, b + 50)
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '')
}

// → [{ n, unitate:'luni'|'zile', fragment }] — duratele de valabilitate găsite în text (fără duplicate)
export function extrageDurate(text) {
  const orig = String(text || ''), t = norm(orig), out = []
  for (const [re, unitate, cuv] of [[RE_LUNI, 'luni', CUV_LUNI], [RE_ZILE, 'zile', CUV_ZILE]]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(t))) {
      const n = m[1] != null ? Number(m[1]) : cuvant(cuv, m[2])
      const [min, max] = LIMITE[unitate]
      if (!(n >= min && n <= max)) continue
      const inainte = t.slice(Math.max(0, m.index - 150), m.index), dupa = t.slice(m.index + m[0].length, m.index + m[0].length + 60)
      if (!(CONTEXT_INAINTE.test(inainte) || CONTEXT_DUPA.test(dupa))) continue
      if (CONTEXT_STRAIN.test(t.slice(Math.max(0, m.index - 80), m.index))) continue
      if (out.some(x => x.n === n && x.unitate === unitate)) continue
      out.push({ n, unitate, fragment: fragmentDin(orig, m.index, m.index + m[0].length) })
    }
  }
  return out
}

// ── sursele: câmpul „garanție de participare” din fișa licitației + cerințele din registru
const RE_GARANTIE = /garant\w*\s+(?:de\s+)?particip/
const RE_LEGATURA_OFERTA = /valabilitat\w*\s+(?:a\s+)?ofert/

// cerinte = rânduri ofertare_cerinte { id, text_cerinta, stare, inlocuita_de }
export function clasificaSurse({ fisa, cerinte } = {}) {
  const garantie = [], oferta = []
  if (String(fisa || '').trim()) garantie.push({ eticheta: 'fișa licitației (câmpul „garanție de participare”)', text: String(fisa) })
  for (const c of cerinte || []) {
    if (!c || c.inlocuita_de != null || c.stare === 'nu_se_aplica') continue
    const t = norm(c.text_cerinta)
    if (RE_GARANTIE.test(t)) garantie.push({ eticheta: `cerința #${c.id}`, text: c.text_cerinta })
    else if (/valabil/.test(t) && /ofert/.test(t)) oferta.push({ eticheta: `cerința #${c.id} (valabilitatea ofertei)`, text: c.text_cerinta })
  }
  return { garantie, oferta }
}

// data de expirare pentru o durată, pornind de la ziua termenului de depunere
export function calculeazaValabilitate(durata, deIso) {
  const n = Number(durata?.n)
  if (!(n > 0) || !['luni', 'zile'].includes(durata?.unitate)) return null
  if (!deIso) return { pana: null, zile: durata.unitate === 'zile' ? n : null }
  const pana = durata.unitate === 'luni' ? plusLuni(deIso, n) : plusZile(deIso, n)
  return pana ? { pana, zile: zileIntre(deIso, pana) } : null
}

// aproximare DOAR pentru ordonare când nu există termen de depunere (nu pentru date)
const aprox = d => d.unitate === 'luni' ? d.n * 30.44 : d.n

// alege durata cu expirarea cea mai târzie; celelalte ies în `alte` (atenționare de neconcordanță)
function celMaiLung(cand, deIso) {
  const cu = cand.map(c => ({ ...c, pana: calculeazaValabilitate(c, deIso)?.pana || null }))
  cu.sort((a, b) => (a.pana && b.pana ? (a.pana < b.pana ? 1 : a.pana > b.pana ? -1 : 0) : aprox(b) - aprox(a)))
  const [best, ...rest] = cu
  const alte = rest.filter((x, i, a) => !(x.n === best.n && x.unitate === best.unitate) && a.findIndex(y => y.n === x.n && y.unitate === x.unitate) === i)
  return { best, alte }
}

// → { durata:{n,unitate}|null, sursa:{eticheta,fragment}|null, dinOferta, alte:[{n,unitate,eticheta,pana}], motiv }
export function propuneValabilitate(surse, deIso) {
  const g = surse?.garantie || [], o = surse?.oferta || []
  const din = lista => lista.flatMap(s => extrageDurate(s.text).map(d => ({ ...d, eticheta: s.eticheta })))
  let cand = din(g), dinOferta = false
  if (!cand.length && g.some(s => RE_LEGATURA_OFERTA.test(norm(s.text)))) { cand = din(o); dinOferta = cand.length > 0 }
  if (!cand.length) return { durata: null, sursa: null, dinOferta: false, alte: [], motiv: MESAJ_NECITIT }
  const { best, alte } = celMaiLung(cand, deIso)
  return {
    durata: { n: best.n, unitate: best.unitate },
    sursa: { eticheta: best.eticheta, fragment: best.fragment },
    dinOferta,
    alte: alte.map(a => ({ n: a.n, unitate: a.unitate, eticheta: a.eticheta, pana: a.pana })),
    motiv: null,
  }
}

// La decalarea termenului: durata cerinței recitită pe termenul NOU vs durata confirmată la cerere.
// Se propune cea cu expirarea mai târzie (nu scurtăm niciodată ce a ales omul); nimic ⇒ null (manual).
// optiuni = [{ durata, eticheta }]
export function alegeDurataActualizare(optiuni, deNouIso) {
  const cand = (optiuni || []).filter(x => x?.durata && Number(x.durata.n) > 0).map(x => ({ n: Number(x.durata.n), unitate: x.durata.unitate, eticheta: x.eticheta }))
  if (!cand.length) return null
  const { best } = celMaiLung(cand, deNouIso)
  return { durata: { n: best.n, unitate: best.unitate }, eticheta: best.eticheta }
}

// „4 luni”, „1 lună”, „123 de zile”, „105 zile”, „24 de luni” (în română „de” apare de la 20 în sus)
export function textDurata(d) {
  const n = Number(d?.n); if (!(n > 0)) return ''
  const de = n % 100 >= 20 || (n >= 100 && n % 100 === 0) ? 'de ' : ''
  if (d.unitate === 'luni') return n === 1 ? '1 lună' : `${n} ${de}luni`
  return n === 1 ? '1 zi' : `${n} ${de}zile`
}
