// deno-lint-ignore-file no-explicit-any
// ofertare-document-nou-citeste/lucru.ts — starea rezumatului pe felii, păstrată pe server în analiza.citire_noi_lucru (06.10.2026).
// { rev, sha (SHA-256 al textului-sursă), n (felii), la (pozițiile tăieturilor), inceput_la, citit_de, parti: { "<i>": Parte } }. Fiecare
// apel adaugă o felie; la un text schimbat sau tăiat altfel (alt sha / n / la — ex. altă versiune a împărțirii) se reia de la zero. Scrierea e compare-and-set pe DOUĂ revizii: citire_ai.rev (cheile
// serverului de planșe, ca la scrieCitireNoi) și citire_noi_lucru.rev (alt apel a avansat între timp → conflict, nimic suprascris).
import type { Parte } from './felii.ts'
export type Lucru = { rev: string; sha: string; n: number; la?: string; inceput_la: string; citit_de: string | null; parti: Record<string, Parte> }

// Starea validă pentru textul curent, sau una nouă (fără parti) dacă lipsește / e pentru alt text.
export function lucruPentru(existent: any, sha: string, n: number, inceputLa: string, cititDe: string | null, la = ''): { lucru: Lucru; reluat: boolean } {
  const ok = existent && typeof existent === 'object' && existent.sha === sha && existent.n === n && (existent.la ?? '') === la &&
    existent.parti && typeof existent.parti === 'object'
  if (ok) return { lucru: existent as Lucru, reluat: true }
  return { lucru: { rev: '', sha, n, la, inceput_la: inceputLa, citit_de: cititDe, parti: {} }, reluat: false }
}
export const urmatoareaFelie = (l: Lucru) => { for (let i = 0; i < l.n; i++) if (!l.parti[String(i)]) return i; return -1 }

// revVazut = citire_noi_lucru.rev la începutul apelului (null dacă nu exista). Întoarce conflict dacă altcineva a scris între timp.
export async function scrieLucru(db: any, id: number, revVazut: string | null, nou: Lucru): Promise<{ scris: boolean; conflict?: boolean; upErr?: any }> {
  for (let incercare = 0; incercare < 3; incercare++) {
    const { data: cur } = await db.from('ofertare_documente_atribuire').select('analiza').eq('id', id).maybeSingle()
    const baza = cur?.analiza && typeof cur.analiza === 'object' ? cur.analiza : {}
    const revAcum = baza?.citire_noi_lucru?.rev ?? null
    if ((revAcum || null) !== (revVazut || null)) return { scris: false, conflict: true }
    const revAi = baza?.citire_ai?.rev ?? null
    let q = db.from('ofertare_documente_atribuire').update({ analiza: { ...baza, citire_noi_lucru: nou } }).eq('id', id)
    q = revAi == null ? q.is('analiza->citire_ai->>rev', null) : q.eq('analiza->citire_ai->>rev', String(revAi))
    q = revVazut ? q.eq('analiza->citire_noi_lucru->>rev', revVazut) : q.is('analiza->citire_noi_lucru->>rev', null)
    const { data: w, error } = await q.select('id')
    if (error) return { scris: false, upErr: error }
    if ((w || []).length === 1) return { scris: true }
  }
  return { scris: false, conflict: true }
}
