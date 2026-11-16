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
import { citesteTermen } from './ofertareRadarFiltru.js'

export const MESAJ_ANULAT = 'încărcare anulată'

// Momentul termenului pentru ordonare (ms UTC); termen lipsă / ilizibil → null (la final, ca NULLS LAST în BD)
const momentTermen = t => {
  const c = citesteTermen(t)
  if (!c) return null
  return c.zi ? Date.UTC(+c.zi.slice(0, 4), +c.zi.slice(5, 7) - 1, +c.zi.slice(8, 10)) : c.ms
}
const scorNr = s => (s == null || !Number.isFinite(Number(s)) ? null : Number(s))

/** Ordinea listei: scor desc (fără scor la final), termen asc (fără termen la final), apoi id asc. Nu modifică intrarea. */
export function ordoneazaRadar(rows) {
  const cu = (rows || []).map(r => ({ r, s: scorNr(r.scor_potrivire), t: momentTermen(r.termen_depunere) }))
  cu.sort((a, b) => {
    if (a.s !== b.s) return a.s == null ? 1 : b.s == null ? -1 : b.s - a.s
    if (a.t !== b.t) return a.t == null ? 1 : b.t == null ? -1 : a.t - b.t
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

/** Mesajul de eroare arătat omului (text simplu, fără obiecte brute). */
export const mesajEroareRadar = e => {
  const m = e?.message || (typeof e === 'string' ? e : '')
  return m ? `Radarul nu s-a putut încărca: ${m}` : 'Radarul nu s-a putut încărca.'
}
