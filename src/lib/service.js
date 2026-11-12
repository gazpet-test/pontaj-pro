// ════════════════════════════════════════════════════════════════════════════
// LIB SERVICE — helpers pentru calcule scadențe service (Pachet C)
// ════════════════════════════════════════════════════════════════════════════
// Folosit de:
//   - ServiceTab.jsx (coloana „Următor service" + KPI scadențe)
//   - Acasă (widget „Active cu service aproape/depășit")
//   - oriunde mai apare nevoia de a calcula scadența service
//
// Capcane spelling de care să ții cont când scrii queries:
//   logistica_alimentari.active_id  (cu E)
//   logistica_service_fise.activ_id (FĂRĂ E)
//   v_active_km_ore.activ_id        (FĂRĂ E)
// ════════════════════════════════════════════════════════════════════════════

import { PRAG_CITIRI, zi } from './citiriBord.js'

// Praguri pentru a marca o scadență drept „aproape" (galben)
export const PRAG_ZILE = 30
export const PRAG_KM   = 1000
export const PRAG_ORE  = 100

// Ziua de azi 'AAAA-LL-ZZ' în Europe/Bucharest (pentru „creștere imposibilă de la fișă”).
const aziBucuresti = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

// Citirea de pe fișă (cea mai mare dintre intrare / ieșire) pentru 'km' sau 'ore'; null dacă lipsește.
export function citireFisa(fisa, tip) {
  const [a, b] = tip === 'km' ? ['km_intrare', 'km_iesire'] : ['ore_intrare', 'ore_iesire']
  const v = [fisa?.[a], fisa?.[b]].filter(x => x != null && x !== '' && Number.isFinite(Number(x))).map(Number)
  return v.length ? Math.max(...v) : null
}

// TKT-2026-0380: o depășire de scadență e IMPOSIBILĂ (deci vine dintr-o citire greșită, nu dintr-o
// revizie ratată) când: valoarea curentă e peste plafonul absolut, SAU depășirea e mai mare decât
// saltul imposibil deja folosit la validarea fișelor (80.000 km / 1.500 h), SAU creșterea de la
// citirea de pe fișă e mai mare decât se poate face în zilele scurse (24 h/zi, 1.000 km/zi).
// Aceleași praguri ca validarea citirilor (src/lib/citiriBord.js), o singură definiție.
export function depasireImposibila(tip, live, fisa, azi = aziBucuresti()) {
  const p = PRAG_CITIRI[tip]
  const urm = tip === 'km' ? fisa?.urmatoarea_km : fisa?.urmatoarea_ore
  if (!p || live == null || live === '' || urm == null || urm === '') return false
  const L = Number(live), U = Number(urm)
  if (!Number.isFinite(L) || !Number.isFinite(U) || L <= U) return false   // nedepășit: nimic de judecat
  if (L > p.plafon) return true
  if (L - U > p.salt) return true
  const baza = citireFisa(fisa, tip), d0 = zi(fisa?.data_fisei), d1 = zi(azi)
  if (baza != null && d0 && d1 && d1 >= d0) {
    const zile = Math.round((Date.parse(`${d1}T00:00:00Z`) - Date.parse(`${d0}T00:00:00Z`)) / 86400000) + 1
    if (L - baza > zile * p.maxPeZi) return true
  }
  return false
}

// TKT-2026-0380: ordinea fișelor unui activ = data_fisei, apoi id (aceeași zi).
const maiNoua = (a, b) => (a.data_fisei || '') > (b.data_fisei || '') || ((a.data_fisei || '') === (b.data_fisei || '') && Number(a.id) > Number(b.id))
const areScadenta = f => f.urmatoarea_data != null || f.urmatoarea_km != null || f.urmatoarea_ore != null

// { [activ_id]: ultima fișă care are cel puțin o scadență (dată / km / ore) }
export function ultimeleFiseCuScadenta(fise) {
  const m = {}
  for (const f of fise || []) {
    if (!f || !areScadenta(f)) continue
    const cur = m[f.activ_id]
    if (!cur || maiNoua(f, cur)) m[f.activ_id] = f
  }
  return m
}

// Fișa mai nouă, cu scadență, care o înlocuiește pe `fisa` (revizia următoare s-a făcut deja), sau null.
// O fișă înlocuită nu se mai compară cu km / orele de azi: altfel orice fișă veche apare „depășită”.
// O fișă nouă FĂRĂ scadență (ex. o reparație) nu înlocuiește scadența unei mentenanțe.
export function fisaInlocuitaDe(fisa, ultimele) {
  const u = fisa ? ultimele?.[fisa.activ_id] : null
  return u && u.id !== fisa.id && maiNoua(u, fisa) ? u : null
}

