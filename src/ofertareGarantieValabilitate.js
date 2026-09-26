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
//  3. O durată contează doar dacă PROPOZIȚIA ei vorbește de valabilitate/perioadă, iar subiectul propoziției
//     e garanția/oferta: numit explicit („garanț…”, „ofert…”, dar nu „ofertant”) sau implicit (textul e deja
//     o sursă despre garanție/ofertă) și FĂRĂ alt subiect în propoziție (certificat, autorizație, aviz, contract,
//     lucrări, execuție…). Fără contexte străine în fața duratei (execuție, restituire, perioada de garanție a
//     lucrărilor, durata contractului) și fără „cu N zile înainte” / „prelungită cu N zile” / „19 luna februarie”.
//  4. Mai multe durate: dacă expiră la cel mult 31 de zile una de alta (ex. „120 zile (4 luni)”) se propune
//     cea mai târzie, cu celelalte la atenționare; dacă diferă mai mult ⇒ câmp GOL + toate variantele afișate.
//  5. Dacă textul garanției spune doar „cel puțin egală cu valabilitatea ofertei”, durata se ia din
//     cerința despre valabilitatea ofertei — marcată ca atare (legătura e în pasajul citat).
//  6. Polița în ORIGINAL + termen decalat: cererea de prelungire NU schimbă perioada afișată a poliței
//     (valabil_*) — polița fizică acoperă tot perioada veche până la „act adițional primit”. Cererea
//     rămâne în observații cu un marcaj ⟦…⟧ citit de stareGarantie().
//  7. Propagarea termenului (evalueazaGarantie / semnalReverificare): termen mutat ⇒ cerința recalculată și
//     semnal de reverificare pe tab, KPI și eticheta tab-ului; polița emisă își păstrează perioada din poliță.
//     KPI / eticheta tab-ului: indicatorGarantie() — o garanție care NU e încă în original rămâne „în curs” (roșu),
//     semnalul se adaugă lângă, nu o înlocuiește.
//
// Funcții PURE (fără React / Supabase), testate în ofertareGarantieValabilitate.test.js.
// ════════════════════════════════════════════════════════════════

export const MESAJ_NECITIT = 'Valabilitatea nu a putut fi citită din cerință — completează manual.'
export const MESAJ_CONFLICT = 'Cerințele dau durate de valabilitate diferite — nu s-a ales automat nicio valoare; completează manual.'
export const ETICHETA_REZUMAT = 'rezumatul din fișa licitației (câmpul „garanție de participare”, scris în platformă)'
export const PRAG_CONFLICT_ZILE = 31

