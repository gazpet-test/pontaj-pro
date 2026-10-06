// ofertare-document-nou-citeste/sursa.ts — din ce citește AI-ul și cât așteaptă (Răcari, 06.10.2026).
// „Răspuns consolidat nr. 2” (SCN1179379/00025, 2,7 MB, scanat) a fost trimis întreg ca PDF într-un singur apel: AI-ul a citit
// peste 150 s, gateway-ul a tăiat cu 504 și nu s-a scris nimic (nici eroarea). Acum:
//  - dacă documentul are deja text din citirea pe felii („Procesează” în Documentație, ofertare-ingest-doc), AI-ul citește TEXTUL
//    (rapid, ieftin, fără limita de pagini a PDF-ului);
//  - altfel trimite PDF-ul ca înainte, dar apelul se oprește singur la TIMEOUT_MS, înainte de limita gateway-ului (150 s), și întoarce o
//    eroare de business clară (calea pe felii), în loc de un 504 fără urmă.
export const TIMEOUT_MS = 130_000                 // plafonul apelului AI: 05.10 o citire reușită a durat 129 s; gateway-ul edge taie la 150 s (504 la 150,1 s pe 06.10)
// Copilot 06.10 (P2): termenul se socotește de la INTRAREA în handler, nu de la fetch — descărcarea din Storage, base64-ul și
// query-urile consumă din aceleași 150 s. Apelul AI primește min(TIMEOUT_MS, BUGET_MS − scurs); rămân ~10 s pentru scriere + răspuns.
export const BUGET_MS = 140_000
export const MIN_AI_MS = 15_000                   // sub atât nu mai pornim apelul AI (ar fi tăiat oricum, dar plătit) → direct eroarea de timp
export function timpRamas(t0: number, acum: number): number {
  const r = Math.min(TIMEOUT_MS, BUGET_MS - (acum - t0))
  return r >= MIN_AI_MS ? r : 0
}
export const TEXT_MIN = 500                       // sub atât, textul extras nu e o citire reală (antet, pagină goală)
export const TEXT_MAX = 400_000                   // plafon de caractere trimise AI-ului din text_extras

export type Sursa = { mod: 'text'; text: string; partial: boolean } | { mod: 'pdf' }

// Rezumatul AI scris de scrieCitireNoi în text_extras (25.09: documentul citit aici devine „procesat” cu rezumatul ca text) NU e
// textul documentului — „recitește” pe el ar rezuma rezumatul (review ultracode 06.10, P2). Forma: „DOCUMENT: <nume>\nTip: <tip>…”.
export const eRezumatAi = (t: string) => /^DOCUMENT: [^\n]*\nTip: /.test(t)

// Textul se folosește doar dacă vine din citirea pe felii / extragere reală: „procesat” sau „partial” (paginile lipsă sunt marcate
// în text cu NECITITĂ), cel puțin TEXT_MIN caractere și nu e rezumatul AI de mai sus. Altfel PDF-ul rămâne sursa.
export function alegeSursa(row: { status_procesare?: string | null; text_extras?: string | null }): Sursa {
  const t = String(row?.text_extras || '').trim()
  const st = row?.status_procesare
  if ((st === 'procesat' || st === 'partial') && t.length >= TEXT_MIN && !eRezumatAi(t)) return { mod: 'text', text: t.slice(0, TEXT_MAX), partial: st === 'partial' }
  return { mod: 'pdf' }
}

// Poarta pe cheltuială și pe server (review ultracode 06.10, P2: P1 era reparat doar în UI — un bundle vechi din cache sau un apel
// direct trecea): PDF-ul întreg (apel AI scump, până la 130 s) îl pornește doar ownerul, responsabilul licitației sau rutina internă,
// ca la ofertare-ingest-doc. Rezumatul din textul deja extras rămâne pentru oricine are acces Ofertare.
export function poateCitiPdf(a: { intern: boolean; isOwner?: boolean | null; responsabilId?: string | null; uid?: string | null }): boolean {
  return a.intern || a.isOwner === true || (!!a.responsabilId && a.responsabilId === a.uid)
}
export const MESAJ_POARTA_PDF = 'Documentul nu are încă text extras, iar citirea PDF-ului întreg costă: o pornește doar ownerul sau responsabilul licitației. ' +
  'După ce e citit, rezumatul îl poate face oricine.'

export const MESAJ_TIMEOUT = 'Citirea a depășit timpul (documentul e mare sau scanat). Deschide tab-ul Documentație și apasă ' +
  '«Procesează» pe acest document: îl citește pe felii, fără limită de timp. Apoi apasă din nou «Citește cu AI» — va citi textul extras.'
// Timpul depășit pe TEXT (document foarte lung): „Procesează” n-ar ajuta (e deja citit), deci alt mesaj (review ultracode 06.10, P3).
export const MESAJ_TIMEOUT_TEXT = 'Rezumatul din textul extras a depășit timpul (document foarte lung). Reîncearcă peste un minut; ' +
  'dacă se repetă, deschide documentul original sau textul din Documentație.'
export const mesajTimeout = (mod: Sursa['mod']) => (mod === 'text' ? MESAJ_TIMEOUT_TEXT : MESAJ_TIMEOUT)

// Eroarea de rețea a fetch-ului cu AbortSignal.timeout: TimeoutError / AbortError (Deno), indiferent de mesaj.
export const eTimeout = (e: unknown) => {
  const n = (e as { name?: string })?.name
  return n === 'TimeoutError' || n === 'AbortError'
}
