// Salvarea liniilor unui bon de consum fără fereastra „șters, apoi refuzat” (review #806 r2/r3, Codex P2).
// Protocolul (din client, fără RPC nou — o salvare tranzacțională reală e o decizie separată):
//   (1) bucatiProtejate: verificarea bucăților din registrul de țeavă ÎNAINTE de orice scriere (nici antetul nu se atinge);
//   (2) antetul se actualizează cu control de versiune (updated_at citit la deschidere) — o editare concurentă e refuzată;
//   (3) salveazaLiniiBon: id-urile liniilor existente se RECITESC din BD (un retry după o salvare parțială le include și
//       pe cele inserate atunci), liniile noi se inserează, apoi se șterg exact liniile citite; dacă ștergerea afectează
//       alt număr de rânduri (RLS, editare concurentă) se raportează conflict, nu succes.

/** id-urile unice de bucăți trasabile de pe liniile bonului. */
export function bucatiPeLinii(rows) {
  return [...new Set(rows.map(r => r.magazie_bucata_id).filter(Boolean).map(Number))]
}

/** Bucățile din registru de pe linii (funcția lipsește înainte de migrare → nimic protejat). */
export async function bucatiProtejate(db, rows) {
  const protejate = []
  for (const id of bucatiPeLinii(rows)) {
    const { data, error } = await db.rpc('fn_izo_bucata_protejata', { p_bucata: id })
    if (!error && data === true) protejate.push(id)
  }
  return protejate
}

/**
 * @param {object} db      clientul supabase
 * @param {number} bonId
 * @param {object[]} rows  liniile noi (cu bon_id)
 * @returns {Promise<{ok: boolean, motiv?: string, protejate?: number[]}>}
 */
export async function salveazaLiniiBon(db, bonId, rows) {
  const protejate = await bucatiProtejate(db, rows)
  if (protejate.length) return { ok: false, motiv: 'registru', protejate }
  const { data: existente, error: eSel } = await db.from('executie_bonuri_consum_linii').select('id').eq('bon_id', bonId)
  if (eSel) return { ok: false, motiv: eSel.message || String(eSel) }
  const vechiIds = (existente || []).map(l => l.id)
  const { error: eIns } = await db.from('executie_bonuri_consum_linii').insert(rows)
  if (eIns) return { ok: false, motiv: eIns.message || String(eIns) }
  if (vechiIds.length) {
    const { data: sterse, error: eDel } = await db.from('executie_bonuri_consum_linii').delete().eq('bon_id', bonId).in('id', vechiIds).select('id')
    if (eDel) return { ok: false, motiv: 'liniile vechi nu s-au putut șterge (bonul are acum și liniile noi; reîncercarea le curăță): ' + (eDel.message || eDel) }
    if ((sterse || []).length !== vechiIds.length)
      return { ok: false, motiv: `conflict: s-au șters ${(sterse || []).length} din ${vechiIds.length} linii vechi (bon modificat între timp?) — reîncarcă bonul` }
  }
  return { ok: true }
}