// ── date calendaristice 'YYYY-MM-DD', calculate în UTC (fără surprize de fus orar / oră de vară)
const ISO = /^(\d{4})-(\d{2})-(\d{2})/
const msDin = iso => { const m = ISO.exec(String(iso || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN }
const isoDin = ms => new Date(ms).toISOString().slice(0, 10)

// durate NEÎNTREGI (4,6 luni) → null: nu rotunjim în tăcere o valabilitate
export const plusZile = (iso, n) => { const ms = msDin(iso); return isNaN(ms) || !Number.isInteger(Number(n)) ? null : isoDin(ms + Number(n) * 86400000) }

export const plusLuni = (iso, n) => {
  const m = ISO.exec(String(iso || '')); if (!m || !Number.isInteger(Number(n))) return null
  const tot = (+m[2] - 1) + Number(n)
  const an = +m[1] + Math.floor(tot / 12), luna = ((tot % 12) + 12) % 12
  const ultimaZi = new Date(Date.UTC(an, luna + 1, 0)).getUTCDate()
  return isoDin(Date.UTC(an, luna, Math.min(+m[3], ultimaZi)))
}

export const zileIntre = (a, b) => { const x = msDin(a), y = msDin(b); return isNaN(x) || isNaN(y) ? null : Math.round((y - x) / 86400000) }

// 'YYYY-MM-DD' → 'DD.MM.YYYY' (determinist, fără locale)
export const fmtIso = iso => { const m = ISO.exec(String(iso || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : '—' }

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
// NFC întâi (diacriticele descompuse „s + U+0326” devin „ș”), apoi normalizare cu ACEIAȘI indici ca textul
// NFC: fiecare caracter → litera de bază, minusculă (ș/ş/ţ/ț/ă/â/î)
const nfc = s => String(s || '').normalize('NFC')
const norm = s => String(s || '').split('').map(ch => { const b = ch.normalize('NFD')[0] || ch; const l = b.toLowerCase(); return l.length === 1 ? l : b }).join('')

const CUV_LUNI = { o: 1, una: 1, unu: 1, doua: 2, doi: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10,
  unsprezece: 11, douasprezece: 12, doisprezece: 12, optsprezece: 18, 'douazeci si patru': 24 }
const CUV_ZILE = { treizeci: 30, 'patruzeci si cinci': 45, saizeci: 60, nouazeci: 90, 'o suta douazeci': 120, 'o suta cincizeci': 150, 'o suta optzeci': 180 }
const alt = o => Object.keys(o).sort((a, b) => b.length - a.length).map(k => k.replace(/ /g, '\\s+')).join('|')
const cuvant = (o, w) => o[String(w).replace(/\s+/g, ' ')]

const RE_LUNI = new RegExp(`\\b(?:(\\d{1,2})|(${alt(CUV_LUNI)}))\\s*(?:\\(\\s*(?:\\d{1,2}|[a-z]+(?:\\s+[a-z]+){0,3})\\s*\\)\\s*)?(?:de\\s+)?(luni|luna)(?![a-z])`, 'g')
const RE_ZILE = new RegExp(`\\b(?:(\\d{1,3})|(${alt(CUV_ZILE)}))\\s*(?:\\(\\s*[^)]{1,40}\\)\\s*)?(?:de\\s+)?zile(?![a-z])(?!\\s+lucr)`, 'g')

// propoziția trebuie să vorbească de valabilitate/perioadă; subiectul: garanția/oferta („ofertant” nu contează),
// numită explicit sau implicit — dar nu altceva (certificatul ISO, autorizația ANRE, avizul, contractul…)
const PROP_VALABIL = /valabil|perioad/
const PROP_OBIECT = /garant|ofert(?!ant)/
const SUBIECT_STRAIN = /certificat|autorizat|\baviz|atestat|raspundere\s+civila|\bcontract|lucrar|executi|receptie|legitimati|metrolog/
// fără „valabil/perioadă”, o durată contează doar dacă garanția/oferta e numită în propoziție ȘI durata curge
// „de la data / termenul …” („Garanția de participare: 4 luni de la data limită”); nu „de la comunicarea rezultatului”
const ANCORA_TERMEN = /^\s*(?:\([^)]*\)\s*)?(?:calendaristice\s*)?,?\s*(?:de\s+la|incepand\s+cu|socotit\w*\s+de\s+la|calculat\w*\s+de\s+la)\s+(?:data|termen)/
// contexte străine în fața duratei (în aceeași propoziție): execuție, contract, garanția lucrărilor, restituire
const CONTEXT_STRAIN = /(?:durata|perioada)\s+(?:de\s+)?(?:executie|contractului|contract|lucrarilor|derulare)|buna\s+executie|executi|garantie\s+a\s+lucrarilor|perioad\w*\s+de\s+garantie(?!\s+de\s+participare)|restitui|elibera/
// „prelungită cu 30 de zile”, „cu o lună înainte” — un increment, nu o valabilitate
const INAINTE_INCREMENT = /\bcu\s+(?:inca\s+)?(?:(?:minim(?:um)?|cel\s+putin)\s+)?$/
// „o lună înainte de expirare”; „19 luna februarie” (o dată, nu o durată)
const DUPA_STRAIN = /^\s*(?:\([^)]*\)\s*)?(?:calendaristice\s+)?(?:inainte|anterior)|^\s*(?:ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)(?![a-z])/
// plaje plauzibile pentru valabilitatea unei oferte / garanții de participare; sub 30 de zile e un termen
// de prezentare sau de restituire („în 5 zile de la comunicare”), nu o valabilitate
const LIMITE = { luni: [1, 36], zile: [30, 730] }

// propozițiile textului: „;”, rând gol, sau „. ! ?” urmat de spațiu + majusculă (nu „art. 154”, „alin. (1)”,
// „III.1.6.a”, „370.000”). Un singur „\n” NU desparte (PDF-urile rup rândul în mijlocul frazei).
const RE_SFARSIT = /;|\n\s*\n|[.!?](?=\s+["„“«]?[A-ZĂÂÎȘŞȚŢ])|[.!?]\s*$/g
function propozitii(text) {
  const out = []; let start = 0, m
  RE_SFARSIT.lastIndex = 0
  while ((m = RE_SFARSIT.exec(text))) { const e = m.index + m[0].length; if (e > start) out.push([start, e]); start = e; if (!m[0].length) RE_SFARSIT.lastIndex++ }
  if (start < text.length) out.push([start, text.length])
  return out
}

const fragmentDin = (text, a, b) => {
  const s = Math.max(0, a - 70), e = Math.min(text.length, b + 50)
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '')
}

// → [{ n, unitate:'luni'|'zile', fragment }] — duratele de valabilitate găsite în text (fără duplicate).
// Textul e o sursă deja clasificată (garanție / valabilitatea ofertei) — vezi clasificaSurse.
export function extrageDurate(text) {
  const orig = nfc(text), t = norm(orig), out = [], prop = propozitii(orig)
  for (const [re, unitate, cuv] of [[RE_LUNI, 'luni', CUV_LUNI], [RE_ZILE, 'zile', CUV_ZILE]]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(t))) {
      const n = m[1] != null ? Number(m[1]) : cuvant(cuv, m[2])
      if (unitate === 'luni' && m[3] === 'luna' && n !== 1) continue          // „19 luna februarie”
      const [min, max] = LIMITE[unitate]
      if (!(n >= min && n <= max)) continue
      const [s, e] = prop.find(([a, b]) => m.index >= a && m.index < b) || [0, t.length]
      const p = t.slice(s, e)
      const dupa = t.slice(m.index + m[0].length, Math.min(e, m.index + m[0].length + 60))
      if (!(PROP_VALABIL.test(p) || (PROP_OBIECT.test(p) && ANCORA_TERMEN.test(dupa)))) continue
      if (!PROP_OBIECT.test(p) && SUBIECT_STRAIN.test(p)) continue            // „Certificatul ISO valabil 12 luni.”
      const inainte = t.slice(Math.max(s, m.index - 80), m.index)
      if (CONTEXT_STRAIN.test(inainte) || INAINTE_INCREMENT.test(inainte)) continue
      if (DUPA_STRAIN.test(dupa)) continue
      if (out.some(x => x.n === n && x.unitate === unitate)) continue
      out.push({ n, unitate, fragment: fragmentDin(orig, m.index, m.index + m[0].length) })
    }
  }
  return out
}

// ── sursele: registrul de cerințe + câmpul „garanție de participare” din fișa licitației (rezumat, secundar)
const RE_GARANTIE = /garant\w*\s+(?:de\s+)?particip/
// legătura EXPLICITĂ garanție ↔ ofertă („cel puțin egală cu valabilitatea ofertei”, „≥ perioada de valabilitate
// a ofertei”); „să prelungească perioada de valabilitate a ofertei și, după caz, a garanției” nu e o legătură
const RE_LEGATURA_OFERTA = /(?:egal\w*\s+cu|cel\s+putin|≥|>=|acoper\w*)[^.;]{0,40}valabilitat\w*\s+(?:a\s+)?ofert(?!ant)/
// cerință despre valabilitatea OFERTEI („oferta valabilă 4 luni”, „perioada de valabilitate a ofertei”);
// „Ofertantul prezintă certificat ISO valabil 12 luni” NU e despre ofertă
const RE_OFERTA = /valabilitat\w*\s+(?:a\s+)?ofert(?!ant)|\bofert(?!ant)\w*\b[^.;]{0,40}valabil/

const locDin = c => [c.sursa_document_id ? `doc ${c.sursa_document_id}` : null, c.sursa_pagina ? `pag. ${c.sursa_pagina}` : null].filter(Boolean).join(', ')

// cerinte = rânduri ofertare_cerinte { id, text_cerinta, stare, inlocuita_de, sursa_document_id?, sursa_pagina? }
// Cerințele (citate din documentație) vin ÎNAINTEA rezumatului din fișă: la durate egale se citează cerința.
export function clasificaSurse({ fisa, cerinte } = {}) {
  const garantie = [], oferta = []
  for (const c of cerinte || []) {
    if (!c || c.inlocuita_de != null || c.stare === 'nu_se_aplica') continue
    const t = norm(nfc(c.text_cerinta)), loc = locDin(c)
    if (RE_GARANTIE.test(t)) garantie.push({ eticheta: `cerința #${c.id}${loc ? ` (${loc})` : ''}`, text: c.text_cerinta })
    else if (RE_OFERTA.test(t)) oferta.push({ eticheta: `cerința #${c.id} (valabilitatea ofertei${loc ? `; ${loc}` : ''})`, text: c.text_cerinta })
  }
  if (String(fisa || '').trim()) garantie.push({ eticheta: ETICHETA_REZUMAT, text: String(fisa), secundara: true })
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

// aproximare DOAR pentru ordonare / comparare când nu există termen de depunere (nu pentru date)
const aprox = d => d.unitate === 'luni' ? d.n * 30.44 : d.n

// ordonează după expirare (cea mai târzie prima); `ecart` = zile între cea mai târzie și cea mai timpurie
function ordonate(cand, deIso) {
  const cu = cand.map(c => ({ ...c, pana: calculeazaValabilitate(c, deIso)?.pana || null }))
  cu.sort((a, b) => (a.pana && b.pana ? (a.pana < b.pana ? 1 : a.pana > b.pana ? -1 : 0) : aprox(b) - aprox(a)))
  const prim = cu[0], ultim = cu[cu.length - 1]
  const ecart = prim.pana && ultim.pana ? zileIntre(ultim.pana, prim.pana) : Math.round(aprox(prim) - aprox(ultim))
  const unice = cu.filter((x, i, a) => a.findIndex(y => y.n === x.n && y.unitate === x.unitate) === i)
  return { best: prim, alte: unice.slice(1), toate: unice, ecart }
}

// → { durata:{n,unitate}|null, sursa:{eticheta,fragment,secundara}|null, dinOferta, alte:[{n,unitate,eticheta,pana}], conflict, motiv }
export function propuneValabilitate(surse, deIso) {
  const g = surse?.garantie || [], o = surse?.oferta || []
  const din = lista => lista.flatMap(s => extrageDurate(s.text).map(d => ({ ...d, eticheta: s.eticheta, secundara: !!s.secundara })))
  let cand = din(g), dinOferta = false
  if (!cand.length && g.some(s => RE_LEGATURA_OFERTA.test(norm(nfc(s.text))))) { cand = din(o); dinOferta = cand.length > 0 }
  if (!cand.length) return { durata: null, sursa: null, dinOferta: false, alte: [], conflict: false, motiv: MESAJ_NECITIT }
  const { best, alte, toate, ecart } = ordonate(cand, deIso)
  const scurt = a => ({ n: a.n, unitate: a.unitate, eticheta: a.eticheta, pana: a.pana, fragment: a.fragment })
  if (ecart > PRAG_CONFLICT_ZILE) return { durata: null, sursa: null, dinOferta, alte: toate.map(scurt), conflict: true, motiv: MESAJ_CONFLICT }
  return {
    durata: { n: best.n, unitate: best.unitate },
    sursa: { eticheta: best.eticheta, fragment: best.fragment, secundara: best.secundara },
    dinOferta,
    alte: alte.map(scurt),
    conflict: false,
    motiv: null,
  }
}

// La decalarea termenului: cerința citibilă se folosește SINGURĂ (recitită pe termenul nou, în unitatea ei).
// Durata cererii anterioare (valabil_zile, mereu în zile) e doar REZERVĂ, când cerința nu se poate citi.
export function propuneActualizare(propunere, valabilZileAnterior) {
  if (propunere?.durata && Number(propunere.durata.n) > 0)
    return { durata: { n: Number(propunere.durata.n), unitate: propunere.durata.unitate }, eticheta: propunere.sursa?.eticheta || 'cerință', rezerva: false }
  const z = Number(valabilZileAnterior)
  if (z > 0 && Number.isInteger(z)) return { durata: { n: z, unitate: 'zile' }, eticheta: `durata cererii anterioare (${textDurata({ n: z, unitate: 'zile' })}) — cerința nu a putut fi citită`, rezerva: true }
  return null
}

// „4 luni”, „1 lună”, „123 de zile”, „105 zile”, „24 de luni” (în română „de” apare de la 20 în sus)
export function textDurata(d) {
  const n = Number(d?.n); if (!(n > 0)) return ''
  const de = n % 100 >= 20 || (n >= 100 && n % 100 === 0) ? 'de ' : ''
  if (d.unitate === 'luni') return n === 1 ? '1 lună' : `${n} ${de}luni`
  return n === 1 ? '1 zi' : `${n} ${de}zile`
}

// ════════════════════════════════════════════════════════════════
// Prelungirea poliței în ORIGINAL (termen decalat) — evidență fără coloane noi
//   Cererea și actul adițional se notează în `observatii`, cu un marcaj ⟦…⟧ la capătul rândului:
//     ⟦prelungire-ceruta <de> <pana> acoperea <deVechi> <panaVechi>⟧   ⟦act-aditional <de> <pana>⟧
//     ⟦prelungire-renuntata <de> <pana>⟧ (cererea nu mai e necesară: polița acoperă dovedit termenul curent)
//   Ultimul marcaj decide: „ceruta” = prelungire în așteptare; „act” = confirmată; „renuntata” = închisă fără act.
// ════════════════════════════════════════════════════════════════
const RE_MARCAJ = /⟦(prelungire-ceruta|act-aditional|prelungire-renuntata) (\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})(?: acoperea (\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2}))?⟧/g
const TIP_MARCAJ = { 'prelungire-ceruta': 'ceruta', 'act-aditional': 'act', 'prelungire-renuntata': 'renuntata' }

