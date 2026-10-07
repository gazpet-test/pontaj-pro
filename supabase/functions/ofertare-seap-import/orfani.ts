// orfani.ts — curățenia obiectelor din Storage fără rând în BD, la finalul unui import (ofertare-seap-import).
// Separată de index.ts ca să fie testabilă (orfani_test.ts).
//
// Audit Jakarinos 07.10.2026 (#1, P0): varianta veche ștergea TOT ce lista Storage dacă SELECT-ul din BD eșua (randuri=null →
// set gol → toate obiectele „orfane”) și ștergea și obiectele urcate CHIAR ATUNCI de alt drum (worker NAS, api Vercel, UI),
// aflate între upload și INSERT — toate scriu în același `<id>/atribuire/`. Acum, fail-closed:
//   - orice eroare (listare, SELECT, pagină) = nu se șterge nimic;
//   - inventarul din BD se citește pe pagini (plafonul de rânduri al PostgREST nu mai trunchiază tăcut lista);
//   - se șterg doar obiectele mai vechi de VARSTA_MINIMA_ORFAN_MS (un upload în curs nu e niciodată „orfan”);
//   - un obiect fără dată citibilă nu se șterge.
export const VARSTA_MINIMA_ORFAN_MS = 60 * 60_000
const PAGINA = 1000

// deno-lint-ignore no-explicit-any
export async function curataOrfani(supa: any, licitatieId: number, acum: number = Date.now()): Promise<string[]> {
  try {
    const prefix = `${licitatieId}/atribuire`
    const { data: obiecte, error: eLista } = await supa.storage.from('ofertare').list(prefix, { limit: 1000 })
    if (eLista || !Array.isArray(obiecte) || !obiecte.length) return []
    const folosite = new Set<string>()
    for (let de = 0; ; de += PAGINA) {
      const { data: randuri, error } = await supa.from('ofertare_documente_atribuire')
        .select('fisier_path').eq('licitatie_id', licitatieId).order('id').range(de, de + PAGINA - 1)
      if (error || !Array.isArray(randuri)) return []   // inventar necunoscut = nimic nu e „orfan”
      for (const r of randuri) folosite.add(String(r?.fisier_path || ''))
      if (randuri.length < PAGINA) break
    }
    const prag = acum - VARSTA_MINIMA_ORFAN_MS
    const orfani = obiecte
      .filter((o: { name?: string; id?: string | null }) => o?.name && o?.id)   // id null = subfolder, nu fișier
      .filter((o: { created_at?: string; updated_at?: string }) => {
        const t = Date.parse(o.created_at ?? o.updated_at ?? '')
        return Number.isFinite(t) && t < prag
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
