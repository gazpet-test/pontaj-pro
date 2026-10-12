// Poarta unică pe loturi (migrarea 20261024b): orice procesare plătită a unui document din Ofertare (citire AI, OCR,
// cerințe, cantități, planșe, răspunsuri, generare) întreabă ÎNTÂI baza dacă documentul e eligibil.
// Logica stă DOAR în SQL (fn_ofertare_eligibilitate); aici e doar apelul + fail-closed:
// orice eroare / răspuns neașteptat = NEELIGIBIL (nu se cheltuie pe un document netriat).
// Motive eligibile: fara_loturi, comun, lot_participam. FĂRĂ excepții (nici fișa de date — review Copilot r1).
// Motive neeligibile: loturi_neinitializate, nicio_participare, de_triat, in_afara_loturilor, stare_invalida,
// document_inexistent, eroare_poarta (local, când RPC-ul pică).

import { eligibilaPeLot, lotRand } from './lot.ts'

export type Eligibilitate ={ eligibil: boolean; motiv: string; licitatie_id: number | null }

type ClientRpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

const MESAJ: Record<string, string> = {
  loturi_neinitializate: 'loturile licitației nu sunt setate (alege „fără loturi” sau definește loturile)',
  nicio_participare: 'nu e bifat niciun lot la care participăm',
  de_triat: 'documentul nu e triat pe lot (comun / lot)',
  in_afara_loturilor: 'documentul e doar pe loturi la care nu participăm',
  stare_invalida: 'stare de lot invalidă',
  document_inexistent: 'document inexistent',
  eroare_poarta: 'verificarea pe loturi nu a răspuns',
}

export function mesajLot(motiv: string): string {
  return 'Blocat pe loturi: ' + (MESAJ[motiv] || motiv)
}

export async function documentEligibil(db: ClientRpc, documentId: number): Promise<Eligibilitate> {
  try {
    const { data, error } = await db.rpc('fn_ofertare_document_eligibil', { p_document_id: documentId })
    const d = data as Partial<Eligibilitate> | null
    if (error || !d || typeof d.eligibil !== 'boolean' || typeof d.motiv !== 'string') {
      return { eligibil: false, motiv: 'eroare_poarta', licitatie_id: null }
    }
    return { eligibil: d.eligibil === true, motiv: d.motiv, licitatie_id: d.licitatie_id ?? null }
  } catch (_) {
    return { eligibil: false, motiv: 'eroare_poarta', licitatie_id: null }
  }
}

// Pentru liste (worker / extrageri pe toată licitația): Map document_id -> Eligibilitate.
// Documentele lipsă din răspuns sunt NEELIGIBILE (fail-closed); eroarea RPC = map gol + ok:false.
// Paginat stabil (ORDER BY document_id + range, review Jakarinos P2 #8): fără paginare, peste plafonul PostgREST
// (max_rows 1000) documentele rămase pe dinafară ar deveni neeligibile local, deși SQL le permite. O pagină picată = ok:false.
// Clienții fără builder (testele cu rpc → Promise) primesc un singur apel, ca înainte.
const PAGINA = 1000
export async function eligibilitateLicitatie(db: ClientRpc, licitatieId: number):
  Promise<{ ok: boolean; harta: Map<number, Eligibilitate> }> {
  const harta = new Map<number, Eligibilitate>()
  try {
    for (let off = 0; ; off += PAGINA) {
      let q: any = db.rpc('fn_ofertare_eligibilitate', { p_licitatie_id: licitatieId })
      const paginat = typeof q?.order === 'function' && typeof q?.range === 'function'
      if (paginat) q = q.order('document_id', { ascending: true }).range(off, off + PAGINA - 1)
      const { data, error } = await q
      if (error || !Array.isArray(data)) return { ok: false, harta: new Map() }
      for (const r of data as Array<{ document_id: number; eligibil: boolean; motiv: string }>) {
        if (typeof r?.document_id !== 'number') continue
        harta.set(Number(r.document_id), { eligibil: r.eligibil === true, motiv: String(r.motiv), licitatie_id: licitatieId })
      }
      if (!paginat || data.length < PAGINA) break
    }
    return { ok: true, harta }
  } catch (_) {
    return { ok: false, harta: new Map() }
  }
}

