// TKT-0329 B (PR3): rândul de proveniență al textului unui document, scris de PRODUCĂTOR, pe exact textul scris în text_extras
// (spec §4.1): ofertare-ingest-doc → 'transcriere'; ofertare-document-nou-citeste și ofertare-plansa-citeste → 'sinteza_ai'.
// Doar 'transcriere' (sau text_confirmat de om) e sursă de extragere. Best-effort: o eroare aici NU oprește producătorul (o lipsă
// de proveniență înseamnă doar „text nevalidat”, adică fail-closed); rezultatul se întoarce ca să fie raportat.
export type Origine = 'transcriere' | 'sinteza_ai'
export async function scrieProvenienta(db: any, documentId: number, text: string | null | undefined, origine: Origine, producator: string,
  completitudine: 'integral' | 'partial', paginiNecitite: number[] = []): Promise<{ ok: boolean; eroare?: string }> {
  if (!text) return { ok: false, eroare: 'text gol' }
  try {
    const { data, error } = await db.rpc('fn_ofertare_cb_text_scrie', { p_document_id: documentId, p_text: text, p_origine: origine,
      p_producator: producator, p_completitudine: completitudine, p_pagini_necitite: paginiNecitite })
    if (error) return { ok: false, eroare: String(error.message || error).slice(0, 200) }
    return { ok: !!data?.ok }
  } catch (e) {
    return { ok: false, eroare: String((e as Error)?.message || e).slice(0, 200) }
  }
}
