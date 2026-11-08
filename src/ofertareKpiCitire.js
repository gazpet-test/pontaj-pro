// Citirile complete pentru KPI-urile din lista de licitații (acoperire X/Y, roșii, de reverificat).
// Auditul Ofertare 08.11.2026: `.limit(20000)` nu ajuta — PostgREST are plafon de server (max-rows = 1000), deci interogarea de
// cerințe întorcea exact 1000 de rânduri (Content-Range 0-999) din cele ~2.000+ active, iar majoritatea cardurilor (și fișa
// deschisă din listă) arătau „acoperire 0/0 · registru negenerat” deși registrul avea sute de cerințe confirmate (lic. 103: 417).
// Aici: keyset pe id până la pagina goală (L23, `paginareKeyset` existent), iar listele lungi de id-uri se trimit pe bucăți,
// ca URL-ul cererii să rămână scurt. Eroarea se propagă (L18): apelantul arată „necitit”, nu 0.
import { paginareKeyset } from './hrDeciziiUtil.js'

export const BUCATA_ID = 150   // id-uri pe cerere în filtrele `in.(…)` (≈1–1,5 KB de URL)

export const bucati = (arr, n = BUCATA_ID) => {
  const out = []
  for (let i = 0; i < (arr || []).length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Cerințele active (neînlocuite, nedublate) ale licitațiilor date — toate, nu primele 1000.
export async function cerinteKpi(sb, licIds) {
  const tot = []
  for (const b of bucati(licIds)) {
    tot.push(...await paginareKeyset((ultim, pas) => {
      let q = sb.from('ofertare_cerinte').select('id, licitatie_id, tip, cand_se_prezinta')
        .in('licitatie_id', b).is('inlocuita_de', null).is('duplicat_al', null).order('id', { ascending: true }).limit(pas)
      if (ultim != null) q = q.gt('id', ultim)
      return q
    }))
  }
  return tot
}

// Rândurile de acoperire ale cerințelor date — toate, pe bucăți de id-uri; ordinea finală după id (ca înainte de paginare).
export async function acopeririKpi(sb, cerIds, select) {
  const parti = await Promise.all(bucati(cerIds).map(b => paginareKeyset((ultim, pas) => {
    let q = sb.from('ofertare_acoperire').select(select).in('cerinta_id', b).order('id', { ascending: true }).limit(pas)
    if (ultim != null) q = q.gt('id', ultim)
    return q
  })))
  return parti.flat().sort((a, b) => a.id - b.id)
}