export function ultimaPrelungire(observatii) {
  let m, last = null
  RE_MARCAJ.lastIndex = 0
  while ((m = RE_MARCAJ.exec(String(observatii || ''))))
    last = { tip: TIP_MARCAJ[m[1]], de: m[2], pana: m[3], acDe: m[4] || null, acPana: m[5] || null }
  return last
}
export const faraMarcaje = obs => String(obs || '').replace(/[ \t]*⟦[^⟧\n]*⟧/g, '')
export const adaugaObservatie = (obs, linie) => [obs, linie].filter(x => String(x || '').trim()).join('\n')

export const liniePrelungireCeruta = ({ azi, termenVechi, termenNou, polita, acDe, acPana, de, pana, durata }) =>
  `${fmtIso(azi)}: termen decalat ${fmtIso(termenVechi)} → ${fmtIso(termenNou)}; polița nr. ${polita || '—'} (original) acoperă ${fmtIso(acDe)} – ${fmtIso(acPana)}; ` +
  `cerută brokerului perioada nouă ${fmtIso(de)} – ${fmtIso(pana)}${durata ? ` (${textDurata(durata)})` : ''} — neconfirmată până la actul adițional. ⟦prelungire-ceruta ${de} ${pana} acoperea ${acDe} ${acPana}⟧`