// Filtru pentru o LISTĂ de documente oarecare (surse de prompt: clauze, organigramă, răspunsuri, clarificări, acoperire…):
// un apel fn_ofertare_document_eligibil per document (listele sunt mici), în loturi de 20. Orice eroare de poartă
// = ok:false și NIMIC eligibil (apelantul se oprește, nu trimite parțial la AI).
export async function filtreazaDocumente(db: ClientRpc, ids: Array<number | null | undefined>):
  Promise<{ ok: boolean; eligibile: Set<number>; blocate: Map<number, string> }> {
  const unice = [...new Set(ids.filter((x) => x != null && Number.isFinite(Number(x))).map(Number))]
  const eligibile = new Set<number>(), blocate = new Map<number, string>()
  for (let i = 0; i < unice.length; i += 20) {
    const felie = unice.slice(i, i + 20)
    const rez = await Promise.all(felie.map((id) => documentEligibil(db, id)))
    for (let k = 0; k < felie.length; k++) {
      if (rez[k].motiv === 'eroare_poarta') return { ok: false, eligibile: new Set(), blocate: new Map([[felie[k], 'eroare_poarta']]) }
      if (rez[k].eligibil) eligibile.add(felie[k]); else blocate.set(felie[k], rez[k].motiv)
    }
  }
  return { ok: true, eligibile, blocate }
}

// O cale din bucketul `ofertare` (E0, clarificări, RFQ…) poate fi și fisier_path al unor documente de atribuire: dacă
// ORICARE e neeligibil, calea e blocată. Paginat complet (review Jakarinos r2 P2 #8: nu doar primele 50), fail-closed.
// null = liber; altfel motivul.
export async function caleBlocata(db: ClientRpc & ClientFrom, cale: string): Promise<string | null> {
  try {
    const ids: number[] = []
    for (let off = 0; ; off += PAGINA) {
      const { data, error } = await db.from('ofertare_documente_atribuire').select('id').eq('fisier_path', cale)
        .order('id', { ascending: true }).range(off, off + PAGINA - 1)
      if (error || !Array.isArray(data)) return 'eroare_poarta'
      for (const r of data) {
        const id = Number(r?.id)
        if (!Number.isSafeInteger(id) || id <= 0) return 'eroare_poarta'
        ids.push(id)
      }
      if (data.length < PAGINA) break
    }
    if (!ids.length) return null
    const f = await filtreazaDocumente(db, ids)
    if (!f.ok) return 'eroare_poarta'
    return f.blocate.size ? (f.blocate.values().next().value as string) : null
  } catch (_) {
    return 'eroare_poarta'
  }
}

// Participarea licitației:{ok, motiv, stare, participam[]}. ok doar pentru fara_loturi sau are_loturi cu ≥ 1 lot bifat
// (aceleași motive ca fn_ofertare_eligibilitate). Zero participări ≠ „fără filtru” (review Jakarinos P1 #2): e blocat.
type ClientFrom = { from: (t: string) => any }
export type Participare = { ok: boolean; motiv: string; stare: string | null; participam: number[] }
export async function participareLicitatie(db: ClientFrom, licitatieId: number): Promise<Participare> {
  const eroare: Participare = { ok: false, motiv: 'eroare_poarta', stare: null, participam: [] }
  try {
    const [{ data: lic, error: e1 }, { data: lot, error: e2 }] = await Promise.all([
      db.from('ofertare_licitatii').select('stare_loturi').eq('id', licitatieId).maybeSingle(),
      db.from('ofertare_licitatie_loturi').select('nr').eq('licitatie_id', licitatieId).eq('participam', true),
    ])
    if (e1 || e2 || !lic || !Array.isArray(lot)) return eroare
    const stare = String(lic.stare_loturi)
    const participam = lot.map((l: any) => Number(l.nr)).filter((n: number) => Number.isInteger(n) && n >= 1).sort((a: number, b: number) => a - b)
    if (stare === 'fara_loturi') return { ok: true, motiv: 'fara_loturi', stare, participam: [] }
    if (stare === 'neinitializat') return { ok: false, motiv: 'loturi_neinitializate', stare, participam }
    if (stare !== 'are_loturi') return { ok: false, motiv: 'stare_invalida', stare, participam }
    if (!participam.length) return { ok: false, motiv: 'nicio_participare', stare, participam }
    return { ok: true, motiv: 'lot_participam', stare, participam }
  } catch (_) {
    return eroare
  }
}