/**
 * Calculează cea mai apropiată scadență de service.
 *
 * @param {Object} fisa - ultima fișă service (poate fi null)
 *                       cu urmatoarea_data / urmatoarea_km / urmatoarea_ore
 * @param {number|null} kmLive  - km curenți (din v_active_km_ore.km_live)
 * @param {number|null} oreLive - ore curente (din v_active_km_ore.ore_live)
 * @returns {{tip:'data'|'km'|'ore', ramas:number, label:string} | null}
 */
export function calcUrmService(fisa, kmLive, oreLive, azi) {
  if (!fisa) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const items = []

  if (fisa.urmatoarea_data) {
    const d = new Date(fisa.urmatoarea_data)
    const diffDays = Math.floor((d - today) / 86400000)
    items.push({
      tip: 'data',
      ramas: diffDays,
      urgenta: diffDays / PRAG_ZILE,
      label: diffDays < 0 ? `${Math.abs(diffDays)} zile depășite` : `${diffDays} zile`,
    })
  }
  // TKT-2026-0380: depășirea imposibilă NU se afișează ca „depășit”, ci „citire de verificat”
  // (deVerificat), cu urgența 0: după scadențele reale depășite, înaintea celor neajunse.
  const deVerificat = (tip, live, diff) => ({
    tip, ramas: diff, urgenta: 0, deVerificat: true, live: Number(live),
    depasire: Math.abs(diff),
    label: 'citire de verificat',
  })
  if (fisa.urmatoarea_km != null && kmLive != null) {
    const diff = fisa.urmatoarea_km - kmLive
    items.push(depasireImposibila('km', kmLive, fisa, azi) ? deVerificat('km', kmLive, diff) : {
      tip: 'km',
      ramas: diff,
      urgenta: diff / PRAG_KM,
      label: diff < 0
        ? `${Math.abs(diff).toLocaleString('ro-RO')} km depășiți`
        : `${diff.toLocaleString('ro-RO')} km`,
    })
  }
  if (fisa.urmatoarea_ore != null && oreLive != null) {
    const diff = fisa.urmatoarea_ore - oreLive
    items.push(depasireImposibila('ore', oreLive, fisa, azi) ? deVerificat('ore', oreLive, diff) : {
      tip: 'ore',
      ramas: diff,
      urgenta: diff / PRAG_ORE,
      label: diff < 0 ? `${Math.abs(diff)} h depășite` : `${diff} h`,
    })
  }

  if (!items.length) return null
  // TKT-0152 (Daniel Oancea): înainte sortam după `ramas` brut, adică comparam
  // ZILE cu KM cu ORE — numere din unități diferite. „30 zile" ieșea mereu
  // înaintea „5000 km", așa că din clipa în care cineva punea data următoarei
  // revizii, coloana „URMĂTOR" arăta zile și ascundea kilometrii, deși mașina
  // ajungea la km cu mult înainte de dată.
  // Acum comparăm cât de aproape e fiecare scadență de PROPRIUL ei prag
  // (urgenta = rămas / prag), deci se compară lucruri comparabile.
  items.sort((x, y) => x.urgenta - y.urgenta)
  // `toate` = toate scadențele definite, cea mai urgentă prima — badge-ul le
  // arată pe toate, ca omul să vadă și km și data, nu doar una.
  return { ...items[0], toate: items }
}

/**
 * Returnează level-ul scadenței.
 * 'depasit' (roșu) | 'aproape' (galben) | 'ok' (verde) | null
 */
export function urmServiceLevel(u) {
  if (!u) return null
  if (u.deVerificat) return 'verificare'   // TKT-2026-0380: nu intră în „scadențe depășite”
  if (u.ramas < 0) return 'depasit'
  if (u.tip === 'data' && u.ramas <= PRAG_ZILE) return 'aproape'
  if (u.tip === 'km'   && u.ramas <= PRAG_KM)   return 'aproape'
  if (u.tip === 'ore'  && u.ramas <= PRAG_ORE)  return 'aproape'
  return 'ok'
}

/**
 * Returnează culoarea hex corespunzătoare level-ului.
 * Folosește paleta G din Logistica.jsx — schimbă dacă tema diferă.
 */
export function urmServiceColor(u) {
  const lvl = urmServiceLevel(u)
  if (lvl === 'verificare') return '#BC8CFF'  // G.purple — citire de verificat, nu scadență
  if (lvl === 'depasit') return '#F85149'  // G.red
  if (lvl === 'aproape') return '#D29922'  // G.yellow
  if (lvl === 'ok')      return '#3FB950'  // G.green
  return '#6E7681'                          // G.dim
}

/**
 * Helper de UI: textul scurt pentru badge.
 * Ex: „📅 12 zile" / „🛣️ 450 km depășiți" / „⏱️ 80 h"
 */
export function urmServiceBadgeText(u) {
  if (!u) return '—'
  const icon = u.deVerificat ? '🔎' : u.tip === 'data' ? '📅' : u.tip === 'km' ? '🛣️' : '⏱️'
  return `${icon} ${u.label}${u.deVerificat ? (u.tip === 'km' ? ' (km)' : ' (ore)') : ''}`
}
