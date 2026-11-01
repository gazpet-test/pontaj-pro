// worker/ofertare/poarta_coada.ts — a doua barieră pe cozile AI ale Ofertării (20261124a, decizia Răzvan 3A; review #908 r1–r3).
// Prima barieră e în BD: cozile se scriu doar prin ofertare_coada_porneste (auth.uid() + fn_ofertare_poate_cheltui, cerut_de = auth.uid()).
// Workerul rulează cu service_role, deci înainte de FIECARE apel plătit (felie, reîncercare, document) întreabă și el poarta pentru
// cerut_de-ul rândului (r2 Jakarinos P1-03: o revocare între două felii oprește restul). Fail-closed:
//  - poarta spune NU (sau cerut_de lipsește) → coada se închide cu notă, fără niciun apel AI;
//  - cererea a fost înlocuită între timp (alt cerut_la / alt cerut_de = altă generație, r2 P2-01) → rularea curentă se oprește, fără să
//    atingă rândul nou;
//  - RPC-ul / citirea / scrierea cade → nu se cheltuie nimic acum (garda reîncearcă de câteva ori, apoi oprește rularea).
// r4 (review r3: Copilot P2-01/P2-02/P2-03, Jakarinos P2-01): identitatea cererii = (cerut_la, cerut_de); verdictul pozitiv se reconfirmă
// după RPC (rândul recitit trebuie să fie ACEEAȘI cerere, încă activă); TOATE scrierile procesării pe coadă (progres + închiderea finală)
// trec prin Garda.scrie = CAS pe licitație + generație + cerut_de + activ, cu rezultatul verificat — o rulare veche nu mai poate închide
// sau suprascrie cererea nouă. Garda e parametru OBLIGATORIU al procesărilor (ingest / acoperire / clarificări).
export type CoadaAi = 'ofertare_ingest_coada' | 'ofertare_acoperire_coada' | 'ofertare_clarificari_coada' | 'ofertare_extragere_coada'
export type Verdict = 'da' | 'refuz' | 'inlocuita' | 'eroare'
export type Cerere = { cerut_la: string; cerut_de: string | null }
export type RezScriere = 'ok' | 'inlocuita' | 'eroare'
// Garda unei rulări: apelată înaintea fiecărui cost (true = poți cheltui); `scrie` = singura cale de scriere pe rândul cozii.
export type Garda = (() => Promise<boolean>) & { cerere: Cerere; scrie: (patch: Record<string, unknown>) => Promise<RezScriere> }
export const NOTA_REFUZ = '❌ refuzat: cine a cerut procesarea nu trece poarta pe cheltuială (owner / responsabil numit de owner sau de un admin Ofertare)'
export const NOTA_EROARE = '⏸ oprit: poarta pe cheltuială nu s-a putut verifica (eroare de citire) — pornește din nou procesarea'

const aceeasi = (c: { activ?: boolean; cerut_la?: string; cerut_de?: string | null } | null, cer: Cerere) =>
  !!c && c.activ === true && c.cerut_la === cer.cerut_la && (c.cerut_de ?? null) === (cer.cerut_de ?? null)

// CAS pe cererea `cer`: actualizează rândul DOAR dacă e încă aceeași cerere, activă. Rezultatul UPDATE-ului e verificat.
// deno-lint-ignore no-explicit-any
export async function scrieCas(supabase: any, tabel: CoadaAi, licId: number, cer: Cerere, patch: Record<string, unknown>): Promise<RezScriere> {
  try {
    let q = supabase.from(tabel).update(patch).eq('licitatie_id', licId).eq('cerut_la', cer.cerut_la).eq('activ', true)
    q = cer.cerut_de === null ? q.is('cerut_de', null) : q.eq('cerut_de', cer.cerut_de)
    const { data, error } = await q.select('licitatie_id')
    if (error) return 'eroare'
    return Array.isArray(data) && data.length === 1 ? 'ok' : 'inlocuita'
  } catch (_) {
    return 'eroare'
  }
}

// r5 (review r5 Jakarinos P1-01 / Copilot P1-01): persistarea unui rezultat DEJA PLĂTIT. O scriere eșuată nu se transformă în „reia bucla”
// (care ar reciti aceeași bucată și ar plăti din nou apelul AI): ACEEAȘI scriere se reîncearcă, cu pauză crescătoare, până reușește ('ok'),
// până cererea e înlocuită / oprită ('stop'), sau până se oprește workerul ('stop' — rezultatul nescris se pierde, fără apel AI nou).
// deno-lint-ignore no-explicit-any
export async function scrieCuReincercare(supabase: any, tabel: CoadaAi, licId: number, cer: Cerere, patch: Record<string, unknown>,
  o: { oprire: () => boolean; pauza?: (ms: number) => Promise<void>; log?: (m: string) => void }): Promise<'ok' | 'stop'> {
  const pauza = o.pauza ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const log = o.log ?? (() => {})
  for (let n = 1; ; n++) {
    const rz = await scrieCas(supabase, tabel, licId, cer, patch)
    if (rz === 'ok') return 'ok'
    if (rz === 'inlocuita') { log(`#${licId} ${tabel}: cererea a fost înlocuită / oprită între timp — n-o ating`); return 'stop' }
    if (o.oprire()) { log(`#${licId} ${tabel}: scrierea a eșuat și workerul se oprește — rezultatul nescris se pierde, fără apel nou`); return 'stop' }
    log(`#${licId} ${tabel}: scrierea a eșuat (încercarea ${n}) — reîncerc ACEEAȘI scriere, fără apel AI nou`)
    await pauza(Math.min(30_000 * n, 300_000))
  }
}

