// ═══════════════════════════════════════════════════════════════════════════
// raportRezumat.js — rezumatul scurt al raportului zilnic de șantier (etapa 1, determinist, fără AI)
//
// rezumatRaport(intrare) scrie câteva rânduri pe înțelesul unui director: șantier / proiect, data, vremea, oameni, utilaje,
// poze, lucrările cu cantitățile EXACT ca în raport (unitatea de măsură inclusă), detaliile, problemele.
// Regulile: cifrele se copiază din raport (nu se rotunjesc, nu se deduc, nu se adună); câmp lipsă = rândul / bucata lipsește
// (nu „0”, nu „necunoscut”); textele lungi se taie pe cuvinte, cu „…”.
//
// Forma intrării = cea construită în BD de fn_raport_rezumat_intrare (migrarea 20261215a, blocul INTRARE) și de scriptul de
// probă scripts/raport_rezumat_proba.sql (același bloc, copiat identic):
//   { santier, proiect, data: 'AAAA-LL-ZZ', meteo: {temp, precip_mm, alerte[]}, personal: {sudori, …, total},
//     utilaje: [{nume, cod, stare, motiv}], linii: [{obiect_cod, obiect_nume, activitate, um, cantitate, bifa}],
//     distributie: {conducte, bransamente}, lucrari, probleme, masini, poze: N }
// Textul salvat pe raport îl scrie SERVERUL (fn_raport_rezumat_text, aceeași regulă în SQL). Funcția de aici e oglinda lui
// (L19: dublare inevitabilă JS / SQL = test de paritate pe același tabel de cazuri, src/raportRezumat.cazuri.json).
// ═══════════════════════════════════════════════════════════════════════════

export const LIMITE = { detalii: 240, probleme: 240, masini: 160, motiv: 80 }
// textul corectat de om: cel mult atâtea caractere (aceeași limită ca în BD; peste = refuz, nu tăiere)
export const MAX_EDITAT = 4000

const CATEGORII = [
  ['sudori', 'sudori'], ['lacatusi', 'lăcătuși'], ['operatori', 'operatori utilaje'], ['soferi', 'șoferi'],
  ['necalificati', 'necalificați'], ['tesa', 'TESA'], ['altii', 'alții'],
]

// caracterele de control (cod 1–31 și 127: tab, rând nou etc.) devin spațiu; construit din coduri, nu din secvențe de escape
const CONTROL = new RegExp('[' + String.fromCharCode(1) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']+', 'g')

// textul pe un singur rând: controalele -> spațiu, spațiile repetate -> unul, fără spații la capete (doar spațiul obișnuit)
export function curata(s) {
  if (typeof s !== 'string') return ''
  return s.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '')
}

// cel mult n caractere (puncte de cod, ca length() din PostgreSQL), tăiat la ultimul spațiu; un singur cuvânt mai lung = tăiat la n
export function trunchiaza(s, n) {
  const t = curata(s)
  const cp = Array.from(t)
  if (cp.length <= n) return t
  const cap = cp.slice(0, n + 1).join('')
  const i = cap.lastIndexOf(' ')
  return (i > 0 ? cap.slice(0, i) : cp.slice(0, n).join('')) + '…'
}

const esteNr = (v) => typeof v === 'number' && Number.isFinite(v)
const esteObiect = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
// numărul exact cum vine din raport, cu virgulă zecimală (12.5 -> „12,5”); nenumăr = null (bucata lipsește)
export function fmtNr(v) {
  return esteNr(v) ? String(v).replace('.', ',') : null
}
const fmtData = (d) => (typeof d === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d)) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : ''

function textMeteo(m) {
  if (!esteObiect(m)) return ''
  const p = []
  if (esteNr(m.temp)) p.push(`${fmtNr(m.temp)} °C`)
  if (esteNr(m.precip_mm) && m.precip_mm > 0) p.push(`precipitații ${fmtNr(m.precip_mm)} mm`)
  const al = Array.isArray(m.alerte) ? m.alerte.map(curata).filter(Boolean) : []
  if (al.length) p.push(`alerte: ${al.join(', ')}`)
  return p.join(', ')
}

function textOameni(ps) {
  if (!esteObiect(ps)) return ''
  const cat = CATEGORII.filter(([k]) => esteNr(ps[k]) && ps[k] > 0).map(([k, l]) => `${l} ${fmtNr(ps[k])}`)
  if (esteNr(ps.total)) return `Oameni: ${fmtNr(ps.total)}${cat.length ? ` (${cat.join(', ')})` : ''}`
  return cat.length ? `Oameni: ${cat.join(', ')}` : ''
}

