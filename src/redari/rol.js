import { esteUtilizator as esteUtilizatorCalitate } from './pv.js'
// Aceeași listă canonică pentru filtrul local și PostgREST, înainte de paginare.
export const ROLURI = [
  { cod: 'toti', eticheta: 'Toți' },
  { cod: 'proprietar', eticheta: 'Proprietari' },
  { cod: 'utilizator', eticheta: 'Utilizatori / arendași' },
]
const CALITATI_ROL = {
  proprietar: ['proprietar', 'coproprietar', 'mostenitor', 'neidentificat'],
  utilizator: ['utilizator', 'arendas'],
}
export const esteUtilizator = d => esteUtilizatorCalitate(d?.calitate)
export function calitatiRol(rol = 'toti') {
  if (rol === 'toti') return null
  if (!Object.hasOwn(CALITATI_ROL, rol)) throw new Error('Rol necunoscut.')
  return CALITATI_ROL[rol]
}
export function potrivesteRol(d, rol = 'toti') {
  const calitati = calitatiRol(rol)
  return calitati === null || calitati.includes(d?.calitate)
}
export function aplicaRol(q, rol = 'toti') {
  const calitati = calitatiRol(rol)
  return calitati === null ? q : q.in('calitate', calitati)
}