// cer = cererea pe care o procesezi; lipsă = prima citire (o adoptă). Întoarce verdictul și cererea văzută.
// deno-lint-ignore no-explicit-any
export async function cerereaTrecePoarta(supabase: any, tabel: CoadaAi, licId: number, cer?: Cerere | null): Promise<{ v: Verdict; cerere: Cerere | null }> {
  const citeste = async () => {
    const { data, error } = await supabase.from(tabel).select('cerut_de, cerut_la, activ').eq('licitatie_id', licId).maybeSingle()
    return { c: data as { activ: boolean; cerut_la: string; cerut_de: string | null } | null, error }
  }
  try {
    const { c, error } = await citeste()
    if (error) return { v: 'eroare', cerere: cer ?? null }
    const vazuta: Cerere | null = c ? { cerut_la: c.cerut_la, cerut_de: c.cerut_de ?? null } : null
    if (cer && !aceeasi(c, cer)) return { v: c?.activ ? 'inlocuita' : 'refuz', cerere: vazuta }
    if (!c?.activ || !vazuta) return { v: 'refuz', cerere: vazuta }
    let ok = false
    if (vazuta.cerut_de) {
      const r = await supabase.rpc('fn_ofertare_poate_cheltui', { p_licitatie_id: licId, p_uid: vazuta.cerut_de })
      if (r.error) return { v: 'eroare', cerere: vazuta }
      ok = r.data === true
    }
    if (ok) {
      // r4 (Copilot r3 P2-02): rândul se recitește după RPC — „da” doar dacă e ÎNCĂ aceeași cerere, activă (oprire / înlocuire în timpul RPC)
      const d = await citeste()
      if (d.error) return { v: 'eroare', cerere: vazuta }
      return { v: aceeasi(d.c, vazuta) ? 'da' : (d.c?.activ ? 'inlocuita' : 'refuz'), cerere: vazuta }
    }
    // închidere doar pe ACEEAȘI cerere (CAS pe generație + cerut_de + activ): o cerere nouă pusă între timp nu se atinge
    const acum = new Date().toISOString()
    const r = await scrieCas(supabase, tabel, licId, vazuta, { activ: false, terminat_la: acum, ultimul_tick: acum, nota: NOTA_REFUZ })
    return { v: r === 'ok' ? 'refuz' : r, cerere: vazuta }
  } catch (_) {
    return { v: 'eroare', cerere: cer ?? null }
  }
}

// Garda pentru o rulare: o funcție apelată înaintea fiecărui cost. true = poți cheltui. La eroare reîncearcă (pauză), apoi
// închide cererea (CAS pe cerere, rezultat verificat) cu NOTA_EROARE și întoarce false. `pauza` / `log` injectabile pentru teste.
// deno-lint-ignore no-explicit-any
export function gardaCheltuiala(supabase: any, tabel: CoadaAi, licId: number, cer: Cerere,
  o: { incercari?: number; pauza?: (ms: number) => Promise<void>; log?: (m: string) => void; oprire?: () => boolean } = {}): Garda {
  const pauza = o.pauza ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const log = o.log ?? ((m: string) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[poarta]', m))
  const n = o.incercari ?? 3
  const g = (async () => {
    for (let i = 1; i <= n; i++) {
      const { v } = await cerereaTrecePoarta(supabase, tabel, licId, cer)
      if (v === 'da') return true
      if (v !== 'eroare') return false
      if (i < n) await pauza(20_000 * i)
    }
    const acum = new Date().toISOString()
    const r = await scrieCas(supabase, tabel, licId, cer, { activ: false, terminat_la: acum, ultimul_tick: acum, nota: NOTA_EROARE })
    // r4 (Copilot r3 P2-03): închiderea poate să nu reușească — nu se cheltuie oricum, dar se spune explicit
    if (r !== 'ok') log(`#${licId} ${tabel}: închiderea după erori a poartă ${r === 'inlocuita' ? 'n-a mai găsit cererea (înlocuită / oprită)' : 'a eșuat — cererea poate rămâne activă, workerul o reverifică la următoarea preluare'}`)
    return false
  }) as Garda
  g.cerere = cer
  // r6 (review r6 Jakarinos P1-01): progresul și închiderea pe coadă (acoperire, clarificări, ingest) persistă un rezultat DEJA PLĂTIT —
  // o scriere eșuată se reîncearcă (aceeași scriere), nu se abandonează (cererea ar rămâne activă și preluarea următoare ar plăti din nou).
  // 'ok' = scris; 'inlocuita' = cerere înlocuită / oprită (rândul nou neatins); 'eroare' = DOAR când workerul se oprește în timpul reîncercărilor.
  const oprire = o.oprire ?? (() => false)
  g.scrie = async (patch) => {
    const r = await scrieCuReincercare(supabase, tabel, licId, cer, patch, { oprire, pauza, log })
    return r === 'ok' ? 'ok' : oprire() ? 'eroare' : 'inlocuita'
  }
  return g
}
