// Proveniența clarificărilor GENERATE (platformă / automat) înainte de a le refolosi ca text într-un prompt plătit —
// 20261025a, review Jakarinos r5 P1 #2 (PR #677). Lipsa PDF-ului NU mai dovedește origine manuală: doar `origine='manual'`
// e text introdus de om (verificat în continuare de apelant pe fisier_path / raspuns_document_id).
// O clarificare generată intră doar dacă, ACUM:
//   - toate documentele din surse_document_ids sunt eligibile;
//   - toate cerințele din surse_cerinte_ids există și trec filtreazaDerivate pe licitația lor (document + lot);
//   - toate cantitățile din surse_cantitati_ids există și trec filtreazaDerivate (cu surse_document_ids, fără „fără provenință”);
//   - pe are_loturi are măcar o sursă (altfel `fara_provenienta`).
// Merge peste licitații (exemplele din alte licitații). Orice eroare de poartă / citire = ok:false (apelantul se oprește).
import { eligibilitateLicitatie, esteEligibil, filtreazaDerivate, participareLicitatie, surseDocumente, type Eligibilitate, type MotivExclus, type Participare } from './eligibilLot.ts'

type Db = Parameters<typeof filtreazaDerivate>[0]
export type ClarSurse = {
  licitatie_id?: number | null; origine?: string | null
  surse_cerinte_ids?: unknown; surse_cantitati_ids?: unknown; surse_document_ids?: unknown
}
export const COLOANE_SURSE = 'licitatie_id, origine, surse_cerinte_ids, surse_cantitati_ids, surse_document_ids'

export async function filtreazaClarificari<T extends ClarSurse>(db: Db, randuri: T[]):
  Promise<{ ok: boolean; pastrate: T[]; excluse: Array<T & MotivExclus> }> {
  const esec = { ok: false, pastrate: [] as T[], excluse: [] as Array<T & MotivExclus> }
  try {
    const generate = randuri.filter((q) => q.origine !== 'manual')
    const lista = (v: unknown) => surseDocumente(v)   // aceeași validare: null = listă stricată
    const cerIds = new Set<number>(), cantIds = new Set<number>(), docIds = new Set<number>()
    for (const q of generate) {
      for (const x of lista(q.surse_cerinte_ids) || []) cerIds.add(x)
      for (const x of lista(q.surse_cantitati_ids) || []) cantIds.add(x)
      for (const x of lista(q.surse_document_ids) || []) docIds.add(x)
    }
    // participarea + harta documentelor eligibile, pe FIECARE licitație implicată: un document-sursă trebuie să fie eligibil
    // în licitația clarificării (review Copilot r2 P1 #2) — un document mutat în altă licitație lipsește din hartă = neeligibil
    const lics = [...new Set(generate.map((q) => Number(q.licitatie_id)).filter((n) => Number.isSafeInteger(n) && n > 0))]
    const part = new Map<number, Participare>(), harti = new Map<number, Map<number, Eligibilitate>>()
    for (const l of lics) {
      const p = await participareLicitatie(db, l)
      if (p.motiv === 'eroare_poarta') return esec
      part.set(l, p)
      if (!p.ok || !docIds.size) continue
      const e = await eligibilitateLicitatie(db, l)
      if (!e.ok) return esec
      harti.set(l, e.harta)
    }
    // cerințele și cantitățile sursă → filtrul pe licitația lor
    const cerOk = new Set<number>(), cantOk = new Set<number>()
    if (cerIds.size) {
      const data = await citesteInLoturi(db, 'ofertare_cerinte', 'id, licitatie_id, sursa_document_id, surse_document_ids, lot, lot_domeniu, lot_nr', [...cerIds])
      if (!data) return esec
      for (const [l, rs] of grupeaza(data)) {
        const f = await filtreazaDerivate(db, l, rs)
        if (!f.ok) { if (f.motiv === 'eroare_poarta') return esec; continue }
        for (const c of f.pastrate) cerOk.add(Number(c.id))
      }
    }
    if (cantIds.size) {
      const data = await citesteInLoturi(db, 'ofertare_cantitati', 'id, licitatie_id, lot_domeniu, lot_nr, surse_document_ids, extras_de_ai', [...cantIds])
      if (!data) return esec
      for (const [l, rs] of grupeaza(data)) {
        const f = await filtreazaDerivate(db, l, rs, { cereSurse: (r: any) => r.extras_de_ai !== false })
        if (!f.ok) { if (f.motiv === 'eroare_poarta') return esec; continue }
        for (const c of f.pastrate) cantOk.add(Number(c.id))
      }
    }
    const pastrate: T[] = [], excluse: Array<T & MotivExclus> = []
    for (const q of randuri) {
      if (q.origine === 'manual') { pastrate.push(q); continue }
      const p = part.get(Number(q.licitatie_id))
      if (!p) { excluse.push({ ...q, motiv: 'licitatie_necunoscuta' }); continue }
      if (!p.ok) { excluse.push({ ...q, motiv: p.motiv }); continue }
      const c = lista(q.surse_cerinte_ids), k = lista(q.surse_cantitati_ids), d = lista(q.surse_document_ids)
      if (c === null || k === null || d === null) { excluse.push({ ...q, motiv: 'surse_invalide' }); continue }
      if (p.stare === 'are_loturi' && !c.length && !k.length && !d.length) { excluse.push({ ...q, motiv: 'fara_provenienta' }); continue }
      // clarificarea AUTOMATĂ din planșe pe are_loturi: sursele ei derivate nu urmăresc textul păstrat (Jakarinos r6 P1 #6,
      // varianta B Răzvan) — exclusă până la PR-ul de rigoare completă (surse salvate odată cu textul în RPC)
      if (p.stare === 'are_loturi' && q.origine === 'automat') { excluse.push({ ...q, motiv: 'automat_pe_loturi' }); continue }
      const harta = harti.get(Number(q.licitatie_id))
      if (d.length && (!harta || !d.every((x) => esteEligibil(harta, x)))) { excluse.push({ ...q, motiv: 'document_blocat' }); continue }
      if (!c.every((x) => cerOk.has(x))) { excluse.push({ ...q, motiv: 'cerinta_exclusa' }); continue }
      if (!k.every((x) => cantOk.has(x))) { excluse.push({ ...q, motiv: 'cantitate_exclusa' }); continue }
      pastrate.push(q)
    }
    return { ok: true, pastrate, excluse }
  } catch (_) {
    return esec
  }
}

// Citire completă după ID-uri (Jakarinos r7 P2): loturi de 500 ID-uri (sub plafonul PostgREST de 1000 rânduri), ordonat;
// orice eroare = null (fail-closed la apelant); se păstrează doar rândurile cu ID-urile cerute.
const LOT_ID = 500
async function citesteInLoturi(db: Db, tabel: string, coloane: string, ids: number[]): Promise<any[] | null> {
  const toate: any[] = []
  for (let i = 0; i < ids.length; i += LOT_ID) {
    const felie = ids.slice(i, i + LOT_ID), cerute = new Set(felie)
    const { data, error } = await (db as any).from(tabel).select(coloane).in('id', felie).order('id', { ascending: true })
    if (error || !Array.isArray(data)) return null
    toate.push(...data.filter((r: any) => cerute.has(Number(r?.id))))
  }
  return toate
}

function grupeaza(rows: any[]): Map<number, any[]> {
  const m = new Map<number, any[]>()
  for (const r of rows) {
    const l = Number(r?.licitatie_id)
    if (!Number.isSafeInteger(l) || l <= 0) continue
    m.set(l, [...(m.get(l) || []), r])
  }
  return m
}
