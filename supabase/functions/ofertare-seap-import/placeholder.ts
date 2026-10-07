// placeholder.ts — scrierea rândului unui document adus din SEAP, cu completarea placeholder-ului pus de veghe
// (ofertare-seap-import). Separată de index.ts ca să fie testabilă (placeholder_test.ts).
//
// Audit Jakarinos 07.10.2026 (#2): placeholder-ul se completează O SINGURĂ DATĂ. E consumat din hartă la prima folosire, iar
// UPDATE-ul trece doar dacă rândul e ÎNCĂ placeholder (alt drum — workerul NAS — l-ar fi putut completa între timp). Înainte,
// „Anexa (1).pdf” și „Anexa 1.pdf” dintr-un ZIP (aceeași cheie de nume, conținut diferit) scriau amândouă în același rând:
// al doilea îl înlocuia pe primul, iar obiectul primului rămânea fără rând. Același tratament ca urca() din worker/ofertare/seap.ts.
export type Scriere = { id: number | null; completat: boolean; eroare?: string }

// deno-lint-ignore no-explicit-any
export async function scrieDocument(supa: any, rand: Record<string, unknown>, cheie: string, placeholders: Map<string, number>): Promise<Scriere> {
  const idPh = placeholders.get(cheie)
  if (idPh) {
    placeholders.delete(cheie)
    const { data, error } = await supa.from('ofertare_documente_atribuire').update(rand).eq('id', idPh)
      .or('fisier_path.is.null,fisier_path.like.%/neincarcat/%').select('id')
    if (error) return { id: null, completat: false, eroare: error.message }
    if (Array.isArray(data) && data.length === 1) return { id: data[0].id as number, completat: true }
    // completat între timp de alt drum → rând nou, nu suprascriere
  }
  const { data, error } = await supa.from('ofertare_documente_atribuire').insert(rand).select('id').maybeSingle()
  if (error) return { id: null, completat: false, eroare: error.message }
  return { id: (data?.id ?? null) as number | null, completat: false }
}