// Cerințe (sau orice rând derivat cu sursa_document_id + lot canonic) care pot intra într-un prompt plătit:
//   1. licitația trebuie să aibă participare (altfel ok:false — nimic nu pleacă la AI);
//   2. documentul-sursă, dacă există, trebuie să fie eligibil ACUM (reverificat la fiecare apel, nu moștenit);
//   3. pe are_loturi: lotul rândului (canonic, sau textul vechi `lot`) trebuie să fie „toate” sau să intersecteze
//      loturile bifate; „necunoscut” NU intră implicit (review Jakarinos P1 #2) — iese în `excluse` cu motivul lui.
// Rândurile fără document-sursă (manuale) trec doar pe lot.
// Proveniența cu mai multe surse (20261025a, review Jakarinos r5 P1 #4): `surse_document_ids` — TOATE trebuie eligibile.
// `cereSurse(r)` (opțional): pe are_loturi, rândul pentru care întoarce true și n-are nicio sursă documentară
// (nici sursa_document_id, nici surse_document_ids) iese cu `fara_provenienta` — ex. cantitățile extrase automat.
export type MotivExclus = { motiv: string }
export async function filtreazaDerivate<T extends { sursa_document_id?: number | null; surse_document_ids?: unknown; lot_domeniu?: string | null; lot_nr?: unknown; lot?: string | null }>(
  db: ClientRpc & ClientFrom, licitatieId: number, randuri: T[], opt: { cereSurse?: (r: T) => boolean } = {},
): Promise<{ ok: boolean; motiv: string; participare: Participare; pastrate: T[]; excluse: Array<T & MotivExclus> }> {
  const participare = await participareLicitatie(db, licitatieId)
  if (!participare.ok) return { ok: false, motiv: participare.motiv, participare, pastrate: [], excluse: [] }
  // o singură citire paginată pe licitație; un document-sursă din altă licitație lipsește din hartă = neeligibil
  const f = await eligibilitateLicitatie(db, licitatieId)
  if (!f.ok) return { ok: false, motiv: 'eroare_poarta', participare, pastrate: [], excluse: [] }
  const pastrate: T[] = [], excluse: Array<T & MotivExclus> = []
  for (const r of randuri) {
    const doc = r.sursa_document_id == null ? null : Number(r.sursa_document_id)
    if (doc != null && !esteEligibil(f.harta, doc)) { excluse.push({ ...r, motiv: 'document_' + (f.harta.get(doc)?.motiv || 'neeligibil') }); continue }
    const surse = surseDocumente(r.surse_document_ids)
    if (surse === null) { excluse.push({ ...r, motiv: 'surse_invalide' }); continue }
    const blocata = surse.find((s) => !esteEligibil(f.harta, s))
    if (blocata != null) { excluse.push({ ...r, motiv: 'document_' + (f.harta.get(blocata)?.motiv || 'neeligibil') }); continue }
    if (participare.stare === 'are_loturi') {
      const l = lotRand(r)
      if (l.domeniu === 'necunoscut') { excluse.push({ ...r, motiv: 'lot_necunoscut' }); continue }
      if (!eligibilaPeLot(l, participare.participam)) { excluse.push({ ...r, motiv: 'lot_in_afara' }); continue }
      // fără nicio sursă documentară — după lot (motivul de lot e mai informativ când se aplică ambele)
      if (doc == null && !surse.length && opt.cereSurse?.(r)) { excluse.push({ ...r, motiv: 'fara_provenienta' }); continue }
    }
    pastrate.push(r)
  }
  return { ok: true, motiv: participare.motiv, participare, pastrate, excluse }
}

// surse_document_ids din BD: null/absent = [] (fără surse); listă cu un element nevalid = null (neverificabil → exclus)
export function surseDocumente(v: unknown): number[] | null {
  if (v == null) return []
  if (!Array.isArray(v)) return null
  const ids = v.map(Number)
  return ids.every((n) => Number.isSafeInteger(n) && n > 0) ? [...new Set(ids)] : null
}

export function esteEligibil(harta: Map<number, Eligibilitate>, documentId: number): boolean {
  return harta.get(Number(documentId))?.eligibil === true
}
