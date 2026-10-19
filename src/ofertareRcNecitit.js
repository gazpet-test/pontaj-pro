// Alerta „răspuns de la autoritate necitit” (d, Răzvan 19.10.2026 — după RC3 Racari, 14.10, stat 5 zile neprocesat).
// Funcție pură: din documentele licitației → ce arată bannerul de pe fișă. Aceeași regulă o va folosi escaladarea zilnică (a).
import { ziRo, zileIntre } from './ofertareTermene.js'

export const TIP_RC = 'raspuns_clarificare'
// necitit = nu a trecut prin citire; „partial” = citit cu pagini lipsă → semnal separat (portocaliu)
export const ST_NECITIT = ['neprocesat', 'in_lucru', 'eroare']

// docs: [{ id, nume_original, tip, status_procesare, pagini_necitite, created_at }]; acum: ISO / Date (testabil)
export function rcNecitite(docs, termenDepunere, acum = new Date()) {
  const rc = (docs || []).filter(d => d.tip === TIP_RC)
  const necitite = rc.filter(d => ST_NECITIT.includes(d.status_procesare || 'neprocesat'))
  const partiale = rc.filter(d => d.status_procesare === 'partial' && (d.pagini_necitite?.length || 0) > 0)
  if (!necitite.length && !partiale.length) return null
  const azi = ziRo(acum)
  const deLa = necitite.map(d => ziRo(d.created_at)).filter(Boolean).sort()[0] || null
  const termen = ziRo(termenDepunere)
  return {
    necitite, partiale,
    deLa,                                               // ziua celui mai vechi răspuns necitit
    zileNecitit: deLa && azi ? zileIntre(deLa, azi) : null,
    zilePanaLaDepunere: termen && azi ? zileIntre(azi, termen) : null,
    rosu: necitite.length > 0,
  }
}
