// tip.ts — tipul unui document adus de veghe din NoticeDocument/GetAll (clarificări / republicări). Audit Jakarinos #12,
// review PR-C (08.10.2026): ordinea care NU strică anti-bug-ul Răcari (16.09) și nu lasă „alta” să decidă.
import { esteArhiva, tipExplicit } from '../_shared/tipDocument.mjs'

/** Document:
 *   1. tipul documentului ÎNLOCUIT, dacă nu e „alta” — un caiet revizuit rămâne caiet, chiar dacă titlul SEAP spune
 *      „Erata” / „Răspuns” (regula veche, păstrată);
 *   2. clasificatorul comun pe NUMELE FIȘIERULUI (nu pe „titlu — fișier”: titlul canalului ar face din
 *      „Erata nr. 1 — Caiet.pdf” un răspuns); „alta” nu decide (o „Anexa 1.pdf” din răspunsul consolidat rămâne răspuns);
 *   3. altfel exact regula veche: tipul înlocuit („alta”), apoi metadatele SEAP (răspuns la clarificări), apoi „alta”.
 *  Arhivă: regula veche neschimbată (Clarificări / Termene grupează răspunsurile după ea; fișierele din ea primesc tipul lor). */
export function tipRaspuns(numeFisier: string, tipInlocuit: string | null | undefined, eRaspuns: boolean): string {
  if (esteArhiva(numeFisier)) return tipInlocuit || (eRaspuns ? 'raspuns_clarificare' : 'alta')
  if (tipInlocuit && tipInlocuit !== 'alta') return tipInlocuit
  const t = tipExplicit(numeFisier)
  if (t && t !== 'alta') return t
  return tipInlocuit || (eRaspuns ? 'raspuns_clarificare' : 'alta')
}
