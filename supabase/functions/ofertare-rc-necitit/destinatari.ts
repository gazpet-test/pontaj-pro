// Destinatarii mailului „RC necitit” (decizia Răzvan 28.10.2026, varianta B; responsabilul 2 opțional din 20261121a):
//   TO = responsabilii licitației (responsabil_id și, dacă există, responsabil2_id → profiles.email), CC = owner-ul principal (doar el);
//   niciun responsabil cu email valid → TO = owner-ul principal, cu „FĂRĂ RESPONSABIL” în subiect și corp.
// Adresele vin DOAR din BD (profiles), niciodată din conținutul documentelor; se acceptă doar @gazpet.ro (și pentru responsabilul 2).
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

// motiv = de ce mailul e „FĂRĂ RESPONSABIL” SAU (cu faraResponsabil=false) avertismentul pentru un responsabil fără email valid
export type Destinatari = { to: string[]; cc: string[]; faraResponsabil: boolean; motiv: string | null; responsabil: string | null }
// review #901 r1 (P2-01): stările legitime ale unui loc de responsabil; „licitația lipsește din citire” NU e aici — e eroare la apelant
export type Responsabil = { stare: 'fara_responsabil' } | { stare: 'profil_lipsa' } | { stare: 'profil'; name?: string | null; email?: string | null }

const descriere = (r: Responsabil): string => r.stare === 'fara_responsabil' ? 'licitația nu are responsabil'
  : r.stare === 'profil_lipsa' ? 'profilul responsabilului nu mai există'
  : `responsabilul${numeCurat(r.name) ? ' (' + numeCurat(r.name) + ')' : ''} nu are email @gazpet.ro valid`

// resp: un element (responsabil 1) sau două (1 + 2); un loc gol de responsabil 2 nu se trimite deloc (nu e „fără responsabil”).
// owner: emailul owner-ului principal CITIT din BD (profiles.is_owner); null → apelantul nu trimite (eroare, revendicarea se eliberează)
export function destinatariLicitatie(resp: Responsabil | Responsabil[], owner: string | null): Destinatari | null {
  const o = emailValid(owner)
  if (!o) return null
  const lista = (Array.isArray(resp) ? resp : [resp])
  const locuri = lista.length ? lista : [{ stare: 'fara_responsabil' } as Responsabil]
  const valizi: { email: string; nume: string | null }[] = []
  const probleme: string[] = []
  for (const r of locuri) {
    const e = r.stare === 'profil' ? emailValid(r.email) : null
    if (e) { if (!valizi.some((v) => v.email === e)) valizi.push({ email: e, nume: r.stare === 'profil' ? numeCurat(r.name) : null }) }
    else if (r.stare !== 'fara_responsabil' || locuri.length === 1) probleme.push(descriere(r))
  }
  if (!valizi.length) {
    const numeInvalizi = locuri.map((r) => r.stare === 'profil' ? numeCurat(r.name) : null).filter(Boolean)
    return { to: [o], cc: [], faraResponsabil: true, motiv: [...new Set(probleme)].join('; ') || descriere(locuri[0]),
      responsabil: numeInvalizi.length ? numeInvalizi.join(' + ') : null }
  }
  const to = valizi.map((v) => v.email)
  const nume = valizi.map((v) => v.nume).filter(Boolean).join(' + ') || null
  return { to, cc: to.includes(o) ? [] : [o], faraResponsabil: false, motiv: probleme.length ? [...new Set(probleme)].join('; ') : null, responsabil: nume }
}