export const linieActAditional = ({ azi, polita, de, pana }) =>
  `${fmtIso(azi)}: act adițional primit la polița nr. ${polita || '—'} — acoperă ${fmtIso(de)} – ${fmtIso(pana)}. ⟦act-aditional ${de} ${pana}⟧`

// starea afișată a garanției (antet, avertizări) — o singură sursă pentru UI
// g = rândul ofertare_garantii; deAcum = ziua termenului curent; necesarPana = data cerută de cerință pe termenul curent
export function stareGarantie({ g, deAcum, necesarPana }) {
  if (!g) return null
  const original = g.status === 'original'
  const ult = original ? ultimaPrelungire(g.observatii) : null
  const inAsteptare = ult?.tip === 'ceruta' ? ult : null
  // ce acoperă EFECTIV polița: pentru original cu prelungire în așteptare, perioada veche din marcaj
  // (rezistă și dacă revenirea valabil_* după mail n-a reușit)
  const acoperaDe = inAsteptare?.acDe || g.valabil_de || null
  const acoperaPana = inAsteptare?.acPana || g.valabil_pana || null
  const termenCerere = ziDepunere(g.termen_la_cerere)
  const decalat = !!(termenCerere && deAcum && termenCerere !== deAcum)
  const prelungireCurenta = inAsteptare && inAsteptare.de === deAcum ? inAsteptare : null
  const prelungireVeche = inAsteptare && inAsteptare.de !== deAcum ? inAsteptare : null
  const insuficient = !!(acoperaPana && necesarPana && acoperaPana < necesarPana)
  // termenul mutat MAI DEVREME: polița începe după noua zi de depunere ⇒ nu acoperă depunerea
  const incepeDupaTermen = !!(acoperaDe && deAcum && acoperaDe > deAcum)
  const antet = !(acoperaDe || acoperaPana) ? '' : original
    ? `polița valabilă ${fmtIso(acoperaDe)} – ${fmtIso(acoperaPana)}${inAsteptare ? ` · prelungire cerută la ${fmtIso(inAsteptare.de)} – ${fmtIso(inAsteptare.pana)} (neconfirmată)` : ''}`
    : `perioadă cerută ${fmtIso(g.valabil_de)} – ${fmtIso(g.valabil_pana)}`
  return { original, decalat, termenCerere, inAsteptare, prelungireCurenta, prelungireVeche, acoperaDe, acoperaPana, insuficient, incepeDupaTermen, antet }
}

