/* convocatorNeexpediat.js — D4 (audit 04.11.2026): convocatoarele GENERATE dar NEEXPEDIATE ale unui deținător.
   Vederea red_v_stare_parcela are doar max(data_expediere), deci un convocator generat și neexpediat nu se vede în Registru,
   iar un al doilea click pe „📄 Convocator” consuma un număr C-nnnn nou (numerele nu se refolosesc) → convocatoare duble.
   Fără migrare: citire separată din red_convocari (paginată, pe loturi de id-uri — citesteIn din ui/comune.jsx, L23).
   Propunere de migrare (NU aplicată): coloanele `conv_neexpediat_nr` / `conv_neexpediat_nr_count` în red_v_stare_parcela. */

// coloanele necesare (fără PII): numărul, canalul, fișierul (pentru „Descarcă din nou”) și data generării
export const COL_CONV_NEEXPEDIAT = 'id, detinator_id, canal, nr_document, fisier_convocator_path, created_at'

/** Filtrul „generat, neexpediat”: convocare activă, neștearsă, fără dată de expediere. */
export const filtruNeexpediate = (q) => q.eq('stare', 'activ').is('data_expediere', null).is('sters_la', null)

/** Fabrica de interogare pentru citesteIn (fiecare apel = interogare nouă, ordonare stabilă pentru paginare). */
export const fabricaNeexpediate = (supabase) => () =>
  filtruNeexpediate(supabase.from('red_convocari').select(COL_CONV_NEEXPEDIAT)).order('created_at').order('id')

/** Rândurile citite → Map detinator_id → listă, cea mai recentă prima. Rândurile fără deținător se ignoră. */
export function grupeazaNeexpediate(randuri) {
  const harta = new Map()
  for (const r of randuri || []) {
    if (!r?.detinator_id) continue
    if (!harta.has(r.detinator_id)) harta.set(r.detinator_id, [])
    harta.get(r.detinator_id).push(r)
  }
  for (const lista of harta.values()) {
    lista.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id ?? '').localeCompare(String(a.id ?? '')))
  }
  return harta
}

/** Eticheta scurtă din Registru: „Convocator generat C-0002 (neexpediat)”, „… (neexpediat, fișier neîncărcat)”, „ +1”. */
export function etichetaNeexpediat(lista) {
  if (!lista?.length) return ''
  const c = lista[0]
  const fisier = c.fisier_convocator_path ? '' : ', fișier neîncărcat'
  const altele = lista.length > 1 ? ` +${lista.length - 1}` : ''
  return `Convocator generat ${c.nr_document} (neexpediat${fisier})${altele}`
}

/** Textul bifei care deblochează un convocator NOU când există deja unul neexpediat. */
export function textConfirmareNumarNou(lista) {
  const n = lista?.length || 0
  const nr = (lista || []).map(c => c.nr_document).join(', ')
  return `Înțeleg că se consumă un număr C-nnnn NOU (numerele nu se refolosesc) și că deținătorul va avea ${n + 1} convocatoare active neexpediate (există deja: ${nr}).`
}

/**
 * Se poate porni generarea cu număr NOU? existente = null → încă se citește (nu); eroare de citire → nu (fail-closed:
 * fără să știm dacă există deja unul, nu consumăm un număr); listă goală → da; listă nevidă → doar cu bifa de confirmare.
 */
export function poateGeneraNou({ existente, eroare, confirmat }) {
  if (eroare) return false
  if (!Array.isArray(existente)) return false
  return existente.length === 0 || confirmat === true
}