function textUtilaje(u) {
  if (!Array.isArray(u) || u.length === 0) return ''
  const nef = u.filter(e => esteObiect(e) && e.stare === 'nefunctional').map(e => {
    const den = curata(e.nume) || curata(e.cod) || 'fără denumire'
    const m = trunchiaza(e.motiv, LIMITE.motiv)
    return m ? `${den} – ${m}` : den
  })
  return `Utilaje: ${u.length}${nef.length ? ` (nefuncționale: ${nef.join('; ')})` : ''}`
}

// lucrările pe obiecte, în ordinea din raport (prima apariție a obiectului); fără obiect = „Lucrări:”
function randuriLucrari(linii) {
  if (!Array.isArray(linii)) return []
  const grupe = new Map()
  for (const l of linii) {
    if (!esteObiect(l)) continue
    const cod = curata(l.obiect_cod), nume = curata(l.obiect_nume)
    const et = cod && nume ? `${cod} · ${nume}` : (cod || nume)
    const act = curata(l.activitate) || 'activitate'
    let buc
    if (l.bifa === true) buc = `${act} (efectuat)`
    else {
      const c = fmtNr(l.cantitate), um = curata(l.um)
      buc = c == null ? `${act} (fără cantitate)` : `${act} ${c}${um ? ' ' + um : ''}`
    }
    if (!grupe.has(et)) grupe.set(et, [])
    grupe.get(et).push(buc)
  }
  return [...grupe].map(([et, b]) => `${et ? `Lucrări ${et}` : 'Lucrări'}: ${b.join('; ')}`)
}

function textDistributie(d) {
  if (!esteObiect(d)) return ''
  const p = []
  if (esteNr(d.conducte) && d.conducte > 0) p.push(`conducte ${fmtNr(d.conducte)}`)
  if (esteNr(d.bransamente) && d.bransamente > 0) p.push(`branșamente ${fmtNr(d.bransamente)}`)
  return p.length ? `Distribuție gaze (rânduri): ${p.join(', ')}` : ''
}

export function rezumatRaport(r) {
  const x = esteObiect(r) ? r : {}
  const out = []
  // 1. șantierul (+ proiectul, dacă e altul), data, vremea
  const s = curata(x.santier), pr = curata(x.proiect), d = fmtData(x.data), m = textMeteo(x.meteo)
  out.push(`${s || 'Raport zilnic'}${pr && pr !== s ? ` (proiect ${pr})` : ''}${d ? ` · ${d}` : ''}${m ? ` · ${m}` : ''}`)
  // 2. oameni · utilaje · poze
  const echipa = [textOameni(x.personal), textUtilaje(x.utilaje), esteNr(x.poze) && x.poze > 0 ? `Poze: ${fmtNr(x.poze)}` : ''].filter(Boolean)
  if (echipa.length) out.push(echipa.join(' · '))
  // 3. lucrările cu cantități, pe obiecte; distribuția
  const luc = randuriLucrari(x.linii)
  out.push(...luc)
  const dist = textDistributie(x.distributie)
  if (dist) out.push(dist)
  // 4. textul liber al lucrărilor (detalii, dacă există și cantități)
  const t = trunchiaza(x.lucrari, LIMITE.detalii)
  if (t) out.push(`${luc.length ? 'Detalii' : 'Lucrări'}: ${t}`)
  // 5. probleme · mașini
  const pb = [trunchiaza(x.probleme, LIMITE.probleme), trunchiaza(x.masini, LIMITE.masini)]
  const pbt = [pb[0] ? `Probleme: ${pb[0]}` : '', pb[1] ? `Mașini: ${pb[1]}` : ''].filter(Boolean)
  if (pbt.length) out.push(pbt.join(' · '))
  return out.join('\n')
}

// ── pentru rubrica din aplicație ──
// eticheta: „generat automat” / „editat de <nume>”; rezumatul lipsă (raport salvat înainte de migrare) = null
export function etichetaRezumat(raport, numeAutor) {
  if (!raport || raport.rezumat_sursa == null) return null
  if (raport.rezumat_sursa === 'automat') return 'generat automat'
  if (raport.rezumat_sursa === 'editat') return `editat de ${numeAutor || 'un utilizator'}`
  return null
}
// textul corectat de om, validat ca în BD: nevid (nu doar spații), cel mult MAX_EDITAT caractere (fără tăiere)
export function valideazaEditat(t) {
  if (typeof t !== 'string' || !/[^\s]/.test(t)) return 'Rezumatul nu poate fi gol. Pentru textul automat folosește „Revino la automat”.'
  if (Array.from(t).length > MAX_EDITAT) return `Rezumatul are ${Array.from(t).length} caractere; maximum ${MAX_EDITAT}.`
  return null
}
