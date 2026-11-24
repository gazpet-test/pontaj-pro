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

// Indexul cardurilor din rânduri { id, card_combustibil }: pe fiecare card (după trim) numărul de rânduri și
// variantele EXACTE din BD (cu spații), ca filtrul pe server să le prindă pe toate. Fără card = null / doar spații
// (varianteFaraCard = textele doar din spații). Sortare naturală (GAZPET2 înainte de GAZPET10).
export function indexCarduri(randuri) {
  const map = new Map()
  let faraCard = 0
  const goale = new Set()
  for (const a of randuri || []) {
    const brut = a?.card_combustibil
    const k = cheieCard(brut)
    if (k === null) {
      faraCard++
      if (typeof brut === 'string') goale.add(brut)
      continue
    }
    const c = map.get(k) || { card: k, nr: 0, variante: new Set() }
    c.nr++
    c.variante.add(String(brut))
    map.set(k, c)
  }
  const carduri = Array.from(map.values())
    .sort((x, y) => x.card.localeCompare(y.card, 'ro', { numeric: true }))
    .map(c => ({ card: c.card, nr: c.nr, variante: Array.from(c.variante).sort() }))
  return { carduri, faraCard, varianteFaraCard: Array.from(goale).sort(), total: (randuri || []).length }
}

// Cardurile prezente în listă, sortate, cu numărul de rânduri; fără card = la final (din indexCarduri).
export function carduriDisponibile(alimentari) {
  const { carduri, faraCard } = indexCarduri(alimentari)
  return { carduri: carduri.map(({ card, nr }) => ({ card, nr })), faraCard }
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
