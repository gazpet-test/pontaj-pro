// juridic#021 pct. 5: AR semnat de altă persoană — convocările rămân „AR primit”, cu mențiunea vizibilă în registru și în PV B.
// Mențiunea stă pe plic (ar_primit_de / ar_mentiune); se atașează convocărilor din plic la citire.
export const COL_PLIC_AR = 'id,ar_primit_de,ar_mentiune'
const PREFIX = ' (primit de altă persoană'

export function atasezaMentiuniAr(convocari = [], plicuri = []) {
  const pe = new Map(plicuri.map(p => [p.id, p]))
  return convocari.map(c => {
    const p = c?.plic_id ? pe.get(c.plic_id) : null
    return p?.ar_primit_de === 'alta_persoana' ? { ...c, ar_alta_persoana: String(p.ar_mentiune ?? '').trim() || 'fără mențiune' } : c
  })
}

// Textul adăugat după data confirmării; varianta scurtă (fără textul liber de pe cartonaș) e pentru exporturile către TGZ.
export const mentiuneAr = (conv, { detaliat = true } = {}) =>
  conv?.ar_alta_persoana ? (detaliat ? `${PREFIX}: ${conv.ar_alta_persoana})` : `${PREFIX})`) : ''

export const scurteazaMentiuneAr = v => typeof v === 'string' && v.includes(`${PREFIX}: `) ? v.slice(0, v.indexOf(`${PREFIX}: `)) + `${PREFIX})` : v
