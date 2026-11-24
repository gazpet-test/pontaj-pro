// Logica pură a edge fn ctc-autorizatie-fisier (TKT-2026-0389, 20261222b + 20270111a) — testată în src/ctcAutorizatiiMigrare.test.js și
// src/ctcAutorizatiiNdt.test.js. Cererea, calea primită din BD, maparea erorilor RPC pe coduri HTTP și decizia completă (trateazaCerere, cu
// RPC-ul și semnarea primite din index.ts); nimic aici nu citește sau scrie singur.

// cele două forme de cerere și ce înseamnă fiecare: RPC-ul (chemat cu JWT-ul utilizatorului), argumentul lui și bucket-ul semnării
export const RAMURI = {
  sudor: { cheie: 'autorizatie_id', rpc: 'fn_ctc_autorizatie_fisier', arg: 'p_id', bucket: 'autorizatii' },
  ndt: { cheie: 'ndt_document_id', rpc: 'fn_ctc_autorizatie_ndt_fisier', arg: 'p_document_id', bucket: 'ofertare' },
} as const
export const VALABIL_SEC = 60

export type Tip = keyof typeof RAMURI
export type Cerere = { ok: true; tip: Tip; id: number } | { ok: false; error: string }

// corpul: EXACT o cheie, `autorizatie_id` (sudori, neschimbat) SAU `ndt_document_id` (20270111a), cu un întreg pozitiv sigur; orice altă
// formă (chei în plus, ambele chei, cheie necunoscută, alt tip de valoare) = 400, fără apel la BD (L13: validare strictă, fără conversii)
export function valideazaCerere(corp: unknown): Cerere {
  if (!corp || typeof corp !== 'object' || Array.isArray(corp)) return { ok: false, error: 'Corp invalid' }
  const chei = Object.keys(corp as Record<string, unknown>)
  const tip = (Object.keys(RAMURI) as Tip[]).find(t => RAMURI[t].cheie === chei[0])
  if (chei.length !== 1 || !tip) return { ok: false, error: 'Se așteaptă exact una dintre cheile autorizatie_id / ndt_document_id' }
  const id = (corp as Record<string, unknown>)[RAMURI[tip].cheie]
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: `${RAMURI[tip].cheie} invalid` }
  return { ok: true, tip, id }
}

// calea din BD, înainte de semnare: relativă la bucket, segmente din [A-Za-z0-9._-], fără „.” / „..”, fără „/” la capete, fără spații /
// caractere de control, cel mult 500 de caractere. Altfel null (422, nu se semnează nimic).
const SEGMENT = /^[A-Za-z0-9._-]{1,200}$/
export function caleSigura(cale: unknown): string | null {
  if (typeof cale !== 'string' || cale.length === 0 || cale.length > 500) return null
  const seg = cale.split('/')
  if (seg.some(s => !SEGMENT.test(s) || s === '.' || s === '..')) return null
  return cale
}

// calea unui document NDT (20270111a), reverificată în edge: forma parteneri/<id firmă>/ndt/<nume> (aceeași ca garda și RPC-ul din BD; firma
// o verifică RPC-ul) ȘI caleSigura (mai strictă: un nume cu spații, acceptat de BD, nu se semnează aici — 422, nimic semnat)
const FORMA_NDT = new RegExp('^parteneri/[1-9][0-9]*/ndt/[^/]+$')
export function caleNdtSigura(cale: unknown): string | null {
  const c = caleSigura(cale)
  return c && FORMA_NDT.test(c) ? c : null
}

// eroarea RPC → HTTP: 42501 = fără drept (403); P0002 = autorizație de sudor inexistentă / fără scan / alt tip (404, același mesaj);
// funcția lipsă (migrarea neaplicată sau revenită) = 503; orice altceva = 500 (eroarea nu se ascunde sub „nu ai drept”, L18).
export function statusDinEroareRpc(e: { code?: string } | null | undefined): { status: number; error: string } {
  const cod = e?.code || ''
  if (cod === '42501') return { status: 403, error: 'Fără acces la autorizațiile pentru cartea tehnică (modulul CTC)' }
  if (cod === 'P0002') return { status: 404, error: 'Autorizație de sudor inexistentă sau fără scan' }
  if (cod === 'PGRST202' || cod === '42883') return { status: 503, error: 'Funcția nu e încă activă în baza de date' }
  return { status: 500, error: 'Eroare internă' }
}

export type Raspuns = { status: number; corp: Record<string, unknown> }
export type Dependente = {
  // RPC-ul, chemat CU JWT-UL UTILIZATORULUI (auth.uid() = utilizatorul), nu cu service_role
  rpc: (nume: string, argumente: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>
  // semnarea cu service_role, DOAR pe calea aprobată de BD și reverificată aici
  semneaza: (bucket: string, cale: string, secunde: number) => Promise<{ data: { signedUrl?: string } | null; error: unknown }>
}

// decizia completă pentru un corp deja citit ca JSON
export async function trateazaCerere(corp: unknown, dep: Dependente): Promise<Raspuns> {
  const cerere = valideazaCerere(corp)
  if (!cerere.ok) return { status: 400, corp: { error: cerere.error } }
  const r = RAMURI[cerere.tip]
  let cale: string | null = null
  try {
    const { data, error } = await dep.rpc(r.rpc, { [r.arg]: cerere.id })
    if (error) { const s = statusDinEroareRpc(error); return { status: s.status, corp: { error: s.error } } }
    if (cerere.tip === 'ndt') {
      // NULL = inexistent / nu e NDT / fără fișier / cale invalidă în BD — același răspuns (fără oracol)
      if (data == null) return { status: 404, corp: { error: 'Autorizație NDT inexistentă sau fără scan' } }
      cale = caleNdtSigura(data)
    } else {
      cale = caleSigura(data)
    }
  } catch (_) {
    return { status: 500, corp: { error: 'Eroare internă' } }
  }
  if (!cale) return { status: 422, corp: { error: 'Calea scanului e invalidă' } }
  const { data: semnat, error: eroareSemnare } = await dep.semneaza(r.bucket, cale, VALABIL_SEC)
  if (eroareSemnare || !semnat?.signedUrl) return { status: 502, corp: { error: 'Scanul nu a putut fi semnat' } }
  return { status: 200, corp: { url: semnat.signedUrl, expira_in_sec: VALABIL_SEC } }
}