// ════════════════════════════════════════════════════════════════
// Propagarea termenului de depunere (R7, test de propagare cerut de Copilot, 26.09.2026)
//   Termenul se schimbă ⇒ (1) cerința se recalculează pe termenul nou; (2) garanția existentă primește semnalul de
//   reverificare — vizibil în tab-ul 🛡, pe KPI-ul „Garanție participare” și pe eticheta tab-ului, din ACEEAȘI funcție;
//   (3) o poliță EMISĂ păstrează perioada din poliță — nimic nu o „prelungește” fără act adițional;
//   (4) fără durată implicită (nici 90, nici 150): cerința necitită (sau contradictorie) ⇒ acoperirea rămâne
//       „de verificat”, nu verde — când termenul s-a mutat, când o prelungire e în așteptare și pentru orice poliță
//       în ORIGINAL (și cu termenul nemutat: acoperirea nu se poate verifica față de o cerință necunoscută).
//   Limită (R7, documentată): mutarea AUTOMATĂ a termenului (edge fn ofertare-seap-veghe, din erata SEAP) lasă doar
//   notificarea generică din clopoțel („TERMEN MUTAT … verifică … valabilitatea garanției”); semnalul concret
//   (acoperă / nu acoperă) apare la deschiderea fișei (KPI + tab), nu în lista de carduri / v_ofertare_dashboard.
// ════════════════════════════════════════════════════════════════
export const NIVEL_REVERIFICARE = { nu_acopera: 'nu acoperă termenul', de_verificat: 'de reverificat' }

