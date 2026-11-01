// worker/ofertare/poarta_coada.ts — a doua barieră pe cozile AI ale Ofertării (20261124a, decizia Răzvan 3A; review #908 r1).
// Prima barieră e în BD: cozile se scriu doar prin ofertare_coada_porneste (auth.uid() + fn_ofertare_poate_cheltui, cerut_de = auth.uid()).
// Workerul rulează cu service_role, deci înainte de a cheltui întreabă și el poarta pentru cerut_de-ul rândului. Fail-closed:
//  - poarta spune NU (sau cerut_de lipsește) → coada se închide cu notă, fără niciun apel AI;
//  - RPC-ul / citirea cade → nu se cheltuie nimic acum, rândul rămâne activ și se reia la tura următoare (o eroare trecătoare nu
//    omoară o cerere legitimă).
export type CoadaAi = 'ofertare_ingest_coada' | 'ofertare_acoperire_coada' | 'ofertare_clarificari_coada' | 'ofertare_extragere_coada'
export const NOTA_REFUZ = '❌ refuzat: cine a cerut procesarea nu trece poarta pe cheltuială (owner / responsabil numit de owner sau de un admin Ofertare)'

// deno-lint-ignore no-explicit-any
export async function cerereaTrecePoarta(supabase: any, tabel: CoadaAi, licId: number): Promise<'da' | 'refuz' | 'eroare'> {
  try {
    const { data: c, error } = await supabase.from(tabel).select('cerut_de, activ').eq('licitatie_id', licId).maybeSingle()
    if (error) return 'eroare'
    if (!c?.activ) return 'refuz'
    let ok = false
    if (c.cerut_de) {
      const r = await supabase.rpc('fn_ofertare_poate_cheltui', { p_licitatie_id: licId, p_uid: c.cerut_de })
      if (r.error) return 'eroare'
      ok = r.data === true
    }
    if (ok) return 'da'
    const acum = new Date().toISOString()
    await supabase.from(tabel).update({ activ: false, terminat_la: acum, ultimul_tick: acum, nota: NOTA_REFUZ }).eq('licitatie_id', licId)
    return 'refuz'
  } catch (_) {
    return 'eroare'
  }
}
