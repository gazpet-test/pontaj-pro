// Proveniența textului unui document (ofertare_doc_texte_prov, TKT-0329 B + 20261101b): ce a produs text_extras și cât e de sigur.
// Datele vin din fn_ofertare_doc_prov_curent (ultimul rând pe document ales în SQL + `curent` = sha-ul rândului e sha-ul textului
// ACTUAL — review #795 r1, Copilot + Gemini P1: altfel o proveniență veche s-ar fi afișat pe un text schimbat ulterior).
// 'ocr_local_neverificat' (laboratorul OCR, decizia Răzvan 19.10.2026) se arată VIZIBIL: textul nu e verificat de om și nu e sursă de
// extragere a cantităților (fn_ofertare_cb_text_valid_asof acceptă doar 'transcriere' sau confirmarea omului).

export const ORIGINI = {
  transcriere: { text: 'transcriere AI', icon: '📝', atentie: false },
  sinteza_ai: { text: 'sinteză AI', icon: '🤖', atentie: false },
  ocr_local_neverificat: { text: 'OCR local neverificat', icon: '⚠', atentie: true },
}

// rows = rezultatul RPC-ului (un rând pe document) → Map(document_id → rând); dubluri (n-ar trebui) → păstrează prov_id cel mai mare
export function provPeDocument(rows) {
  const m = new Map()
  for (const r of rows || []) {
    if (r?.document_id == null) continue
    const v = m.get(r.document_id)
    if (!v || Number(r.prov_id || 0) > Number(v.prov_id || 0)) m.set(r.document_id, r)
  }
  return m
}

// eticheta pentru UI; fail-closed: o origine NECUNOSCUTĂ sau o proveniență care nu mai e a textului curent se arată cu atenție
export function etichetaProvenienta(p) {
  if (!p) return null
  const o = ORIGINI[p.origine] || { text: `origine necunoscută: ${p.origine}`, icon: '⚠', atentie: true }
  const cand = p.constatat_la ? new Date(p.constatat_la).toLocaleString('ro-RO') : ''
  if (p.curent === false) {
    return { text: 'proveniență veche — textul s-a schimbat după', icon: '⚠', atentie: true,
      titlu: `Ultima proveniență înregistrată (${o.text}${cand ? `, ${cand}` : ''}) NU e a textului actual: textul documentului a fost ` +
             'rescris după, fără proveniență nouă. Textul actual nu e sursă pentru extragerea cantităților până la confirmare.' }
  }
  const titlu = [`Proveniența textului: ${o.text}`, p.producator ? `producător ${p.producator}` : '',
    p.completitudine ? `text ${p.completitudine}` : '', cand ? `din ${cand}` : '',
    o.atentie ? 'NU e verificat de om și NU e sursă pentru extragerea cantităților' : ''].filter(Boolean).join(' · ')
  return { ...o, titlu }
}
