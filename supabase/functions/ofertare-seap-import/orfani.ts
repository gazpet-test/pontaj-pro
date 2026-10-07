// orfani.ts — curățenia obiectelor din Storage fără rând în BD, la finalul unui import (ofertare-seap-import).
// Separată de index.ts ca să fie testabilă (orfani_test.ts).
//
// Audit Jakarinos 07.10.2026 (#1, P0): varianta veche ștergea TOT ce lista Storage dacă SELECT-ul din BD eșua (randuri=null →
// set gol → toate obiectele „orfane”) și ștergea și obiectele urcate CHIAR ATUNCI de alt drum (worker NAS, api Vercel, UI),
// aflate între upload și INSERT — toate scriu în același `<id>/atribuire/`. Acum, fail-closed:
//   - orice eroare (listare, SELECT, pagină) = nu se șterge nimic;
//   - inventarul din BD se citește pe pagini (plafonul de rânduri al PostgREST nu mai trunchiază tăcut lista);
//   - se șterg doar obiectele mai vechi de VARSTA_MINIMA_ORFAN_MS (un upload în curs nu e niciodată „orfan”);
//   - un obiect fără dată citibilă nu se șterge; contează data cea MAI RECENTĂ dintre created_at și updated_at;
//   - listarea Storage e paginată (offset), plafonată la PAGINI_STORAGE × 1000 obiecte pe rulare (Copilot P2 r1 pe #646);
//   - fișierul semnat original al unui document desfăcut pe loc (seap_meta.semnat.path, worker NAS, var. B 07.10.2026) e
//     FOLOSIT: e dovada semnăturii, nu un orfan.
export const VARSTA_MINIMA_ORFAN_MS = 60 * 60_000
const PAGINA = 1000
const PAGINI_STORAGE = 20

// deno-lint-ignore no-explicit-any
export async function curataOrfani(supa: any, licitatieId: number, acum: number = Date.now()): Promise<string[]> {
  try {
    const prefix = `${licitatieId}/atribuire`
    // deno-lint-ignore no-explicit-any
    const obiecte: any[] = []
    for (let p = 0; p < PAGINI_STORAGE; p++) {
      const { data: lot, error: eLista } = await supa.storage.from('ofertare').list(prefix, { limit: PAGINA, offset: p * PAGINA })
      if (eLista || !Array.isArray(lot)) return []
      obiecte.push(...lot)
      if (lot.length < PAGINA) break
    }
    if (!obiecte.length) return []
    const folosite = new Set<string>()
    for (let de = 0; ; de += PAGINA) {
      const { data: randuri, error } = await supa.from('ofertare_documente_atribuire')
        .select('fisier_path, seap_meta').eq('licitatie_id', licitatieId).order('id').range(de, de + PAGINA - 1)
      if (error || !Array.isArray(randuri)) return []   // inventar necunoscut = nimic nu e „orfan”
      for (const r of randuri) {
        folosite.add(String(r?.fisier_path || ''))
        const semnat = r?.seap_meta?.semnat?.path
        if (typeof semnat === 'string' && semnat) folosite.add(semnat)
      }
      if (randuri.length < PAGINA) break
    }
    const prag = acum - VARSTA_MINIMA_ORFAN_MS
    const orfani = obiecte
      .filter((o: { name?: string; id?: string | null }) => o?.name && o?.id)   // id null = subfolder, nu fișier
      .filter((o: { created_at?: string; updated_at?: string }) => {
        const t = [o.created_at, o.updated_at].map(x => Date.parse(x ?? '')).filter(Number.isFinite)
        return t.length > 0 && Math.max(...t) < prag   // atins recent (creat SAU modificat) = nu e orfan
      })
      .map((o: { name: string }) => `${prefix}/${o.name}`)
      .filter((cale: string) => !folosite.has(cale))
    if (!orfani.length) return []
    const { error } = await supa.storage.from('ofertare').remove(orfani)
    return error ? [] : orfani
  } catch (_) {
    return []   // curățenia nu are voie să strice importul
  }
}
