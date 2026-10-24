import { ziBucuresti } from './izoTeren.js'

export const sesiuneVeche = (s, azi = ziBucuresti()) => Boolean(s && !s.trimisa && (s.stare == null || s.stare === 'deschisa') && s.zi < azi)
// izo_fronturi (LIVE) nu are moment de start: un front e vechi doar când a expirat (expira_la), fără date invalide.
export const frontVechi = (f, acum = new Date()) => {
  const exp = new Date(f?.expira_la)
  return Boolean(f?.activ && !Number.isNaN(exp.getTime()) && exp <= acum)
}

// Niciun ACK pierdut nu se interpretează ca operație neaplicată.
export function abandoneazaCiorneLocale(stare, uid) {
  const s = structuredClone(stare)
  const apartine = o => o.cerere.payload.preverificare_uid === uid || (o.cerere.tip_op === 'sesiune_deschide' && o.cerere.payload.uid === uid)
  const ops = s.ops.filter(apartine)
  if (ops.some(o => o.stare !== 'pe_tableta')) throw Error('Există operații fără ACK. Sincronizează identic înainte de abandon.')
  for (const o of ops) {
    o.abandonata = true; o.stare = 'abandonata_local'
    s.arhiva.push(o)
  }
  s.ops = s.ops.filter(o => !apartine(o))
  return s
}
