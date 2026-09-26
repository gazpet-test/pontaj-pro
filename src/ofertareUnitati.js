import { normUm } from './ofertareCantitatiInvalidare.js'

// R9b: mapare explicită, identică cu ofertare_clasa_unitate din migrarea 2.
const LUNGIMI = { m: 1, 'm.': 1, metri: 1, metru: 1, ml: 1, 'ml.': 1, 'm.l.': 1, 'm.l': 1,
  'metri liniari': 1, 'metru liniar': 1, km: 1000, hm: 100 }
const ALTE = new Set(['mc', 'm cub', 'm3', 'm³', 'mp', 'm2', 'm²', 'ha', 'l', 'litri', 'buc', 'bucata', 'bucati', 'bucăți', 'buc.', 'bc', 'kg', 't', 'to', 'h', 'ore', 'set', 'cpl'])
export function clasaUnitate(um) {
  const u = normUm(um)
  if (Object.hasOwn(LUNGIMI, u)) return { tip: 'lungime', factor: LUNGIMI[u] }
  return { tip: ALTE.has(u) ? 'alta' : 'de_verificat' }
}

export function inMetri(c, baza = 'cantitate') {
  const u = clasaUnitate(c?.um), v = c?.[baza]
  return u.tip === 'lungime' && v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) * u.factor : null
}
