// ═══════════════════════════════════════════════════════════════════════════
// citireCompleta.js — toate rândurile unei interogări PostgREST, pe chei, și ordinea catalogului de deviz în client.
//
// PostgREST dă cel mult 1000 de rânduri pe cerere (max-rows), indiferent de .limit(): o citire FĂRĂ ordine și FĂRĂ paginare primește un SUBSET
// care depinde de ordinea fizică a rândurilor în tabel. Review #1158 r8 (Rest de decontat): după confirmarea ofertei în „Rest de decontat”
// (rândurile vechi mutate în istoric, cele confirmate scrise la loc) „Contract” din ActivitatiProiectPanel și stadiul fizic din verificariProiect
// se schimbau pe proiectele cu peste 1000 de articole, deși datele erau echivalente — defectul era al cititorilor, confirmarea doar îl făcea vizibil.
// Aici: paginareKeyset (src/hrDeciziiUtil.js, L23) pe id crescător, pagini de `pas`, până la pagina goală; o eroare se ARUNCĂ (L18: eroare ≠ listă goală).
// ═══════════════════════════════════════════════════════════════════════════
import { paginareKeyset } from '../hrDeciziiUtil.js'

/**
 * Toate rândurile: fabrica() = supabase.from(...).select('id, …') cu filtrele, FĂRĂ order / limit (le pune paginarea: order('id') + limit(pas) + gt('id', ultim)).
 * Rezultatul e tabloul rândurilor (nu { data, error }); eroarea PostgREST se aruncă.
 */
export const citesteToate = (fabrica, pas = 1000) => paginareKeyset((ultim, n) => {
  const q = fabrica().order('id', { ascending: true }).limit(n)
  return ultim == null ? q : q.gt('id', ultim)
}, pas)

// ordinea de afișare a catalogului (CatalogDevizPanel), în client, ca .order('obiect_cod').order('deviz_cod').order('nr') de dinainte: text crescător
// pe coduri (comparare pe caractere), NULL la sfârșit (ca în PostgreSQL), la egalitate id crescător (ordine stabilă)
const cmpText = (a, b) => a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a < b ? -1 : a > b ? 1 : 0)
export const ordineCatalog = (a, b) => cmpText(a.obiect_cod, b.obiect_cod) || cmpText(a.deviz_cod, b.deviz_cod) || cmpText(a.nr, b.nr) || cmpText(a.id, b.id)
