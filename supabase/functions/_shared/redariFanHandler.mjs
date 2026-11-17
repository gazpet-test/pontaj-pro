// redariFanHandler.mjs — handler testabil pentru funcția edge redari-fan-awb (FAN Courier), fără rețea implicită.
// Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3–§5. Fișa a–e: §4. NU acceptă identitate sau rol din corp (L08).
// TRANSPORT_REAL_ACTIV = false în COD → după poarta owner se răspunde 423, ÎNAINTE de orice citire a secretelor FAN, a BD-ului (în afara
// lotului) sau a vreunui apel către api.fancourier.ro. Calea reală (redariFanTransport.mjs) e scrisă și testată pe răspunsuri simulate,
// dar nu e atinsă cât flag-ul e false. Activarea = PR separat, revizuit, după acordul proprietarului (doc §10 „Lista de activare”).
import { executaActiuneFan } from './redariFanTransport.mjs'

export const TRANSPORT_REAL_ACTIV = false
// comanda curierului NU e aici: câmpurile POST /order nu sunt în documentul de proiectare → se face manual în selfAWB (doc §3 pasul 5, §8)
export const ACTIUNI_FAN = Object.freeze(['genereaza', 'eticheta', 'urmarire', 'confirmari', 'evenimente', 'reconciliaza', 'sterge_awb'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function raspundeFan({ jwt, corp }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  if (!jwt) return out(401, 'neautentificat')
  const user = await deps.getUser()
  // Jakarinos r1 P2 (L18): autentificarea indisponibilă (5xx / rețea / fără status) ≠ token invalid
  if (user?.error) return Number.isInteger(user.error.status) && user.error.status >= 400 && user.error.status < 500 ? out(401, 'neautentificat') : out(503, 'autentificare_neconfirmata')
  if (!user?.data?.user?.id) return out(401, 'neautentificat')
  // (d) Toate acțiunile cheltuie bani sau ating date FAN reale → doar owner-ul (fn_sms_e_owner pe auth.uid()), verificat AICI, nu din corp.
  const owner = await deps.owner()
  if (owner?.error) return out(503, 'autorizare_neconfirmata')   // L18: eroare ≠ „nu e owner”
  if (owner?.data !== true) return out(403, 'non_owner')
  if (!corp || typeof corp !== 'object' || !ACTIUNI_FAN.includes(corp.actiune)) return out(400, 'cerere_invalida')
  if (typeof corp.lot_id !== 'string' || !UUID.test(corp.lot_id)) return out(400, 'cerere_invalida')
  const lot = await deps.lot(corp.lot_id)   // RLS cu JWT-ul omului: lotul trebuie să fie vizibil (L09)
  if (lot?.error) return out(503, 'citire_neconfirmata')
  if (!lot?.data) return out(404, 'tinta_inexistenta')
  if (!TRANSPORT_REAL_ACTIV) return out(423, 'transport_real_oprit')
  return executaActiuneFan({ corp, lot: lot.data }, deps)
}
