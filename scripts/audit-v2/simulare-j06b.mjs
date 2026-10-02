// Exclusiv date simulate pentru testele Node; runnerul nu importă acest modul.
import { hash } from './supraveghere-p2.mjs'
export const ACTOR_TEST = '10c105d3-536d-4ca6-b943-803592626909'
export function completeazaDBSimulat(db) {
  const from = db.from.bind(db)
  db.auth = { getUser: async () => ({ data: { user: { id: ACTOR_TEST } } }) }
  db.from = table => {
    if (table !== 'profiles') return from(table)
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: ACTOR_TEST, is_owner: false } }) }
    return q
  }
  db.schema = () => ({ from: () => {
    const q = { select: () => q, like: () => q, order: () => q, range: async () => ({ data: [] }) }; return q
  } })
  return db
}
export function completeazaDriverSimulat(driver) {
  return Object.assign(driver, { async instaleazaGarda(options) { this.guard = options; return true },
    verificaGarda() { if (this.guardError) throw this.guardError }, verificaActor: async () => {} })
}
export function monitorSimulat(tables = {}, storage = []) {
  return async () => ({ complete: true, inventory_id: 'inventar-test', actor_id: ACTOR_TEST,
    guard: { active: true, actor_id: ACTOR_TEST, licitatie_id: 103 },
    tables: Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.map(r => ({ id: r.id ?? r.licitatie_id,
      licitatie_id: r.licitatie_id ?? (t === 'ofertare_licitatii' ? r.id : 103), sha256: hash(r) }))])), storage: structuredClone(storage) })
}
