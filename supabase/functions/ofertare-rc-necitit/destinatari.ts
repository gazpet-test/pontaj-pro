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
// review #901 r1 (P2-02): numele intră doar în corpul HTML (escapat) și în jurnal — oricum fără caractere de control / format / separatori
export const numeCurat = (n: unknown): string | null => {
  const s = String(n ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return s || null
}

export type Destinatari = { to: string[]; cc: string[]; faraResponsabil: boolean; motiv: string | null; responsabil: string | null }
// review #901 r1 (P2-01): cele trei stări legitime; „licitația lipsește din citire” NU e aici — e eroare la apelant (revendicarea se eliberează)
export type Responsabil = { stare: 'fara_responsabil' } | { stare: 'profil_lipsa' } | { stare: 'profil'; name?: string | null; email?: string | null }

// owner: emailul owner-ului principal CITIT din BD (profiles.is_owner); null → apelantul nu trimite (eroare, revendicarea se eliberează)
export function destinatariLicitatie(resp: Responsabil, owner: string | null): Destinatari | null {
  const o = emailValid(owner)
  if (!o) return null
  const fara = (motiv: string, responsabil: string | null = null): Destinatari => ({ to: [o], cc: [], faraResponsabil: true, motiv, responsabil })
  if (resp.stare === 'fara_responsabil') return fara('licitația nu are responsabil')
  if (resp.stare === 'profil_lipsa') return fara('profilul responsabilului nu mai există')
  const nume = numeCurat(resp.name)
  const r = emailValid(resp.email)
  if (!r) return fara(`responsabilul${nume ? ' (' + nume + ')' : ''} nu are email @gazpet.ro valid`, nume)
  return { to: [r], cc: r === o ? [] : [o], faraResponsabil: false, motiv: null, responsabil: nume }
}
