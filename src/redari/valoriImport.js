// Redări — valorile DE LA IMPORT ale parcelelor (anunțul de afișare, decizia Răzvan 19.11.2026, varianta A; regula: identificatoriPublici.js).
// Sursa = rândul INSERT din red_jurnal (trg_red_jurnal pe red_parcele: date_noi = to_jsonb(NEW), append-only pentru rolurile aplicației;
// RLS: citibil de oricine are nivel pe Redări, ca parcelele). Citire pe loturi de id-uri (LOT_IN) cu paginare keyset pe red_jurnal.id
// (L23: fără plafonul de 1000). O eroare de citire ARUNCĂ (L18: generarea se oprește cu mesaj, nu trece tacit pe „fără import”).
import { citestePaginat, LOT_IN } from './ui/comune.jsx'
import { valoriImportDinJurnal } from './identificatoriPublici.js'

/** Coloanele citite din red_jurnal (select explicit; date_noi = rândul parcelei la INSERT, fără valoare_lei). */
export const COL_JURNAL_INSERT_PARCELA = 'id, tabela, actiune, inregistrare_id, date_noi'

/**
 * Map(id parcelă, minuscule → { tarla, nr_cadastral, poz_hg }) pentru parcelele cu un INSERT de import dovedit (valoriImportDinJurnal).
 * `parcele` = rândurile citite pentru anunț (cu `id`); `uat3` = codul UAT-ului proaspăt citit.
 */
export async function citesteValoriImport(client, parcele, uat3, { esteCurent = () => true } = {}) {
  const ids = [...new Set((Array.isArray(parcele) ? parcele : []).map(p => p?.id).filter(x => typeof x === 'string' && x !== '').map(x => x.toLowerCase()))]
  const randuri = []
  for (let i = 0; i < ids.length; i += LOT_IN) {
    const lot = ids.slice(i, i + LOT_IN)
    const pagina = await citestePaginat(() => client.from('red_jurnal').select(COL_JURNAL_INSERT_PARCELA)
      .eq('tabela', 'red_parcele').eq('actiune', 'insert').in('inregistrare_id', lot), { cheie: 'id', esteCurent })
    for (const r of pagina) randuri.push(r)
  }
  return valoriImportDinJurnal(randuri, uat3)
}
