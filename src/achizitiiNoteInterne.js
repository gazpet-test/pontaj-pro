// TKT-2026-0361 — Achiziții: notițe interne pe comanda către furnizor (comenzi_furnizor.note_interne, migrarea 20261215a).
// Notița e DOAR pentru colegi (discuții la telefon cu furnizorul, data trimiterii cererii etc.): nu intră în PDF-ul
// comenzii, al cererii de ofertă, în PV-uri, în lista de repere sau în mailuri. Generatoarele de documente citesc câmpuri
// numite explicit (nu tot rândul), deci coloana nouă nu ajunge acolo; testul din achizitiiNoteInterne.test.js o dovedește.
// Compatibilitate: până se aplică migrarea, coloana lipsește → câmpul se arată dezactivat, salvarea comenzii rămâne ca azi.

export const NOTE_INTERNE_MAX = 4000   // aceeași limită ca CHECK-ul din 20261215a

// Coloana lipsește (migrarea neaplicată): 42703 la SELECT, PGRST204 la UPDATE (cache-ul de schemă PostgREST).
// Doar erorile care numesc coloana noastră; orice altă eroare rămâne eroare (L18).
export function lipsaColoanaNote(error) {
  if (!error) return false
  const cod = String(error.code || '')
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  return (cod === '42703' || cod === 'PGRST204') && /\bnote_interne\b/.test(text)
}

// Rezultatul sondei `select('note_interne').limit(1)`: 'da' (coloana există), 'nu' (migrarea neaplicată),
// 'eroare' (nu știm — câmpul rămâne dezactivat, fără să pretindem că lipsește migrarea).
export function stareNoteDinSonda(res) {
  if (!res || res.error) return lipsaColoanaNote(res?.error) ? 'nu' : 'eroare'
  return 'da'
}

// Textul de salvat: spațiile de la capete tăiate, gol → null (nu un șir gol în BD).
export function normalizeazaNota(text) {
  const t = String(text ?? '').trim()
  return t ? t : null
}

// null = valid; altfel mesajul pentru om.
export function validareNota(text) {
  const t = normalizeazaNota(text)
  if (t && t.length > NOTE_INTERNE_MAX) return `Notița are ${t.length} caractere; maximum ${NOTE_INTERNE_MAX}.`
  return null
}

// Notița salvată s-a schimbat față de cea din BD? (fără salvări inutile)
export const notaSchimbata = (text, salvata) => normalizeazaNota(text) !== normalizeazaNota(salvata)
