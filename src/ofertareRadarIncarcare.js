// Încărcarea ecranului „📡 Radar licitații" (RadarLicitatii din OfertareLicitatii.jsx), testată în
// ofertareRadarIncarcare.test.js.
//
// Reguli (16.11.2026, notele de review de la #1110):
// - Lista se citește COMPLET, pe chei (paginareKeyset din hrDeciziiUtil.js, keyset pe id până la pagina goală, L23):
//   un plafon al API-ului (1000 sau mai mic) nu mai taie tacit lista. O pagină eșuată = eroare, nu listă parțială.
// - Ordinea afișată (scor descrescător, fără scor la final; apoi termenul crescător, fără termen la final) se face aici,
//   după citire, pentru că paginarea merge pe id. E aceeași ordine ca vechea cerere unică din BD.
// - Fiecare încărcare are un token de generație (L24): o încărcare mai nouă sau închiderea ecranului o anulează,
//   iar rezultatul unei încărcări vechi nu se mai aplică, oricând ar sosi.
// - Eroare ≠ listă goală (L18): starea ecranului se decide în stareAfisareRadar.

import { paginareKeyset } from './hrDeciziiUtil.js'
import { momentTermenNs } from './ofertareRadarFiltru.js'

export const MESAJ_ANULAT = 'încărcare anulată'

const scorNr = s => (s == null || !Number.isFinite(Number(s)) ? null : Number(s))

/**
 * Ordinea listei: scor desc (fără scor la final), termen asc (fără termen la final), apoi id asc. Nu modifică intrarea.
 * Termenul se compară cu TOATĂ precizia lui (nanosecunde, BigInt — momentTermenNs), ca în BD (timestamptz = microsecunde),
 * nu trunchiat la milisecunde.
 */
export function ordoneazaRadar(rows) {
  const cu = (rows || []).map(r => ({ r, s: scorNr(r.scor_potrivire), t: momentTermenNs(r.termen_depunere) }))
  cu.sort((a, b) => {
    if (a.s !== b.s) return a.s == null ? 1 : b.s == null ? -1 : b.s - a.s
    if (a.t !== b.t) return a.t == null ? 1 : b.t == null ? -1 : a.t < b.t ? -1 : 1
    return a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0
  })
  return cu.map(x => x.r)
}

/**
 * Toate anunțurile relevante, paginat pe id. viu() se apelează înaintea fiecărei pagini și aruncă dacă încărcarea
 * a fost anulată (bucla se oprește, nu mai cere pagini).
 * @returns Promise<rânduri ordonate>; respinge la orice pagină eșuată (fără rezultat parțial)
 */
export async function incarcaRadarComplet(client, { viu = () => {}, pas = 1000 } = {}) {
  const rows = await paginareKeyset((ultim, n) => {
    viu()
    let q = client.from('ofertare_radar').select('*').eq('relevant', true).order('id').limit(n)
    if (ultim != null) q = q.gt('id', ultim)
    return q
  }, pas)
  viu()
  const ids = new Set(rows.map(r => r.id))
  if (ids.size !== rows.length) throw new Error('lista radarului are id-uri repetate')
  return ordoneazaRadar(rows)
}

/** Generații de încărcare: porneste() anulează orice încărcare anterioară; anuleaza() le anulează pe toate (închiderea ecranului). */
export function creeazaGeneratie() {
  let g = 0
  return {
    porneste() {
      const a = ++g
      return {
        curent: () => a === g,
        viu: () => { if (a !== g) throw new Error(MESAJ_ANULAT) },
      }
    },
    anuleaza() { g++ },
  }
}

/**
 * Rulează o încărcare în generația ei: laSucces / laEroare / laFinal se apelează DOAR dacă e încă cea mai nouă.
 * incarca(viu) → Promise<rezultat>.
 */
export async function incarcaInGeneratie(gen, incarca, { laSucces, laEroare, laFinal } = {}) {
  const t = gen.porneste()
  try {
    const r = await incarca(t.viu)
    if (t.curent()) laSucces?.(r)
  } catch (e) {
    if (t.curent()) laEroare?.(e)
  } finally {
    if (t.curent()) laFinal?.()
  }
}

/** Ce arată ecranul: 'incarcare' | 'eroare' | 'gol' (zero rezultate pe filtru) | 'lista'. Eroarea are prioritate față de „gol". */
export function stareAfisareRadar({ loading, eroare, nrAfisate }) {
  if (eroare) return 'eroare'
  if (!nrAfisate) return loading ? 'incarcare' : 'gol'
  return 'lista'
}

/**
 * Mesajul de eroare arătat omului: text FIX, controlat (L10, review #1113). Detaliul tehnic al erorii (ex. „permission denied
 * for table …”) nu ajunge pe ecran, indiferent de eroare; ecranul îl scrie doar în consolă.
 */
export const MESAJ_EROARE_RADAR = 'Lista nu a putut fi încărcată. Încearcă din nou.'
export const mesajEroareRadar = () => MESAJ_EROARE_RADAR
