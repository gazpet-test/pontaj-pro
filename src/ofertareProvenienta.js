// Proveniența textului unui document (ofertare_doc_texte_prov, TKT-0329 B + 20261101b): ce a produs text_extras și cât e de sigur.
// Funcții pure (testabile): din rândurile prov ale licitației → ultimul rând pe document → eticheta afișată pe rândul documentului.
// 'ocr_local_neverificat' (laboratorul OCR, decizia Răzvan 19.10.2026) se arată VIZIBIL: textul nu e verificat de om și nu e sursă de
// extragere a cantităților (fn_ofertare_cb_text_valid_asof acceptă doar 'transcriere' sau confirmarea omului).

export const ORIGINI = {
  transcriere: { text: 'transcriere AI', icon: '📝', atentie: false },
  sinteza_ai: { text: 'sinteză AI', icon: '🤖', atentie: false },
  ocr_local_neverificat: { text: 'OCR local neverificat', icon: '⚠', atentie: true },
}

// rows: [{ document_id, sha256, origine, producator, completitudine, constatat_la, id }] → Map(document_id → rândul cel mai nou)
export function ultimaProvPeDocument(rows) {
  const m = new Map()
  for (const r of rows || []) {
    if (r?.document_id == null) continue
    const v = m.get(r.document_id)
    const nou = !v || String(r.constatat_la || '') > String(v.constatat_la || '') ||
      (String(r.constatat_la || '') === String(v.constatat_la || '') && Number(r.id || 0) > Number(v.id || 0))
    if (nou) m.set(r.document_id, r)
  }
  return m
}

// eticheta pentru UI; o origine NECUNOSCUTĂ (adăugată mai târziu în BD) se arată tot cu atenție — fail-closed, nu se ascunde
export function etichetaProvenienta(p) {
  if (!p) return null
  const o = ORIGINI[p.origine] || { text: `origine necunoscută: ${p.origine}`, icon: '⚠', atentie: true }
  const cand = p.constatat_la ? new Date(p.constatat_la).toLocaleString('ro-RO') : ''
  const titlu = [`Proveniența textului: ${o.text}`, p.producator ? `producător ${p.producator}` : '',
    p.completitudine ? `text ${p.completitudine}` : '', cand ? `din ${cand}` : '',
    o.atentie ? 'NU e verificat de om și NU e sursă pentru extragerea cantităților' : ''].filter(Boolean).join(' · ')
  return { ...o, titlu }
}
