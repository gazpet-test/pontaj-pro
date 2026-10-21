// Alerta „răspuns de la autoritate necitit” (d, Răzvan 19.10.2026 — după RC3 Racari, 14.10, stat 5 zile neprocesat).
// Funcție pură: din stările documentelor licitației → ce arată bannerul de pe fișă.
// 20261104a (Răzvan 21.10.2026, „hai să reparăm alerta”): starea per document NU se mai calculează aici — vine din RPC-ul ofertare_rc_stari,
// care folosește ACEEAȘI funcție SQL (ofertare_rc_doc_stare) ca alerta zilnică (cron + mail): o singură regulă pentru banner și alertă.
import { ziRo, zileIntre } from './ofertareTermene.js'

export const TIP_RC = 'raspuns_clarificare'
// stările întoarse de ofertare_rc_doc_stare (precedența e în SQL): citit / text_neverificat / partial / perechi_necitite / necitit
// în roșu (și în alerta zilnică): necitit, perechi_necitite, text_neverificat; „partial” = semnal separat (portocaliu)
export const STARI_ROSU = ['necitit', 'perechi_necitite', 'text_neverificat']
// fail-closed: o stare lipsă sau necunoscută (ex. o stare nouă în SQL, încă nemapată aici) contează ca necitită
const esteRosu = (s) => s !== 'citit' && s !== 'partial'
export const ETICHETA_STARE = {
  perechi_necitite: 'perechile întrebare – răspuns necitite',
  text_neverificat: 'text OCR local neverificat',
}

// docs: [{ id, nume_original, created_at, stare }] (rândurile RPC-ului ofertare_rc_stari); acum: ISO / Date (testabil)
export function rcNecitite(docs, termenDepunere, acum = new Date()) {
  const rc = docs || []
  const necitite = rc.filter(d => esteRosu(d.stare))
  const partiale = rc.filter(d => d.stare === 'partial')
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
    // termen doar cu dată („2026-10-26”, review Gemini r2): trecut abia din ziua următoare (pe ora României), nu de la miezul nopții UTC
    termenTrecut: /^\d{4}-\d{2}-\d{2}$/.test(String(termenDepunere || '')) ? (azi != null && termen != null && azi > termen)
      : Number.isFinite(tTermen) ? tTermen <= new Date(acum).getTime() : false,
    rosu: necitite.length > 0,
  }
}

// eticheta unui document în banner: numele + motivul, când nu e „necitit” simplu
export const etichetaRc = (d) => `${d.nume_original || `#${d.id}`}${ETICHETA_STARE[d.stare] ? ` (${ETICHETA_STARE[d.stare]})` : ''}`