// st = stareGarantie(...); → { da, nivel: 'nu_acopera'|'de_verificat'|null, motive: [text], acoperaVerificat }
// acoperaVerificat = polița acoperă DOVEDIT noul termen + valabilitatea cerută (singurul caz în care omul poate
// închide reverificarea fără act adițional — vezi patchVerificatAcoperire)
export function semnalReverificare(st, { deAcum, necesarPana } = {}) {
  if (!st) return { da: false, nivel: null, motive: [], acoperaVerificat: false }
  const m = []
  if (!deAcum) m.push('licitația nu are termen de depunere — acoperirea garanției nu se poate verifica')
  if (st.decalat) m.push(`termenul de depunere s-a mutat (${fmtIso(st.termenCerere)} → ${fmtIso(deAcum)}) față de cel pentru care s-a cerut polița`)
  if (st.incepeDupaTermen) m.push(`polița începe abia pe ${fmtIso(st.acoperaDe)}, după ziua depunerii (${fmtIso(deAcum)})`)
  if (st.insuficient) m.push(`polița acoperă până la ${fmtIso(st.acoperaPana)}, cerința cere până la ${fmtIso(necesarPana)}`)
  if (st.inAsteptare) m.push(`prelungire cerută la ${fmtIso(st.inAsteptare.de)} – ${fmtIso(st.inAsteptare.pana)}, neconfirmată (fără act adițional)` +
    (st.prelungireVeche ? ` — cerută pentru termenul ${fmtIso(st.prelungireVeche.de)}, nu pentru cel curent` : ''))
  // cerința necitită: și pentru polița în ORIGINAL cu termenul nemutat — verdele ar afirma o acoperire neverificată
  if (deAcum && (st.decalat || st.inAsteptare || st.original) && !necesarPana) m.push('valabilitatea cerută pe termenul curent nu a putut fi calculată — acoperirea nu e verificată')
  const acoperaVerificat = !!(deAcum && necesarPana && st.acoperaDe && st.acoperaPana && !st.incepeDupaTermen && !st.insuficient)
  const nuAcopera = st.insuficient || st.incepeDupaTermen
  return { da: m.length > 0, nivel: nuAcopera ? 'nu_acopera' : m.length ? 'de_verificat' : null, motive: m, acoperaVerificat }
}

// Evaluarea completă pe termenul CURENT — o singură sursă pentru tab, KPI și eticheta tab-ului.
// g = rândul ofertare_garantii (sau null); termenDepunere = ofertare_licitatii.termen_depunere (timestamptz);
// fisa = ofertare_licitatii.garantie_participare; cerinte = rândurile ofertare_cerinte relevante.
export function evalueazaGarantie({ g, termenDepunere, fisa, cerinte }) {
  const deAcum = ziDepunere(termenDepunere)
  const propunere = propuneValabilitate(clasificaSurse({ fisa, cerinte }), deAcum)
  const necesar = propunere.durata && deAcum ? calculeazaValabilitate(propunere.durata, deAcum) : null
  const necesarPana = necesar?.pana || null
  const st = stareGarantie({ g, deAcum, necesarPana })
  return { deAcum, propunere, necesar, st, reverificare: semnalReverificare(st, { deAcum, necesarPana }) }
}

