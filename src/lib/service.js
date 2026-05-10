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

// Praguri pentru a marca o scadență drept „aproape" (galben)
export const PRAG_ZILE = 30
export const PRAG_KM   = 1000
export const PRAG_ORE  = 100

/**
 * Calculează cea mai apropiată scadență de service.
 *
 * @param {Object} fisa - ultima fișă service (poate fi null)
 *                       cu urmatoarea_data / urmatoarea_km / urmatoarea_ore
 * @param {number|null} kmLive  - km curenți (din v_active_km_ore.km_live)
 * @param {number|null} oreLive - ore curente (din v_active_km_ore.ore_live)
 * @returns {{tip:'data'|'km'|'ore', ramas:number, label:string} | null}
 */
export function calcUrmService(fisa, kmLive, oreLive) {
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
      label: diffDays < 0 ? `${Math.abs(diffDays)} zile depășite` : `${diffDays} zile`,
    })
  }
  if (fisa.urmatoarea_km != null && kmLive != null) {
    const diff = fisa.urmatoarea_km - kmLive
    items.push({
      tip: 'km',
      ramas: diff,
      label: diff < 0
        ? `${Math.abs(diff).toLocaleString('ro-RO')} km depășiți`
        : `${diff.toLocaleString('ro-RO')} km`,
    })
  }
  if (fisa.urmatoarea_ore != null && oreLive != null) {
    const diff = fisa.urmatoarea_ore - oreLive
    items.push({
      tip: 'ore',
      ramas: diff,
      label: diff < 0 ? `${Math.abs(diff)} h depășite` : `${diff} h`,
    })
  }

  if (!items.length) return null
  items.sort((x, y) => x.ramas - y.ramas)
  return items[0]
}

/**
 * Returnează level-ul scadenței.
 * 'depasit' (roșu) | 'aproape' (galben) | 'ok' (verde) | null
 */
export function urmServiceLevel(u) {
  if (!u) return null
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
  const icon = u.tip === 'data' ? '📅' : u.tip === 'km' ? '🛣️' : '⏱️'
  return `${icon} ${u.label}`
}
