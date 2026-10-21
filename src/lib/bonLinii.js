// Salvarea liniilor unui bon de consum fără fereastra „șters, apoi refuzat” (review #806 r2, Codex P2-9).
// Ordinea: (1) verificarea bucăților din registrul de țeavă ÎNAINTE de orice scriere; (2) liniile noi se inserează;
// (3) abia după ce inserarea a reușit se șterg liniile vechi, după id. Dacă (2) eșuează, liniile vechi rămân neatinse.

/** id-urile unice de bucăți trasabile de pe liniile bonului. */
export function bucatiPeLinii(rows) {
  return [...new Set(rows.map(r => r.magazie_bucata_id).filter(Boolean).map(Number))]
}

/**
 * @param {object} db         clientul supabase
 * @param {number} bonId
 * @param {object[]} rows     liniile noi (cu bon_id)
 * @param {number[]} vechiIds id-urile liniilor existente (pentru editare); [] la bon nou
 * @returns {Promise<{ok: boolean, motiv?: string, protejate?: number[]}>}
 */
export async function salveazaLiniiBon(db, bonId, rows, vechiIds = []) {
  // (1) bucățile din registru nu intră pe bon — refuz înainte să atingem ceva (funcția lipsește înainte de migrare: nimic protejat)
  const protejate = []
  for (const id of bucatiPeLinii(rows)) {
    const { data, error } = await db.rpc('fn_izo_bucata_protejata', { p_bucata: id })
    if (!error && data === true) protejate.push(id)
  }
  if (protejate.length) return { ok: false, motiv: 'registru', protejate }
  // (2) liniile noi
  const { error: eIns } = await db.from('executie_bonuri_consum_linii').insert(rows)
  if (eIns) return { ok: false, motiv: eIns.message || String(eIns) }
  // (3) liniile vechi, doar după inserarea reușită
  if (vechiIds.length) {
    const { error: eDel } = await db.from('executie_bonuri_consum_linii').delete().eq('bon_id', bonId).in('id', vechiIds)
    if (eDel) return { ok: false, motiv: 'liniile vechi nu s-au putut șterge (bonul are acum și liniile noi): ' + (eDel.message || eDel) }
  }
  return { ok: true }
}