// Termenul s-a mutat la salvarea fișei licitației? (ziua din ora României) → { de, la } sau null
export function termenMutat(vechi, nou) {
  const a = ziDepunere(vechi), b = ziDepunere(nou)
  return a === b ? null : { de: a, la: b }
}

// Polița acoperă DOVEDIT termenul curent ⇒ omul confirmă, iar termenul de referință devine cel curent.
// Se poate închide așa: (a) termenul mutat; (b) o cerere de prelungire rămasă pentru ALT termen (prelungireVeche —
// ex. termen T → T+30, cerere trimisă, termen înapoi la T): marcaj ⟦prelungire-renuntata⟧, citit de ultimaPrelungire.
// Perioada poliței NU se prelungește: valabil_* rămân (sau revin, dacă revenirea după mail eșuase) la ce acoperă
// polița efectiv. O prelungire cerută pentru termenul CURENT nu se închide așa (act adițional). Altfel null.
export function patchVerificatAcoperire({ g, ev, termenDepunere, azi }) {
  const st = ev?.st
  if (!g || !st || !ev?.reverificare?.acoperaVerificat || st.prelungireCurenta) return null
  const veche = st.prelungireVeche
  if (!st.decalat && !veche) return null            // nimic de închis
  const linie = `${fmtIso(azi)}: ` +
    (st.decalat ? `termen ${fmtIso(st.termenCerere)} → ${fmtIso(ev.deAcum)}; ` : '') +
    (veche ? `cererea de prelungire la ${fmtIso(veche.de)} – ${fmtIso(veche.pana)} (pentru termenul ${fmtIso(veche.de)}) nu mai e necesară, termenul curent e ${fmtIso(ev.deAcum)}; ` : '') +
    `polița${g.polita_nr ? ` nr. ${g.polita_nr}` : ''} acoperă ${fmtIso(st.acoperaDe)} – ${fmtIso(st.acoperaPana)}, ` +
    `suficient pentru cerință (până la ${fmtIso(ev.necesar.pana)}) — verificat, fără act adițional.` +
    (veche ? ` ⟦prelungire-renuntata ${veche.de} ${veche.pana}⟧` : '')
  const p = { termen_la_cerere: termenDepunere, observatii: adaugaObservatie(g.observatii, linie) }
  // după închiderea cererii, acoperirea se citește din valabil_*: dacă acolo a rămas perioada CERUTĂ (revenirea
  // eșuase), se readuce perioada pe care polița o acoperă efectiv (din marcaj) — nu o prelungire neconfirmată
  if (veche && (g.valabil_de !== st.acoperaDe || g.valabil_pana !== st.acoperaPana)) {
    const per = perioadaPolita(st.acoperaDe, st.acoperaPana)
    if (!per) return null
    Object.assign(p, per)
  }
  return p
}

// KPI „Garanție participare” + eticheta tab-ului 🛡 din fișa licitației — o singură funcție pentru ambele.
// status = v_ofertare_dashboard.garantie_status; fisa = ofertare_licitatii.garantie_participare;
// semnal = useSemnalGarantie (undefined = se încarcă, null = fără garanție, altfel { reverificare }).
// → { unit, ton: 'rosu'|'portocaliu'|'verde'|'neutru', tab }
// Polița NU e încă în original ⇒ rămâne „în curs” și ROȘIE (ca înainte de R7); semnalul se ADAUGĂ în text — nu
// acoperă starea mai gravă cu o etichetă mai slabă. Doar pentru „original” semnalul decide culoarea.
export function indicatorGarantie({ status, fisa, semnal }) {
  const rev = semnal?.reverificare?.da ? semnal.reverificare : null
  const avert = rev ? `⚠ ${NIVEL_REVERIFICARE[rev.nivel] || NIVEL_REVERIFICARE.de_verificat}` : ''
  if (status === 'original') {
    if (rev) return { unit: avert, ton: rev.nivel === 'nu_acopera' ? 'rosu' : 'portocaliu', tab: ` · ${avert}` }
    if (semnal === undefined) return { unit: '…', ton: 'neutru', tab: ' · …' }      // se încarcă ⇒ neutru, nu verde
    return { unit: '✓ original', ton: 'verde', tab: ' · ✓' }
  }
  if (status) {
    const unit = rev ? `în curs · ${avert}` : 'în curs'
    return { unit, ton: fisa || rev?.nivel === 'nu_acopera' ? 'rosu' : rev ? 'portocaliu' : 'neutru', tab: ` · ${unit}` }
  }
  return { unit: '', ton: fisa ? 'rosu' : 'neutru', tab: '' }
}

