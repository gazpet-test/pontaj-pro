// TKT-0329 A, PR-extragere (Task 7): pasul de comparație a cantităților între documente, la finalul fiecărei rulări `structurat`
// (spec §3.8, planul 2026-11-25-ofertare-cantitati-intre-surse, deciziile 2, 8, 15, 17, 18). Zero apeluri AI (DepsMasuratori nu are `ai`);
// edge-ul nu clasifică, nu alege observații, nu verifică dovezi — totul e în SQL (20270112a, L19). Edge-ul doar:
//   (1) citește fotografia surselor (fn_ofertare_semnale_fotografie);
//   (2) cere contextul fiecărui document CITIT (fn_ofertare_semnale_context, legat de sha-ul fotografiei) și îl verifică local (sha text,
//       decizii_sha, nume, tip) — orice nepotrivire = `context_nepotrivit`, nimic propus;
//   (3) citește feliile logice ale extragerilor din fotografie (fn_ofertare_semnale_felii, keyset, ≤ 200 / pagină) până la pagina goală
//       și verifică numărul primit = Σ felii_distincte (altfel `felii_trunchiate`, L23); completitudineFelii pe TOATE (inclusiv cache);
//   (4) inventarul paginilor rulării (paginiRulare); (5) fn_ofertare_masuratori_propune cu un token nou; (6) fn_ofertare_semnale_publica.
// Nicio reîncercare; orice eroare / refuz de RPC = raport cu `eroare` (L05: nu se reia singur; o evaluare rămasă `in_curs` e marcată
// `depasita` de următoarea propunere). Contextul rulării (deps.documente / deciziiRol, citite mai devreme) NU se folosește aici.
import { completitudineFelii, type Context, eFotografie, type FelieIncompleta, type FelieServita, type Fotografie, type PaginiDocument, type PaginiRulare,
  paginiRulare, rezumatSemnale, type RezumatSemnale, verificaContext } from '../_shared/cantMasura.ts'

export type DepsMasuratori = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }> }
export type RaportMasuratori = {
  ok: boolean
  eroare?: string            // codul erorii (context_nepotrivit, felii_trunchiate, felii_ordine, 'fotografie: …', 'propune: …', 'publica: …', 'exceptie: …')
  detalii?: string
  evaluare_depasita?: boolean
  fotografie_sha?: string
  evaluare_id?: number
  felii: number              // feliile logice verificate (toate extragerile din fotografie, inclusiv cache)
  pagini?: PaginiRulare
  rezumat?: RezumatSemnale
  semnale?: unknown[]
  ignorate?: unknown[]
}
export const LIMITA_FELII = 200
const PAGINI_MAX_KEYSET = 100000   // gardă împotriva unei bucle fără sfârșit la un server care nu avansează keyset-ul

const mesaj = (e: unknown) => String((e as { message?: unknown })?.message ?? e ?? 'necunoscut').slice(0, 300)

