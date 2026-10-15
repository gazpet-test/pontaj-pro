// Regula de tabel + plafonul de ieșire, COMUNE pentru ofertare-ingest-doc (producție) și ofertare-citire-test (proba de modele),
// ca proba să rămână relevantă pentru producție: același text de prompt, același max_tokens pe model.
// 15.10.2026 (proba Haiku 4.5 vs 5.5, 7 documente, felii de 8 pagini):
//  (1) Haiku 5.5 a scris rândurile listei de cantități F3 (doc 1294) FĂRĂ separator („8 TSD02B1 82 SUTE MC 1,11170”),
//      pe altă listă (doc 434) l-a păstrat — inconsecvent. Regula de mai jos e fermă + exemplu + contraexemplu.
//  (2) Felia de 8 pagini s-a tăiat la max_tokens 8000 în 6 din 7 cazuri: tokenizerul Haiku 5.5 numără ~30% mai mulți
//      tokeni pe același text. Plafon 12000 doar pe Haiku 5.5 (limita modelului e 128K; 12000 < ~16K, prag sub care
//      cererea fără streaming nu riscă timeout HTTP). Ceilalți rămân la 8000.

export const REGULA_TABEL = `TABELE (obligatoriu): fiecare rând de tabel pe o singură linie; fiecare celulă separată prin " | " (spațiu, bară verticală, spațiu), INCLUSIV celulele goale (o celulă goală rămâne între separatori: "a |  | c"); păstrează toate coloanele în ordinea lor — NU uni două coloane într-una și NU sări coloane.
Exemplu corect (listă de cantități F3, coloanele Nr | Cod | U/M | Cantitate):
Nr | Cod | U/M | Cantitate
8 | TSD02B1 | 100 mc | 1,11170
INTERZIS (celule lipite doar cu spații, fără " | "):
8 TSD02B1 100 mc 1,11170`

export const MAX_OUT_IMPLICIT = 8000
export const MAX_OUT_PE_MODEL: Record<string, number> = { 'claude-haiku-5-5': 12000 }
export const maxOut = (modelId: string): number => MAX_OUT_PE_MODEL[modelId] ?? MAX_OUT_IMPLICIT