// Semnalul din citirea făcută de useSemnalGarantie (pur, testat). l = licitația din dashboard; g = ultima garanție
// neanulată; eroare = mesajul erorii de citire. Eroare ⇒ „de reverificat” (nu verde); dashboard-ul spune că există
// garanție, dar recitirea nu o găsește ⇒ tot „de reverificat” (nu „✓ original” din lipsă de date).
export function semnalDinCitire({ l, g, cerinte, eroare }) {
  const deVerificat = motiv => ({ reverificare: { da: true, nivel: 'de_verificat', motive: [motiv], acoperaVerificat: false } })
  if (!l?.garantie_status) return null
  if (eroare) return deVerificat(`garanția nu s-a putut citi: ${eroare}`)
  if (!g) return deVerificat('garanția din fișa licitației nu s-a găsit la recitire — reîncarcă pagina')
  return evalueazaGarantie({ g, termenDepunere: l.termen_depunere, fisa: l.garantie_participare, cerinte: cerinte || [] })
}

// Pasul 4: câmpurile „perioada scrisă pe poliță” se precompletează cu perioada cerută DOAR cât omul nu le-a atins
// (sau la altă garanție). O reîncărcare — ex. după o actualizare trimisă brokerului în „achitată” — nu mai
// suprascrie în tăcere ce a trecut omul de pe polița fizică. f4 = { gid, atins, de, pana, ... }
export function precompletarePerioada(f4, g) {
  if (!g) return f4
  if (f4?.gid === g.id && f4?.atins) return f4
  return { ...f4, gid: g.id, atins: false, de: g.valabil_de || '', pana: g.valabil_pana || '' }
}

// Pasul 4 („polița în original”): perioada se ia DIN POLIȚA FIZICĂ (precompletată cu perioada cerută, confirmată
// de om). Fără asta, o actualizare cerută brokerului după plată ar trece drept prelungire emisă.
export function perioadaPolita(de, pana) {
  const zile = zileIntre(de, pana)
  return zile > 0 ? { valabil_de: de, valabil_pana: pana, valabil_zile: zile } : null
}

// Trimite perioada nouă brokerului FĂRĂ să lase în BD o perioadă netrimisă.
// Edge fn „actualizare” citește perioada din BD ⇒ perioada cerută se scrie ÎNAINTE de mail:
//  - mailul eșuează ⇒ se revine la valorile vechi (inclusiv observațiile);
//  - polița e în ORIGINAL și mailul a plecat ⇒ valabil_* / termen_la_cerere revin la perioada pe care polița
//    o acoperă efectiv; cererea rămâne în observații (marcaj) până la „act adițional primit”.
// patch(p) și mail() sunt injectate (UI: supabase; teste: în memorie). Nu aruncă după primul patch reușit.
export async function trimiteActualizareSigur({ g, cerut, original, linieObs, patch, mail }) {
  const vechi = { valabil_de: g.valabil_de ?? null, valabil_pana: g.valabil_pana ?? null, valabil_zile: g.valabil_zile ?? null, termen_la_cerere: g.termen_la_cerere ?? null }
  const pA = { ...cerut }
  if (original) pA.observatii = adaugaObservatie(g.observatii, linieObs)
  await patch(pA)   // dacă eșuează aici, nu s-a schimbat nimic ⇒ eroarea urcă la apelant
  let rez
  try { rez = await mail() } catch (e) {
    try { await patch({ ...vechi, observatii: g.observatii ?? null }); return { ok: false, mail: false, revenire: true, eroare: e?.message || String(e) } }
    catch (e2) { return { ok: false, mail: false, revenire: false, eroare: e?.message || String(e), eroareRevenire: e2?.message || String(e2) } }
  }
  if (!original) return { ok: true, mail: true, rez }
  let ultima = null
  for (let i = 0; i < 3; i++) {
    try { await patch(vechi); return { ok: true, mail: true, revenire: true, rez } } catch (e) { ultima = e }
  }
  return { ok: true, mail: true, revenire: false, eroareRevenire: ultima?.message || String(ultima), rez }
}

// „Act adițional primit”: perioada confirmată devine perioada poliței, iar termenul de referință — cel curent
export function patchActAditional({ g, de, pana, termenDepunere, azi }) {
  const zile = zileIntre(de, pana)
  if (!(zile > 0)) return null
  return { valabil_de: de, valabil_pana: pana, valabil_zile: zile, termen_la_cerere: termenDepunere,
    observatii: adaugaObservatie(g?.observatii, linieActAditional({ azi, polita: g?.polita_nr, de, pana })) }
}