// p.eligibile = documentele pe care rularea le-ar fi extras (ultimele versiuni ale tipurilor eligibile); fără ele, orice document fără extragere
// gata e „necitit” (conservator)
export async function comparaSurse(deps: DepsMasuratori, p: { licitatie_id: number; cerere_id?: number; stareExtrageri: Map<number, string>; paginiPestePlafon: PaginiDocument[];
  eligibile?: Set<number> | null; limita_felii?: number }): Promise<RaportMasuratori> {
  const r: RaportMasuratori = { ok: false, felii: 0 }
  const limita = Math.min(Math.max(Number(p.limita_felii) || LIMITA_FELII, 1), LIMITA_FELII)
  try {
    // (1) fotografia surselor
    const fo = await deps.rpc('fn_ofertare_semnale_fotografie', { p_licitatie_id: p.licitatie_id })
    if (fo.error) return { ...r, eroare: 'fotografie: ' + mesaj(fo.error) }
    if (!eFotografie(fo.data)) return { ...r, eroare: 'fotografie: răspuns fără forma fotografiei' }
    const foto: Fotografie = fo.data
    r.fotografie_sha = foto.sha
    // (2) contextul documentelor CITITE (cu extragere autoritativă — doar ele au felii), legat de fotografie
    const citite = foto.documente.filter((d) => d.extragere_id !== null && d.extragere_id !== undefined)
    const contexte = new Map<number, Context>()
    for (const d of citite) {
      const cx = await deps.rpc('fn_ofertare_semnale_context', { p_licitatie_id: p.licitatie_id, p_fotografie_sha: foto.sha, p_document_id: d.id })
      if (cx.error) return { ...r, eroare: 'context: ' + mesaj(cx.error), detalii: 'document ' + d.id }
      if (!cx.data || typeof cx.data !== 'object' || cx.data.refuz) return { ...r, eroare: 'context_nepotrivit', detalii: `document ${d.id}: ${cx.data?.refuz ?? 'răspuns gol'}` }
      if (!(await verificaContext(cx.data as Context, d))) return { ...r, eroare: 'context_nepotrivit', detalii: `document ${d.id}: textul / deciziile / numele / tipul nu sunt cele din fotografie` }
      contexte.set(Number(d.id), cx.data as Context)
    }
    // (3) feliile logice ale extragerilor din fotografie, keyset până la pagina goală
    const extrageri = citite.map((d) => Number(d.extragere_id))
    const asteptate = citite.reduce((s, d) => s + (Number(d.felii_distincte) || 0), 0)
    const felii: FelieServita[] = []
    if (extrageri.length) {
      let dupaE: number | null = null, dupaF: number | null = null, pagini = 0
      for (;;) {
        if (++pagini > PAGINI_MAX_KEYSET) return { ...r, eroare: 'felii_ordine', detalii: 'prea multe pagini keyset' }
        const fe = await deps.rpc('fn_ofertare_semnale_felii', { p_licitatie_id: p.licitatie_id, p_extrageri: extrageri, p_dupa_extragere: dupaE, p_dupa_felie: dupaF, p_limita: limita })
        if (fe.error) return { ...r, eroare: 'felii: ' + mesaj(fe.error) }
        if (!Array.isArray(fe.data)) return { ...r, eroare: 'felii: răspuns fără listă' }
        if (!fe.data.length) break
        for (const x of fe.data as FelieServita[]) {
          const e = Number(x?.extragere_id), n = Number(x?.felie_nr)
          if (!Number.isFinite(e) || !Number.isFinite(n)) return { ...r, eroare: 'felii_ordine', detalii: 'rând fără extragere_id / felie_nr' }
          // keyset strict crescător pe (extragere_id, felie_nr): altfel serverul nu răspunde contractului (dubluri / ordine) și nu propunem nimic
          if (dupaE !== null && !(e > dupaE || (e === dupaE && n > (dupaF as number)))) return { ...r, eroare: 'felii_ordine', detalii: `(${e}, ${n}) după (${dupaE}, ${dupaF})` }
          dupaE = e; dupaF = n
          felii.push(x)
        }
        if (felii.length > asteptate) break   // mai multe decât spune fotografia: tot trunchiere / nepotrivire (verificat mai jos)
      }
    }
    r.felii = felii.length
    if (felii.length !== asteptate) return { ...r, eroare: 'felii_trunchiate', detalii: `primite ${felii.length}, așteptate ${asteptate}` }
    const incomplete: FelieIncompleta[] = completitudineFelii(felii, contexte)
    // (4) inventarul paginilor rulării (documente necitite, pagini necitite / peste plafon, felii incomplete)
    const pagini = paginiRulare(foto, p.stareExtrageri, incomplete, p.paginiPestePlafon, p.eligibile ?? null)
    r.pagini = pagini
    // (5) propunerea — un token nou pe evaluare (UNIQUE în BD); fotografia pe care am lucrat
    const token = crypto.randomUUID()
    const pr = await deps.rpc('fn_ofertare_masuratori_propune', { p_licitatie_id: p.licitatie_id, p_token: token, p_fotografie: foto, p_pagini: pagini })
    if (pr.error) return { ...r, eroare: 'propune: ' + mesaj(pr.error) }
    if (pr.data?.refuz === 'evaluare_depasita') return { ...r, evaluare_depasita: true, detalii: 'fotografia s-a schimbat în timpul rulării; evaluarea se reia la rularea următoare' }
    if (pr.data?.refuz || !Number.isFinite(Number(pr.data?.evaluare_id))) return { ...r, eroare: 'propune: ' + String(pr.data?.refuz ?? 'răspuns fără evaluare_id') }
    r.evaluare_id = Number(pr.data.evaluare_id)
    r.ignorate = Array.isArray(pr.data.ignorate) ? pr.data.ignorate : []
    // (6) publicarea atomică (inventar, agregare, verdict, semnal, ciornă) — pe server
    const pu = await deps.rpc('fn_ofertare_semnale_publica', { p_licitatie_id: p.licitatie_id, p_evaluare_id: r.evaluare_id, p_token: token })
    if (pu.error) return { ...r, eroare: 'publica: ' + mesaj(pu.error) }
    if (pu.data?.refuz === 'evaluare_depasita') return { ...r, evaluare_depasita: true, detalii: 'fotografia s-a schimbat între propunere și publicare' }
    if (pu.data?.refuz || !pu.data || typeof pu.data !== 'object') return { ...r, eroare: 'publica: ' + String(pu.data?.refuz ?? 'răspuns gol') }
    return { ...r, ok: true, rezumat: rezumatSemnale(pu.data), semnale: Array.isArray(pu.data.semnale) ? pu.data.semnale : [] }
  } catch (e) {
    return { ...r, eroare: 'exceptie: ' + mesaj(e) }
  }
}
