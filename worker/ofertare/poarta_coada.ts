// worker/ofertare/poarta_coada.ts — a doua barieră pe cozile AI ale Ofertării (20261124a, decizia Răzvan 3A; review #908 r1 + r2).
// Prima barieră e în BD: cozile se scriu doar prin ofertare_coada_porneste (auth.uid() + fn_ofertare_poate_cheltui, cerut_de = auth.uid()).
// Workerul rulează cu service_role, deci înainte de FIECARE apel plătit (felie, reîncercare, document) întreabă și el poarta pentru
// cerut_de-ul rândului (r2 Jakarinos P1-03: o revocare între două felii oprește restul). Fail-closed:
//  - poarta spune NU (sau cerut_de lipsește) → coada se închide cu notă, fără niciun apel AI;
//  - cererea a fost înlocuită între timp (alt cerut_la = altă generație, r2 P2-01) → rularea curentă se oprește, fără să atingă rândul nou;
//  - RPC-ul / citirea / scrierea cade → nu se cheltuie nimic acum (garda reîncearcă de câteva ori, apoi oprește rularea).
export type CoadaAi = 'ofertare_ingest_coada' | 'ofertare_acoperire_coada' | 'ofertare_clarificari_coada' | 'ofertare_extragere_coada'
export type Verdict = 'da' | 'refuz' | 'inlocuita' | 'eroare'
export const NOTA_REFUZ = '❌ refuzat: cine a cerut procesarea nu trece poarta pe cheltuială (owner / responsabil numit de owner sau de un admin Ofertare)'
export const NOTA_EROARE = '⏸ oprit: poarta pe cheltuială nu s-a putut verifica (eroare de citire) — pornește din nou procesarea'

// generatie = cerut_la-ul cererii pe care o procesezi; lipsă = prima citire (o adoptă). Întoarce verdictul și generația văzută.
// deno-lint-ignore no-explicit-any
export async function cerereaTrecePoarta(supabase: any, tabel: CoadaAi, licId: number, generatie?: string | null): Promise<{ v: Verdict; generatie: string | null }> {
  try {
    const { data: c, error } = await supabase.from(tabel).select('cerut_de, cerut_la, activ').eq('licitatie_id', licId).maybeSingle()
    if (error) return { v: 'eroare', generatie: generatie ?? null }
    if (!c?.activ) return { v: 'refuz', generatie: c?.cerut_la ?? null }
    if (generatie && c.cerut_la !== generatie) return { v: 'inlocuita', generatie: c.cerut_la }
    let ok = false
    if (c.cerut_de) {
      const r = await supabase.rpc('fn_ofertare_poate_cheltui', { p_licitatie_id: licId, p_uid: c.cerut_de })
      if (r.error) return { v: 'eroare', generatie: c.cerut_la }
      ok = r.data === true
    }
    if (ok) return { v: 'da', generatie: c.cerut_la }
    // închidere doar pe ACEEAȘI cerere (CAS pe generație + cerut_de + activ): o cerere nouă pusă între timp nu se atinge
    const acum = new Date().toISOString()
    const { data: rand, error: eU } = await supabase.from(tabel).update({ activ: false, terminat_la: acum, ultimul_tick: acum, nota: NOTA_REFUZ })
      .eq('licitatie_id', licId).eq('cerut_la', c.cerut_la).eq('activ', true).select('licitatie_id')
    if (eU) return { v: 'eroare', generatie: c.cerut_la }
    return { v: Array.isArray(rand) && rand.length === 1 ? 'refuz' : 'inlocuita', generatie: c.cerut_la }
  } catch (_) {
    return { v: 'eroare', generatie: generatie ?? null }
  }
}

// Garda pentru o rulare: o funcție apelată înaintea fiecărui cost. true = poți cheltui. La eroare reîncearcă (pauză), apoi
// închide cererea (CAS pe generație) cu NOTA_EROARE și întoarce false. `pauza` injectabil pentru teste.
// deno-lint-ignore no-explicit-any
export function gardaCheltuiala(supabase: any, tabel: CoadaAi, licId: number, generatie: string | null,
  o: { incercari?: number; pauza?: (ms: number) => Promise<void> } = {}): () => Promise<boolean> {
  const pauza = o.pauza ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const n = o.incercari ?? 3
  return async () => {
    for (let i = 1; i <= n; i++) {
      const { v } = await cerereaTrecePoarta(supabase, tabel, licId, generatie)
      if (v === 'da') return true
      if (v !== 'eroare') return false
      if (i < n) await pauza(20_000 * i)
    }
    try {
      const acum = new Date().toISOString()
      let q = supabase.from(tabel).update({ activ: false, terminat_la: acum, ultimul_tick: acum, nota: NOTA_EROARE }).eq('licitatie_id', licId).eq('activ', true)
      if (generatie) q = q.eq('cerut_la', generatie)
      await q
    } catch (_) { /* nu se cheltuie oricum */ }
    return false
  }
}
