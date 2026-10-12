// Loturile în ofertare-raspuns-set (MVP loturi 20261024b) — logica pură, testată în loturi_test.ts (index.ts pornește
// serverul la import, deci nu se poate testa direct). Mulțimi de ÎNTREGI din parseLot, niciodată substring de text.
//   - setul fără lot (sau „toate”) = comportamentul vechi: tot registrul, fără marcaje;
//   - setul cu lot neinterpretabil = refuz (fail-closed), nu „tot registrul”;
//   - cerința „lista” intră doar dacă se intersectează cu lotul setului; „toate” intră;
//   - cerința „necunoscut” NU e eligibilă automat: intră în registru MARCATĂ, iar orice operație pe ea iese cu
//     necesita_revizuire=true (UI-ul nu o bifează la „Selectează toate”) și e raportată în răspuns.
import { eligibilaPeLot, lotRand, parseLot } from '../_shared/lot.ts'
export { lotRand }

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

// Documentele din care provine coada deschisă. `coada_doc_id` (r4, un singur id) putea fi deja o coadă lipită A→B cu doar B
// reținut (Jakarinos r6 P1 #1): pe are_loturi forma veche = [] (neverificabilă, omisă); pe fara_loturi se citește ca [id].
// O listă coada_doc_ids cu un element nevalid = [] (neverificabilă).
export function surseCoada(prop: any, areLoturi = false): number[] {
  if (areLoturi && prop?.coada_incompleta === true) return []   // marcaj moștenit: nu intră la AI pe loturi (Jakarinos r9 P1 #1)
  if (Array.isArray(prop?.coada_doc_ids)) {
    const valide = prop.coada_doc_ids.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0)
    return valide.length === prop.coada_doc_ids.length ? iduri(valide) : []
  }
  if (areLoturi) return []
  return prop?.coada_doc_id == null ? [] : iduri([prop.coada_doc_id])
}

// Sursele unei dispoziții noi = documentul curent ∪ sursele cozii folosite în prompt (goală dacă coada a fost omisă).
export function surseNoi(docId: number, coadaFolosita: number[]): number[] {
  return iduri([...coadaFolosita, docId])
}

// Sursele de verificat la reutilizarea unei dispoziții: `doc_ids` dacă există. Dispoziție veche (fără doc_ids): pe
// are_loturi = null (fără proveniență verificabilă — putea conține o coadă din alt document), altfel [doc_id] ca înainte.
export function surseDispozitie(x: any, areLoturi: boolean): number[] | null {
  if (areLoturi && x?.surse_incomplete === true) return null   // coadă veche moștenită (Jakarinos r8 P1 #1)
  if (Array.isArray(x?.doc_ids) && x.doc_ids.length) {
    const valide = x.doc_ids.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0)
    return valide.length === x.doc_ids.length ? iduri(valide) : null   // un id stricat = proveniență neverificabilă
  }
  if (areLoturi) return null
  return x?.doc_id == null ? null : iduri([x.doc_id])
}

