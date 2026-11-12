// citeste-orice — potrivirea documentului pe o entitate (proiect / angajat / activ / furnizor).
// r7: calea fără funcția din BD cere dovada din BD că tabelul restricțiilor nu există (review r6 P1); altfel refuz.
// r6 (20261209a, acces pe proiect în Execuție): mutat din index.ts ca să poată fi testat fără Deno.serve; potrivirea (scorul) e
// NESCHIMBATĂ. Nou: candidații pentru Execuție = DOAR proiectele permise contului care a urcat documentul, listă dată de BD
// (fn_executie_acces_candidati, doar service_role). Un cont restrâns nu mai poate primi pe propriul document un proiect din afara listei
// (review r5 P1: dispariția documentului după o asemenea potrivire era un semnal de existență).

const STOP = new Set(['punere','siguranta','conducte','conducta','transport','gaze','naturale','natural','zona','judetul','jud','judet','subtraversare','subtrav','traversare','aeriana','raul','rau','cuplare','distributie','transgaz','lucrari','lucrare','santier','din','sau','catre','godevilabila','transformare','localitatii','localitate','racord','srm','cfi','pis','parau','paru'])

function norm(s: string): string { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function words(s: string, useStop = true): string[] { return norm(s).split(' ').filter(w => w.length >= 3 && (!useStop || !STOP.has(w))) }
function scorMatch(hint: string, target: string, useStop = true): { score: number, hits: number, maxLen: number } {
  const hw = new Set(words(hint, useStop)); const tw = words(target, useStop)
  if (!hw.size || !tw.length) return { score: 0, hits: 0, maxLen: 0 }
  let hit = 0, maxLen = 0
  for (const w of tw) if (hw.has(w)) { hit++; if (w.length > maxLen) maxLen = w.length }
  const denom = Math.min(tw.length, Math.max(hw.size, 1))
  return { score: hit / Math.max(denom, 1), hits: hit, maxLen }
}
export function bestMatch(hint: string, lista: any[], campuri: string[], useStop = true): { id: any, conf: number } | null {
  let best: any = null, bestScore = 0, bestHits = 0, bestMaxLen = 0
  for (const item of (lista || [])) {
    let s = 0, h = 0, ml = 0
    for (const c of campuri) { const r = scorMatch(hint, item[c] || '', useStop); if (r.score > s) { s = r.score; h = r.hits; ml = r.maxLen } }
    if (s > bestScore) { bestScore = s; bestHits = h; bestMaxLen = ml; best = item }
  }
  if (best && bestScore >= 0.5 && (bestHits >= 2 || bestMaxLen >= 6)) return { id: best.id, conf: Math.round(bestScore * 100) }
  return null
}
export function plateNorm(s: string): string { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '') }

// ── Execuție: candidații de potrivire (r6) ──
// Semnătura din BD (migrarea 20261209a): public.fn_executie_acces_candidati(p_profile uuid) RETURNS jsonb = [{id, nume, cod_intern}].
// candidati_test.ts verifică numele și parametrul față de textul migrării (o greșeală de nume ar trece altfel pe calea de compatibilitate).
export const RPC_CANDIDATI = 'fn_executie_acces_candidati'
export const PARAM_CANDIDATI = 'p_profile'

export type Proiect = { id: number, nume: string | null, cod_intern: string | null }
export type Candidati =
  | { ok: true, proiecte: Proiect[], sursa: 'bd' | 'compat' }
  | { ok: false, err: string }

// Funcția lipsește din API: DOAR PGRST202 („nu există în schema cache”) pe NUMELE ei. Orice altă eroare (drept retras 42501, timeout,
// rețea, 5xx, o eroare din interiorul funcției, ex. 22023 cont inexistent) NU e „lipsă” → refuz, nu „toate” (L18).
// r7 (review r6 P1): PGRST202 e răspunsul CACHE-ULUI instanței API care a primit cererea, nu al BD: nu dovedește că nu există restricții
// (cache nereîncărcat după migrare, instanțe în stări diferite). E doar motivul de a cere dovada de mai jos, nu dovada.
export function functieLipsa(error: any): boolean {
  return !!error && error.code === 'PGRST202' && String(error.message || '').includes(RPC_CANDIDATI)
}

// r7: tabelul restricțiilor (aceeași migrare). Singurul loc în care pot exista restricții: îl scrie doar fn_executie_acces_proiect_seteaza,
// iar revenirea îl șterge odată cu funcția candidaților.
export const TABEL_ACCES = 'executie_acces_proiect'

// Tabelul lipsește DIN BD: 42P01 („relation … does not exist”) e eroarea lui Postgres la EXECUTAREA interogării, pe catalogul de atunci.
// PostgREST nu o produce din cache: o primește doar dacă a trimis interogarea la BD. Ce vine din cache-ul lui (PGRST205 „tabel
// necunoscut în schema cache”, PGRST202, orice PGRSTxxx) nu e dovadă → nu intră aici.
export function tabelLipsaInBd(error: any): boolean {
  return !!error && error.code === '42P01' && String(error.message || '').includes(TABEL_ACCES)
}

