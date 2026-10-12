// Loturile în ofertare-raspuns-set (MVP loturi 20261024b) — logica pură, testată în loturi_test.ts (index.ts pornește
// serverul la import, deci nu se poate testa direct). Mulțimi de ÎNTREGI din parseLot, niciodată substring de text.
//   - setul fără lot (sau „toate”) = comportamentul vechi: tot registrul, fără marcaje;
//   - setul cu lot neinterpretabil = refuz (fail-closed), nu „tot registrul”;
//   - cerința „lista” intră doar dacă se intersectează cu lotul setului; „toate” intră;
//   - cerința „necunoscut” NU e eligibilă automat: intră în registru MARCATĂ, iar orice operație pe ea iese cu
//     necesita_revizuire=true (UI-ul nu o bifează la „Selectează toate”) și e raportată în răspuns.
import { eligibilaPeLot, lotRand, parseLot } from '../_shared/lot.ts'

export type RandLot = { id: number; lot?: string | null; lot_domeniu?: string | null; lot_nr?: unknown }

export function selectieSet(lotSet: string | null | undefined): { ok: true; selectie: number[] | null } | { ok: false; eroare: string } {
  const brut = String(lotSet ?? '').trim()
  if (!brut) return { ok: true, selectie: null }
  const p = parseLot(brut)
  if (p.domeniu === 'toate') return { ok: true, selectie: null }
  if (p.domeniu === 'lista') return { ok: true, selectie: p.loturi }
  return { ok: false, eroare: `lotul setului („${brut.slice(0, 40)}”) nu se poate interpreta — corectează-l (ex. „2”, „1,3”, „toate”) sau lasă-l gol` }
}

export function filtreazaRegistru<T extends RandLot>(cer: T[], lotSet: string | null | undefined):
  { ok: true; eligibile: T[]; lotNecunoscut: Set<number>; excluse: number } | { ok: false; eroare: string } {
  const sel = selectieSet(lotSet)
  if (!sel.ok) return sel
  if (sel.selectie === null) return { ok: true, eligibile: [...cer], lotNecunoscut: new Set(), excluse: 0 }
  const eligibile: T[] = [], lotNecunoscut = new Set<number>()
  for (const c of cer) {
    const l = lotRand(c)
    if (eligibilaPeLot(l, sel.selectie)) eligibile.push(c)
    else if (l.domeniu === 'necunoscut') { eligibile.push(c); lotNecunoscut.add(Number(c.id)) }
  }
  return { ok: true, eligibile, lotNecunoscut, excluse: cer.length - eligibile.length }
}

// Lotul operației pe selecția EFECTIVĂ (set ∩ participare, review Jakarinos r4 P1 #1): dispoziția cu loturi numite → doar
// loturile ei din selecție (participăm 1+2, dispoziția e pe 2 → „2”, nu „1,2”); dispoziția generală / „toate” → toată
// selecția; selecție null (fara_loturi, set fără lot) → regula veche (lotul setului, altfel al dispoziției).
export function lotOperatieSelectie(selEf: number[] | null, lotSet: string | null | undefined, loturiDisp: unknown) {
  if (selEf === null) return lotOperatie(lotSet, loturiDisp)
  const brut = (Array.isArray(loturiDisp) ? loturiDisp : []).map(String).filter((s) => s.trim())
  const l = brut.length ? parseLot(brut.join(',')) : null
  if (l?.domeniu === 'lista') {
    const x = l.loturi.filter((n) => selEf.includes(n))
    if (x.length) return lotOperatie(x.join(','), null)
  }
  return lotOperatie(selEf.join(','), null)
}

// Proveniența cozii și a dispozițiilor (review Jakarinos r5 P1 #1, PR #677): coada lipită A→B conține text din A, deci
// dispozițiile rezultate și coada care merge mai departe poartă TOATE documentele contributoare, nu doar documentul curent.
const iduri = (xs: unknown[]) => [...new Set(xs.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))]

// Documentele din care provine coada deschisă. `coada_doc_id` (r4, un singur id) se citește ca [id]; fără niciuna = [].
export function surseCoada(prop: any): number[] {
  if (Array.isArray(prop?.coada_doc_ids)) return iduri(prop.coada_doc_ids)
  return prop?.coada_doc_id == null ? [] : iduri([prop.coada_doc_id])
}

// Sursele unei dispoziții noi = documentul curent ∪ sursele cozii folosite în prompt (goală dacă coada a fost omisă).
export function surseNoi(docId: number, coadaFolosita: number[]): number[] {
  return iduri([...coadaFolosita, docId])
}

// Sursele de verificat la reutilizarea unei dispoziții: `doc_ids` dacă există. Dispoziție veche (fără doc_ids): pe
// are_loturi = null (fără proveniență verificabilă — putea conține o coadă din alt document), altfel [doc_id] ca înainte.
export function surseDispozitie(x: any, areLoturi: boolean): number[] | null {
  if (Array.isArray(x?.doc_ids) && x.doc_ids.length) {
    const valide = x.doc_ids.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0)
    return valide.length === x.doc_ids.length ? iduri(valide) : null   // un id stricat = proveniență neverificabilă
  }
  if (areLoturi) return null
  return x?.doc_id == null ? null : iduri([x.doc_id])
}

// Lotul unei operații: al setului, altfel al dispoziției-sursă (audit R03). `lot` (text, citit de RPC-ul de aplicare)
// devine forma canonică „2” / „1,3” când se poate interpreta; altfel rămâne textul brut, ca înainte.
export function lotOperatie(lotSet: string | null | undefined, loturiDispozitie: unknown):
  { lot: string | null; lot_domeniu: string | null; lot_nr: number[] | null } {
  const dinSet = String(lotSet ?? '').trim()
  const dinDisp = Array.isArray(loturiDispozitie) && loturiDispozitie.length ? loturiDispozitie.map(String).join(',') : ''
  const brut = dinSet || dinDisp
  if (!brut) return { lot: null, lot_domeniu: null, lot_nr: null }
  const p = parseLot(brut)
  if (p.domeniu === 'lista') return { lot: p.loturi.join(','), lot_domeniu: 'lista', lot_nr: p.loturi }
  if (p.domeniu === 'toate') return { lot: 'toate', lot_domeniu: 'toate', lot_nr: null }
  return { lot: brut, lot_domeniu: 'necunoscut', lot_nr: null }
}