// Sursele unei OPERAȚII (Jakarinos r6 P1 #2): sursele dispoziției ∪ documentul cerinței-țintă (la modifica / anuleaza textul
// rezultat pornește de la ea). null = dispoziție fără proveniență verificabilă.
export function surseOperatie(surseDisp: number[] | null, docCerinta: number | null | undefined): number[] | null {
  if (surseDisp === null) return null
  return iduri([...surseDisp, ...(docCerinta == null ? [] : [docCerinta])]).sort((x, y) => x - y)
}
// Proveniența COMPLETĂ a unei dispoziții (Jakarinos r8 P1 #1): listă doc_ids validă și nemarcată incompletă. Fallback-ul de
// compatibilitate ([doc_id] pe fara_loturi) NU certifică surse complete: operațiile din el nu se aplică ulterior pe are_loturi.
export function provenientaCompleta(x: any): boolean {
  if (x?.surse_incomplete === true || !Array.isArray(x?.doc_ids) || !x.doc_ids.length) return false
  return x.doc_ids.every((n: unknown) => Number.isSafeInteger(Number(n)) && Number(n) > 0)
}
// Coada e incompletă dacă vine în forma veche (doar coada_doc_id) sau a moștenit deja marcajul.
export function coadaIncompleta(prop: any): boolean {
  return prop?.coada_incompleta === true || (!!prop?.coada_deschisa && !Array.isArray(prop?.coada_doc_ids))
}
// Domeniul operației trebuie să acopere TOT domeniul cerinței-țintă (Jakarinos r10 P1): RPC-ul modifică / anulează cerința
// întreagă (îi păstrează lotul) — o dispoziție pe lotul 2 aplicată unei cerințe comune („toate” = toată participarea) ar schimba
// și lotul 1. Ținta „toate” se citește ca toată participarea; necunoscut = neacoperit. Acoperire parțială = la om.
export function domeniuAcoperit(lotOp: { domeniu: string; loturi: number[] }, lotTinta: { domeniu: string; loturi: number[] },
  participam: number[]): boolean {
  if (lotTinta.domeniu === 'necunoscut' || lotOp.domeniu === 'necunoscut') return false
  const tinta = lotTinta.domeniu === 'toate' ? participam : lotTinta.loturi
  const op = lotOp.domeniu === 'toate' ? participam : lotOp.loturi
  return tinta.length > 0 && tinta.every((n) => op.includes(n))
}
// Domeniul documentului-sursă (Jakarinos r11 P1 #1): document alocat pe loturi → lista lui; comun → null (fără restricție);
// altă stare → [] (nimic). Operația generală dintr-un document alocat pe lotul 2 e doar pe lotul 2, nu pe toată participarea.
export function restrangeLaDocument(lotOpLoturi: number[], domDoc: number[] | null): number[] {
  return domDoc === null ? lotOpLoturi : lotOpLoturi.filter((n) => domDoc.includes(n))
}

// Reverificarea UNEI operații existente (compara pe toate ramurile + aplica) — Jakarinos r10/r11. null = aplicabilă, altfel motivul.
//  - proveniență completă și exact o sursă;
//  - ținta (modifica/anuleaza): există, sursa ei actuală e în proveniența operației, amprenta nu s-a schimbat de la analiză;
//  - pe are_loturi: lotul operației ⊆ domeniul documentului-sursă, iar operația acoperă tot domeniul țintei.
export type CtxOperatii = {
  peLoturi: boolean; participam: number[]
  cerinte: Map<number, any>                      // ținte, citite acum
  domDoc: Map<number, number[] | null>          // domeniul documentelor-sursă, citit acum
  amprenteOperatie?: Record<string, string>     // amprentele cu care a fost generată operația (dacă se pot compara)
  amprenteAcum?: Record<string, string>
}
export function motivOperatie(o: any, ctx: CtxOperatii): string | null {
  if (o?.surse_complete !== true || !provenientaUnica(o?.surse_doc_ids)) return 'fara_provenienta_unica'
  const doc = Number(o.surse_doc_ids[0])
  if (o.cerinta_id != null) {
    const t = ctx.cerinte.get(Number(o.cerinta_id))
    if (!t) return 'tinta_lipsa'
    if (t.sursa_document_id != null && Number(t.sursa_document_id) !== doc) return 'tinta_sursa_schimbata'
    const k = String(o.cerinta_id)
    if (ctx.amprenteOperatie && ctx.amprenteAcum && ctx.amprenteOperatie[k] !== undefined
        && ctx.amprenteOperatie[k] !== ctx.amprenteAcum[k]) return 'tinta_schimbata'
  }
  if (ctx.peLoturi) {
    if (!ctx.domDoc.has(doc)) return 'domeniu_document_necunoscut'
    const l = lotRand(o)
    if (l.domeniu !== 'lista' || !l.loturi.length) return 'lot_' + l.domeniu
    const dd = ctx.domDoc.get(doc) as number[] | null
    if (dd !== null && !l.loturi.every((n) => dd.includes(n))) return 'domeniu_document'
    if (!l.loturi.every((n) => ctx.participam.includes(n))) return 'lot_in_afara_participarii'
    if (o.cerinta_id != null && !domeniuAcoperit(l, lotRand(ctx.cerinte.get(Number(o.cerinta_id))), ctx.participam)) return 'domeniu_partial'
  }
  return null
}
// RPC-ul de aplicare scrie UN singur sursa_document_id pe cerință: aplicabil (pe are_loturi) doar cu exact o sursă.
export function provenientaUnica(surse: unknown): boolean {
  return Array.isArray(surse) && surse.length === 1 && Number.isSafeInteger(Number(surse[0])) && Number(surse[0]) > 0
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
