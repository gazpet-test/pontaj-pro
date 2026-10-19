// Proveniența textului unui document (ofertare_doc_texte_prov, TKT-0329 B + 20261101b): ce a produs text_extras și cât e de sigur.
// Datele vin din fn_ofertare_cb_doc_prov_curent: pe fiecare document cu text (sau cu proveniență) ultimul rând ales în SQL + `curent`
// (sha-ul rândului = sha-ul textului ACTUAL) + are_text; prov_id NULL = text FĂRĂ proveniență (review #795 r1 + r2, Copilot / Gemini).
// 'ocr_local_neverificat' (laboratorul OCR, decizia Răzvan 19.10.2026) se arată VIZIBIL: textul nu e verificat de om și nu e sursă de
// extragere a cantităților (fn_ofertare_cb_text_valid_asof acceptă doar 'transcriere' sau confirmarea omului).
// nivel: 'atentie' = portocaliu (citire neverificată / proveniență veche / necunoscută); 'info' = vizibil, discret (lipsă / indisponibil).

export const ORIGINI = {
  transcriere: { text: 'transcriere AI', icon: '📝', nivel: 'ok' },
  sinteza_ai: { text: 'sinteză AI', icon: '🤖', nivel: 'ok' },
  ocr_local_neverificat: { text: 'OCR local neverificat', icon: '⚠', nivel: 'atentie' },
}
const NU_SURSA = 'Textul actual NU e sursă pentru extragerea cantităților până la confirmarea omului.'

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

// RPC-ul n-a răspuns (încă) sau a dat eroare: NU se arată o etichetă veche (review r2 P1, fail-closed)
export const PROV_INDISPONIBILA = { text: 'proveniență indisponibilă', icon: '⚠', nivel: 'info',
  titlu: 'Proveniența textului nu s-a putut încărca acum. Reîncarcă lista; până atunci nu presupune că textul e verificat.' }

// eticheta pentru UI; fail-closed: origine NECUNOSCUTĂ, proveniență care nu mai e a textului curent sau text fără proveniență = vizibile
export function etichetaProvenienta(p) {
  if (!p) return null
  if (p.prov_id == null) {
    return p.are_text === false ? null : { text: 'fără proveniență', icon: '⚠', nivel: 'info',
      titlu: 'Textul documentului nu are proveniență înregistrată (citit înainte de TKT-0329 B sau scrierea provenienței a eșuat). ' + NU_SURSA }
  }
  const o = ORIGINI[p.origine] || { text: `origine necunoscută: ${p.origine}`, icon: '⚠', nivel: 'atentie' }
  const cand = p.constatat_la ? new Date(p.constatat_la).toLocaleString('ro-RO') : ''
  if (p.curent !== true) {
    return { text: 'proveniență veche — textul s-a schimbat după', icon: '⚠', nivel: 'atentie',
      titlu: `Ultima proveniență înregistrată (${o.text}${cand ? `, ${cand}` : ''}) NU e a textului actual: textul documentului a fost ` +
             'rescris după, fără proveniență nouă (sau textul lipsește). ' + NU_SURSA }
  }
  const titlu = [`Proveniența textului: ${o.text}`, p.producator ? `producător ${p.producator}` : '',
    p.completitudine ? `text ${p.completitudine}` : '', cand ? `din ${cand}` : '',
    o.nivel === 'atentie' ? 'NU e verificat de om și NU e sursă pentru extragerea cantităților' : ''].filter(Boolean).join(' · ')
  return { ...o, titlu }
}
