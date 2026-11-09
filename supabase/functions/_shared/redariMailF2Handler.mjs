import { TRANSPORT_REAL_ACTIV, gardaTrimitere } from './redariMailF2.mjs'
// Handler testabil, fără rețea implicită. Nu acceptă identitate sau rol din corp.
export async function raspundeTrimitere({ jwt, corp }, deps) {
  const out = (status, cod) => ({ status, body: { cod, trimise: 0 } })
  if (!jwt) return out(401, 'neautentificat')
  const user = await deps.getUser()
  if (user.error || !user.data?.user?.id) return out(401, 'neautentificat')
  const owner = await deps.owner()
  if (owner.error) return out(503, 'autorizare_neconfirmata')
  if (owner.data !== true) return out(403, 'non_owner')
  if (typeof corp?.lot_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(corp.lot_id)) return out(400, 'cerere_invalida')
  const l = await deps.lot(corp.lot_id)
  if (l.error) return out(503, 'citire_neconfirmata')
  if (!l.data) return out(404, 'tinta_inexistenta')
  const [s, i] = await Promise.all([deps.setari(), deps.informare(l.data.proiect_id)])
  if (s.error || i.error) return out(503, 'citire_neconfirmata')
  const cod = gardaTrimitere({ owner: true, setari: s.data, informare: i.data, lot: l.data })
  if (cod) return out(409, cod)
  if (!TRANSPORT_REAL_ACTIV) return out(423, 'transport_real_oprit')
  // Nicio implementare de transport se activează prin simpla schimbare a unui flag BD.
  return out(503, 'transport_neconfigurat')
}
