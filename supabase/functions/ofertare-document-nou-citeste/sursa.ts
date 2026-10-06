// ofertare-document-nou-citeste/sursa.ts — din ce citește AI-ul și cât așteaptă (Răcari, 06.10.2026).
// „Răspuns consolidat nr. 2” (SCN1179379/00025, 2,7 MB, scanat) a fost trimis întreg ca PDF într-un singur apel: AI-ul a citit
// peste 150 s, gateway-ul a tăiat cu 504 și nu s-a scris nimic (nici eroarea). Acum:
//  - dacă documentul are deja text din citirea pe felii („Procesează” în Documentație, ofertare-ingest-doc), AI-ul citește TEXTUL
//    (rapid, ieftin, fără limita de pagini a PDF-ului);
//  - altfel trimite PDF-ul ca înainte, dar apelul se oprește singur la TIMEOUT_MS, înainte de limita gateway-ului (150 s), și întoarce o
//    eroare de business clară (calea pe felii), în loc de un 504 fără urmă.
export const TIMEOUT_MS = 130_000                 // gateway-ul edge taie la 150 s (504 la 150,1 s pe 06.10); 05.10 o citire reușită a durat 129 s — rămân ~20 s pentru descărcare + scriere
export const TEXT_MIN = 500                       // sub atât, textul extras nu e o citire reală (antet, pagină goală)
export const TEXT_MAX = 400_000                   // plafon de caractere trimise AI-ului din text_extras

export type Sursa = { mod: 'text'; text: string } | { mod: 'pdf' }

// Textul se folosește doar dacă citirea pe felii s-a TERMINAT (procesat): „partial” = pagini lipsă, deci PDF-ul rămâne sursa.
export function alegeSursa(row: { status_procesare?: string | null; text_extras?: string | null }): Sursa {
  const t = String(row?.text_extras || '').trim()
  if (row?.status_procesare === 'procesat' && t.length >= TEXT_MIN) return { mod: 'text', text: t.slice(0, TEXT_MAX) }
  return { mod: 'pdf' }
}

export const MESAJ_TIMEOUT = 'Citirea a depășit timpul (documentul e mare sau scanat). Deschide tab-ul Documentație și apasă ' +
  '«Procesează» pe acest document: îl citește pe felii, fără limită de timp. Apoi apasă din nou «Citește cu AI» — va citi textul extras.'

// Eroarea de rețea a fetch-ului cu AbortSignal.timeout: TimeoutError / AbortError (Deno), indiferent de mesaj.
export const eTimeout = (e: unknown) => {
  const n = (e as { name?: string })?.name
  return n === 'TimeoutError' || n === 'AbortError'
}
