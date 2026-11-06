// redariFanHandler.mjs — handler testabil pentru funcția edge redari-fan-awb (FAN Courier), fără rețea implicită.
// Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3–§5. Fișa a–e: §4. NU acceptă identitate sau rol din corp (L08).
// Livrarea de schelet (06.11.2026): TRANSPORT_REAL_ACTIV = false în COD → după poarta owner se răspunde 423, înainte de orice
// citire a secretelor FAN sau apel către api.fancourier.ro. Activarea cere un PR separat, revizuit, după „da”-ul lui Răzvan.
export const TRANSPORT_REAL_ACTIV = false
export const ACTIUNI_FAN = Object.freeze(['genereaza', 'eticheta', 'comanda_curier', 'sterge_awb', 'urmarire', 'reconciliaza'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function raspundeFan({ jwt, corp }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  if (!jwt) return out(401, 'neautentificat')
  const user = await deps.getUser()
  // Jakarinos r1 P2 (L18): autentificarea indisponibilă (5xx / rețea / fără status) ≠ token invalid
  if (user?.error) return Number.isInteger(user.error.status) && user.error.status < 500 ? out(401, 'neautentificat') : out(503, 'autentificare_neconfirmata')
  if (!user?.data?.user?.id) return out(401, 'neautentificat')
  // (d) Toate acțiunile cheltuie bani sau ating date FAN reale → doar owner-ul (fn_sms_e_owner pe auth.uid()).
  const owner = await deps.owner()
  if (owner?.error) return out(503, 'autorizare_neconfirmata')   // L18: eroare ≠ „nu e owner”
  if (owner?.data !== true) return out(403, 'non_owner')
  if (!corp || typeof corp !== 'object' || !ACTIUNI_FAN.includes(corp.actiune)) return out(400, 'cerere_invalida')
  if (typeof corp.lot_id !== 'string' || !UUID.test(corp.lot_id)) return out(400, 'cerere_invalida')
  const lot = await deps.lot(corp.lot_id)   // RLS cu JWT-ul omului: lotul trebuie să fie vizibil (L09)
  if (lot?.error) return out(503, 'citire_neconfirmata')
  if (!lot?.data) return out(404, 'tinta_inexistenta')
  if (!TRANSPORT_REAL_ACTIV) return out(423, 'transport_real_oprit')
  // Implementarea reală (doc §3): claim atomic pe rând (fn_red_fan_claim, cheie de idempotență) → POST /intern-awb (un AWB pe apel)
  // → interpreteazaRaspunsAwb → fn_red_fan_rezultat (CAS pe cheie). Lipsește intenționat în schelet.
  return out(503, 'transport_neconfigurat')
}
