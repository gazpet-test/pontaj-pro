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

export type Sursa = { mod: 'text'; text: string; partial: boolean; trunchiat: boolean; lungimeSursa: number } | { mod: 'pdf' }

// Rezumatul AI scris de scrieCitireNoi în text_extras (25.09: documentul citit aici devine „procesat” cu rezumatul ca text) NU e
// textul documentului — „recitește” pe el ar rezuma rezumatul (review ultracode 06.10, P2). Forma: „DOCUMENT: <nume>\nTip: <tip>…”.
export const eRezumatAi = (t: string) => /^DOCUMENT: [^\n]*\nTip: /.test(t)

// Textul se folosește doar dacă vine din citirea pe felii / extragere reală: „procesat” sau „partial” (paginile lipsă sunt marcate
// în text cu NECITITĂ), cel puțin TEXT_MIN caractere și nu e rezumatul AI de mai sus. Altfel PDF-ul rămâne sursa.
// Copilot conv. 3 (06.10, P1): un text peste TEXT_MAX NU se mai taie tăcut — sursa poartă trunchiat + lungimeSursa, AI-ul e anunțat
// în prompt (notaSursa), iar citirea se salvează cu sursa_completa = false (provenanta) și apare în UI ca citire PARȚIALĂ.
export function alegeSursa(row: { status_procesare?: string | null; text_extras?: string | null }): Sursa {
  const t = String(row?.text_extras || '').trim()
  const st = row?.status_procesare
  if ((st === 'procesat' || st === 'partial') && t.length >= TEXT_MIN && !eRezumatAi(t))
    return { mod: 'text', text: t.slice(0, TEXT_MAX), partial: st === 'partial', trunchiat: t.length > TEXT_MAX, lungimeSursa: t.length }
  return { mod: 'pdf' }
}

// Ce i se spune AI-ului despre sursă: incompletitudinea e declarată, nu ascunsă (lipsa dovezii nu devine concluzie negativă).
export function notaSursa(s: Sursa): string {
  if (s.mod !== 'text') return ''
  const n: string[] = []
  if (s.partial) n.push('Unele pagini NU au putut fi citite (marcate „NECITITĂ”) — nu presupune conținutul lor.')
  if (s.trunchiat) n.push(`ATENȚIE: primești doar primele ${s.text.length} din ${s.lungimeSursa} de caractere ale documentului — restul NU ți-a fost trimis. ` +
    'Nu concluziona că o modificare, o întrebare sau un termen lipsește din document; listele tale pot fi incomplete.')
  return n.length ? ' ' + n.join(' ') : ''
}

// Proveniența salvată lângă citire_noi: ce sursă, cât din ea, dacă e completă și de ce nu.
export function provenanta(s: Sursa, sha256: string | null) {
  if (s.mod !== 'text') return { sursa: 'pdf', sursa_completa: true, motive_incomplet: [] as string[], lungime_sursa: null, lungime_folosita: null, sursa_sha256: null }
  const motive: string[] = []
  if (s.partial) motive.push('pagini_necitite')
  if (s.trunchiat) motive.push('trunchiat')
  return { sursa: 'text', sursa_completa: motive.length === 0, motive_incomplet: motive, lungime_sursa: s.lungimeSursa, lungime_folosita: s.text.length, sursa_sha256: sha256 }
}

// Amprenta textului-sursă (SHA-256 hex al text_extras, trim) — scrierea verifică că sursa n-a fost recitită în timpul apelului AI (P2).
export async function amprentaText(t: string | null | undefined): Promise<string> {
  const b = new TextEncoder().encode(String(t || '').trim())
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('')
}
export const MESAJ_SURSA_SCHIMBATA = 'Documentul a fost recitit / reprocesat în timpul citirii cu AI — rezumatul vechi NU s-a salvat. Apasă din nou «Citește cu AI».'

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
