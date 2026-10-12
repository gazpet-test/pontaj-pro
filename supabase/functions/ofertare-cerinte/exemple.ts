// Exemplele de corecții umane (ai_feedback) din promptul sistem al extragerii de cerințe — review Jakarinos r5 P1 #3 (PR #677).
// Un exemplu e text dintr-o cerință a UNEI licitații (de obicei alta decât cea curentă): intră DOAR dacă proveniența lui
// se poate rezolva și trece poarta ACUM — ref_table='ofertare_cerinte' + ref_id → cerința → document-sursă eligibil +
// lotul cerinței în participarea licitației EI (filtreazaDerivate, aceeași logică ca în restul promptului).
// Fără ref, cerință ștearsă, fără document-sursă, document blocat, lot în afară = omis. Orice eroare = zero exemple
// (fail-closed: nu exemple nefiltrate).
import { filtreazaDerivate } from '../_shared/eligibilLot.ts'

type Db = Parameters<typeof filtreazaDerivate>[0]
export type Exemplu = { id: number; ref_id: number; output_ai: unknown; output_corectat: unknown }

const CANDIDATI = 30   // se citesc mai mulți decât n, ca exemplele omise să nu golească lista

export async function exempleFeedback(db: Db, contextCheie: string, n = 3): Promise<{ exemple: Exemplu[]; omise: number }> {
  const gol = { exemple: [] as Exemplu[], omise: 0 }
  try {
    const { data: fb, error } = await (db as any).from('ai_feedback').select('id, ref_table, ref_id, output_ai, output_corectat')
      .eq('context_cheie', contextCheie).eq('verdict', 'corectat').order('corectat_la', { ascending: false }).limit(CANDIDATI)
    if (error || !Array.isArray(fb)) return gol
    if (!fb.length) return gol
    const cuRef = fb.filter((x: any) => x?.ref_table === 'ofertare_cerinte' && Number.isSafeInteger(Number(x?.ref_id)) && Number(x.ref_id) > 0)
    const ids = [...new Set(cuRef.map((x: any) => Number(x.ref_id)))]
    if (!ids.length) return { exemple: [], omise: fb.length }

    const { data: cer, error: eC } = await (db as any).from('ofertare_cerinte')
      .select('id, licitatie_id, sursa_document_id, surse_document_ids, lot, lot_domeniu, lot_nr').in('id', ids)
    if (eC || !Array.isArray(cer)) return gol
    // fără document-sursă nu există proveniență de verificat (filtreazaDerivate le-ar lăsa să treacă doar pe lot)
    const peLicitatie = new Map<number, any[]>()
    for (const c of cer) {
      if (c?.sursa_document_id == null || !Number.isSafeInteger(Number(c?.licitatie_id))) continue
      const l = Number(c.licitatie_id)
      peLicitatie.set(l, [...(peLicitatie.get(l) || []), c])
    }
    const bune = new Set<number>()
    for (const [lic, randuri] of peLicitatie) {
      const f = await filtreazaDerivate(db, lic, randuri)
      if (!f.ok) {
        if (f.motiv === 'eroare_poarta') return gol   // poarta căzută: niciun exemplu
        continue                                        // licitația fără participare: exemplele ei ies
      }
      for (const c of f.pastrate) bune.add(Number(c.id))
    }
    // selecția finală DOAR din cuRef (tabel + ID), nu din fb pe ID numeric (Jakarinos r6 P1 #3: alt tabel, același ref_id)
    const alese = cuRef.filter((x: any) => bune.has(Number(x.ref_id)))
    const exemple = alese.slice(0, n)
      .map((x: any) => ({ id: Number(x.id), ref_id: Number(x.ref_id), output_ai: x.output_ai, output_corectat: x.output_corectat }))
    return { exemple, omise: fb.length - alese.length }
  } catch (_) {
    return gol
  }
}
