// deno test --node-modules-dir=none supabase/functions/ofertare-cerinte/exemple_test.ts
// Review Jakarinos r5 P1 #3: exemplele ai_feedback intră în promptul sistem doar cu proveniență verificată acum.
import { deepStrictEqual as eq } from 'node:assert/strict'
import { exempleFeedback } from './exemple.ts'
import { fakeSupa } from '../_test/fake_supa.ts'
import { cuPoartaLot } from '../_test/poarta_lot.ts'

const CK = 'ofertare-cerinte|cs|alta'
const fb = (id: number, ref_id: number | null, ref_table: string | null = 'ofertare_cerinte') =>
  ({ id, context_cheie: CK, verdict: 'corectat', ref_table, ref_id, output_ai: { t: 'AI_' + id }, output_corectat: { t: 'OM_' + id } })

function db(opt: { motive?: Record<number, string>; cade?: boolean } = {}, extra: Record<string, any[]> = {}) {
  const { supa } = fakeSupa({
    ai_feedback: [fb(1, 101), fb(2, 102), fb(3, 103), fb(4, null), fb(5, 105, 'alt_tabel'), fb(6, 999), fb(7, 107)],
    ofertare_cerinte: [
      { id: 101, licitatie_id: 50, sursa_document_id: 10, lot_domeniu: 'toate', lot_nr: null },   // ok
      { id: 102, licitatie_id: 60, sursa_document_id: 20, lot_domeniu: 'lista', lot_nr: [1] },     // lot 1, participăm la 2
      { id: 103, licitatie_id: 50, sursa_document_id: 11, lot_domeniu: 'toate', lot_nr: null },    // document 11 blocat
      { id: 105, licitatie_id: 50, sursa_document_id: 10, lot_domeniu: 'toate', lot_nr: null },    // dar ref_table greșit
      { id: 107, licitatie_id: 50, sursa_document_id: null, lot_domeniu: 'toate', lot_nr: null },  // fără document-sursă
    ],
    ofertare_licitatii: [{ id: 50, stare_loturi: 'fara_loturi' }, { id: 60, stare_loturi: 'are_loturi' }],
    ofertare_licitatie_loturi: [{ licitatie_id: 60, nr: 2, participam: true }],
    ...extra,
  })
  return cuPoartaLot(supa, [10, 11, 20], opt).supa
}

Deno.test('exemple feedback: doar cele cu cerință + document eligibil + lot în participare', async () => {
  const r = await exempleFeedback(db({ motive: { 11: 'de_triat' } }), CK, 3)
  eq(r.exemple.map((x) => x.id), [1])
  eq(r.omise, 6)
})
Deno.test('exemple feedback: poarta căzută = zero exemple (nu nefiltrate)', async () => {
  eq((await exempleFeedback(db({ cade: true }), CK, 3)).exemple, [])
})
Deno.test('exemple feedback: lotul 1 devine participant => exemplul lotului 1 intră', async () => {
  const r = await exempleFeedback(db({}, { ofertare_licitatie_loturi: [{ licitatie_id: 60, nr: 1, participam: true }] }), CK, 3)
  eq(r.exemple.map((x) => x.id), [1, 2, 3])
})
Deno.test('exemple feedback: fără feedback = listă goală, fără citiri de cerințe', async () => {
  const { supa, n } = fakeSupa({ ai_feedback: [] })
  eq(await exempleFeedback(cuPoartaLot(supa, []).supa, CK, 3), { exemple: [], omise: 0 })
  eq(n.citiri.includes('ofertare_cerinte'), false)
})
