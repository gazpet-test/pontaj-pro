// Filtrele din „Alocare manuală șantier — Bulk Edit” (FaraSantierBulkModal), ca funcții pure.
// TKT-2026-0383 / 0387 (24.11.2026): filtru după card de combustibil. Cardurile se mută între
// utilaje, deci NU există alocare automată pe card: filtrul doar restrânge lista, iar
// „Mass: aplică toate” se aplică exact rândurilor rămase vizibile.

// Valoarea din dropdown pentru alimentările fără card completat.
export const FARA_CARD = '__fara_card__'

// Cheia cardului: textul fără spații la capete; gol / null = fără card.
export function cheieCard(card) {
  const t = typeof card === 'string' ? card.trim() : (card == null ? '' : String(card).trim())
  return t || null
}

// Cardurile prezente în listă, sortate, cu numărul de rânduri; fără card = la final.
export function carduriDisponibile(alimentari) {
  const map = new Map()
  let faraCard = 0
  for (const a of alimentari || []) {
    const k = cheieCard(a?.card_combustibil)
    if (k === null) { faraCard++; continue }
    map.set(k, (map.get(k) || 0) + 1)
  }
  const carduri = Array.from(map.entries())
    .sort((x, y) => x[0].localeCompare(y[0], 'ro', { numeric: true }))
    .map(([card, nr]) => ({ card, nr }))
  return { carduri, faraCard }
}

// filtre = { luna: 'toate'|'YYYY-MM', statie: 'toate'|nume, whatsapp: 'toate'|'cu_wa'|'fara_wa',
//            card: 'toate'|FARA_CARD|card, vehicul: text }
export function filtreazaAlimentari(alimentari, filtre = {}) {
  const { luna = 'toate', statie = 'toate', whatsapp = 'toate', card = 'toate', vehicul = '' } = filtre
  let res = alimentari || []
  if (luna !== 'toate') res = res.filter(a => a.data_alimentare?.startsWith(luna))
  if (statie !== 'toate') res = res.filter(a => a.statie_combustibil === statie)
  if (whatsapp === 'cu_wa') res = res.filter(a => a.whatsapp_caption)
  if (whatsapp === 'fara_wa') res = res.filter(a => !a.whatsapp_caption)
  if (card === FARA_CARD) res = res.filter(a => cheieCard(a.card_combustibil) === null)
  else if (card !== 'toate') res = res.filter(a => cheieCard(a.card_combustibil) === card)
  const q = (vehicul || '').trim().toLowerCase()
  if (q) {
    res = res.filter(a => {
      const av = a.logistica_active || {}
      return (
        (av.cod_intern || '').toLowerCase().includes(q) ||
        (av.nr_inmatriculare || '').toLowerCase().includes(q) ||
        (av.marca || '').toLowerCase().includes(q) ||
        (av.model || '').toLowerCase().includes(q)
      )
    })
  }
  return res
}

// „Mass: aplică toate”: preselecția se face DOAR pe rândurile vizibile (filtrate).
export function selectieMasa(vizibile, siteId) {
  const out = {}
  if (!siteId) return out
  for (const a of vizibile || []) out[a.id] = siteId
  return out
}

// Ce se salvează: doar selecțiile cu șantier ale rândurilor vizibile acum.
export function selectiiDeSalvat(selections, vizibile) {
  const ids = new Set((vizibile || []).map(a => a.id))
  return Object.entries(selections || {})
    .filter(([id, siteId]) => siteId && ids.has(Number(id)))
    .map(([id, siteId]) => ({ id: Number(id), site_id: Number(siteId) }))
}
