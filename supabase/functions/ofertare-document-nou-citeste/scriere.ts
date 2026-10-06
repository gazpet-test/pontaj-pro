// ofertare-document-nou-citeste/scriere.ts — scrierea citirii (analiza.citire_noi) CU compare-and-set (R5, reparația rundei 1, 26.09.2026).
// `analiza` se recitește chiar înainte de scriere, se înlocuiește DOAR cheia proprie (citire_noi) și se scrie condiționat pe
// analiza->citire_ai->>rev (orice scriere a cheilor serverului — citirea / transferul planșei, retăierea, confirmarea conflictelor —
// schimbă rev-ul); la conflict se reface peste starea nouă, max. 3 încercări. Testat în scriere_test.ts.
// Copilot conv. 3 (06.10, P2): `sursa` = amprenta sursei citite ÎNAINTE de apelul AI (stare, procesat_la, SHA-256 al textului / calea
// fișierului). La scriere se recitește și se compară; dacă documentul a fost recitit / reprocesat între timp → stale, nimic scris.
// UPDATE-ul e condiționat și pe status_procesare + procesat_la (orice reprocesare le schimbă) + fisier_path (un upload nou scrie la cale
// nouă), deci nici fereastra dintre recitire și scriere.
import { amprentaText } from './sursa.ts'
// shaText = SHA-256 al text_extras (calea text); obiectNeschimbat = recomparația identității obiectului din Storage (calea PDF).
// inceput = ISO-ul intrării în handler: o citire_noi mai nouă decât el pe rând = „citit între timp” (alt apel), nu sursă schimbată.
export type AmprentaSursa = { status: string | null; procesat_la: string | null; shaText?: string | null; fisier_path?: string | null; obiectNeschimbat?: () => Promise<boolean>; inceput?: string }

// Copilot conv. 3 (r5, P1): o citire terminată DUPĂ începutul acestui apel (alt apel concurent) câștigă — independent de sursă
// (pe o sursă stabilă, a doua citire o suprascria tăcut). „Recitește” pornit după citirea anterioară are citit_la < inceput → trece.
async function motivSchimbare(cur: any, sursa: AmprentaSursa): Promise<string | null> {
  const cititLa = cur?.analiza?.citire_noi?.citit_la
  if (sursa.inceput && typeof cititLa === 'string' && cititLa > sursa.inceput) return 'citit_intre_timp'
  const schimbat = (cur.status_procesare ?? null) !== sursa.status || (cur.procesat_la ?? null) !== sursa.procesat_la ||
    (sursa.fisier_path != null && cur.fisier_path !== sursa.fisier_path) ||
    (!!sursa.shaText && (await amprentaText(cur.text_extras)) !== sursa.shaText) ||
    (!!sursa.obiectNeschimbat && !(await sursa.obiectNeschimbat()))
  return schimbat ? 'sursa_schimbata' : null
}

const SEL = 'analiza, status_procesare, text_extras, procesat_la, fisier_path'
export async function scrieCitireNoi(db: any, id: number, citire: any, numeOriginal: string, sursa?: AmprentaSursa): Promise<{ upErr: any; scris: boolean; stale?: boolean; motiv?: string }> {
  let upErr: any = null, scris = false
  for (let incercare = 0; incercare < 3 && !scris; incercare++) {
    const { data: cur } = await db.from('ofertare_documente_atribuire').select(SEL).eq('id', id).maybeSingle()
    if (sursa && cur) {
      const motiv = await motivSchimbare(cur, sursa)
      if (motiv) return { upErr: null, scris: false, stale: true, motiv }
    }
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
    if (sursa) {
      q = sursa.status == null ? q.is('status_procesare', null) : q.eq('status_procesare', sursa.status)
      q = sursa.procesat_la == null ? q.is('procesat_la', null) : q.eq('procesat_la', sursa.procesat_la)
      // Copilot conv. 3 (r4): și calea fișierului în CAS — un upload care schimbă doar fisier_path între recitire și UPDATE nu mai trece
      if (sursa.fisier_path != null) q = q.eq('fisier_path', sursa.fisier_path)
      // r5: și citirea existentă în CAS — o citire concurentă scrisă între recitire și UPDATE nu mai e suprascrisă
      const cititLaCur = baza?.citire_noi?.citit_la
      q = typeof cititLaCur === 'string' ? q.eq('analiza->citire_noi->>citit_la', cititLaCur) : q.is('analiza->citire_noi->>citit_la', null)
    }
    const { data: w, error } = await q.select('id')
    if (error) { upErr = error; break }
    scris = (w || []).length === 1
  }
  // CAS epuizat: dacă ultimul UPDATE a ratat din cauza sursei (nu a rev-ului), mesajul corect e „sursă schimbată”, nu „scris simultan”
  if (!scris && !upErr && sursa) {
    const { data: cur } = await db.from('ofertare_documente_atribuire').select(SEL).eq('id', id).maybeSingle()
    const motiv = cur ? await motivSchimbare(cur, sursa) : null
    if (motiv) return { upErr: null, scris: false, stale: true, motiv }
  }
  return { upErr, scris }
}
