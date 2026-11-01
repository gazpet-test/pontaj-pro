// Poarta unică pe cheltuială AI în Ofertare (20261124a, decizia Răzvan 01.11.2026: varianta 1 + A).
// Permis: ownerul, sau responsabilul 1 / 2 al licitației numit de owner / un admin Ofertare (nu autoatribuit); numirile vechi fără
// „numit de” rămân permise. Regula stă într-un singur loc, în SQL: fn_ofertare_poate_cheltui (EXECUTE doar service_role).
// Fail-closed: orice eroare, răspuns ne-boolean sau parametru lipsă = refuz.
type ClientRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }

export async function poateCheltui(db: ClientRpc, licitatieId: number | string | null | undefined, uid: string | null | undefined): Promise<boolean> {
  const lic = Number(licitatieId)
  if (!uid || !Number.isSafeInteger(lic) || lic <= 0) return false
  try {
    const { data, error } = await db.rpc('fn_ofertare_poate_cheltui', { p_licitatie_id: lic, p_uid: uid })
    return !error && data === true
  } catch {
    return false
  }
}

// r4 (#908, review r3 Copilot P1-02): cheltuiala fără licitație (RFQ neasociat — nu are responsabil) = doar ownerul, tot printr-o funcție
// a migrării 20261124a (fn_ofertare_poate_cheltui_fara_licitatie, EXECUTE doar service_role). Fail-closed ca mai sus.
export async function poateCheltuiFaraLicitatie(db: ClientRpc, uid: string | null | undefined): Promise<boolean> {
  if (!uid) return false
  try {
    const { data, error } = await db.rpc('fn_ofertare_poate_cheltui_fara_licitatie', { p_uid: uid })
    return !error && data === true
  } catch {
    return false
  }
}

export const MESAJ_CHELTUIALA = 'o pornește doar ownerul sau un responsabil al licitației numit de owner / un admin Ofertare (costă)'
