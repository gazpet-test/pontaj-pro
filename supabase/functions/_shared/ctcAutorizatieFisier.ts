// Logica pură a edge fn ctc-autorizatie-fisier (TKT-2026-0389, 20261222b) — testată în src/ctcAutorizatieFisier.test.js.
// Cererea, calea primită din BD și maparea erorilor RPC pe coduri HTTP; nimic aici nu citește sau scrie.

export type Cerere = { ok: true; id: number } | { ok: false; error: string }

// corpul: { autorizatie_id: întreg pozitiv sigur } — nimic altceva acceptat (L13: validare strictă, fără conversii tăcute)
export function valideazaCerere(corp: unknown): Cerere {
  if (!corp || typeof corp !== 'object' || Array.isArray(corp)) return { ok: false, error: 'Corp invalid' }
  const chei = Object.keys(corp as Record<string, unknown>)
  if (chei.length !== 1 || chei[0] !== 'autorizatie_id') return { ok: false, error: 'Se așteaptă doar autorizatie_id' }
  const id = (corp as Record<string, unknown>).autorizatie_id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'autorizatie_id invalid' }
  return { ok: true, id }
}

// calea din BD (fn_ctc_autorizatie_fisier), înainte de semnare: relativă la bucket, segmente din [A-Za-z0-9._-], fără „.” / „..”,
// fără „/” la capete, fără spații / caractere de control, cel mult 500 de caractere. Altfel null (422, nu se semnează nimic).
const SEGMENT = /^[A-Za-z0-9._-]{1,200}$/
export function caleSigura(cale: unknown): string | null {
  if (typeof cale !== 'string' || cale.length === 0 || cale.length > 500) return null
  const seg = cale.split('/')
  if (seg.some(s => !SEGMENT.test(s) || s === '.' || s === '..')) return null
  return cale
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
