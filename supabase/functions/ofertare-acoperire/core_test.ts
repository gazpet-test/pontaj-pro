// deno test -A --no-lock --no-check supabase/functions/ofertare-acoperire/core_test.ts  (--no-check: core.ts are erori TS vechi pe Map-urile de catalog, idsExp/idsAuth — nu țin de poartă)
// Poarta pe loturi în propuneAcoperiri (20261024b, review Jakarinos P1 #6): stă în CORE, deci prinde și workerul NAS
// (worker/ofertare/acoperire.ts cheamă core-ul direct, fără HTTP). Fără rețea: supabase simulat + fetch simulat.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { propuneAcoperiri } from './core.ts'
import { cuPoartaLot } from '../_test/poarta_lot.ts'

function supaFals(tabele: Record<string, any[]>) {
  return {
    rpc: (_n: string, _a?: any) => Promise.resolve({ data: null, error: { message: 'rpc neașteptat' } }),
    from(t: string) {
      const b: any = {
        select: () => b, eq: () => b, neq: () => b, is: () => b, not: () => b, in: () => b, order: () => b, limit: () => b,
        single: () => Promise.resolve({ data: (tabele[t] || [])[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: (tabele[t] || [])[0] ?? null, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        then: (ok: any, ko: any) => Promise.resolve({ data: tabele[t] || [], error: null }).then(ok, ko),
      }
      return b
    },
  }
}

const CER = [
  { id: 1, tip: 'eliminatorie', text_cerinta: 'RTE 8.4D pentru lotul 1', sursa_document_id: 10, lot_domeniu: 'lista', lot_nr: [1] },
  { id: 2, tip: 'eliminatorie', text_cerinta: 'RTE 9.1 pentru lotul 2', sursa_document_id: 10, lot_domeniu: 'lista', lot_nr: [2] },
  { id: 3, tip: 'eliminatorie', text_cerinta: 'Cerință din documentul netriat', sursa_document_id: 11, lot_domeniu: 'toate', lot_nr: null },
]
async function rulare(tabele: Record<string, any[]> = {}, opt: { motive?: Record<number, string>; cade?: boolean } = {}) {
  const baza = supaFals({
    ofertare_licitatii: [{ id: 7, nr_anunt: 'CN7', autoritate: 'AC', obiect: 'rețea gaze', stare_loturi: 'are_loturi' }],
    ofertare_licitatie_loturi: [{ nr: 1 }], ofertare_cerinte: CER,
    hr_autorizatii: [{ id: 100, numar_autorizatie: 'A1', fara_expirare: true, domenii: ['8.4 (D)'], tip: { denumire: 'RTE ISC', cod: 'RTE' }, emp: { name: 'POP ION', active: true } }],
    ...tabele,
  })
  const { supa, apeluri } = cuPoartaLot(baza, [10, 11], opt)
  const corpuri: string[] = []
  const vechi = globalThis.fetch
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
    corpuri.push(String(init?.body || ''))
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"acoperiri":[]}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }), { status: 200 }))
  }) as typeof fetch
  try { return { r: await propuneAcoperiri(supa, { licitatie_id: 7, batch: 'eliminatorie' }), corpuri, apeluri } } finally { globalThis.fetch = vechi }
}

Deno.test('acoperire loturi: la AI pleacă doar cerința eligibilă; excluse numărate, nu „fără răspuns”', async () => {
  const { r, corpuri } = await rulare({}, { motive: { 11: 'de_triat' } })
  assertEquals(corpuri.length, 1, JSON.stringify(r))
  const variabil = JSON.parse(corpuri[0]).messages[0].content[1].text as string
  assert(variabil.includes('RTE 8.4D pentru lotul 1'))
  assertFalse(variabil.includes('lotul 2') || variabil.includes('netriat'), variabil)
  assertFalse(variabil.includes('lot_domeniu') || variabil.includes('sursa_document_id'), 'câmpurile porții nu intră în prompt')
  assertEquals(r.excluse_lot, 2)
  assertEquals(r.excluse_motive, { lot_in_afara: 1, document_de_triat: 1 })
  assertEquals(r.cerinte_fara_raspuns, [1], 'excluse nu ajung la reluare')
})

Deno.test('acoperire loturi: fără participare / poarta picată / nimic eligibil => niciun apel AI', async () => {
  const nicio = await rulare({ ofertare_licitatie_loturi: [] })
  assertEquals([nicio.corpuri.length, nicio.r.motiv_lot], [0, 'nicio_participare'])
  assert(String(nicio.r.error).startsWith('Blocat pe loturi'))
  const cade = await rulare({}, { cade: true })
  assertEquals([cade.corpuri.length, cade.r.motiv_lot], [0, 'eroare_poarta'])
  const gol = await rulare({ ofertare_cerinte: CER.slice(1) }, { motive: { 11: 'in_afara_loturilor' } })
  assertEquals(gol.corpuri.length, 0)
  assert(gol.r.ok && /nu s-a chemat AI-ul/.test(gol.r.skip), JSON.stringify(gol.r))
  assertEquals(gol.r.excluse_motive, { lot_in_afara: 1, document_in_afara_loturilor: 1 })
  // fără loturi: totul trece (comportamentul vechi), cu poarta tot întrebată
  const fara = await rulare({ ofertare_licitatii: [{ id: 7, nr_anunt: 'CN7', obiect: 'x', stare_loturi: 'fara_loturi' }] })
  assertEquals(fara.corpuri.length, 1)
  assertEquals(fara.r.excluse_lot, 0)
})
