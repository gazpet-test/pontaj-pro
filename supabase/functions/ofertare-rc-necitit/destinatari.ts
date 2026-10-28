// Destinatarii mailului „RC necitit” (decizia Răzvan 28.10.2026, varianta B):
//   TO = responsabilul licitației (ofertare_licitatii.responsabil_id → profiles.email), CC = owner-ul principal (doar el, nu toți ownerii);
//   fără responsabil / fără email valid → TO = owner-ul principal, cu „FĂRĂ RESPONSABIL” în subiect și corp.
// Adresele vin DOAR din BD (profiles), niciodată din conținutul documentelor; se acceptă doar @gazpet.ro.
export const OWNER_PRINCIPAL = 'razvan.trusu@gazpet.ro'
const RE_GAZPET = /^[^@\s<>,;"']+@gazpet\.ro$/i

export const emailValid = (e: unknown): string | null => {
  const s = String(e ?? '').trim().toLowerCase()
  return RE_GAZPET.test(s) ? s : null
}

export type Destinatari = { to: string[]; cc: string[]; faraResponsabil: boolean; motiv: string | null; responsabil: string | null }

// owner: emailul owner-ului principal CITIT din BD (profiles.is_owner); null → apelantul nu trimite (eroare, revendicarea se eliberează)
export function destinatariLicitatie(resp: { name?: string | null; email?: string | null } | null, owner: string | null): Destinatari | null {
  const o = emailValid(owner)
  if (!o) return null
  const nume = resp?.name ? String(resp.name).replace(/[\r\n]+/g, ' ').trim().slice(0, 80) : null
  if (!resp) return { to: [o], cc: [], faraResponsabil: true, motiv: 'licitația nu are responsabil', responsabil: null }
  const r = emailValid(resp.email)
  if (!r) return { to: [o], cc: [], faraResponsabil: true, motiv: `responsabilul${nume ? ' (' + nume + ')' : ''} nu are email @gazpet.ro valid`, responsabil: nume }
  return { to: [r], cc: r === o ? [] : [o], faraResponsabil: false, motiv: null, responsabil: nume }
}
