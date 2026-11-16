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

const SEMNE_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g')

export const normCautare = s => String(s ?? '').normalize('NFD').replace(SEMNE_RE, '').toLowerCase().replace(/\s+/g, ' ').trim()

export const SEGMENTE_RADAR = ['distributie', 'transgaz', 'romgaz']

// Data de azi în Europe/Bucharest, ca 'AAAA-LL-ZZ'
const ziuaBucuresti = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

// true doar dacă termenul e citibil și a trecut. Termen cu oră = comparat pe momentul exact;
// termen doar cu dată = expirat abia după ce s-a terminat acea zi în România.
export function eExpirat(termen, acumMs) {
  if (termen == null || termen === '') return false
  const s = String(termen).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return ziuaBucuresti(acumMs) > s
  const t = new Date(s).getTime()
  if (!Number.isFinite(t)) return false
  return t < acumMs
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
