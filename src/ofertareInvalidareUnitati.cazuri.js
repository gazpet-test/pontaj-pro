// Aceleași intrări și rezultate așteptate pentru Vitest, Deno și PostgreSQL.
export const cazuriUnitatiF2 = ['m', 'km', 'hm'].flatMap(um => {
  const factor = um === 'km' ? 1000 : um === 'hm' ? 100 : 1
  const baza = { status: 'validat', um, cantitate: 1, cantitate_plansa: null }
  return [
    { nume: `${um}: prima observație 1 m`, vechi: baza, patch: { cantitate_plansa: 1 }, invalidat: factor !== 1 },
    { nume: `${um}: prima observație egală fizic`, vechi: baza, patch: { cantitate_plansa: factor }, invalidat: false },
    { nume: `${um}: eliminarea observației 1 m`, vechi: { ...baza, cantitate_plansa: 1 }, patch: { cantitate_plansa: null }, invalidat: factor !== 1 },
    { nume: `${um}: eliminarea observației egale fizic`, vechi: { ...baza, cantitate_plansa: factor }, patch: { cantitate_plansa: null }, invalidat: false },
    { nume: `${um}: cantitatea se compară în unitatea ei`, vechi: { ...baza, cantitate_plansa: factor }, patch: { cantitate: 1.001 }, invalidat: true },
    { nume: `${um}: cantitate necunoscută nu devine zero`, vechi: { ...baza, cantitate: null }, patch: { cantitate_plansa: 0 }, invalidat: true },
    { nume: `${um}: referință aprobată, observație egală fizic`, vechi: { ...baza, um: ` ${um.toUpperCase()} ` }, referinta: baza,
      patch: { cantitate_plansa: factor }, invalidat: false },
    { nume: `${um}: referință aprobată, eliminarea observației egale fizic`, vechi: { ...baza, cantitate_plansa: 2 * factor }, referinta: { ...baza, cantitate_plansa: factor },
      patch: { cantitate_plansa: null }, invalidat: false },
  ]
})
