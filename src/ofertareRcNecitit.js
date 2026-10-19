// Alerta „răspuns de la autoritate necitit” (d, Răzvan 19.10.2026 — după RC3 Racari, 14.10, stat 5 zile neprocesat).
// Funcție pură: din documentele licitației → ce arată bannerul de pe fișă. Aceeași regulă o va folosi escaladarea zilnică (a).
import { ziRo, zileIntre } from './ofertareTermene.js'

export const TIP_RC = 'raspuns_clarificare'
// fail-closed (review Gemini r1): orice stare care NU e citită integral / ignorată de un om contează ca necitită (neprocesat, in_lucru,
// eroare, lipsă, sau o stare nouă necunoscută); „partial” = citit cu pagini lipsă → semnal separat (portocaliu), chiar fără listă de pagini
export const ST_CITIT = ['procesat', 'ignorat']

// docs: [{ id, nume_original, tip, status_procesare, pagini_necitite, created_at }]; acum: ISO / Date (testabil)
export function rcNecitite(docs, termenDepunere, acum = new Date()) {
  const rc = (docs || []).filter(d => d.tip === TIP_RC)
  const necitite = rc.filter(d => !ST_CITIT.includes(d.status_procesare) && d.status_procesare !== 'partial')
  const partiale = rc.filter(d => d.status_procesare === 'partial')
  if (!necitite.length && !partiale.length) return null
  const azi = ziRo(acum)
  const deLa = necitite.map(d => ziRo(d.created_at)).filter(Boolean).sort()[0] || null
  const termen = ziRo(termenDepunere)
  const tTermen = termenDepunere ? new Date(termenDepunere).getTime() : NaN
  return {
    necitite, partiale,
    deLa,                                               // ziua celui mai vechi răspuns necitit
    zileNecitit: deLa && azi ? zileIntre(deLa, azi) : null,
    zilePanaLaDepunere: termen && azi ? zileIntre(azi, termen) : null,
    // ora exactă (Copilot r1: în ziua depunerii, după ora-limită, zilele calendaristice rămân 0 → „AZI” ar fi fals)
    termenTrecut: Number.isFinite(tTermen) ? tTermen <= new Date(acum).getTime() : false,
    rosu: necitite.length > 0,
  }
}
