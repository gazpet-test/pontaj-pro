// ofertare-document-nou-citeste/scriere.ts — scrierea citirii (analiza.citire_noi) CU compare-and-set (R5, reparația rundei 1, 26.09.2026).
// `analiza` se recitește chiar înainte de scriere, se înlocuiește DOAR cheia proprie (citire_noi) și se scrie condiționat pe
// analiza->citire_ai->>rev (orice scriere a cheilor serverului — citirea / transferul planșei, retăierea, confirmarea conflictelor —
// schimbă rev-ul); la conflict se reface peste starea nouă, max. 3 încercări. Testat în scriere_test.ts.
export async function scrieCitireNoi(db: any, id: number, citire: any, numeOriginal: string): Promise<{ upErr: any; scris: boolean }> {
  let upErr: any = null, scris = false
  for (let incercare = 0; incercare < 3 && !scris; incercare++) {
    const { data: cur } = await db.from('ofertare_documente_atribuire').select('analiza, status_procesare, text_extras').eq('id', id).maybeSingle()
    const baza = cur?.analiza && typeof cur.analiza === 'object' ? cur.analiza : {}
    const upd: Record<string, unknown> = { analiza: { ...baza, citire_noi: citire }, analiza_la: new Date().toISOString() }
    if (cur && !cur.text_extras && ['neprocesat', 'eroare', null].includes(cur.status_procesare)) {
      const L = [`DOCUMENT: ${numeOriginal}`, `Tip: ${citire.tip}`, '', citire.rezumat]
      if (citire.modificari.length) { L.push('', 'MODIFICĂRI:'); for (const m of citire.modificari) L.push('- ' + (typeof m === 'string' ? m : JSON.stringify(m))) }
      if (citire.intrebari_raspunse.length) { L.push('', 'ÎNTREBĂRI ȘI RĂSPUNSURI:'); for (const q of citire.intrebari_raspunse) L.push('- ' + (typeof q === 'string' ? q : JSON.stringify(q))) }
      Object.assign(upd, { status_procesare: 'procesat', text_extras: L.join('\n'), eroare: null, procesat_la: new Date().toISOString() })
    }
    const rev = baza?.citire_ai?.rev ?? null
    let q = db.from('ofertare_documente_atribuire').update(upd).eq('id', id)
    q = rev == null ? q.is('analiza->citire_ai->>rev', null) : q.eq('analiza->citire_ai->>rev', String(rev))
    const { data: w, error } = await q.select('id')
    if (error) { upErr = error; break }
    scris = (w || []).length === 1
  }
  return { upErr, scris }
}