// Dovada INDEPENDENTĂ cerută înainte de calea de azi (citire directă, service_role, fără funcții în interogare: nu depinde de cache-ul de
// funcții, iar rezultatul acceptat ca dovadă — 42P01 — vine din BD, nu din cache-ul de tabele):
// - 'fara_tabel': BD spune că tabelul nu există → nicio restricție posibilă pentru nimeni → calea de azi;
// - 'migrare_aplicata': tabelul EXISTĂ în BD (interogarea a rulat), dar funcția candidaților lipsește din cache-ul instanței → stare
//   tranzitorie (cache nereîncărcat). Contul poate fi restrâns (are rânduri) sau nu; regula „cine e restrâns” are O SINGURĂ definiție, în BD
//   (fn_executie_acces_nerestrans_cont, L19), deci n-o refacem aici → refuz pentru oricine (rândul intră în eroare, „reîncearcă”);
// - 'neclar': orice altceva (PGRST205 = tabel necunoscut doar în cache, 42501, rețea, răspuns fără tablou) → refuz.
export type Dovada = 'fara_tabel' | 'migrare_aplicata' | 'neclar'
export async function dovadaFaraRestrictii(supabase: any): Promise<Dovada> {
  let rez: { data: unknown, error: any }
  try {
    rez = await supabase.from(TABEL_ACCES).select('profile_id').limit(1)
  } catch (_) {
    return 'neclar'
  }
  if (rez.error) return tabelLipsaInBd(rez.error) ? 'fara_tabel' : 'neclar'
  return Array.isArray(rez.data) ? 'migrare_aplicata' : 'neclar'
}

const MESAJ_EROARE = 'Potrivirea pe proiect: lista proiectelor permise contului care a urcat documentul nu s-a putut citi; reîncearcă.'

// Proiectele printre care se caută potrivirea unui document de Execuție urcat de `uploadatDe` (NULL = rând fără cont, cale server).
// - BD (migrarea aplicată): exact lista din fn_executie_acces_candidati (cont nerestrâns / owner = toate cele active, ca azi;
//   cont restrâns = doar cele active din lista lui; cont inexistent = refuz). Răspuns invalid = eroare, nu „toate”.
// - compat (r7): DOAR când funcția lipsește din API ȘI BD dovedește că tabelul restricțiilor nu există (42P01) → EXACT interogarea de azi
//   (proiectele active, eroarea ei = listă goală, ca azi). Orice altă combinație = refuz, fără să citească lista proiectelor.
export async function proiecteCandidat(supabase: any, uploadatDe: string | null): Promise<Candidati> {
  let rez: { data: unknown, error: any }
  try {
    rez = await supabase.rpc(RPC_CANDIDATI, { [PARAM_CANDIDATI]: uploadatDe ?? null })
  } catch (_) {
    return { ok: false, err: MESAJ_EROARE }
  }
  if (rez.error) {
    if (!functieLipsa(rez.error)) return { ok: false, err: MESAJ_EROARE }
    if (await dovadaFaraRestrictii(supabase) !== 'fara_tabel') return { ok: false, err: MESAJ_EROARE }
    const { data: proiecte } = await supabase.from('executie_proiecte').select('id,nume,cod_intern').eq('activ', true)
    return { ok: true, proiecte: proiecte || [], sursa: 'compat' }
  }
  const lista = rez.data
  if (!Array.isArray(lista)) return { ok: false, err: MESAJ_EROARE }
  const proiecte: Proiect[] = []
  for (const p of lista) {
    if (!p || typeof p !== 'object' || !Number.isSafeInteger((p as any).id) || (p as any).id <= 0) return { ok: false, err: MESAJ_EROARE }
    const { id, nume, cod_intern } = p as any
    proiecte.push({ id, nume: typeof nume === 'string' ? nume : null, cod_intern: typeof cod_intern === 'string' ? cod_intern : null })
  }
  return { ok: true, proiecte, sursa: 'bd' }
}

// Potrivirea unui document de Execuție: candidații contului, apoi același bestMatch ca până acum (nume, cod_intern, cu cuvintele STOP).
export async function potrivesteProiect(supabase: any, uploadatDe: string | null, hint: string):
  Promise<{ ok: true, potrivire: { id: any, conf: number } | null, sursa: 'bd' | 'compat' } | { ok: false, err: string }> {
  const c = await proiecteCandidat(supabase, uploadatDe)
  if (!c.ok) return c
  return { ok: true, potrivire: bestMatch(hint, c.proiecte, ['nume', 'cod_intern'], true), sursa: c.sursa }
}
